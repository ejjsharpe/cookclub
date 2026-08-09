import type { NutritionInput } from "@repo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateNutrition } from "../../../src/services/nutrition-generator";

const sourceMocks = vi.hoisted(() => ({
  fetchHtml: vi.fn(),
  extractStructuredRecipeCandidates: vi.fn(),
}));

vi.mock("../../../src/import/url/fetch", () => ({
  fetchHtml: sourceMocks.fetchHtml,
}));
vi.mock("../../../src/import/url/structured-data", () => ({
  extractStructuredRecipeCandidates:
    sourceMocks.extractStructuredRecipeCandidates,
}));

const recipe: NutritionInput["recipe"] = {
  name: "Weeknight Pasta",
  description: "A simple pasta dinner",
  servings: 4,
  sourceUrl: "https://recipes.example.com/weeknight-pasta",
  sourceType: "url",
  ingredientSections: [
    {
      name: null,
      ingredients: [
        { index: 0, quantity: 400, unit: "g", name: "spaghetti" },
        { index: 1, quantity: 2, unit: "tbsp", name: "olive oil" },
      ],
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [{ index: 0, instruction: "Boil and toss." }],
    },
  ],
};

function createAi(response: string) {
  return { complete: vi.fn().mockResolvedValue(response) };
}

describe("generateNutrition", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sourceMocks.fetchHtml.mockReset();
    sourceMocks.extractStructuredRecipeCandidates.mockReset();
    sourceMocks.fetchHtml.mockResolvedValue("<html>recipe</html>");
    sourceMocks.extractStructuredRecipeCandidates.mockReturnValue([]);
  });

  it("returns complete structured nutrition from the source without AI", async () => {
    sourceMocks.extractStructuredRecipeCandidates.mockReturnValue([
      {
        nutrition: {
          calories: 480,
          protein: 18,
          carbohydrates: 62,
          fat: 17,
          source: "extracted",
          confidence: "high",
        },
      },
    ]);
    const ai = createAi("{}");

    const result = await generateNutrition({ recipe }, ai);

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        calories: 480,
        protein: 18,
        carbohydrates: 62,
        fat: 17,
        source: "extracted",
      }),
    });
    expect(sourceMocks.fetchHtml).toHaveBeenCalledWith(recipe.sourceUrl, 0);
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("preserves partial source values while AI fills missing fields", async () => {
    sourceMocks.extractStructuredRecipeCandidates.mockReturnValue([
      {
        nutrition: {
          calories: 430,
          protein: null,
          carbohydrates: null,
          fat: null,
          source: "extracted",
          confidence: "low",
        },
      },
    ]);
    const ai = createAi(
      JSON.stringify({
        calories: 500,
        protein: 20,
        carbohydrates: 70,
        fat: 16,
        fiber: 8,
        confidence: "medium",
      }),
    );

    const result = await generateNutrition({ recipe }, ai);

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        calories: 430,
        protein: 20,
        carbohydrates: 70,
        fat: 16,
        fiber: 8,
        source: "ai_estimated",
        confidence: "low",
      }),
    });
    expect(JSON.stringify(ai.complete.mock.calls[0]?.[1])).toContain(
      '\\"calories\\":430',
    );
  });

  it("falls back to AI when source extraction fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    sourceMocks.fetchHtml.mockRejectedValue(new Error("Source unavailable"));
    const ai = createAi(
      JSON.stringify({
        calories: 500,
        protein: 20,
        carbohydrates: 70,
        fat: 16,
        confidence: "medium",
      }),
    );

    const result = await generateNutrition({ recipe }, ai);

    expect(result.success).toBe(true);
    expect(ai.complete).toHaveBeenCalledTimes(1);
  });

  it("returns a stable error when AI provides no nutrition values", async () => {
    const ai = createAi(JSON.stringify({ confidence: "low" }));

    const result = await generateNutrition(
      { recipe: { ...recipe, sourceUrl: null } },
      ai,
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: "NUTRITION_GENERATION_FAILED",
        message: "AI returned empty nutrition estimates.",
      },
    });
    expect(sourceMocks.fetchHtml).not.toHaveBeenCalled();
  });

  it("reports an AI failure when partial existing nutrition cannot be filled", async () => {
    const ai = {
      complete: vi.fn().mockRejectedValue(new Error("Provider unavailable")),
    };

    const result = await generateNutrition(
      {
        recipe: {
          ...recipe,
          nutrition: {
            calories: 430,
            source: "imported",
            confidence: "high",
          },
        },
      },
      ai,
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: "NUTRITION_GENERATION_FAILED",
        message: "Provider unavailable",
      },
    });
    expect(sourceMocks.fetchHtml).not.toHaveBeenCalled();
  });
});
