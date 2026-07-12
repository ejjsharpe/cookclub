/**
 * Recipe Generator Service
 * Handles conversational AI recipe generation
 */

import type { ParsedRecipe } from "../schema";
import type {
  Env,
  ChatMessage,
  RecipeConversationState,
  ChatResponse,
} from "../types";
import {
  DEFAULT_MAX_TOKENS,
  parseAiJsonPayload,
  runAiModel,
} from "../utils/ai-response-parser";
import {
  RECIPE_CONVERSATION_SYSTEM_PROMPT,
  RECIPE_GENERATION_SYSTEM_PROMPT,
  createConversationPrompt,
  createRecipeGenerationPrompt,
} from "../utils/generation-prompts";

// Cloudflare Workers AI model
const TEXT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct" as const;

const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
} as const;

const nullableNumberSchema = {
  anyOf: [{ type: "number" }, { type: "null" }],
} as const;

const CONVERSATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string" },
    suggestedReplies: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
    },
    updatedState: {
      type: "object",
      properties: {
        ingredients: {
          anyOf: [
            { type: "array", items: { type: "string" } },
            { type: "null" },
          ],
        },
        cuisinePreference: nullableStringSchema,
        willingToShop: {
          anyOf: [{ type: "boolean" }, { type: "null" }],
        },
        maxCookingTime: nullableStringSchema,
      },
      required: [
        "ingredients",
        "cuisinePreference",
        "willingToShop",
        "maxCookingTime",
      ],
      additionalProperties: false,
    },
    readyToGenerate: { type: "boolean" },
  },
  required: [
    "message",
    "suggestedReplies",
    "updatedState",
    "readyToGenerate",
  ],
  additionalProperties: false,
} as const;

const RECIPE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: nullableStringSchema,
    prepTime: nullableNumberSchema,
    cookTime: nullableNumberSchema,
    totalTime: nullableNumberSchema,
    servings: { type: "number" },
    ingredientSections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: nullableStringSchema,
          ingredients: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                quantity: nullableNumberSchema,
                unit: nullableStringSchema,
                name: { type: "string" },
              },
              required: ["quantity", "unit", "name"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "ingredients"],
        additionalProperties: false,
      },
    },
    instructionSections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: nullableStringSchema,
          instructions: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
              required: ["text"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "instructions"],
        additionalProperties: false,
      },
    },
    suggestedTags: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "name",
    "description",
    "prepTime",
    "cookTime",
    "totalTime",
    "servings",
    "ingredientSections",
    "instructionSections",
    "suggestedTags",
  ],
  additionalProperties: false,
} as const;

interface ConversationAiResponse {
  message: string;
  suggestedReplies?: string[];
  updatedState: RecipeConversationState;
  readyToGenerate: boolean;
}

interface GeneratedRecipeAiResponse {
  name: string;
  description: string | null;
  prepTime: number | null; // minutes
  cookTime: number | null; // minutes
  totalTime: number | null; // minutes
  servings: number;
  ingredientSections?: {
    name: string | null;
    ingredients: {
      quantity: number | null;
      unit: string | null;
      name: string;
    }[];
  }[];
  instructionSections?: {
    name: string | null;
    instructions: {
      text: string;
      imageUrl?: string | null;
    }[];
  }[];
  ingredients?: {
    quantity: number | null;
    unit: string | null;
    name: string;
  }[];
  instructions?: {
    text: string;
    imageUrl?: string | null;
  }[];
  suggestedTags?: string[];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`AI returned an invalid ${label}`);
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`AI returned an invalid ${label}`);
  }

  return value.trim();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeConversationState(
  value: unknown,
  previousState: RecipeConversationState,
): RecipeConversationState {
  const state = asRecord(value, "conversation state");
  const ingredients = Array.isArray(state.ingredients)
    ? state.ingredients
        .filter(
          (ingredient): ingredient is string =>
            typeof ingredient === "string" && ingredient.trim().length > 0,
        )
        .map((ingredient) => ingredient.trim())
    : null;

  return {
    ingredients:
      ingredients && ingredients.length > 0
        ? ingredients
        : previousState.ingredients,
    cuisinePreference:
      nullableString(state.cuisinePreference) ??
      previousState.cuisinePreference,
    willingToShop:
      typeof state.willingToShop === "boolean"
        ? state.willingToShop
        : previousState.willingToShop,
    maxCookingTime:
      nullableString(state.maxCookingTime) ?? previousState.maxCookingTime,
  };
}

