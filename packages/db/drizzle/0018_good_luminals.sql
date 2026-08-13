ALTER TABLE "recipe_images" ADD COLUMN "index" integer;--> statement-breakpoint
WITH "ranked_recipe_images" AS (
	SELECT
		"id",
		(ROW_NUMBER() OVER (PARTITION BY "recipe_id" ORDER BY "id") - 1)::integer AS "position"
	FROM "recipe_images"
)
UPDATE "recipe_images"
SET "index" = "ranked_recipe_images"."position"
FROM "ranked_recipe_images"
WHERE "recipe_images"."id" = "ranked_recipe_images"."id";--> statement-breakpoint
ALTER TABLE "recipe_images" ALTER COLUMN "index" SET NOT NULL;--> statement-breakpoint
DROP INDEX "recipe_images_recipe_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_images_recipe_id_index_idx" ON "recipe_images" USING btree ("recipe_id","index");
