CREATE TABLE "recipe_import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"import_type" text DEFAULT 'smart' NOT NULL,
	"mode" text NOT NULL,
	"title" text NOT NULL,
	"input_data" text NOT NULL,
	"mime_type" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipe" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"dismissed_at" timestamp,
	"processing_started_at" timestamp,
	"usage_period_start" timestamp,
	"usage_consumed_at" timestamp,
	"refunded_at" timestamp,
	CONSTRAINT "recipe_import_jobs_import_type_check" CHECK ("recipe_import_jobs"."import_type" IN ('basic', 'smart')),
	CONSTRAINT "recipe_import_jobs_mode_check" CHECK ("recipe_import_jobs"."mode" IN ('url', 'text', 'image')),
	CONSTRAINT "recipe_import_jobs_status_check" CHECK ("recipe_import_jobs"."status" IN ('pending', 'processing', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "recipe_import_jobs" ADD CONSTRAINT "recipe_import_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_import_jobs_user_status_idx" ON "recipe_import_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "recipe_import_jobs_user_created_at_idx" ON "recipe_import_jobs" USING btree ("user_id","created_at" DESC NULLS LAST);
