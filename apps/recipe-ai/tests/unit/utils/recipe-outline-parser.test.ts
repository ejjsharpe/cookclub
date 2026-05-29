import { describe, expect, it } from "vitest";

import { extractRecipeOutline } from "../../../src/utils/recipe-outline-parser";

describe("extractRecipeOutline", () => {
  it("extracts normal Ingredients and Method outlines", () => {
    const recipe = extractRecipeOutline(
      `
      Lemon Pasta
      Serves 4
      Ingredients:
      - 300 g spaghetti
      - 1 lemon, zested
      - 2 tbsp olive oil
      Method:
      1. Boil the spaghetti.
      2. Toss with lemon zest and olive oil.
      `,
      { sourceUrl: "https://example.com/lemon-pasta", sourceType: "url" },
    );

    expect(recipe?.name).toBe("Lemon Pasta");
    expect(recipe?.servings).toBe(4);
    expect(recipe?.ingredientSections[0]?.ingredients).toHaveLength(3);
    expect(recipe?.instructionSections[0]?.instructions).toHaveLength(2);
  });

  it("extracts cottage pie captions that start ingredients with Serves", () => {
    const caption =
      "COTTAGE PIE  Nothing fancy, just a cozy cottage pie. Serves 8: •1kg 5% beef mince •2 carrots •1 onion For the mash you’ll need: •500g potatoes •100g butter Method: * Fry the mince. * Boil and mash the potatoes. * Bake until golden.";

    const recipe = extractRecipeOutline(caption, {
      sourceUrl: "https://www.tiktok.com/@cook/video/123",
      images: ["https://example.com/cottage.jpg"],
    });

    expect(recipe?.name).toBe("Cottage Pie");
    expect(recipe?.servings).toBe(8);
    expect(recipe?.ingredientSections).toHaveLength(2);
    expect(recipe?.ingredientSections[1]?.name).toBe("Mash");
    expect(recipe?.instructionSections[0]?.instructions).toHaveLength(3);
  });

  it("keeps For the sauce ingredient sections", () => {
    const recipe = extractRecipeOutline(
      `
      Crispy Tofu Bowls
      Ingredients:
      400 g tofu
      2 cups cooked rice
      For the sauce:
      2 tbsp soy sauce
      1 tbsp sesame oil
      Directions:
      1. Roast the tofu.
      2. Whisk the sauce and serve with rice.
      `,
    );

    expect(recipe?.ingredientSections).toHaveLength(2);
    expect(recipe?.ingredientSections[1]?.name).toBe("Sauce");
    expect(recipe?.ingredientSections[1]?.ingredients[0]?.name).toBe(
      "soy sauce",
    );
  });

  it("extracts compact one-line captions", () => {
    const recipe = extractRecipeOutline(
      "Easy tomato pasta Ingredients: 200 g spaghetti 1 cup tomato sauce Method: 1. Boil the spaghetti. 2. Toss with tomato sauce.",
    );

    expect(recipe?.name).toBe("Easy Tomato Pasta");
    expect(recipe?.ingredientSections[0]?.ingredients).toHaveLength(2);
    expect(recipe?.instructionSections[0]?.instructions).toHaveLength(2);
  });

  it("keeps continuation quantities in the same ingredient", () => {
    const recipe = extractRecipeOutline(
      "Brownies Ingredients: 5 tbsp butter 1 1/4 cups sugar 2 eggs plus 1 egg yolk 1 tsp vanilla Method: 1. Mix ingredients. 2. Bake brownies.",
    );
    const eggRecipe = extractRecipeOutline(
      "Custard Ingredients: 2 eggs and 1 egg yolk 1 cup milk Method: 1. Whisk. 2. Cook.",
    );

    const ingredients = recipe?.ingredientSections[0]?.ingredients;

    expect(ingredients).toHaveLength(4);
    expect(ingredients?.map((ingredient) => ingredient.name)).toEqual([
      "butter",
      "sugar",
      "eggs plus 1 egg yolk",
      "vanilla",
    ]);
    expect(
      eggRecipe?.ingredientSections[0]?.ingredients.map(
        (ingredient) => ingredient.name,
      ),
    ).toEqual(["eggs and 1 egg yolk", "milk"]);
  });

  it("keeps imperative instruction lines as steps", () => {
    const recipe = extractRecipeOutline(
      `
      Pasta
      Ingredients:
      200 g pasta
      1 cup sauce
      Steps:
      Make sure the pan is hot
      To serve, top with basil
      Eat immediately
      `,
    );

    const instructions = recipe?.instructionSections[0]?.instructions;

    expect(instructions?.map((instruction) => instruction.instruction)).toEqual([
      "Make sure the pan is hot",
      "To serve, top with basil",
      "Eat immediately",
    ]);
  });

  it("handles emoji and bullet steps", () => {
    const recipe = extractRecipeOutline(
      `
      Pancake Stack
      You’ll need:
      🥞 1 cup flour
      🥚 2 eggs
      • 1 cup milk
      Steps:
      ✅ Whisk everything together.
      • Cook spoonfuls in a hot pan.
      `,
    );

    expect(recipe?.ingredientSections[0]?.ingredients).toHaveLength(3);
    expect(recipe?.instructionSections[0]?.instructions).toHaveLength(2);
  });

  it("rejects ingredient-only captions and non-recipe noise", () => {
    expect(
      extractRecipeOutline(
        "Brownie ingredients: 1 cup sugar 2 eggs 1 cup flour #recipe",
      ),
    ).toBeNull();
    expect(
      extractRecipeOutline(
        "Behind the scenes at dinner service. Follow for more kitchen clips.",
      ),
    ).toBeNull();
  });
});
