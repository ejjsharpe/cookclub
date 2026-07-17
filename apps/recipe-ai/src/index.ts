import { WorkerEntrypoint } from "cloudflare:workers";

import { createCerebrasClient } from "./services/cerebras-client";
import { createFallbackAiClient } from "./services/fallback-ai-client";
import { createGroqClient } from "./services/groq-client";
import { rehostParsedRecipeImagesForResponse } from "./services/hosted-images";
import { parseImage } from "./services/image-parser";
import { generateNutrition } from "./services/nutrition-generator";
import { processChat } from "./services/recipe-generator";
import { generateRecipeImage } from "./services/recipe-image-generator";
import { personalizeRecipe } from "./services/recipe-personalizer";
import { parseText } from "./services/text-parser";
import { parseUrl } from "./services/url-parser";
import type {
  Env,
  ParseInput,
  ParseResponse,
  ChatInput,
  ChatResponse,
  GenerateRecipeImageInput,
  GenerateRecipeImageResponse,
  NutritionInput,
  NutritionResponse,
  PersonalizeRecipeInput,
} from "./types";
import {
  RECIPE_AI_INFERENCE_CLIENT,
  type AiClient,
} from "./utils/ai-response-parser";
import { finalizeParseDiagnostics } from "./utils/parse-diagnostics";

export type {
  ParsedRecipe,
  Ingredient,
  Instruction,
  Tag,
  SourceType,
} from "./schema";
export type {
  ParseInput,
  ParseResponse,
  ParseMetadata,
  ParseDiagnostics,
  ChatInput,
  ChatResponse,
  ChatMessage,
  RecipeConversationState,
  GenerateRecipeImageInput,
  GenerateRecipeImageResponse,
  NutritionInput,
  NutritionResponse,
  PersonalizationGoal,
  PersonalizeRecipeInput,
} from "./service";
export type { ParseResult, ParseError } from "./types";

function parseInputSource(input: ParseInput): "url" | "text" | "image" {
  return input.type === "text" || input.type === "image" ? input.type : "url";
}

async function parseWithEnv(
  env: Env,
  input: ParseInput,
  aiClient: AiClient,
): Promise<ParseResponse> {
  const parseStart = Date.now();
  try {
    let result: ParseResponse;

    switch (input.type) {
      case "url":
        result = await parseUrl(env, input.data, {
          structuredOnly: input.structuredOnly,
          aiClient,
        });
        break;

      case "text":
        result = await parseText(env, input.data, aiClient);
        break;

      case "image":
        result = await parseImage(env, input.data, input.mimeType, aiClient);
        break;

      default:
        return finalizeParseDiagnostics(
          {
            success: false,
            error: {
              code: "INVALID_INPUT_TYPE",
              message: "Input type must be 'url', 'text', or 'image'",
            },
          },
          "url",
          parseStart,
        );
    }

    return finalizeParseDiagnostics(
      await rehostParsedRecipeImagesForResponse(env, result),
      parseInputSource(input),
      parseStart,
    );
  } catch (error) {
    console.error(error);
    return finalizeParseDiagnostics(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected error occurred",
        },
      },
      parseInputSource(input),
      parseStart,
    );
  }
}

function createProductionAiClient(env: Env): AiClient {
  return createFallbackAiClient(
    createCerebrasClient(env.CEREBRAS_API_KEY),
    createGroqClient(env.GROQ_API_KEY),
  );
}

/**
 * Recipe AI Worker
 *
 * Provides RPC methods for recipe parsing, generation, personalization, and
 * image generation. It should be called via Service Bindings from trusted
 * Workers.
 */
export class RecipeAI extends WorkerEntrypoint<Env> {
  [RECIPE_AI_INFERENCE_CLIENT](): AiClient {
    return createProductionAiClient(this.env);
  }

  /**
   * Parse a recipe from URL, text, or image
   *
   * @param input - The input to parse
   * @returns ParseResponse - Either success with recipe data, or error
   *
   * @example
   * // Parse from URL
   * const result = await env.RECIPE_AI.parse({ type: "url", data: "https://example.com/recipe" });
   *
   * @example
   * // Parse from text
   * const result = await env.RECIPE_AI.parse({ type: "text", data: "Recipe: Pasta..." });
   *
   * @example
   * // Parse from image
   * const result = await env.RECIPE_AI.parse({
   *   type: "image",
   *   data: "base64ImageData...",
   *   mimeType: "image/jpeg"
   * });
   */
  async parse(input: ParseInput): Promise<ParseResponse> {
    return parseWithEnv(this.env, input, this[RECIPE_AI_INFERENCE_CLIENT]());
  }

  /**
   * Process a chat message for AI recipe generation
   *
   * @param input - The chat input containing messages and conversation state
   * @returns ChatResponse - AI message, recipe, or error
   *
   * @example
   * const result = await env.RECIPE_AI.chat({
   *   messages: [{ role: "user", content: "I have chicken and rice" }],
   *   conversationState: { ingredients: null, cuisinePreference: null, willingToShop: null, maxCookingTime: null }
   * });
   */
  async chat(input: ChatInput): Promise<ChatResponse> {
    return await processChat(
      this[RECIPE_AI_INFERENCE_CLIENT](),
      input.messages,
      input.conversationState,
    );
  }

  async personalize(input: PersonalizeRecipeInput): Promise<ParseResponse> {
    return await personalizeRecipe(this[RECIPE_AI_INFERENCE_CLIENT](), input);
  }

  async generateImage(
    input: GenerateRecipeImageInput,
  ): Promise<GenerateRecipeImageResponse> {
    return await generateRecipeImage(this.env, input);
  }

  async nutrition(input: NutritionInput): Promise<NutritionResponse> {
    return await generateNutrition(input, this[RECIPE_AI_INFERENCE_CLIENT]());
  }
}

/**
 * Default export for HTTP requests.
 * Direct HTTP parsing is intentionally disabled; use the RPC entrypoint via
 * Service Bindings from trusted Workers.
 */
export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response(
      JSON.stringify({
        error: "This worker only accepts RPC calls via Service Bindings",
        usage:
          "Add a service binding in your wrangler.jsonc and call env.RECIPE_AI.parse()",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
};
