import { and, eq, gt, lt, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import {
  adaptyWebhookEvents,
  smartImportUsage,
  subscriptionAdminOverrides,
  subscriptionEntitlements,
} from "../../schemas";
import type { DbClient, TransactionClient } from "../types";

export const FREE_SMART_IMPORT_LIMIT = 5;
export const DEFAULT_PRO_ACCESS_LEVEL_ID = "pro";

export type PublicSubscriptionTier = "free" | "pro";
export type SubscriptionAdminOverrideStatus = "free" | "pro";

export interface SubscriptionStatus {
  isPro: boolean;
  accessLevelId: string | null;
  expiresAt: Date | null;
  willRenew: boolean | null;
  smartImports: {
    used: number;
    limit: number | null;
    remaining: number | null;
    periodStart: Date;
  };
}

export type ConsumedSmartImportStatus = SubscriptionStatus & {
  consumedSmartImport: boolean;
};

export interface UpsertSubscriptionEntitlementInput {
  userId: string;
  accessLevelId: string;
  isActive: boolean;
  adaptyProfileId?: string | null;
  adaptyCustomerUserId?: string | null;
  willRenew?: boolean | null;
  expiresAt?: Date | null;
  lastEventAt?: Date | null;
}

export interface SubscriptionAdminOverrideInput {
  userId: string;
  status: SubscriptionAdminOverrideStatus;
  reason: string;
  actorUserId: string;
}

export interface RecordAdaptyWebhookEventInput {
  eventId: string;
  eventType?: string | null;
  profileId?: string | null;
  customerUserId?: string | null;
  payload: unknown;
}

export interface ProcessAdaptyWebhookEventInput {
  event: RecordAdaptyWebhookEventInput;
  entitlement?: UpsertSubscriptionEntitlementInput | null;
}

export function getSmartImportPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function isSubscriptionEntitlementActive(
  entitlement:
    | Pick<
        typeof subscriptionEntitlements.$inferSelect,
        "isActive" | "expiresAt"
      >
    | null
    | undefined,
  now = new Date(),
) {
  if (!entitlement?.isActive) return false;
  return !entitlement.expiresAt || entitlement.expiresAt > now;
}

export function getPublicSubscriptionTierForEntitlement(
  entitlement:
    | Pick<
        typeof subscriptionEntitlements.$inferSelect,
        "isActive" | "expiresAt"
      >
    | null
    | undefined,
  now = new Date(),
): PublicSubscriptionTier {
  return isSubscriptionEntitlementActive(entitlement, now) ? "pro" : "free";
}

export function publicSubscriptionTierSql(
  userId: SQLWrapper,
): SQL<PublicSubscriptionTier> {
  return sql<PublicSubscriptionTier>`CASE
    WHEN EXISTS (
      SELECT 1 FROM ${subscriptionAdminOverrides}
      WHERE ${subscriptionAdminOverrides.userId} = ${userId}
        AND ${subscriptionAdminOverrides.status} = 'pro'
    ) THEN 'pro'
    WHEN EXISTS (
      SELECT 1 FROM ${subscriptionAdminOverrides}
      WHERE ${subscriptionAdminOverrides.userId} = ${userId}
        AND ${subscriptionAdminOverrides.status} = 'free'
    ) THEN 'free'
    WHEN EXISTS (
    SELECT 1 FROM ${subscriptionEntitlements}
    WHERE ${subscriptionEntitlements.userId} = ${userId}
      AND ${subscriptionEntitlements.isActive} = true
      AND (
        ${subscriptionEntitlements.expiresAt} IS NULL
        OR ${subscriptionEntitlements.expiresAt} > now()
      )
  ) THEN 'pro' ELSE 'free' END`;
}

export function publicSubscriptionTierSqlForUserTable(): SQL<PublicSubscriptionTier> {
  // Drizzle renders an outer table column as just "id" inside these nested SQL
  // subqueries. Use the qualified user table column so it cannot resolve to an
  // inner table's id column.
  return publicSubscriptionTierSql(sql.raw('"user"."id"'));
}

async function getSmartImportUsedCount(
  db: DbClient | TransactionClient,
  userId: string,
  periodStart: Date,
) {
  const row = await db
    .select({ usedCount: smartImportUsage.usedCount })
    .from(smartImportUsage)
    .where(
      and(
        eq(smartImportUsage.userId, userId),
        eq(smartImportUsage.periodStart, periodStart),
      ),
    )
    .then((rows) => rows[0]);

  return row?.usedCount ?? 0;
}

export async function getSubscriptionStatus(
  db: DbClient | TransactionClient,
  userId: string,
  now = new Date(),
): Promise<SubscriptionStatus> {
  const periodStart = getSmartImportPeriodStart(now);

  const [entitlement, override, used] = await Promise.all([
    db
      .select()
      .from(subscriptionEntitlements)
      .where(eq(subscriptionEntitlements.userId, userId))
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(subscriptionAdminOverrides)
      .where(eq(subscriptionAdminOverrides.userId, userId))
      .then((rows) => rows[0] ?? null),
    getSmartImportUsedCount(db, userId, periodStart),
  ]);

  const isPro =
    override?.status === "pro" ||
    (!override && isSubscriptionEntitlementActive(entitlement, now));

  return {
    isPro,
    accessLevelId: override
      ? override.status === "pro"
        ? "manual"
        : null
      : (entitlement?.accessLevelId ?? null),
    expiresAt: override ? null : (entitlement?.expiresAt ?? null),
    willRenew: override ? null : (entitlement?.willRenew ?? null),
    smartImports: {
      used,
      limit: isPro ? null : FREE_SMART_IMPORT_LIMIT,
      remaining: isPro ? null : Math.max(0, FREE_SMART_IMPORT_LIMIT - used),
      periodStart,
    },
  };
}

export async function consumeSmartImportUsage(
  db: DbClient | TransactionClient,
  userId: string,
  now = new Date(),
): Promise<ConsumedSmartImportStatus> {
  if ("transaction" in db && typeof db.transaction === "function") {
    return await db.transaction(async (tx) =>
      consumeSmartImportUsageWithClient(tx, userId, now),
    );
  }

  return await consumeSmartImportUsageWithClient(db, userId, now);
}

async function consumeSmartImportUsageWithClient(
  db: DbClient | TransactionClient,
  userId: string,
  now: Date,
): Promise<ConsumedSmartImportStatus> {
  const status = await getSubscriptionStatus(db, userId, now);
  if (status.isPro) return { ...status, consumedSmartImport: true };

  if (status.smartImports.used >= FREE_SMART_IMPORT_LIMIT) {
    return { ...status, consumedSmartImport: false };
  }

  const periodStart = status.smartImports.periodStart;
  const whereCurrentPeriod = and(
    eq(smartImportUsage.userId, userId),
    eq(smartImportUsage.periodStart, periodStart),
  );

  const [updated] = await db
    .update(smartImportUsage)
    .set({
      usedCount: sql`${smartImportUsage.usedCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        whereCurrentPeriod,
        lt(smartImportUsage.usedCount, FREE_SMART_IMPORT_LIMIT),
      ),
    )
    .returning({ usedCount: smartImportUsage.usedCount });

  if (updated) {
    const nextStatus = await getSubscriptionStatus(db, userId, now);
    return { ...nextStatus, consumedSmartImport: true };
  }

  const [inserted] = await db
    .insert(smartImportUsage)
    .values({
      userId,
      periodStart,
      usedCount: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ usedCount: smartImportUsage.usedCount });

  if (inserted) {
    const nextStatus = await getSubscriptionStatus(db, userId, now);
    return { ...nextStatus, consumedSmartImport: true };
  }

  const [updatedAfterConflict] = await db
    .update(smartImportUsage)
    .set({
      usedCount: sql`${smartImportUsage.usedCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        whereCurrentPeriod,
        lt(smartImportUsage.usedCount, FREE_SMART_IMPORT_LIMIT),
      ),
    )
    .returning({ usedCount: smartImportUsage.usedCount });

  const nextStatus = await getSubscriptionStatus(db, userId, now);
  return {
    ...nextStatus,
    consumedSmartImport: Boolean(updatedAfterConflict),
  };
}

export async function refundSmartImportUsage(
  db: DbClient | TransactionClient,
  userId: string,
  now = new Date(),
) {
  const periodStart = getSmartImportPeriodStart(now);
  return refundSmartImportUsageForPeriod(db, userId, periodStart, now);
}

export async function refundSmartImportUsageForPeriod(
  db: DbClient | TransactionClient,
  userId: string,
  periodStart: Date,
  now = new Date(),
) {
  const [updated] = await db
    .update(smartImportUsage)
    .set({
      usedCount: sql`${smartImportUsage.usedCount} - 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(smartImportUsage.userId, userId),
        eq(smartImportUsage.periodStart, periodStart),
        gt(smartImportUsage.usedCount, 0),
      ),
    )
    .returning({ usedCount: smartImportUsage.usedCount });

  return Boolean(updated);
}

export async function upsertSubscriptionEntitlement(
  db: DbClient | TransactionClient,
  input: UpsertSubscriptionEntitlementInput,
) {
  const now = new Date();
  await db
    .insert(subscriptionEntitlements)
    .values({
      userId: input.userId,
      accessLevelId: input.accessLevelId,
      isActive: input.isActive,
      adaptyProfileId: input.adaptyProfileId ?? null,
      adaptyCustomerUserId: input.adaptyCustomerUserId ?? input.userId,
      willRenew: input.willRenew ?? null,
      expiresAt: input.expiresAt ?? null,
      lastEventAt: input.lastEventAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptionEntitlements.userId,
      set: {
        accessLevelId: input.accessLevelId,
        isActive: input.isActive,
        adaptyProfileId: input.adaptyProfileId ?? null,
        adaptyCustomerUserId: input.adaptyCustomerUserId ?? input.userId,
        willRenew: input.willRenew ?? null,
        expiresAt: input.expiresAt ?? null,
        lastEventAt: input.lastEventAt ?? null,
        updatedAt: now,
      },
    });
}

export async function setSubscriptionAdminOverride(
  db: DbClient | TransactionClient,
  input: SubscriptionAdminOverrideInput,
) {
  const now = new Date();
  const [override] = await db
    .insert(subscriptionAdminOverrides)
    .values({
      userId: input.userId,
      status: input.status,
      reason: input.reason,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptionAdminOverrides.userId,
      set: {
        status: input.status,
        reason: input.reason,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      },
    })
    .returning();

  return override;
}

export async function clearSubscriptionAdminOverride(
  db: DbClient | TransactionClient,
  userId: string,
) {
  const [override] = await db
    .delete(subscriptionAdminOverrides)
    .where(eq(subscriptionAdminOverrides.userId, userId))
    .returning();

  return override ?? null;
}

export async function recordAdaptyWebhookEvent(
  db: DbClient | TransactionClient,
  input: RecordAdaptyWebhookEventInput,
): Promise<boolean> {
  const inserted = await db
    .insert(adaptyWebhookEvents)
    .values({
      eventId: input.eventId,
      eventType: input.eventType ?? null,
      profileId: input.profileId ?? null,
      customerUserId: input.customerUserId ?? null,
      payload: input.payload,
      receivedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ eventId: adaptyWebhookEvents.eventId });

  return inserted.length > 0;
}

export async function processAdaptyWebhookEvent(
  db: DbClient,
  input: ProcessAdaptyWebhookEventInput,
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const isFirstDelivery = await recordAdaptyWebhookEvent(tx, input.event);
    if (!isFirstDelivery) return false;

    if (input.entitlement) {
      await upsertSubscriptionEntitlement(tx, input.entitlement);
    }

    return true;
  });
}
