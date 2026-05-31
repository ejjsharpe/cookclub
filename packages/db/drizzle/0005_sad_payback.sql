CREATE TABLE "admin_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_events_event_type_check" CHECK ("admin_audit_events"."event_type" IN (
        'user.create',
        'user.set_role',
        'user.ban',
        'user.unban',
        'user.delete',
        'subscription.override.set',
        'subscription.override.clear'
      ))
);
--> statement-breakpoint
CREATE TABLE "subscription_admin_overrides" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_admin_overrides_status_check" CHECK ("subscription_admin_overrides"."status" IN ('pro', 'free'))
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "subscription_admin_overrides" ADD CONSTRAINT "subscription_admin_overrides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_admin_overrides" ADD CONSTRAINT "subscription_admin_overrides_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_admin_overrides" ADD CONSTRAINT "subscription_admin_overrides_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_events_actor_user_idx" ON "admin_audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_events_target_user_idx" ON "admin_audit_events" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_events_event_type_idx" ON "admin_audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "admin_audit_events_created_at_idx" ON "admin_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "subscription_admin_overrides_status_idx" ON "subscription_admin_overrides" USING btree ("status");