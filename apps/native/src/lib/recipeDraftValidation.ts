export type RecipeDraftValidationField =
  "name" | "images" | "ingredients" | "servings";

export interface RecipeDraftValidationError {
  field: RecipeDraftValidationField;
  message: string;
}

interface RecipeDraftValidationInput {
  name: string;
  servings: number;
  images: {
    isRemote: boolean;
    uploadKey?: string;
  }[];
  ingredientSections: {
    ingredients: {
      text: string;
    }[];
  }[];
}

export function getRecipeDraftValidationErrors(
  draft: RecipeDraftValidationInput,
): RecipeDraftValidationError[] {
  const errors: RecipeDraftValidationError[] = [];

  if (!draft.name.trim()) {
    errors.push({ field: "name", message: "Add a recipe title." });
  }

  const hasReadyImage = draft.images.some(
    (image) => image.isRemote || Boolean(image.uploadKey),
  );
  if (!hasReadyImage) {
    errors.push({
      field: "images",
      message:
        draft.images.length > 0
          ? "Finish uploading or re-add your recipe photo."
          : "Add at least one recipe photo.",
    });
  }

  const hasIngredients = draft.ingredientSections.some((section) =>
    section.ingredients.some((ingredient) => ingredient.text.trim()),
  );
  if (!hasIngredients) {
    errors.push({
      field: "ingredients",
      message: "Add at least one ingredient.",
    });
  }

  if (!Number.isFinite(draft.servings) || draft.servings < 1) {
    errors.push({
      field: "servings",
      message: "Servings must be at least 1.",
    });
  }

  return errors;
}
