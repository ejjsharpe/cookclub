import type {
  Ingredient,
  IngredientSection,
  InstructionSection,
  ParsedRecipe,
} from "../schema";
import { normalizeRecipeForImport } from "../utils/recipe-quality";

const POLISH_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast" as const;
const EMOJI_NUMBER_MARKER_PATTERN =
  /^(?:[0-9#*]\uFE0F?\u20E3|[\u2460-\u2473\u24EA\u24F5-\u24FF\u2776-\u277F\u2780-\u2793])\s*[.)\]:：-]?\s*/u;
const LEADING_MARKER_PATTERN =
  /^(?:[-*•·▪▫◦\s]+|(?:step\s*)?\d{1,3}\s*[.)\]:：-]\s*)+/iu;
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\uFE0F\u20E3]/gu;
const SCRAPED_UI_PATTERN =
  /\b(?:follow|following|sign in|sign up|log in|view this post|open app|likes?|comments?|shares?|save this|link in bio)\b/i;
const GENERIC_TITLE_PATTERN =
  /^(?:imported social recipe|imported recipe|recipe|food|follow|instagram|reel|post|untitled)$/i;

interface PolishIngredient {
  index?: number | null;
  quantity?: number | null;
  unit?: string | null;
  name?: string | null;
}

interface PolishIngredientSection {
  name?: string | null;
  ingredients?: PolishIngredient[];
}

interface PolishInstructionSection {
  name?: string | null;
  instructions?: { instruction?: string | null }[];
}

interface PolishResponse {
  name?: string | null;
  description?: string | null;
  ingredientSections?: PolishIngredientSection[];
  instructionSections?: PolishInstructionSection[];
}

