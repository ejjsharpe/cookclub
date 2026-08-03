CREATE TABLE "content_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_user_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"target_owner_user_id" text,
	"reason" text NOT NULL,
	"details" text,
	"target_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_action" text,
	"resolution_notes" text,
	"resolved_by_user_id" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_target_type_check" CHECK ("content_reports"."target_type" IN ('user', 'comment', 'activity', 'recipe')),
	CONSTRAINT "content_reports_reason_check" CHECK ("content_reports"."reason" IN ('spam_scam', 'harassment_hate', 'sexual_content', 'violence_danger', 'child_safety', 'intellectual_property', 'other')),
	CONSTRAINT "content_reports_status_check" CHECK ("content_reports"."status" IN ('open', 'dismissed', 'resolved')),
	CONSTRAINT "content_reports_details_length_check" CHECK ("content_reports"."details" IS NULL OR char_length("content_reports"."details") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"terms_version" text NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"blocker_user_id" text NOT NULL,
	"blocked_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_not_self_check" CHECK ("user_blocks"."blocker_user_id" <> "user_blocks"."blocked_user_id")
);
--> statement-breakpoint
ALTER TABLE "admin_audit_events" DROP CONSTRAINT "admin_audit_events_event_type_check";--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "moderation_state" text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_reviews" ADD COLUMN "moderation_state" text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "moderation_state" text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "moderation_state" text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_user_id_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_owner_user_id_user_id_fk" FOREIGN KEY ("target_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_user_id_user_id_fk" FOREIGN KEY ("blocker_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_user_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_reports_status_created_at_idx" ON "content_reports" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_reports_target_idx" ON "content_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "content_reports_reporter_created_at_idx" ON "content_reports" USING btree ("reporter_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_open_reporter_target_unique_idx" ON "content_reports" USING btree ("reporter_user_id","target_type","target_id") WHERE "content_reports"."status" = 'open' AND "content_reports"."reporter_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptances_user_terms_version_unique_idx" ON "legal_acceptances" USING btree ("user_id","terms_version");--> statement-breakpoint
CREATE INDEX "legal_acceptances_user_accepted_at_idx" ON "legal_acceptances" USING btree ("user_id","accepted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "user_blocks_blocker_blocked_unique_idx" ON "user_blocks" USING btree ("blocker_user_id","blocked_user_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_user_idx" ON "user_blocks" USING btree ("blocked_user_id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_moderation_state_check" CHECK ("activity_events"."moderation_state" IN ('visible', 'hidden'));--> statement-breakpoint
ALTER TABLE "cooking_reviews" ADD CONSTRAINT "cooking_reviews_moderation_state_check" CHECK ("cooking_reviews"."moderation_state" IN ('visible', 'hidden'));--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_event_type_check" CHECK ("admin_audit_events"."event_type" IN (
        'user.create',
        'user.set_role',
        'user.ban',
        'user.unban',
        'user.delete',
        'subscription.override.set',
        'subscription.override.clear',
        'moderation.report.resolve'
      ));--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_moderation_state_check" CHECK ("comments"."moderation_state" IN ('visible', 'hidden'));--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_moderation_state_check" CHECK ("recipes"."moderation_state" IN ('visible', 'hidden'));