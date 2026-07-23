import { eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import {
  ingredientSections,
  recipeIngredients,
  recipes,
  recipeSearchDocuments,
} from "../../schemas";
type RecipeSearchDocumentClient = PgDatabase<any, any, any>;

export function buildRecipeSearchDocumentSyncQuery(
  tx: RecipeSearchDocumentClient,
  recipeId: number,
) {
  const ingredientNames = sql<string>`COALESCE((
    SELECT string_agg(
      ${recipeIngredients.name},
      ' ' ORDER BY ${ingredientSections.index}, ${recipeIngredients.index}
    )
    FROM ${ingredientSections}
    INNER JOIN ${recipeIngredients}
      ON ${recipeIngredients.sectionId} = ${ingredientSections.id}
    WHERE ${ingredientSections.recipeId} = ${recipes.id}
  ), '')`;

  return tx
    .insert(recipeSearchDocuments)
    .select(
      sql`
        SELECT
          ${recipes.id},
          ${recipes.ownerId},
          ${recipes.name},
          ${ingredientNames}
        FROM ${recipes}
        WHERE ${eq(recipes.id, recipeId)}
      `,
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

/** Synchronize one document inside the recipe writer's transaction. */
export async function syncRecipeSearchDocument(
  tx: RecipeSearchDocumentClient,
  recipeId: number,
): Promise<void> {
  await buildRecipeSearchDocumentSyncQuery(tx, recipeId);
}
