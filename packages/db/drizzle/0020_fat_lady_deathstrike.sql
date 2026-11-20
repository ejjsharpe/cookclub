ALTER TABLE "meal_plan_entries" DROP CONSTRAINT "meal_plan_entries_meal_type_check";--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "meal_times" jsonb;