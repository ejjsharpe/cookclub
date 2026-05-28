ALTER TABLE "recipe_import_jobs" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD COLUMN IF NOT EXISTS "usage_period_start" timestamp;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD COLUMN IF NOT EXISTS "usage_consumed_at" timestamp;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD COLUMN IF NOT EXISTS "refunded_at" timestamp;
