-- Import jobs were not publicly launched, so discard the old payload-bearing
-- rows before enforcing the durable lifecycle contract.
TRUNCATE TABLE "recipe_import_jobs";--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" RENAME COLUMN "input_data" TO "source_data";--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ALTER COLUMN "source_data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" DROP CONSTRAINT "recipe_import_jobs_status_check";--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" DROP CONSTRAINT "recipe_import_jobs_error_code_check";--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD COLUMN "request_fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD COLUMN "completion_fingerprint" text;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD COLUMN "recipe_id" integer;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD COLUMN "consumed_at" timestamp;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD CONSTRAINT "recipe_import_jobs_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_import_jobs_recipe_id_unique_idx" ON "recipe_import_jobs" USING btree ("recipe_id") WHERE "recipe_import_jobs"."recipe_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" DROP COLUMN "mime_type";--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" DROP COLUMN "dismissed_at";--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" DROP COLUMN "usage_consumed_at";--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD CONSTRAINT "recipe_import_jobs_status_check" CHECK ("recipe_import_jobs"."status" IN ('pending', 'processing', 'ready', 'failed', 'consumed'));--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD CONSTRAINT "recipe_import_jobs_error_code_check" CHECK ("recipe_import_jobs"."error_code" IS NULL OR "recipe_import_jobs"."error_code" IN ('IMPORT_ACTIVE_LIMIT_REACHED', 'IMPORT_INVALID_URL', 'IMPORT_UNSUPPORTED_SOURCE', 'IMPORT_SOURCE_UNAVAILABLE', 'IMPORT_RECIPE_NOT_FOUND', 'IMPORT_IMAGE_INVALID', 'PAYLOAD_TOO_LARGE', 'IMPORT_TIMED_OUT', 'IMPORT_FAILED', 'SERVICE_UNAVAILABLE'));
