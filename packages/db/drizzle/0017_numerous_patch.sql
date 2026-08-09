CREATE INDEX "shopping_list_invitations_invited_by_user_idx" ON "shopping_list_invitations" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "meal_plan_invitations_invited_by_user_idx" ON "meal_plan_invitations" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "notifications_actor_id_idx" ON "notifications" USING btree ("actor_id");