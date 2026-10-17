import accordionPotatoes from "./facebook/accordion-potatoes.json";
import tomatoSoup from "./facebook/tomato-soup.json";
import wheatThins from "./facebook/wheat-thins.json";

export { accordionPotatoes, tomatoSoup, wheatThins };

export function facebookHtml(fixture: {
  meta: Record<string, string>;
  payload: unknown;
}): string {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");
  return `<html><head>${Object.entries(fixture.meta)
    .map(
      ([key, value]) =>
        `<meta property="${escape(key)}" content="${escape(value)}">`,
    )
    .join(
      "",
    )}</head><body><script type="application/json">${JSON.stringify(fixture.payload).replaceAll("<", "\\u003c")}</script></body></html>`;
}

export const wheatThinsRecipe = {
  name: "Homemade Wheat Thins",
  servings: null,
  prepTime: null,
  cookTime: null,
  totalTime: null,
  ingredientSections: [
    {
      name: null,
      ingredients: [
        "whole wheat flour",
        "salt",
        "brown sugar",
        "paprika",
        "butter",
        "water",
      ].map((name, index) => ({ index, name, quantity: null, unit: null })),
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [
        "Let the dough rest.",
        "Roll the dough very thinly and cut into squares.",
        "Sprinkle with salt and bake.",
      ].map((instruction, index) => ({ index, instruction })),
    },
  ],
};

export const tomatoSoupRecipe = {
  name: "Creamy Tomato Soup & Vegan Grilled Cheese",
  servings: null,
  prepTime: null,
  cookTime: 40,
  totalTime: null,
  ingredientSections: [
    {
      name: "Soup",
      ingredients: [
        { name: "tomatoes", quantity: 5, unit: null },
        { name: "bell peppers", quantity: 2, unit: null },
        { name: "onion", quantity: 1, unit: null },
        { name: "garlic", quantity: 2, unit: "head" },
        { name: "balsamic vinegar", quantity: 2, unit: "tbsp" },
        { name: "olive oil", quantity: 3, unit: "tbsp" },
        { name: "vegetable broth", quantity: 1, unit: "cup" },
        { name: "fresh basil", quantity: 1, unit: "bunch" },
        { name: "fresh rosemary", quantity: null, unit: null },
        { name: "salt", quantity: null, unit: null },
        { name: "black pepper", quantity: null, unit: null },
      ].map((ingredient, index) => ({ ...ingredient, index })),
    },
    {
      name: "Grilled cheese",
      ingredients: ["bread", "vegan butter", "vegan cheese"].map(
        (name, index) => ({ index, name, quantity: null, unit: null }),
      ),
    },
  ],
  instructionSections: [
    {
      name: "Soup",
      instructions: [
        "Cut the tomatoes and peppers in half, chop the onion, and cut the tops off the garlic heads.",
        "Place on a baking sheet with olive oil, balsamic vinegar, salt and rosemary.",
        "Roast at 350°F (180°C) for 40–50 minutes, until soft.",
        "Squeeze the roasted garlic out of its skins and transfer everything to a pot.",
        "Add basil, pepper and 1 cup vegetable broth, then blend. Add more broth as needed, using 1–2 cups (240–480 ml) in total.",
        "Simmer gently for a few minutes.",
      ].map((instruction, index) => ({ index, instruction })),
    },
    {
      name: "Grilled cheese",
      instructions: [
        {
          index: 0,
          instruction:
            "Cut a face into one bread slice. Melt vegan butter over medium heat, add bread and vegan cheese, and cook until golden and melted. Assemble with the face on top.",
        },
      ],
    },
  ],
};
