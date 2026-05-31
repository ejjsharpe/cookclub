import { getAuth } from "@repo/auth";
import {
  subscriptionAdminOverrides,
  subscriptionEntitlements,
  user,
} from "@repo/db/schemas";
import {
  clearSubscriptionAdminOverride,
  publicSubscriptionTierSqlForUserTable,
  recordAdminAuditEvent,
  setSubscriptionAdminOverride,
} from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { deleteUserAccountData } from "./user-router";
import type { Context } from "../context";
import { router, authedProcedure } from "../trpc";

const UserRoleValidator = type("'admin' | 'user'");
const SubscriptionOverrideStatusValidator = type("'pro' | 'free'");
const ListUserSortByValidator = type(
  "'createdAt' | 'updatedAt' | 'name' | 'username' | 'email' | 'role' | 'subscription' | 'status'",
);

const ListUsersValidator = type({
  "search?": "string",
  "status?": "'active' | 'banned'",
  "subscriptionStatus?": "'pro' | 'free'",
  "role?": UserRoleValidator,
  "limit?": "number",
  "offset?": "number",
  "sortBy?": ListUserSortByValidator,
  "sortDirection?": "'asc' | 'desc'",
});

const CreateUserValidator = type({
  email: "string",
  name: "string",
  password: "string",
  role: UserRoleValidator,
});

const SetRoleValidator = type({
  userId: "string",
  role: UserRoleValidator,
});

const SetSubscriptionOverrideValidator = type({
  userId: "string",
  status: SubscriptionOverrideStatusValidator,
  reason: "string",
});

const ClearSubscriptionOverrideValidator = type({
  userId: "string",
  reason: "string",
});

const BanUserValidator = type({
  userId: "string",
  reason: "string",
  "banExpiresIn?": "number > 0",
});

const UserIdValidator = type({
  userId: "string",
});

const DeleteUserValidator = type({
  userId: "string",
  confirmationEmail: "string",
});

type ListUsersInput = typeof ListUsersValidator.infer;
type AdminPermission = "create" | "list" | "set-role" | "ban" | "delete";

const adminProcedure = authedProcedure.use(async (opts) => {
  await requireAdminPermission(opts.ctx, "list");
  return opts.next({ ctx: opts.ctx });
});

function normalizeLimit(limit: number | undefined) {
  return Math.min(Math.max(Math.trunc(limit ?? 25), 1), 100);
}

function normalizeOffset(offset: number | undefined) {
  return Math.max(Math.trunc(offset ?? 0), 0);
}

function mapAuthError(error: unknown, fallbackMessage: string): TRPCError {
  if (error instanceof TRPCError) return error;

  const candidate = error as {
    status?: number;
    statusCode?: number;
    body?: { message?: string };
    message?: string;
  };
  const status = candidate.statusCode ?? candidate.status;
  const message =
    candidate.body?.message ?? candidate.message ?? fallbackMessage;

  if (status === 401) return new TRPCError({ code: "UNAUTHORIZED", message });
  if (status === 403) return new TRPCError({ code: "FORBIDDEN", message });
  if (status === 404) return new TRPCError({ code: "NOT_FOUND", message });
  if (status === 409) return new TRPCError({ code: "CONFLICT", message });
  if (status === 400 || status === 422) {
    return new TRPCError({ code: "BAD_REQUEST", message });
  }

  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}

async function requireAdminPermission(
  ctx: Context & { user: NonNullable<Context["user"]> },
  permission: AdminPermission,
) {
  try {
    const result = await getAuth(ctx.env).api.userHasPermission({
      body: {
        permissions: {
          user: [permission],
        },
      },
      headers: ctx.req.headers,
    });

    if (!result.success) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
  } catch (error) {
    throw mapAuthError(error, "You are not allowed to access admin actions.");
  }
}

async function assertTargetUserExists(ctx: Context, userId: string) {
  const [targetUser] = await ctx.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!targetUser) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }
}

async function getTargetUserForDeletion(ctx: Context, userId: string) {
  const [targetUser] = await ctx.db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!targetUser) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }

  return targetUser;
}

