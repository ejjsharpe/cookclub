import { eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import {
  ingredientSections,
  recipeIngredients,
  recipes,
  recipeSearchDocuments,
} from "../../schemas";
type RecipeSearchDocumentClient = PgDatabase<any, any, any>;

/** Synchronize one document inside the recipe writer's transaction. */
export async function syncRecipeSearchDocument(
  tx: RecipeSearchDocumentClient,
  recipeId: number,
): Promise<void> {
  const ingredientNames = sql<string>`COALESCE((
    SELECT string_agg(
      ${recipeIngredients.name},
      ' ' ORDER BY ${ingredientSections.index}, ${recipeIngredients.index}
    )
    FROM ${ingredientSections}
    INNER JOIN ${recipeIngredients}
      ON ${recipeIngredients.sectionId} = ${ingredientSections.id}
    WHERE ${ingredientSections.recipeId} = ${recipes.id}
  ), '')`.as("ingredient_names");

  await tx
    .insert(recipeSearchDocuments)
    .select(
      tx
        .select({
          recipeId: recipes.id,
          ownerId: recipes.ownerId,
          title: recipes.name,
          ingredientNames,
        })
        .from(recipes)
        .where(eq(recipes.id, recipeId)),
    )
    .onConflictDoUpdate({
      target: recipeSearchDocuments.recipeId,
      set: {
        ownerId: sql`excluded.owner_id`,
        title: sql`excluded.title`,
        ingredientNames: sql`excluded.ingredient_names`,
      },
    });
}
