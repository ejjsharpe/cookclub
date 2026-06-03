import { describe, expect, it, vi } from "vitest";

import type { ParsedRecipe } from "../../../src/schema";
import {
  polishRecipeForSmartImport,
  recipeHygieneIssues,
} from "../../../src/services/recipe-polisher";

function scrapedRecipe(overrides: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return {
    name: "CRISPY CAULI WITH SUPER GREEN CREAMED BEANS",
    description: "SMOKEY, FIERY CAULIFLOWER",
    sourceUrl: "https://www.instagram.com/reel/DFIyUJAo2nL/",
    sourceType: "url",
    ingredientSections: [
      {
        name: "GREEN BEAN BLEND",
        ingredients: [
          { index: 0, quantity: 2, unit: "can", name: "400g butter beans" },
          { index: 1, quantity: 50, unit: "g", name: "spinach" },
        ],
      },
    ],
    instructionSections: [
      {
        name: "METHOD",
        instructions: [
          {
            index: 0,
            instruction:
              "1️⃣ ROAST THE CAULIFLOWER | TOSS WITH OIL AND SPICES",
            imageUrl: null,
          },
          {
            index: 1,
            instruction:
              "2️⃣ SERVE | SPREAD THE GREEN BEAN BLEND ON A PLATE",
            imageUrl: "https://example.com/step.jpg",
          },
        ],
      },
    ],
    images: ["https://example.com/recipe.jpg"],
    suggestedTags: [],
    ...overrides,
  };
}

describe("polishRecipeForSmartImport", () => {
  it("deterministically cleans casing, markers, separators, and punctuation", async () => {
    const ai = { run: vi.fn() };
    const result = await polishRecipeForSmartImport(ai as any, scrapedRecipe());

    expect(result.usedAi).toBe(false);
    expect(ai.run).not.toHaveBeenCalled();
    expect(result.recipe.name).toBe(
      "Crispy Cauli With Super Green Creamed Beans",
    );
    expect(result.recipe.description).toBe("Smokey, fiery cauliflower.");
    expect(result.recipe.ingredientSections[0]?.name).toBe("Green Bean Blend");
    expect(
      result.recipe.instructionSections[0]?.instructions.map(
        (instruction) => instruction.instruction,
      ),
    ).toEqual([
      "Roast the cauliflower: toss with oil and spices.",
      "Serve: spread the green bean blend on a plate.",
    ]);
    expect(
      result.recipe.instructionSections[0]?.instructions[1]?.imageUrl,
    ).toBe("https://example.com/step.jpg");
    expect(recipeHygieneIssues(result.recipe)).toEqual([]);
  });

  it("uses the fast polish model when deterministic cleanup leaves a generic title", async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Crispy Cauli With Super Green Creamed Beans",
          description: "A smoky cauliflower and green bean recipe.",
          ingredientSections: [
            {
              name: "Green Bean Blend",
              ingredients: [
                { name: "400g butter beans" },
                { name: "spinach" },
              ],
            },
          ],
          instructionSections: [
            {
              name: "Method",
              instructions: [
                {
                  instruction:
                    "Roast the cauliflower with oil and spices until tender.",
                },
                {
                  instruction:
                    "Serve with the green bean blend and crispy onions.",
                },
              ],
            },
          ],
        }),
      }),
    };

    const result = await polishRecipeForSmartImport(
      ai as any,
      scrapedRecipe({ name: "Follow" }),
    );

    expect(result.usedAi).toBe(true);
    expect(ai.run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.1-8b-instruct-fast",
      expect.objectContaining({ max_tokens: 2048 }),
    );
    expect(result.recipe.name).toBe(
      "Crispy Cauli With Super Green Creamed Beans",
    );
    expect(result.recipe.ingredientSections[0]?.ingredients[0]).toMatchObject({
      quantity: 2,
      unit: "can",
      name: "400g butter beans",
    });
  });
});