function buildUserFilters(input: ListUsersInput) {
  const filters: SQL[] = [];

  const search = input.search?.trim();
  if (search) {
    const searchPattern = `%${search}%`;
    const searchFilter = or(
      ilike(user.email, searchPattern),
      ilike(user.name, searchPattern),
      ilike(user.id, searchPattern),
      ilike(user.username, searchPattern),
    );
    if (searchFilter) filters.push(searchFilter);
  }

  if (input.role) {
    filters.push(eq(user.role, input.role));
  }

  if (input.status === "banned") {
    filters.push(eq(user.banned, true));
  } else if (input.status === "active") {
    const activeFilter = or(eq(user.banned, false), isNull(user.banned));
    if (activeFilter) filters.push(activeFilter);
  }

  if (input.subscriptionStatus) {
    filters.push(
      sql`${publicSubscriptionTierSqlForUserTable()} = ${input.subscriptionStatus}`,
    );
  }

  return filters.length > 0 ? and(...filters) : undefined;
}

function getUserOrderBy(
  sortBy: ListUsersInput["sortBy"],
  sortDirection: ListUsersInput["sortDirection"],
) {
  const direction = sortDirection === "asc" ? asc : desc;

  switch (sortBy) {
    case "email":
      return direction(user.email);
    case "name":
      return direction(user.name);
    case "username":
      return direction(user.username);
    case "role":
      return direction(user.role);
    case "subscription":
      return direction(publicSubscriptionTierSqlForUserTable());
    case "status":
      return direction(sql`coalesce(${user.banned}, false)`);
    case "updatedAt":
      return direction(user.updatedAt);
    case "createdAt":
    default:
      return direction(user.createdAt);
  }
}

function getSubscriptionSource(
  row: Pick<typeof subscriptionAdminOverrides.$inferSelect, "status"> | null,
  isPro: boolean,
) {
  if (row) return "manual" as const;
  return isPro ? ("adapty" as const) : ("free" as const);
}

