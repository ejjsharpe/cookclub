import type { ParsedRecipe, Recipe } from "@/api/recipe";

/**
 * Type for a parsed recipe that can be displayed in preview mode
 */
export type PreviewRecipe = Omit<Recipe, "id" | "images"> & {
  isPreview: true;
  id: -1;
  images: { id: number; url: string }[];
};

/**
 * Transform a ParsedRecipe into a display-compatible Recipe format for preview mode.
 * This creates a "mock" recipe object that can be rendered by RecipeDetailScreen
 * without fetching from the server.
 */
export function transformParsedRecipeForPreview(
  parsedRecipe: ParsedRecipe,
): PreviewRecipe | null {
  if (!parsedRecipe.success || !parsedRecipe.data) {
    return null;
  }

  const data = parsedRecipe.data;

  // Build ingredient sections from parsed data
  const ingredientSections = data.ingredientSections?.length
    ? data.ingredientSections.map((section, sectionIndex) => ({
        id: -(sectionIndex + 1),
        name: section.name,
        index: sectionIndex,
        ingredients: section.ingredients.map((ing, ingIndex) => ({
          id: -(sectionIndex * 1000 + ingIndex + 1),
          index: ingIndex,
          quantity: ing.quantity?.toString() ?? null,
          unit: ing.unit ?? null,
          name: ing.name,
          preparation: null,
        })),
      }))
    : [
        {
          id: -1,
          name: null,
          index: 0,
          ingredients: [],
        },
      ];

  // Build instruction sections from parsed data
  const instructionSections = data.instructionSections?.length
    ? data.instructionSections.map((section, sectionIndex) => ({
        id: -(sectionIndex + 1),
        name: section.name,
        index: sectionIndex,
        instructions: section.instructions.map((inst, instIndex) => ({
          id: -(sectionIndex * 1000 + instIndex + 1),
          index: instIndex,
          instruction: inst.instruction,
          imageUrl: inst.imageUrl ?? null,
        })),
      }))
    : [
        {
          id: -1,
          name: null,
          index: 0,
          instructions: [],
        },
      ];

  return {
    isPreview: true,
    id: -1,
    name: data.name,
    description: data.description ?? null,
    prepTime: data.prepTime ?? null,
    cookTime: data.cookTime ?? null,
    totalTime: data.totalTime ?? null,
    servings: data.servings ?? 4,
    sourceUrl: data.sourceUrl ?? null,
    sourceType: data.sourceType ?? parsedRecipe.metadata.source,
    moderationState: "visible",
    originalRecipeId: null,
    originalOwnerId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Mock owner (will be replaced with actual user on save)
    owner: {
      id: "",
      name: "Unknown",
      username: null,
      image: null,
    },

    // Transform images - assign temporary IDs
    images: (data.images ?? []).map((url, index) => ({
      id: -(index + 1),
      url,
    })),

    ingredientSections,
    instructionSections,

    // Preview-specific defaults
    userRecipesCount: 0,
    collectionIds: [],
    isInShoppingList: false,
    originalOwner: null,
    userReviewRating: null,
    tags: (data.suggestedTags ?? []).map((name, index) => ({
      id: -(index + 1),
      name,
    })),
    nutrition: data.nutrition ? { ...data.nutrition, generatedAt: null } : null,
  };
}
