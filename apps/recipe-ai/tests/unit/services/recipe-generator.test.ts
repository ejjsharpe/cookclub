import { describe, expect, it, vi } from "vitest";

import { processChat } from "../../../src/services/recipe-generator";

const emptyState = {
  ingredients: null,
  cuisinePreference: null,
  willingToShop: null,
  maxCookingTime: null,
};

const completeState = {
  ingredients: ["chicken", "rice"],
  cuisinePreference: "comfort food",
  willingToShop: false,
  maxCookingTime: "30 minutes",
};

const sectionedRecipe = {
  name: "Chicken and Rice",
  description: "A comforting one-pan dinner.",
  prepTime: 10,
  cookTime: 20,
  totalTime: 30,
  servings: 2,
  ingredientSections: [
    {
      name: null,
      ingredients: [
        { quantity: 2, unit: null, name: "chicken thighs" },
        { quantity: 1, unit: "cup", name: "rice" },
      ],
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [
        { text: "Brown the chicken." },
        { text: "Add the rice and simmer until tender." },
      ],
    },
  ],
  suggestedTags: ["Dinner"],
};

function createMockAi() {
  return {
    complete: vi.fn(),
  };
}

describe("processChat", () => {
  it("uses a JSON schema and returns the next conversation message", async () => {
    const mockAi = createMockAi();
    mockAi.complete.mockResolvedValue(
      JSON.stringify({
        message: "What kind of food are you in the mood for?",
        suggestedReplies: ["Italian", "Comfort food"],
        updatedState: {
          ...emptyState,
          ingredients: ["chicken", "rice"],
        },
        readyToGenerate: false,
      }),
    );

    const result = await processChat(
      mockAi as any,
      [{ role: "user", content: "Chicken and rice" }],
      emptyState,
    );

    expect(result).toMatchObject({
      type: "message",
      updatedState: { ingredients: ["chicken", "rice"] },
    });
    expect(mockAi.complete.mock.calls[0]?.[1]).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: { type: "object" },
      },
    });
  });

  it("generates a recipe as soon as the final answer completes the state", async () => {
    const mockAi = createMockAi();
    mockAi.complete
      .mockResolvedValueOnce(
        JSON.stringify({
          message: "Perfect, I have everything I need.",
          suggestedReplies: [],
          updatedState: completeState,
          readyToGenerate: false,
        }),
      )
      .mockResolvedValueOnce(JSON.stringify(sectionedRecipe));

    const result = await processChat(
      mockAi as any,
      [{ role: "user", content: "I have 30 minutes" }],
      { ...completeState, maxCookingTime: null },
    );

    expect(result.type).toBe("recipe");
    if (result.type === "recipe") {
      expect(result.recipe.name).toBe("Chicken and Rice");
      expect(result.recipe.ingredientSections[0]?.ingredients[0]).toMatchObject(
        {
          index: 0,
          name: "chicken thighs",
        },
      );
    }
    expect(mockAi.complete).toHaveBeenCalledTimes(2);
    expect(mockAi.complete.mock.calls[1]?.[1]).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          required: expect.arrayContaining([
            "ingredientSections",
            "instructionSections",
          ]),
        },
      },
    });
  });
});
