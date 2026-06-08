DROP INDEX "tags_type_idx";--> statement-breakpoint
DROP INDEX "tags_type_name_idx";--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_type_check";--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
INSERT INTO "tags" ("type", "name", "user_id", "normalized_name", "created_at", "updated_at")
SELECT "type", "name", "user_id", "normalized_name", now(), now()
FROM (
  SELECT DISTINCT ON ("recipes"."owner_id", lower(btrim(regexp_replace(regexp_replace("tags"."name", '^#+', ''), '[[:space:]]+', ' ', 'g'))))
    "tags"."type",
    btrim(regexp_replace(regexp_replace("tags"."name", '^#+', ''), '[[:space:]]+', ' ', 'g')) AS "name",
    "recipes"."owner_id" AS "user_id",
    lower(btrim(regexp_replace(regexp_replace("tags"."name", '^#+', ''), '[[:space:]]+', ' ', 'g'))) AS "normalized_name"
  FROM "recipe_tags"
  INNER JOIN "recipes" ON "recipe_tags"."recipe_id" = "recipes"."id"
  INNER JOIN "tags" ON "recipe_tags"."tag_id" = "tags"."id"
  WHERE btrim(regexp_replace(regexp_replace("tags"."name", '^#+', ''), '[[:space:]]+', ' ', 'g')) <> ''
  ORDER BY "recipes"."owner_id", lower(btrim(regexp_replace(regexp_replace("tags"."name", '^#+', ''), '[[:space:]]+', ' ', 'g'))), "tags"."name"
) AS "user_tags";--> statement-breakpoint
UPDATE "recipe_tags"
SET "tag_id" = "user_tags"."id"
FROM "recipes", "tags" AS "old_tags", "tags" AS "user_tags"
WHERE "recipe_tags"."recipe_id" = "recipes"."id"
  AND "recipe_tags"."tag_id" = "old_tags"."id"
  AND "old_tags"."user_id" IS NULL
  AND "user_tags"."user_id" = "recipes"."owner_id"
  AND "user_tags"."normalized_name" = lower(btrim(regexp_replace(regexp_replace("old_tags"."name", '^#+', ''), '[[:space:]]+', ' ', 'g')));--> statement-breakpoint
DELETE FROM "tags" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "normalized_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tags_user_id_idx" ON "tags" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_normalized_name_idx" ON "tags" USING btree ("user_id","normalized_name");
