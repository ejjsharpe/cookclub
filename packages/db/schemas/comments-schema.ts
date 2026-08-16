import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  index,
  uniqueIndex,
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

// Resolved @username references retained with their username at posting time.
export const commentMentions = pgTable(
  "comment_mentions",
  {
    id: serial("id").primaryKey(),
    commentId: integer("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
  },
  (table) => [
    index("comment_mentions_comment_id_idx").on(table.commentId),
    index("comment_mentions_user_id_idx").on(table.userId),
    uniqueIndex("comment_mentions_comment_user_idx").on(
      table.commentId,
      table.userId,
    ),
  ],
);
