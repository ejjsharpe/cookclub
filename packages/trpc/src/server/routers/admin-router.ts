import { getAuth } from "@repo/auth";
import {
  subscriptionAdminOverrides,
  subscriptionEntitlements,
  user,
  activityEvents,
  comments,
  contentReports,
  cookingReviews,
  recipes,
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
  gte,
} from "drizzle-orm";

import { deleteUserAccountData } from "./user-router";
import type { Context } from "../context";
import { PublicTRPCError } from "../public-errors";
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

const ReportTargetTypeValidator = type(
  "'user' | 'comment' | 'activity' | 'recipe'",
);
const ReportReasonValidator = type(
  "'spam_scam' | 'harassment_hate' | 'sexual_content' | 'violence_danger' | 'child_safety' | 'intellectual_property' | 'other'",
);
const ListReportsValidator = type({
  "status?": "'open' | 'dismissed' | 'resolved'",
  "targetType?": ReportTargetTypeValidator,
  "reason?": ReportReasonValidator,
  "createdSince?": "Date",
  "limit?": "number",
  "offset?": "number",
});
const ResolveReportValidator = type({
  reportId: "number",
  action: "'dismiss' | 'hide' | 'restore' | 'ban' | 'unban'",
  "notes?": "string",
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

function publicAdminInputError(message: string) {
  return new PublicTRPCError({
    code: "BAD_REQUEST",
    appCode: "INVALID_INPUT",
    message,
  });
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
  listReports: adminProcedure
    .input(ListReportsValidator)
    .query(async ({ ctx, input }) => {
      const limit = normalizeLimit(input.limit);
      const offset = normalizeOffset(input.offset);
      const filters: SQL[] = [];
      if (input.status) filters.push(eq(contentReports.status, input.status));
      if (input.targetType) {
        filters.push(eq(contentReports.targetType, input.targetType));
      }
      if (input.reason) filters.push(eq(contentReports.reason, input.reason));
      if (input.createdSince) {
        filters.push(gte(contentReports.createdAt, input.createdSince));
      }
      const where = filters.length > 0 ? and(...filters) : undefined;

      const [reports, totalRows] = await Promise.all([
        ctx.db
          .select({
            id: contentReports.id,
            reporterUserId: contentReports.reporterUserId,
            targetType: contentReports.targetType,
            targetId: contentReports.targetId,
            targetOwnerUserId: contentReports.targetOwnerUserId,
            reason: contentReports.reason,
            details: contentReports.details,
            targetSnapshot: contentReports.targetSnapshot,
            status: contentReports.status,
            resolutionAction: contentReports.resolutionAction,
            resolutionNotes: contentReports.resolutionNotes,
            resolvedByUserId: contentReports.resolvedByUserId,
            resolvedAt: contentReports.resolvedAt,
            createdAt: contentReports.createdAt,
            updatedAt: contentReports.updatedAt,
          })
          .from(contentReports)
          .where(where)
          .orderBy(desc(contentReports.createdAt))
          .limit(limit)
          .offset(offset),
        ctx.db.select({ total: count() }).from(contentReports).where(where),
      ]);

      return {
        reports,
        total: totalRows[0]?.total ?? 0,
        limit,
        offset,
      };
    }),

  resolveReport: adminProcedure
    .input(ResolveReportValidator)
    .mutation(async ({ ctx, input }) => {
      const notes = input.notes?.trim() || null;
      if (notes && notes.length > 2_000) {
        throw publicAdminInputError("Resolution notes are too long.");
      }
      if (input.action === "ban" || input.action === "unban") {
        await requireAdminPermission(ctx, "ban");
      }

      const updatedReport = await ctx.db.transaction(async (tx) => {
        const [report] = await tx
          .select()
          .from(contentReports)
          .where(eq(contentReports.id, input.reportId))
          .for("update")
          .limit(1);
        if (!report) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Report not found.",
          });
        }
        if (report.status !== "open") {
          throw new PublicTRPCError({
            code: "CONFLICT",
            appCode: "CONFLICT",
            message: "This report has already been resolved.",
          });
        }

        const numericTargetId = Number(report.targetId);
        const isContentTarget = report.targetType !== "user";
        if (
          (input.action === "hide" || input.action === "restore") &&
          (!isContentTarget || !Number.isInteger(numericTargetId))
        ) {
          throw publicAdminInputError(
            "Hide and restore actions require a content report.",
          );
        }

        const targetUserId =
          report.targetType === "user"
            ? report.targetId
            : report.targetOwnerUserId;
        if (
          (input.action === "ban" || input.action === "unban") &&
          !targetUserId
        ) {
          throw publicAdminInputError("This report has no user to moderate.");
        }

        if (input.action === "ban" && targetUserId) {
          if (targetUserId === ctx.user.id) {
            throw publicAdminInputError(
              "You cannot ban your own admin account.",
            );
          }
          try {
            await getAuth(ctx.env).api.banUser({
              body: {
                userId: targetUserId,
                banReason: notes ?? `Moderation report #${report.id}`,
              },
              headers: ctx.req.headers,
            });
          } catch (error) {
            throw mapAuthError(error, "Could not ban the reported user.");
          }
        } else if (input.action === "unban" && targetUserId) {
          try {
            await getAuth(ctx.env).api.unbanUser({
              body: { userId: targetUserId },
              headers: ctx.req.headers,
            });
          } catch (error) {
            throw mapAuthError(error, "Could not unban the reported user.");
          }
        }

        const moderationState = input.action === "hide" ? "hidden" : "visible";
        if (input.action === "hide" || input.action === "restore") {
          if (report.targetType === "comment") {
            await tx
              .update(comments)
              .set({ moderationState })
              .where(eq(comments.id, numericTargetId));
          } else if (report.targetType === "activity") {
            await tx
              .update(activityEvents)
              .set({ moderationState })
              .where(eq(activityEvents.id, numericTargetId));
            await tx
              .update(cookingReviews)
              .set({ moderationState })
              .where(eq(cookingReviews.activityEventId, numericTargetId));
          } else if (report.targetType === "recipe") {
            await tx
              .update(recipes)
              .set({ moderationState })
              .where(eq(recipes.id, numericTargetId));
            await tx
              .update(activityEvents)
              .set({ moderationState })
              .where(eq(activityEvents.recipeId, numericTargetId));
          }
        }

        const now = new Date();
        const [resolved] = await tx
          .update(contentReports)
          .set({
            status: input.action === "dismiss" ? "dismissed" : "resolved",
            resolutionAction: input.action,
            resolutionNotes: notes,
            resolvedByUserId: ctx.user.id,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(contentReports.id, input.reportId),
              eq(contentReports.status, "open"),
            ),
          )
          .returning();
        if (!resolved) {
          throw new PublicTRPCError({
            code: "CONFLICT",
            appCode: "CONFLICT",
            message: "This report has already been resolved.",
          });
        }

        await recordAdminAuditEvent(tx, {
          eventType: "moderation.report.resolve",
          actorUserId: ctx.user.id,
          targetUserId: targetUserId ?? null,
          reason: notes,
          metadata: {
            reportId: report.id,
            action: input.action,
            targetType: report.targetType,
            targetId: report.targetId,
          },
        });
        return resolved;
      });

      return { report: updatedReport };
    }),

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
        throw publicAdminInputError("You cannot ban your own admin account.");
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
        throw publicAdminInputError(
          "You cannot delete your own admin account.",
        );
      }

      const targetUser = await getTargetUserForDeletion(ctx, input.userId);
      if (
        targetUser.email.trim().toLowerCase() !==
        input.confirmationEmail.trim().toLowerCase()
      ) {
        throw publicAdminInputError(
          "Enter the user's email address to confirm deletion.",
        );
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
