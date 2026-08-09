DROP INDEX "notifications_recipient_created_idx";--> statement-breakpoint
CREATE INDEX "notifications_recipient_id_idx" ON "notifications" USING btree ("recipient_id","id" DESC NULLS LAST);