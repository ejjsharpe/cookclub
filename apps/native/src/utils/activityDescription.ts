import type { RecipeMetadata } from "@repo/contracts/feed";

export const RECIPE_IMPORT_SOURCE_PREFIX = "imported a recipe from";

export function getRecipeImportSourceDescription(
  recipe: RecipeMetadata,
): string {
  switch (recipe.sourceType) {
    case "url":
      return recipe.sourceDomain;
    case "text":
      return "text";
    case "image":
      return "an image";
    case "ai":
      return "AI";
    case "user":
      return recipe.originalOwner?.username
        ? `@${recipe.originalOwner.username}`
        : (recipe.originalOwner?.name ?? "another user");
    case "manual":
      return "scratch";
  }
}

export function formatRecipeImportActivityDescription(
  recipe: RecipeMetadata,
  sourceDescription = getRecipeImportSourceDescription(recipe),
): string {
  switch (recipe.sourceType) {
    case "manual":
      return "created a recipe from scratch";
    case "ai":
      return "created a recipe with AI";
    default:
      return `${RECIPE_IMPORT_SOURCE_PREFIX} ${sourceDescription}`;
  }
}
