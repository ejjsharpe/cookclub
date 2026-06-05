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
            instruction: "1️⃣ ROAST THE CAULIFLOWER | TOSS WITH OIL AND SPICES",
            imageUrl: null,
          },
          {
            index: 1,
            instruction: "2️⃣ SERVE | SPREAD THE GREEN BEAN BLEND ON A PLATE",
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
                {
                  index: 0,
                  quantity: 2,
                  unit: "can",
                  name: "400g butter beans",
                },
                { index: 1, quantity: 50, unit: "g", name: "spinach" },
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
    expect(ai.run.mock.calls[0]?.[1].messages[1].content).toContain(
      "copy index, quantity, and unit exactly",
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

  it("rejects polished ingredient names that repeat stored measurements", async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Butter Chicken",
          ingredientSections: [
            {
              name: "Sauce",
              ingredients: [
                {
                  index: 0,
                  quantity: 1,
                  unit: "tablespoon",
                  name: "1 tablespoon vegetable oil",
                },
                {
                  index: 1,
                  quantity: 4,
                  unit: null,
                  name: "large garlic cloves",
                },
                {
                  index: 2,
                  quantity: 2,
                  unit: "can",
                  name: "400g butter beans",
                },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [{ instruction: "Cook until tender." }],
            },
          ],
        }),
      }),
    };

    const result = await polishRecipeForSmartImport(
      ai as any,
      scrapedRecipe({
        name: "Follow",
        ingredientSections: [
          {
            name: "Sauce",
            ingredients: [
              {
                index: 0,
                quantity: 1,
                unit: "tablespoon",
                name: "vegetable oil",
              },
              {
                index: 1,
                quantity: 4,
                unit: null,
                name: "garlic cloves",
              },
              {
                index: 2,
                quantity: 2,
                unit: "can",
                name: "400g butter beans",
              },
            ],
          },
        ],
        instructionSections: [
          {
            name: null,
            instructions: [
              {
                index: 0,
                instruction:
                  "Follow the method shown in the source video using the listed ingredients.",
              },
            ],
          },
        ],
      }),
    );

    expect(result.usedAi).toBe(true);
    expect(
      result.recipe.ingredientSections[0]?.ingredients.map(
        (ingredient) => ingredient.name,
      ),
    ).toEqual(["vegetable oil", "large garlic cloves", "400g butter beans"]);
  });

  it("ignores polished ingredient fields with changed quantity, unit, or order", async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Pantry Bean Stew",
          ingredientSections: [
            {
              name: null,
              ingredients: [
                {
                  index: 0,
                  quantity: 2,
                  unit: "cup",
                  name: "chopped tomatoes",
                },
                { index: 1, quantity: 1, unit: "tablespoon", name: "sea salt" },
                { index: 3, quantity: null, unit: null, name: "fresh basil" },
                {
                  index: 3,
                  quantity: 2,
                  unit: "can",
                  name: "400g butter beans",
                },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [{ instruction: "Simmer until thickened." }],
            },
          ],
        }),
      }),
    };

    const result = await polishRecipeForSmartImport(
      ai as any,
      scrapedRecipe({
        name: "Follow",
        ingredientSections: [
          {
            name: null,
            ingredients: [
              { index: 0, quantity: 1, unit: "cup", name: "tomatoes" },
              { index: 1, quantity: 1, unit: "teaspoon", name: "salt" },
              { index: 2, quantity: null, unit: null, name: "basil" },
              {
                index: 3,
                quantity: 2,
                unit: "can",
                name: "400g butter beans",
              },
            ],
          },
        ],
        instructionSections: [
          {
            name: null,
            instructions: [{ index: 0, instruction: "Cook everything." }],
          },
        ],
      }),
    );

    expect(result.usedAi).toBe(true);
    expect(
      result.recipe.ingredientSections[0]?.ingredients.map(
        (ingredient) => ingredient.name,
      ),
    ).toEqual(["tomatoes", "salt", "basil", "400g butter beans"]);
  });
});