export const adminRouter = router({
  listUsers: adminProcedure
    .input(ListUsersValidator)
    .query(async ({ ctx, input }) => {
      const limit = normalizeLimit(input.limit);
      const offset = normalizeOffset(input.offset);
      const where = buildUserFilters(input);

      const [users, totalRows] = await Promise.all([
        ctx.db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            username: user.username,
            role: user.role,
            banned: user.banned,
            banReason: user.banReason,
            banExpires: user.banExpires,
            emailVerified: user.emailVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            subscriptionTier: publicSubscriptionTierSqlForUserTable(),
            entitlement: {
              accessLevelId: subscriptionEntitlements.accessLevelId,
              isActive: subscriptionEntitlements.isActive,
              expiresAt: subscriptionEntitlements.expiresAt,
              willRenew: subscriptionEntitlements.willRenew,
            },
            override: {
              status: subscriptionAdminOverrides.status,
              reason: subscriptionAdminOverrides.reason,
              updatedAt: subscriptionAdminOverrides.updatedAt,
              updatedByUserId: subscriptionAdminOverrides.updatedByUserId,
            },
          })
          .from(user)
          .leftJoin(
            subscriptionEntitlements,
            eq(subscriptionEntitlements.userId, user.id),
          )
          .leftJoin(
            subscriptionAdminOverrides,
            eq(subscriptionAdminOverrides.userId, user.id),
          )
          .where(where)
          .orderBy(getUserOrderBy(input.sortBy, input.sortDirection))
          .limit(limit)
          .offset(offset),
        ctx.db.select({ total: count() }).from(user).where(where),
      ]);

      return {
        users: users.map((row) => {
          const override = row.override?.status ? row.override : null;
          const isPro = row.subscriptionTier === "pro";

          return {
            id: row.id,
            name: row.name,
            email: row.email,
            image: row.image,
            username: row.username,
            role: row.role ?? "user",
            banned: row.banned ?? false,
            banReason: row.banReason,
            banExpires: row.banExpires,
            emailVerified: row.emailVerified,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            subscription: {
              isPro,
              tier: row.subscriptionTier,
              source: getSubscriptionSource(override, isPro),
              accessLevelId: row.entitlement?.accessLevelId ?? null,
              expiresAt: row.entitlement?.expiresAt ?? null,
              willRenew: row.entitlement?.willRenew ?? null,
              override,
            },
          };
        }),
        total: totalRows[0]?.total ?? 0,
        limit,
        offset,
      };
    }),

  createUser: adminProcedure
    .input(CreateUserValidator)
    .mutation(async ({ ctx, input }) => {
      await requireAdminPermission(ctx, "create");

      try {
        const result = await getAuth(ctx.env).api.createUser({
          body: {
            email: input.email,
            name: input.name,
            password: input.password,
            role: input.role,
          },
          headers: ctx.req.headers,
        });

        await recordAdminAuditEvent(ctx.db, {
          eventType: "user.create",
          actorUserId: ctx.user.id,
          targetUserId: result.user.id,
          metadata: { email: result.user.email, role: result.user.role },
        });

        return result;
      } catch (error) {
        throw mapAuthError(error, "Could not create user.");
      }
    }),

  setRole: adminProcedure
    .input(SetRoleValidator)
    .mutation(async ({ ctx, input }) => {
      await requireAdminPermission(ctx, "set-role");

      try {
        const result = await getAuth(ctx.env).api.setRole({
          body: {
            userId: input.userId,
            role: input.role,
          },
          headers: ctx.req.headers,
        });

        await recordAdminAuditEvent(ctx.db, {
          eventType: "user.set_role",
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          metadata: { role: input.role },
        });

        return result;
      } catch (error) {
        throw mapAuthError(error, "Could not update role.");
      }
    }),

  setSubscriptionOverride: adminProcedure
    .input(SetSubscriptionOverrideValidator)
    .mutation(async ({ ctx, input }) => {
      await requireAdminPermission(ctx, "set-role");
      await assertTargetUserExists(ctx, input.userId);

      const override = await ctx.db.transaction(async (tx) => {
        const override = await setSubscriptionAdminOverride(tx, {
          userId: input.userId,
          status: input.status,
          reason: input.reason,
          actorUserId: ctx.user.id,
        });

        await recordAdminAuditEvent(tx, {
          eventType: "subscription.override.set",
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          reason: input.reason,
          metadata: { status: input.status },
        });

        return override;
      });

      return { override };
    }),

  clearSubscriptionOverride: adminProcedure
    .input(ClearSubscriptionOverrideValidator)
    .mutation(async ({ ctx, input }) => {
      await requireAdminPermission(ctx, "set-role");
      await assertTargetUserExists(ctx, input.userId);

      const override = await ctx.db.transaction(async (tx) => {
        const override = await clearSubscriptionAdminOverride(tx, input.userId);

        await recordAdminAuditEvent(tx, {
          eventType: "subscription.override.clear",
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          reason: input.reason,
          metadata: override ? { previousStatus: override.status } : null,
        });

        return override;
      });

      return { success: true, cleared: Boolean(override) };
    }),

  banUser: adminProcedure
    .input(BanUserValidator)
    .mutation(async ({ ctx, input }) => {
      await requireAdminPermission(ctx, "ban");

      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot ban your own admin account.",
        });
      }

      try {
        const result = await getAuth(ctx.env).api.banUser({
          body: {
            userId: input.userId,
            banReason: input.reason,
            ...(input.banExpiresIn !== undefined && {
              banExpiresIn: input.banExpiresIn,
            }),
          },
          headers: ctx.req.headers,
        });

        await recordAdminAuditEvent(ctx.db, {
          eventType: "user.ban",
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          reason: input.reason,
          metadata: { banExpiresIn: input.banExpiresIn ?? null },
        });

        return result;
      } catch (error) {
        throw mapAuthError(error, "Could not ban user.");
      }
    }),

  unbanUser: adminProcedure
    .input(UserIdValidator)
    .mutation(async ({ ctx, input }) => {
      await requireAdminPermission(ctx, "ban");

      try {
        const result = await getAuth(ctx.env).api.unbanUser({
          body: {
            userId: input.userId,
          },
          headers: ctx.req.headers,
        });

        await recordAdminAuditEvent(ctx.db, {
          eventType: "user.unban",
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
        });

        return result;
      } catch (error) {
        throw mapAuthError(error, "Could not unban user.");
      }
    }),

  deleteUser: adminProcedure
    .input(DeleteUserValidator)
    .mutation(async ({ ctx, input }) => {
      await requireAdminPermission(ctx, "delete");

      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot delete your own admin account.",
        });
      }

      const targetUser = await getTargetUserForDeletion(ctx, input.userId);
      if (
        targetUser.email.trim().toLowerCase() !==
        input.confirmationEmail.trim().toLowerCase()
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter the user's email address to confirm deletion.",
        });
      }

      const result = await deleteUserAccountData(ctx, input.userId);

      await recordAdminAuditEvent(ctx.db, {
        eventType: "user.delete",
        actorUserId: ctx.user.id,
        targetUserId: input.userId,
        metadata: {
          deletedImageCount: result.deletedImageCount,
          email: targetUser.email,
        },
      });

      return result;
    }),
});