function normalizeGeneratedRecipe(value: unknown): ParsedRecipe {
  const generated = asRecord(value, "recipe");
  const rawIngredientSections = Array.isArray(generated.ingredientSections)
    ? generated.ingredientSections
    : Array.isArray(generated.ingredients)
      ? [{ name: null, ingredients: generated.ingredients }]
      : null;
  const rawInstructionSections = Array.isArray(generated.instructionSections)
    ? generated.instructionSections
    : Array.isArray(generated.instructions)
      ? [{ name: null, instructions: generated.instructions }]
      : null;

  if (!rawIngredientSections?.length || !rawInstructionSections?.length) {
    throw new Error("AI returned a recipe without ingredients or instructions");
  }

  const ingredientSections = rawIngredientSections.map((rawSection) => {
    const section = asRecord(rawSection, "ingredient section");
    if (!Array.isArray(section.ingredients) || section.ingredients.length === 0) {
      throw new Error("AI returned an empty ingredient section");
    }

    return {
      name: nullableString(section.name),
      ingredients: section.ingredients.map((rawIngredient, index) => {
        const ingredient = asRecord(rawIngredient, "ingredient");
        return {
          index,
          quantity: nullableNumber(ingredient.quantity),
          unit: nullableString(ingredient.unit),
          name: requiredString(ingredient.name, "ingredient name"),
        };
      }),
    };
  });

  const instructionSections = rawInstructionSections.map((rawSection) => {
    const section = asRecord(rawSection, "instruction section");
    if (
      !Array.isArray(section.instructions) ||
      section.instructions.length === 0
    ) {
      throw new Error("AI returned an empty instruction section");
    }

    return {
      name: nullableString(section.name),
      instructions: section.instructions.map((rawInstruction, index) => {
        const instruction = asRecord(rawInstruction, "instruction");
        return {
          index,
          instruction: requiredString(
            instruction.text ?? instruction.instruction,
            "instruction text",
          ),
          imageUrl: nullableString(instruction.imageUrl),
        };
      }),
    };
  });

  const servings = nullableNumber(generated.servings);

  return {
    name: requiredString(generated.name, "recipe name"),
    description: nullableString(generated.description),
    prepTime: nullableNumber(generated.prepTime),
    cookTime: nullableNumber(generated.cookTime),
    totalTime: nullableNumber(generated.totalTime),
    servings: servings && servings > 0 ? servings : 4,
    sourceType: "ai",
    ingredientSections,
    instructionSections,
    images: [],
    suggestedTags: Array.isArray(generated.suggestedTags)
      ? generated.suggestedTags.filter(
          (tag): tag is string => typeof tag === "string" && tag.length > 0,
        )
      : [],
  };
}

/**
 * Check if all required conversation fields are filled
 */
function isConversationComplete(state: RecipeConversationState): boolean {
  return (
    state.ingredients !== null &&
    state.ingredients.length > 0 &&
    state.cuisinePreference !== null &&
    state.willingToShop !== null &&
    state.maxCookingTime !== null
  );
}

/**
 * Parse AI response - handles both string and pre-parsed object
 */
function parseResponse<T>(response: unknown): T {
  return parseAiJsonPayload<T>(response, "Empty response from AI");
}

/**
 * Generate the final recipe based on collected information
 */
async function generateRecipe(
  ai: Env["AI"],
  state: RecipeConversationState,
): Promise<ChatResponse> {
  try {
    const response = await runAiModel(ai, TEXT_MODEL, {
      messages: [
        { role: "system", content: RECIPE_GENERATION_SYSTEM_PROMPT },
        { role: "user", content: createRecipeGenerationPrompt(state) },
      ],
      max_tokens: DEFAULT_MAX_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: RECIPE_RESPONSE_SCHEMA,
      },
    });

    const generated = parseResponse<GeneratedRecipeAiResponse>(response);
    const recipe = normalizeGeneratedRecipe(generated);

    return {
      type: "recipe",
      recipe,
      isComplete: true,
    };
  } catch (error) {
    console.error("Recipe generation error:", error);
    return {
      type: "error",
      error: {
        code: "GENERATION_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Failed to generate recipe. Please try again.",
      },
    };
  }
}

/**
 * Get initial greeting message
 */
function getInitialMessage(): ChatResponse {
  return {
    type: "message",
    message:
      "Hi! I'm here to help you create a delicious recipe. What ingredients do you have available to cook with today?",
    suggestedReplies: [
      "Chicken, rice, and vegetables",
      "Pasta and tomatoes",
      "I'll tell you what I have",
    ],
    updatedState: {
      ingredients: null,
      cuisinePreference: null,
      willingToShop: null,
      maxCookingTime: null,
    },
    isComplete: false,
  };
}

/**
 * Process a chat message and return AI response
 */
export async function processChat(
  ai: Env["AI"],
  messages: ChatMessage[],
  state: RecipeConversationState,
): Promise<ChatResponse> {
  try {
    // If no messages, return initial greeting
    if (messages.length === 0) {
      return getInitialMessage();
    }

    // If conversation is complete, generate the recipe
    if (isConversationComplete(state)) {
      return await generateRecipe(ai, state);
    }

    // Continue the conversation
    const response = await runAiModel(ai, TEXT_MODEL, {
      messages: [
        { role: "system", content: RECIPE_CONVERSATION_SYSTEM_PROMPT },
        { role: "user", content: createConversationPrompt(messages, state) },
      ],
      max_tokens: DEFAULT_MAX_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: CONVERSATION_RESPONSE_SCHEMA,
      },
    });

    const parsed = parseResponse<ConversationAiResponse>(response);
    const updatedState = normalizeConversationState(parsed.updatedState, state);

    // A complete state is enough to generate; do not depend on the model also
    // setting a redundant readiness flag correctly.
    if (isConversationComplete(updatedState)) {
      return await generateRecipe(ai, updatedState);
    }

    return {
      type: "message",
      message:
        nullableString(parsed.message) ||
        "I'd love to help you cook something delicious! What ingredients do you have?",
      suggestedReplies: Array.isArray(parsed.suggestedReplies)
        ? parsed.suggestedReplies.filter(
            (reply): reply is string =>
              typeof reply === "string" && reply.trim().length > 0,
          )
        : undefined,
      updatedState,
      isComplete: false,
    };
  } catch (error) {
    console.error("Chat processing error:", error);
    return {
      type: "error",
      error: {
        code: "CHAT_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Something went wrong. Please try again.",
      },
    };
  }
}
