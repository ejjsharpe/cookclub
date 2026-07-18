ALTER TABLE "recipe_import_jobs" ADD COLUMN "error_code" text;--> statement-breakpoint
UPDATE "recipe_import_jobs"
SET "error_code" = 'IMPORT_FAILED',
    "error" = 'Something went wrong while importing. Please try again.'
WHERE "status" = 'failed';
