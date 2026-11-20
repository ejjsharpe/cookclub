import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  date,
  boolean,
  index,
  uniqueIndex,
  check,
  jsonb,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { recipes } from "./recipe-schema";

// A meal time a plan's days can hold, e.g. breakfast or a custom "Supper".
// Entries store the key in meal_plan_entries.meal_type.
export interface MealTime {
  key: string;
  name: string;
  // Hidden meal times aren't offered when adding; planned meals still show.
  hidden?: boolean;
  // Set for custom meal times, so the plan can say who added them.
  addedBy?: { id: string; name: string };
}

// ─── Meal Plans: multiple per user (personal + shared) ─────────────────────────
export const mealPlans = pgTable(
  "meal_plans",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Marks user's primary personal plan.
    isDefault: boolean("is_default").notNull().default(false),
    // Ordered meal times shared by everyone on the plan.
    // Null means the defaults: breakfast, lunch, dinner.
    mealTimes: jsonb("meal_times").$type<MealTime[]>(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    // Index for listing user's plans (no unique - allows multiple)
    index("meal_plans_user_id_idx").on(table.userId),
    uniqueIndex("meal_plans_one_default_per_user_idx")
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
  ],
);

// ─── Meal Plan Entries: recipe assignments to a day's meal times ───────────────
export const mealPlanEntries = pgTable(
  "meal_plan_entries",
  {
    id: serial("id").primaryKey(),
    mealPlanId: integer("meal_plan_id")
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    // Date for the meal (stores just date, no time)
    date: date("date").notNull(),
    // Key of one of the plan's meal times ("breakfast", "lunch", "dinner" or custom)
    mealType: text("meal_type").notNull(),
    // Reference to the recipe
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    // Cached recipe data for fast queries (avoids joins)
    recipeName: text("recipe_name").notNull(),
    recipeImageUrl: text("recipe_image_url"),
    // Metadata
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    // Index for querying entries by meal plan
    index("meal_plan_entries_meal_plan_id_idx").on(table.mealPlanId),
    // Index for querying entries by date range (common query pattern)
    index("meal_plan_entries_meal_plan_date_idx").on(
      table.mealPlanId,
      table.date,
    ),
    // Index for finding entries by recipe (for cascade-like operations)
    index("meal_plan_entries_recipe_id_idx").on(table.recipeId),
    // Unique constraint: one recipe per meal slot per day
    uniqueIndex("meal_plan_entries_unique_slot_idx").on(
      table.mealPlanId,
      table.date,
      table.mealType,
    ),
  ],
);

// ─── Meal Plan Invitations: invitation-based sharing with friends ─────────────
// Pending invitations expire after 7 days. Accepted invitations represent active access.
export const mealPlanInvitations = pgTable(
  "meal_plan_invitations",
  {
    id: serial("id").primaryKey(),
    mealPlanId: integer("meal_plan_id")
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    // User who is being invited
    invitedUserId: text("invited_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // User who sent the invitation (owner)
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // "pending" = awaiting response, "accepted" = user has access
    status: text("status").notNull().default("pending"),
    // Denormalized inviter info for efficient "shared with me" queries
    inviterName: text("inviter_name").notNull(),
    inviterImage: text("inviter_image"),
    // Denormalized meal plan name for display in banners/notifications
    mealPlanName: text("meal_plan_name").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("meal_plan_invitations_invited_by_user_idx").on(
      table.invitedByUserId,
    ),
    // Index for finding all invitations for a user
    index("meal_plan_invitations_invited_user_idx").on(table.invitedUserId),
    // Index for finding all invitations for a meal plan
    index("meal_plan_invitations_meal_plan_id_idx").on(table.mealPlanId),
    // Composite index for access control checks
    index("meal_plan_invitations_user_status_idx").on(
      table.invitedUserId,
      table.status,
    ),
    // Unique: prevent duplicate invitations
    uniqueIndex("meal_plan_invitations_unique_idx").on(
      table.mealPlanId,
      table.invitedUserId,
    ),
    check(
      "meal_plan_invitations_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'declined')`,
    ),
  ],
);
