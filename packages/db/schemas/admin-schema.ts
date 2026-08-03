import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  check,
} from "drizzle-orm/pg-core";

export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    id: serial("id").primaryKey(),
    eventType: text("event_type").notNull(),
    actorUserId: text("actor_user_id"),
    targetUserId: text("target_user_id"),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_events_actor_user_idx").on(table.actorUserId),
    index("admin_audit_events_target_user_idx").on(table.targetUserId),
    index("admin_audit_events_event_type_idx").on(table.eventType),
    index("admin_audit_events_created_at_idx").on(table.createdAt),
    check(
      "admin_audit_events_event_type_check",
      sql`${table.eventType} IN (
        'user.create',
        'user.set_role',
        'user.ban',
        'user.unban',
        'user.delete',
        'subscription.override.set',
        'subscription.override.clear',
        'moderation.report.resolve'
      )`,
    ),
  ],
);
