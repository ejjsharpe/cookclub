CREATE OR REPLACE FUNCTION recipe_normalize_search_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(lower(input), '[^[:alnum:]]+', ' ', 'g'));
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION recipe_prefix_tsquery(input text)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT string_agg(quote_literal(lexeme) || ':*', ' & ' ORDER BY lexeme)::tsquery
  FROM unnest(tsvector_to_array(to_tsvector('english', input))) AS lexemes(lexeme);
$$;--> statement-breakpoint

CREATE TABLE "recipe_search_documents" (
	"recipe_id" integer PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"ingredient_names" text DEFAULT '' NOT NULL,
	"title_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "title")) STORED NOT NULL,
	"ingredient_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "ingredient_names")) STORED NOT NULL,
	"combined_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', "title"), 'A') || setweight(to_tsvector('english', "ingredient_names"), 'B')) STORED NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_search_documents" ADD CONSTRAINT "recipe_search_documents_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_search_documents" ADD CONSTRAINT "recipe_search_documents_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "recipe_search_documents" (
	"recipe_id",
	"owner_id",
	"title",
	"ingredient_names",
	"updated_at"
)
SELECT
	recipe."id",
	recipe."owner_id",
	recipe."name",
	COALESCE((
		SELECT string_agg(ingredient."name", ' ' ORDER BY section."index", ingredient."index")
		FROM "ingredient_sections" AS section
		INNER JOIN "recipe_ingredients" AS ingredient
			ON ingredient."section_id" = section."id"
		WHERE section."recipe_id" = recipe."id"
	), ''),
	recipe."updated_at"
FROM "recipes" AS recipe;--> statement-breakpoint
CREATE INDEX "recipe_search_documents_owner_id_idx" ON "recipe_search_documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "recipe_search_documents_combined_vector_idx" ON "recipe_search_documents" USING gin ("combined_vector");--> statement-breakpoint
CREATE INDEX "recipe_search_documents_ingredient_vector_idx" ON "recipe_search_documents" USING gin ("ingredient_vector");--> statement-breakpoint
CREATE INDEX "recipes_owner_created_id_idx" ON "recipes" USING btree ("owner_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
