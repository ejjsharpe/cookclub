DELETE FROM "shopping_list_items"
WHERE "source_recipe_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "recipes"
    WHERE "recipes"."id" = "shopping_list_items"."source_recipe_id"
  );
--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_source_recipe_id_recipes_id_fk" FOREIGN KEY ("source_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;
