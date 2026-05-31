import { adminAuditEvents } from "../../schemas";
import type { DbClient, TransactionClient } from "../types";

export type AdminAuditEventType =
  | "user.create"
  | "user.set_role"
  | "user.ban"
  | "user.unban"
  | "user.delete"
  | "subscription.override.set"
  | "subscription.override.clear";

export interface RecordAdminAuditEventInput {
  eventType: AdminAuditEventType;
  actorUserId: string | null;
  targetUserId?: string | null;
  reason?: string | null;
  metadata?: unknown;
}

export async function recordAdminAuditEvent(
  db: DbClient | TransactionClient,
  input: RecordAdminAuditEventInput,
) {
  const [event] = await db
    .insert(adminAuditEvents)
    .values({
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    })
    .returning();

  return event;
}
