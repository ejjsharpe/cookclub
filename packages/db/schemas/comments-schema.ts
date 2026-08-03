import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { activityEvents } from "./activity-schema";
import { user } from "./auth-schema";

// ─── Comments - user comments on activity feed items ──────────────────────────
export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activityEventId: integer("activity_event_id")
      .notNull()
      .references(() => activityEvents.id, { onDelete: "cascade" }),
    parentCommentId: integer("parent_comment_id").references(
      (): AnyPgColumn => comments.id,
      { onDelete: "cascade" },
    ),
    content: text("content").notNull(),
    moderationState: text("moderation_state").notNull().default("visible"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("comments_activity_event_id_idx").on(table.activityEventId),
    index("comments_parent_comment_id_idx").on(table.parentCommentId),
    index("comments_user_id_idx").on(table.userId),
    check(
      "comments_moderation_state_check",
      sql`${table.moderationState} IN ('visible', 'hidden')`,
    ),
  ],
);
