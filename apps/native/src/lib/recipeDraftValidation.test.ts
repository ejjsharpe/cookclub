import { describe, expect, it } from "vitest";

import { getRecipeDraftValidationErrors } from "./recipeDraftValidation";

const validDraft = {
  name: "Tomato pasta",
  servings: 4,
  images: [{ isRemote: true }],
  ingredientSections: [{ ingredients: [{ text: "200g pasta" }] }],
};

describe("getRecipeDraftValidationErrors", () => {
  it("returns every missing save requirement", () => {
    const errors = getRecipeDraftValidationErrors({
      name: "   ",
      servings: 0,
      images: [],
      ingredientSections: [{ ingredients: [{ text: "  " }] }],
    });

    expect(errors).toEqual([
      { field: "name", message: "Add a recipe title." },
      { field: "images", message: "Add at least one recipe photo." },
      { field: "ingredients", message: "Add at least one ingredient." },
      { field: "servings", message: "Servings must be at least 1." },
    ]);
  });

  it("accepts an uploaded local image", () => {
    const errors = getRecipeDraftValidationErrors({
      ...validDraft,
      images: [{ isRemote: false, uploadKey: "recipe_upload_1" }],
    });

    expect(errors).toEqual([]);
  });

  it("explains when a local photo is not ready to save", () => {
    const errors = getRecipeDraftValidationErrors({
      ...validDraft,
      images: [{ isRemote: false }],
    });

    expect(errors).toEqual([
      {
        field: "images",
        message: "Finish uploading or re-add your recipe photo.",
      },
    ]);
  });
});
