import type { Nutrition, ParsedRecipe } from "../schema";
import type { Env } from "../types";
import {
  DEFAULT_MAX_TOKENS,
  parseAiJsonPayload,
  runAiModel,
} from "../utils/ai-response-parser";
import { normalizeNutrition } from "../utils/nutrition-normalizer";
import {
  RECIPE_EXTRACTION_SYSTEM_PROMPT,
  IMAGE_EXTRACTION_SYSTEM_PROMPT,
  createTextExtractionPrompt,
  createHtmlExtractionPrompt,
  createRepairExtractionPrompt,
  createImageExtractionPrompt,
} from "../utils/prompts";

// Cloudflare Workers AI models
export const DEFAULT_TEXT_MODEL =
  "@cf/meta/llama-4-scout-17b-16e-instruct" as const;
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct" as const;

export interface AiExtractionOptions {
  textModel?: string;
  promptVariant?: string;
  maxTokens?: number;
}

const COMPACT_SOCIAL_EXTRACTION_PROMPT = `You are a strict JSON recipe extraction API. Return only valid JSON, with no markdown or commentary.

Extract only recipe facts supported by the source. Ignore ads, comments, hashtags that are not recipe content, biography text, and unrelated links.

Output shape:
{
  "name": "Recipe Name",
  "description": "Brief description or null",
  "prepTime": 15,
  "cookTime": 30,
  "totalTime": 45,
  "servings": 4,
  "ingredientSections": [
    {
      "name": null,
      "ingredients": [
        {"index": 0, "quantity": 2, "unit": "cup", "name": "flour", "preparation": null}
      ]
    }
  ],
  "instructionSections": [
    {
      "name": null,
      "instructions": [
        {"index": 0, "instruction": "Mix the supported ingredients together.", "imageUrl": null}
      ]
    }
  ],
  "suggestedTags": [
    "dinner"
  ]
}

Rules:
- Use numbers for minute durations and servings when stated; otherwise use null.
- Convert ingredient fractions to numbers.
- Split ingredient quantity, unit, name, and preparation.
- Preserve ingredient and instruction sections when the source groups them.
- Social captions/transcripts can contain terse method fragments. Extract supported cooking/prep actions into ordered steps.
- Ingredients may be stated inline in narration or method steps instead of in a dedicated list. Extract every ingredient directly named in supported cooking or preparation actions, using null quantity/unit when unstated.
- Captions may contain the correct spelling for dish-specific names misheard in the audio transcript. Use caption terminology to correct an obvious transcript homophone only when both clearly refer to the same dish or ingredient.
- Do not invent missing quantities, temperatures, timings, or techniques.
- If ingredients are present but there is no actionable method evidence, return "instructionSections": [].
- For missing optional string fields use null; for missing arrays use [].`;

function extractionSystemPrompt(promptVariant?: string): string {
  if (promptVariant === "compact_social") {
    return COMPACT_SOCIAL_EXTRACTION_PROMPT;
  }

  return RECIPE_EXTRACTION_SYSTEM_PROMPT;
}

