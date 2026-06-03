ALTER TABLE "recipe_images" ADD COLUMN "storage_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_images" ADD COLUMN "width" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_images" ADD COLUMN "height" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_images" ADD COLUMN "content_type" text DEFAULT 'image/jpeg' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_images" ADD COLUMN "byte_size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_images" ADD COLUMN "preview_data_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_review_images" ADD COLUMN "storage_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_review_images" ADD COLUMN "width" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_review_images" ADD COLUMN "height" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_review_images" ADD COLUMN "content_type" text DEFAULT 'image/jpeg' NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_review_images" ADD COLUMN "byte_size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_review_images" ADD COLUMN "preview_data_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_images" ADD CONSTRAINT "recipe_images_content_type_check" CHECK ("recipe_images"."content_type" IN ('image/jpeg', 'image/webp', 'image/png'));--> statement-breakpoint
ALTER TABLE "cooking_review_images" ADD CONSTRAINT "cooking_review_images_content_type_check" CHECK ("cooking_review_images"."content_type" IN ('image/jpeg', 'image/webp', 'image/png'));--> statement-breakpoint
CREATE INDEX "recipe_images_storage_key_idx" ON "recipe_images" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "cooking_review_images_storage_key_idx" ON "cooking_review_images" USING btree ("storage_key");