export interface RecipePolishResult {
  recipe: ParsedRecipe;
  issues: string[];
  usedAi: boolean;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkers(value: string): string {
  let text = collapseWhitespace(value);

  for (let index = 0; index < 3; index++) {
    const next = text
      .replace(EMOJI_NUMBER_MARKER_PATTERN, "")
      .replace(LEADING_MARKER_PATTERN, "")
      .trim();

    if (next === text) break;
    text = next;
  }

  return text;
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return word.length <= 2
        ? lower
        : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function hasMostlyUppercaseLetters(value: string): boolean {
  const letters = Array.from(value).filter((char) => /\p{L}/u.test(char));
  if (letters.length < 4) return false;

  const uppercase = letters.filter((char) => char === char.toUpperCase());
  return uppercase.length / letters.length > 0.8;
}

function sentenceCase(value: string): string {
  const text = collapseWhitespace(value);
  const source = hasMostlyUppercaseLetters(text) ? text.toLowerCase() : text;

  return source.replace(/\p{L}/u, (letter) => letter.toUpperCase());
}

function ensureSentencePunctuation(value: string): string {
  return /[.!?)]$/.test(value) ? value : `${value}.`;
}

function lowercaseColonClauses(value: string): string {
  return value.replace(/:\s+(\p{Lu})(?=\p{Ll})/gu, (_match, letter: string) => {
    return `: ${letter.toLowerCase()}`;
  });
}

function cleanTitle(value: string): string {
  const cleaned = collapseWhitespace(
    value
      .replace(EMOJI_PATTERN, " ")
      .replace(/[|]+/g, " ")
      .replace(/\bfull recipe below\b/gi, " "),
  );

  return hasMostlyUppercaseLetters(cleaned) ? titleCase(cleaned) : cleaned;
}

function cleanSectionName(value: string | null | undefined): string | null {
  if (!value) return null;

  const cleaned = collapseWhitespace(
    value.replace(EMOJI_PATTERN, " ").replace(/[|]+/g, " "),
  );
  if (!cleaned) return null;

  return hasMostlyUppercaseLetters(cleaned) ? titleCase(cleaned) : cleaned;
}

function cleanIngredientName(value: string): string {
  return collapseWhitespace(stripMarkers(value).replace(EMOJI_PATTERN, " "));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fractionQuantityPattern(quantity: number): string | null {
  const whole = Math.trunc(quantity);
  const fraction = quantity - whole;
  if (fraction === 0) return null;

  for (const denominator of [2, 3, 4, 8]) {
    const numerator = Math.round(fraction * denominator);
    if (numerator <= 0 || numerator >= denominator) continue;
    if (Math.abs(fraction - numerator / denominator) > 0.001) continue;

    const fractionText = `${numerator}/${denominator}`;
    return whole > 0
      ? `${whole}\\s+${fractionText}|${whole}\\s*${fractionText}`
      : fractionText;
  }

  return null;
}

function quantityPattern(quantity: number | null | undefined): string | null {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return null;

  const decimal = Number.isInteger(quantity)
    ? `${quantity}(?:\\.0+)?`
    : escapeRegExp(String(quantity));
  const fraction = fractionQuantityPattern(quantity);

  return fraction ? `(?:${decimal}|${fraction})` : decimal;
}

function unitPattern(unit: string | null | undefined): string | null {
  if (!unit) return null;

  const aliases: Record<string, string[]> = {
    tablespoon: ["tablespoons?", "tbsps?\\.?"],
    teaspoon: ["teaspoons?", "tsps?\\.?"],
    gram: ["grams?", "g"],
    kilogram: ["kilograms?", "kg"],
    milliliter: ["milliliters?", "millilitres?", "ml"],
    liter: ["liters?", "litres?", "l"],
    cup: ["cups?", "c"],
    ounce: ["ounces?", "oz"],
    pound: ["pounds?", "lbs?", "lb"],
    clove: ["cloves?"],
    can: ["cans?", "tins?"],
    container: ["containers?"],
    carton: ["cartons?"],
    package: ["packages?", "packets?"],
    box: ["boxes?", "box"],
    stick: ["sticks?"],
    slice: ["slices?"],
    piece: ["pieces?"],
    head: ["heads?"],
    stalk: ["stalks?"],
    sprig: ["sprigs?"],
    bunch: ["bunch(?:es)?"],
  };

  return `(?:${(aliases[unit] ?? [escapeRegExp(unit)]).join("|")})`;
}

function storedMeasurementPrefixPattern(
  ingredient: Pick<Ingredient, "quantity" | "unit">,
): RegExp | null {
  const quantity = quantityPattern(ingredient.quantity);
  if (!quantity) return null;

  const unit = unitPattern(ingredient.unit);
  return unit
    ? new RegExp(
        `^(?:about|approx\\.?|approximately)?\\s*${quantity}\\s*${unit}\\.?\\s+(?:of\\s+)?`,
        "i",
      )
    : new RegExp(
        `^(?:about|approx\\.?|approximately)?\\s*${quantity}\\s+`,
        "i",
      );
}

function hasStoredMeasurementPrefix(
  value: string,
  ingredient: Pick<Ingredient, "quantity" | "unit">,
): boolean {
  const prefixPattern = storedMeasurementPrefixPattern(ingredient);
  return prefixPattern ? prefixPattern.test(cleanIngredientName(value)) : false;
}

function stripStoredMeasurementPrefix(
  value: string,
  ingredient: Pick<Ingredient, "quantity" | "unit">,
): string {
  let text = cleanIngredientName(value);
  const prefixPattern = storedMeasurementPrefixPattern(ingredient);
  if (!prefixPattern) return text;

  for (let index = 0; index < 3; index++) {
    const next = text.replace(prefixPattern, "").trim();
    if (next === text) break;
    text = next;
  }

  return text || cleanIngredientName(value);
}

function quantitiesMatch(
  original: Ingredient["quantity"],
  polished: PolishIngredient["quantity"],
): boolean {
  if (original == null) return polished == null;
  return (
    typeof polished === "number" &&
    Number.isFinite(polished) &&
    Math.abs(original - polished) < 0.0001
  );
}

function unitsMatch(
  original: Ingredient["unit"],
  polished: PolishIngredient["unit"],
): boolean {
  return (original ?? null) === (polished ?? null);
}

function validatedPolishedIngredientName(
  original: Ingredient,
  polished: PolishIngredient | undefined,
): string | null {
  if (!polished) return null;
  if (polished.index !== original.index) return null;
  if (!quantitiesMatch(original.quantity, polished.quantity)) return null;
  if (!unitsMatch(original.unit, polished.unit)) return null;
  if (typeof polished.name !== "string") return null;

  const name = cleanIngredientName(polished.name);
  if (!name || hasStoredMeasurementPrefix(name, original)) return null;

  return name;
}

function cleanInstruction(value: string): string {
  const withoutMarkers = stripMarkers(value)
    .replace(EMOJI_PATTERN, " ")
    .replace(/\s+\|\s+/g, ": ");
  const text = lowercaseColonClauses(sentenceCase(withoutMarkers));

  return text ? ensureSentencePunctuation(text) : text;
}

function deterministicPolish(recipe: ParsedRecipe): ParsedRecipe {
  const normalized = normalizeRecipeForImport(recipe);

  const ingredientSections: IngredientSection[] =
    normalized.ingredientSections.map((section) => ({
      name: cleanSectionName(section.name),
      ingredients: section.ingredients.map((ingredient) => ({
        ...ingredient,
        name: stripStoredMeasurementPrefix(ingredient.name, ingredient),
      })),
    }));

  const instructionSections: InstructionSection[] =
    normalized.instructionSections.map((section) => ({
      name: cleanSectionName(section.name),
      instructions: section.instructions.map((instruction) => ({
        ...instruction,
        instruction: cleanInstruction(instruction.instruction),
      })),
    }));

  return normalizeRecipeForImport({
    ...normalized,
    name: cleanTitle(normalized.name),
    description: normalized.description
      ? ensureSentencePunctuation(sentenceCase(normalized.description))
      : null,
    ingredientSections,
    instructionSections,
  });
}

export function recipeHygieneIssues(recipe: ParsedRecipe): string[] {
  const issues = new Set<string>();

  if (GENERIC_TITLE_PATTERN.test(recipe.name.trim())) {
    issues.add("generic_title");
  }
  if (SCRAPED_UI_PATTERN.test(recipe.name)) {
    issues.add("scraped_title");
  }
  if (hasMostlyUppercaseLetters(recipe.name)) {
    issues.add("all_caps_title");
  }

  for (const section of recipe.instructionSections) {
    if (section.name && SCRAPED_UI_PATTERN.test(section.name)) {
      issues.add("scraped_section_name");
    }

    for (const instruction of section.instructions) {
      const text = instruction.instruction;
      if (EMOJI_NUMBER_MARKER_PATTERN.test(text) || EMOJI_PATTERN.test(text)) {
        issues.add("emoji_instruction_marker");
      }
      if (LEADING_MARKER_PATTERN.test(text)) {
        issues.add("list_marker");
      }
      if (/\s+\|\s+/.test(text)) {
        issues.add("scraped_separator");
      }
      if (SCRAPED_UI_PATTERN.test(text)) {
        issues.add("scraped_instruction");
      }
      if (hasMostlyUppercaseLetters(text)) {
        issues.add("all_caps_instruction");
      }
    }
  }

  return Array.from(issues);
}

function parseJsonResponse(response: unknown): PolishResponse {
  const raw =
    typeof response === "string"
      ? response
      : ((response as Record<string, unknown>)?.response ??
        (response as Record<string, unknown>)?.generated_text ??
        (response as Record<string, unknown>)?.result ??
        response);

  if (typeof raw !== "string") return raw as PolishResponse;

  let json = raw.trim();
  if (json.startsWith("```json")) {
    json = json.slice(7);
  } else if (json.startsWith("```")) {
    json = json.slice(3);
  }
  if (json.endsWith("```")) {
    json = json.slice(0, -3);
  }

  return JSON.parse(json.trim()) as PolishResponse;
}

function createPolishPrompt(recipe: ParsedRecipe, issues: string[]): string {
  return `Polish this parsed recipe JSON so it reads like a clean recipe, not scraped social or webpage text.

Return JSON only with this shape:
{
  "name": "Clean Recipe Title",
  "description": "Clean one-sentence description or null",
  "ingredientSections": [
    {
      "name": null,
      "ingredients": [
        {"index": 0, "quantity": 2, "unit": "cup", "name": "ingredient name only"}
      ]
    }
  ],
  "instructionSections": [
    {"name": null, "instructions": [{"instruction": "Clean instruction sentence."}]}
  ]
}

Rules:
- Do not add, remove, reorder, or merge ingredients, sections, or instructions.
- Preserve the same number of ingredient sections, ingredients, instruction sections, and instructions.
- Rewrite only display text: recipe name, description, section names, ingredient names, and instruction text.
- For every ingredient, copy index, quantity, and unit exactly from the input. Only rewrite name.
- Ingredient name must not repeat the stored quantity or unit. For example, if quantity is 1 and unit is "tablespoon", use "vegetable oil", not "1 tablespoon vegetable oil".
- Preserve package-size descriptors that are part of the ingredient name, such as "400g butter beans" when quantity is 2 and unit is "can".
- Remove UI/social text such as Follow, Save, link in bio, comments, likes, hashtags, handles, and emojis.
- Convert all-caps headings to title case.
- Convert instruction text to sentence case with normal punctuation.
- Replace scraped separators like "|" with normal recipe wording.
- Do not invent quantities, ingredients, steps, times, servings, or tags.

Detected issues: ${issues.join(", ")}

Recipe JSON:
${JSON.stringify(recipe).slice(0, 10_000)}`;
}

function mergePolishedText(
  recipe: ParsedRecipe,
  polish: PolishResponse,
): ParsedRecipe {
  return {
    ...recipe,
    name: polish.name?.trim() || recipe.name,
    description:
      typeof polish.description === "string"
        ? polish.description.trim() || null
        : recipe.description,
    ingredientSections: recipe.ingredientSections.map(
      (section, sectionIndex) => {
        const polishedSection = polish.ingredientSections?.[sectionIndex];
        const ingredientsMatchShape =
          polish.ingredientSections?.length ===
            recipe.ingredientSections.length &&
          polishedSection?.ingredients?.length === section.ingredients.length;

        return {
          ...section,
          name:
            polishedSection && "name" in polishedSection
              ? (polishedSection.name?.trim() ?? null)
              : section.name,
          ingredients: section.ingredients.map(
            (ingredient, ingredientIndex) => {
              const polishedName = ingredientsMatchShape
                ? validatedPolishedIngredientName(
                    ingredient,
                    polishedSection?.ingredients?.[ingredientIndex],
                  )
                : null;

              return {
                ...ingredient,
                name: polishedName ?? ingredient.name,
              };
            },
          ),
        };
      },
    ),
    instructionSections: recipe.instructionSections.map(
      (section, sectionIndex) => {
        const polishedSection = polish.instructionSections?.[sectionIndex];

        return {
          ...section,
          name:
            polishedSection && "name" in polishedSection
              ? (polishedSection.name?.trim() ?? null)
              : section.name,
          instructions: section.instructions.map(
            (instruction, instructionIndex) => ({
              ...instruction,
              instruction:
                polishedSection?.instructions?.[
                  instructionIndex
                ]?.instruction?.trim() || instruction.instruction,
            }),
          ),
        };
      },
    ),
  };
}

export async function polishRecipeForSmartImport(
  ai: Ai,
  recipe: ParsedRecipe,
): Promise<RecipePolishResult> {
  const deterministic = deterministicPolish(recipe);
  const issues = recipeHygieneIssues(deterministic);

  if (issues.length === 0) {
    return { recipe: deterministic, issues, usedAi: false };
  }

  try {
    const response = await (ai as any).run(POLISH_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You are a strict recipe copy editor. Return JSON only. Polish text without changing recipe facts.",
        },
        { role: "user", content: createPolishPrompt(deterministic, issues) },
      ],
      max_tokens: 2048,
    });
    const polished = mergePolishedText(
      deterministic,
      parseJsonResponse(response),
    );
    const normalized = deterministicPolish(polished);

    return {
      recipe: normalized,
      issues: recipeHygieneIssues(normalized),
      usedAi: true,
    };
  } catch (error) {
    console.log(
      "Recipe polish failed; using deterministic polish:",
      error instanceof Error ? error.message : error,
    );
    return { recipe: deterministic, issues, usedAi: false };
  }
}