function recipeExtractionRequest(
  messages: { role: string; content: unknown }[],
  maxTokens?: number,
) {
  return {
    messages,
    max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

export interface AiIngredient {
  index: number;
  quantity: number | null;
  unit: string | null;
  name: string;
  preparation: string | null;
}

export interface AiInstruction {
  index: number;
  instruction: string;
  imageUrl?: string | null;
}

export interface AiIngredientSection {
  name: string | null;
  ingredients: AiIngredient[];
}

export interface AiInstructionSection {
  name: string | null;
  instructions: AiInstruction[];
}

export interface AiRecipeResult {
  name: string;
  description: string | null;
  prepTime: number | null; // minutes
  cookTime: number | null; // minutes
  totalTime: number | null; // minutes
  servings: number | null;
  ingredientSections: AiIngredientSection[];
  instructionSections: AiInstructionSection[];
  suggestedTags?: string[];
  nutrition?: Nutrition | null;
}

function durationToMinutes(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const isoMatch = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (isoMatch) {
    const minutes =
      Number(isoMatch[1] ?? 0) * 60 +
      Number(isoMatch[2] ?? 0) +
      Math.ceil(Number(isoMatch[3] ?? 0) / 60);
    return minutes > 0 ? minutes : null;
  }

  const normalized = value.trim().toLowerCase();
  let totalMinutes = 0;
  for (const match of normalized.matchAll(
    /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)\b/g,
  )) {
    totalMinutes += Math.round(Number(match[1]) * 60);
  }
  for (const match of normalized.matchAll(
    /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min|m)\b/g,
  )) {
    totalMinutes += Math.round(Number(match[1]));
  }
  if (totalMinutes > 0) {
    return totalMinutes;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function quantityToNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);
    return denominator > 0 ? whole + numerator / denominator : null;
  }

  const fraction = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator > 0 ? numerator / denominator : null;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeIngredient(ingredient: unknown, index: number): AiIngredient {
  if (typeof ingredient === "string") {
    return {
      index,
      quantity: null,
      unit: null,
      name: ingredient,
      preparation: null,
    };
  }

  const record =
    ingredient && typeof ingredient === "object"
      ? (ingredient as Record<string, unknown>)
      : {};

  return {
    index,
    quantity: quantityToNumber(record.quantity),
    unit: nullableString(record.unit),
    name: String(record.name ?? ""),
    preparation: nullableString(record.preparation),
  };
}

function normalizeInstruction(
  instruction: unknown,
  index: number,
): AiInstruction {
  if (typeof instruction === "string") {
    return {
      index,
      instruction,
      imageUrl: null,
    };
  }

  const record =
    instruction && typeof instruction === "object"
      ? (instruction as Record<string, unknown>)
      : {};

  return {
    index,
    instruction: String(record.instruction ?? record.text ?? ""),
    imageUrl: nullableString(record.imageUrl),
  };
}

function normalizeIngredientSections(recipe: Record<string, unknown>) {
  if (Array.isArray(recipe.ingredientSections)) {
    return recipe.ingredientSections.map((section) => {
      const record =
        section && typeof section === "object"
          ? (section as Record<string, unknown>)
          : {};

      return {
        name: nullableString(record.name),
        ingredients: Array.isArray(record.ingredients)
          ? record.ingredients.map(normalizeIngredient)
          : [],
      };
    });
  }

  return [
    {
      name: null,
      ingredients: Array.isArray(recipe.ingredients)
        ? recipe.ingredients.map(normalizeIngredient)
        : [],
    },
  ];
}

function normalizeInstructionSections(recipe: Record<string, unknown>) {
  if (Array.isArray(recipe.instructionSections)) {
    return recipe.instructionSections.map((section) => {
      const record =
        section && typeof section === "object"
          ? (section as Record<string, unknown>)
          : {};

      return {
        name: nullableString(record.name),
        instructions: Array.isArray(record.instructions)
          ? record.instructions.map(normalizeInstruction)
          : [],
      };
    });
  }

  return [
    {
      name: null,
      instructions: Array.isArray(recipe.instructions)
        ? recipe.instructions.map(normalizeInstruction)
        : [],
    },
  ];
}

function servingsToNumber(value: unknown): number | null {
  if (typeof value === "number") return value > 0 ? value : null;
  if (typeof value !== "string") return null;

  const range = value.match(/(\d+)\s*(?:-|to)\s*(\d+)/i);
  if (range) {
    return Math.round((Number(range[1]) + Number(range[2])) / 2);
  }

  const single = value.match(/\d+/);
  if (!single?.[0]) return null;

  const servings = Number(single[0]);
  return servings > 0 ? servings : null;
}

