import { WorkerEntrypoint } from "cloudflare:workers";

import type { AiExtractionOptions } from "./services/ai-client";
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
  options?: { skipImageRehost?: boolean; aiOptions?: AiExtractionOptions },
): Promise<ParseResponse> {
  const parseStart = Date.now();
  try {
    let result: ParseResponse;

    switch (input.type) {
      case "url":
        result = await parseUrl(env, input.data, {
          structuredOnly: input.structuredOnly,
          aiOptions: options?.aiOptions,
        });
        break;

      case "text":
        result = await parseText(env, input.data, options?.aiOptions);
        break;

      case "image":
        result = await parseImage(env, input.data, input.mimeType);
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
      options?.skipImageRehost
        ? result
        : await rehostParsedRecipeImagesForResponse(env, result),
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

/**
 * Recipe AI Worker
 *
 * Provides RPC methods for recipe parsing, generation, personalization, and
 * image generation. It should be called via Service Bindings from trusted
 * Workers.
 */
export class RecipeAI extends WorkerEntrypoint<Env> {
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
    return parseWithEnv(this.env, input);
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
      this.env.AI,
      input.messages,
      input.conversationState,
    );
  }

  async personalize(input: PersonalizeRecipeInput): Promise<ParseResponse> {
    return await personalizeRecipe(this.env.AI, input);
  }

  async generateImage(
    input: GenerateRecipeImageInput,
  ): Promise<GenerateRecipeImageResponse> {
    return await generateRecipeImage(this.env, input);
  }

  async nutrition(input: NutritionInput): Promise<NutritionResponse> {
    return await generateNutrition(this.env, input);
  }
}

/**
 * Default export for HTTP requests.
 * Direct HTTP parsing is intentionally disabled; use the RPC entrypoint via
 * Service Bindings from trusted Workers.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (
      env.ENVIRONMENT !== "production" &&
      url.pathname === "/benchmark/parse" &&
      request.method === "POST"
    ) {
      try {
        const input = (await request.json()) as ParseInput;
        const textModel =
          request.headers.get("x-recipe-ai-model") ??
          url.searchParams.get("model");
        const skipImageRehost =
          request.headers.get("x-recipe-ai-skip-image-rehost") === "true" ||
          url.searchParams.get("skipImageRehost") === "true";
        const promptVariant =
          request.headers.get("x-recipe-ai-prompt-variant") ??
          url.searchParams.get("promptVariant");
        const maxTokensHeader =
          request.headers.get("x-recipe-ai-max-tokens") ??
          url.searchParams.get("maxTokens");
        const maxTokens = maxTokensHeader ? Number(maxTokensHeader) : null;
        const aiOptions: AiExtractionOptions | undefined =
          textModel || promptVariant || maxTokens
            ? {
                ...(textModel ? { textModel } : {}),
                ...(promptVariant ? { promptVariant } : {}),
                ...(maxTokens && Number.isFinite(maxTokens)
                  ? { maxTokens }
                  : {}),
              }
            : undefined;
        return Response.json(
          await parseWithEnv(env, input, { skipImageRehost, aiOptions }),
        );
      } catch (error) {
        return Response.json(
          {
            success: false,
            error: {
              code: "INVALID_REQUEST",
              message:
                error instanceof Error
                  ? error.message
                  : "Request body must be valid JSON.",
            },
          },
          { status: 400 },
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: "This worker only accepts RPC calls via Service Bindings",
        usage:
          "Add a service binding in your wrangler.toml and call env.RECIPE_AI.parse()",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
};
