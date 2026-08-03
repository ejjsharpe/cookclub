import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

export const legalAcceptances = pgTable(
  "legal_acceptances",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    termsVersion: text("terms_version").notNull(),
    acceptedAt: timestamp("accepted_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("legal_acceptances_user_terms_version_unique_idx").on(
      table.userId,
      table.termsVersion,
    ),
    index("legal_acceptances_user_accepted_at_idx").on(
      table.userId,
      table.acceptedAt.desc(),
    ),
  ],
);

export const userBlocks = pgTable(
  "user_blocks",
  {
    id: serial("id").primaryKey(),
    blockerUserId: text("blocker_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockedUserId: text("blocked_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_blocks_blocker_blocked_unique_idx").on(
      table.blockerUserId,
      table.blockedUserId,
    ),
    index("user_blocks_blocked_user_idx").on(table.blockedUserId),
    check(
      "user_blocks_not_self_check",
      sql`${table.blockerUserId} <> ${table.blockedUserId}`,
    ),
  ],
);

export type ModerationTargetType = "user" | "comment" | "activity" | "recipe";
export type ModerationReportReason =
  | "spam_scam"
  | "harassment_hate"
  | "sexual_content"
  | "violence_danger"
  | "child_safety"
  | "intellectual_property"
  | "other";
export type ModerationReportStatus = "open" | "dismissed" | "resolved";

export interface ModerationTargetSnapshot {
  targetType: ModerationTargetType;
  targetId: string;
  ownerUserId: string | null;
  capturedAt: string;
  content: Record<string, unknown>;
}

export const contentReports = pgTable(
  "content_reports",
  {
    id: serial("id").primaryKey(),
    reporterUserId: text("reporter_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    targetOwnerUserId: text("target_owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    details: text("details"),
    targetSnapshot: jsonb("target_snapshot")
      .$type<ModerationTargetSnapshot>()
      .notNull(),
    status: text("status").notNull().default("open"),
    resolutionAction: text("resolution_action"),
    resolutionNotes: text("resolution_notes"),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("content_reports_status_created_at_idx").on(
      table.status,
      table.createdAt.desc(),
    ),
    index("content_reports_target_idx").on(table.targetType, table.targetId),
    index("content_reports_reporter_created_at_idx").on(
      table.reporterUserId,
      table.createdAt.desc(),
    ),
    uniqueIndex("content_reports_open_reporter_target_unique_idx")
      .on(table.reporterUserId, table.targetType, table.targetId)
      .where(
        sql`${table.status} = 'open' AND ${table.reporterUserId} IS NOT NULL`,
      ),
    check(
      "content_reports_target_type_check",
      sql`${table.targetType} IN ('user', 'comment', 'activity', 'recipe')`,
    ),
    check(
      "content_reports_reason_check",
      sql`${table.reason} IN ('spam_scam', 'harassment_hate', 'sexual_content', 'violence_danger', 'child_safety', 'intellectual_property', 'other')`,
    ),
    check(
      "content_reports_status_check",
      sql`${table.status} IN ('open', 'dismissed', 'resolved')`,
    ),
    check(
      "content_reports_details_length_check",
      sql`${table.details} IS NULL OR char_length(${table.details}) <= 1000`,
    ),
  ],
);