function normalizeAiNutrition(value: unknown): Nutrition | null {
  if (!value || typeof value !== "object") return null;

  return normalizeNutrition(value as Record<string, unknown>, "ai_estimated");
}

function normalizeSuggestedTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return tags.length > 0 ? tags : undefined;
}

function normalizeAiRecipeResult(value: unknown): AiRecipeResult {
  const recipe = value as Record<string, unknown>;

  return {
    name: String(recipe.name ?? ""),
    description: nullableString(recipe.description),
    prepTime: durationToMinutes(recipe.prepTime),
    cookTime: durationToMinutes(recipe.cookTime),
    totalTime: durationToMinutes(recipe.totalTime),
    servings: servingsToNumber(recipe.servings),
    ingredientSections: normalizeIngredientSections(recipe),
    instructionSections: normalizeInstructionSections(recipe),
    suggestedTags: normalizeSuggestedTags(recipe.suggestedTags),
    nutrition: normalizeAiNutrition(recipe.nutrition),
  };
}

/**
 * Extract and parse AI response - handles both string and pre-parsed object
 */
function parseAiResponse(response: unknown): AiRecipeResult {
  return normalizeAiRecipeResult(parseAiJsonPayload(response));
}

/**
 * Extract recipe from text using AI
 */
export async function parseRecipeFromText(
  ai: Env["AI"],
  text: string,
  options: AiExtractionOptions = {},
): Promise<AiRecipeResult> {
  const response = await runAiModel(
    ai,
    options.textModel ?? DEFAULT_TEXT_MODEL,
    recipeExtractionRequest(
      [
        {
          role: "system",
          content: extractionSystemPrompt(options.promptVariant),
        },
        { role: "user", content: createTextExtractionPrompt(text) },
      ],
      options.maxTokens,
    ),
  );

  return parseAiResponse(response);
}

/**
 * Extract recipe from cleaned HTML using AI
 */
export async function parseRecipeFromHtml(
  ai: Env["AI"],
  cleanedHtml: string,
  options: AiExtractionOptions = {},
): Promise<AiRecipeResult> {
  const response = await runAiModel(
    ai,
    options.textModel ?? DEFAULT_TEXT_MODEL,
    recipeExtractionRequest(
      [
        {
          role: "system",
          content: extractionSystemPrompt(options.promptVariant),
        },
        { role: "user", content: createHtmlExtractionPrompt(cleanedHtml) },
      ],
      options.maxTokens,
    ),
  );

  return parseAiResponse(response);
}

/**
 * Repair a partial recipe using AI
 */
export async function repairRecipeFromEvidence(
  ai: Env["AI"],
  evidence: string,
  partialRecipe: ParsedRecipe | null,
  options: AiExtractionOptions = {},
): Promise<AiRecipeResult> {
  const response = await runAiModel(
    ai,
    options.textModel ?? DEFAULT_TEXT_MODEL,
    recipeExtractionRequest(
      [
        {
          role: "system",
          content: extractionSystemPrompt(options.promptVariant),
        },
        {
          role: "user",
          content: createRepairExtractionPrompt({
            evidence,
            partialRecipeJson: partialRecipe
              ? JSON.stringify(partialRecipe).slice(0, 8_000)
              : null,
          }),
        },
      ],
      options.maxTokens,
    ),
  );

  return parseAiResponse(response);
}

/**
 * Extract recipe from image using AI
 */
export async function parseRecipeFromImage(
  ai: Env["AI"],
  imageData: string,
  _mimeType: string,
): Promise<AiRecipeResult> {
  // Convert base64 to Uint8Array for the AI model
  const binaryString = atob(imageData);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const response = await runAiModel(ai, VISION_MODEL, {
    messages: [
      { role: "system", content: IMAGE_EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: createImageExtractionPrompt() },
          {
            type: "image",
            image: bytes,
          },
        ],
      },
    ],
    max_tokens: DEFAULT_MAX_TOKENS,
  });

  return parseAiResponse(response);
}
