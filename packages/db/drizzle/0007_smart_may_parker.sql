ALTER TABLE "recipe_images" DROP COLUMN "preview_data_url";--> statement-breakpoint
ALTER TABLE "cooking_review_images" DROP COLUMN "preview_data_url";--> statement-breakpoint
ALTER TABLE "recipe_images" ADD COLUMN "thumbhash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_review_images" ADD COLUMN "thumbhash" text DEFAULT '' NOT NULL;
