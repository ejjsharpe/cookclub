import { publicImageUrlForKey } from "@repo/contracts/images";
import type { RecipeImportParseResponse } from "@repo/contracts/recipe-ai";
import {
  RECIPE_IMPORT_LIMITS,
  type RecipeImportErrorCode,
} from "@repo/contracts/recipe-import";
import { WorkerEntrypoint } from "cloudflare:workers";

import { parseImage, parseText, parseUrl } from "./import";
import { createCerebrasClient } from "./services/cerebras-client";
import { createFallbackAiClient } from "./services/fallback-ai-client";
import { createGroqClient } from "./services/groq-client";
import { rehostParsedRecipeImagesForResponse } from "./services/hosted-images";
import { generateNutrition } from "./services/nutrition-generator";
import { readBoundedBody } from "./services/provider-response";
import { processChat } from "./services/recipe-generator";
import { generateRecipeImage } from "./services/recipe-image-generator";
import { personalizeRecipe } from "./services/recipe-personalizer";
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

function normalizeImportFailure(
  result: Extract<ParseResponse, { success: false }>,
): Extract<RecipeImportParseResponse, { success: false }> {
  const message = result.error.message;
  const timedOut = /timed? ?out|timeout|aborterror/i.test(message);
  let code: RecipeImportErrorCode;
  let disposition: "terminal" | "retry";

  switch (result.error.code) {
    case "INVALID_URL":
      code = "IMPORT_INVALID_URL";
      disposition = "terminal";
      break;
    case "UNSUPPORTED_URL":
    case "YOUTUBE_UNSUPPORTED_URL":
    case "INVALID_INPUT_TYPE":
      code = "IMPORT_UNSUPPORTED_SOURCE";
      disposition = "terminal";
      break;
    case "NO_STRUCTURED_DATA":
    case "NO_CONTENT":
    case "NO_RECIPE":
    case "VALIDATION_FAILED":
    case "YOUTUBE_NO_RECIPE_EVIDENCE":
    case "INVALID_INPUT":
      code = "IMPORT_RECIPE_NOT_FOUND";
      disposition = "terminal";
      break;
    case "INVALID_MIME_TYPE":
    case "INVALID_BASE64":
      code = "IMPORT_IMAGE_INVALID";
      disposition = "terminal";
      break;
    case "INPUT_TOO_LONG":
    case "IMAGE_TOO_LARGE":
      code = "PAYLOAD_TOO_LARGE";
      disposition = "terminal";
      break;
    case "FETCH_FAILED":
    case "YOUTUBE_METADATA_FAILED":
      code = timedOut ? "IMPORT_TIMED_OUT" : "IMPORT_SOURCE_UNAVAILABLE";
      disposition = result.error.disposition ?? "retry";
      break;
    default:
      code = timedOut ? "IMPORT_TIMED_OUT" : "SERVICE_UNAVAILABLE";
      disposition = result.error.disposition ?? "retry";
      break;
  }

  return {
    ...result,
    error: {
      code,
      message,
      disposition,
      ...(result.error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: result.error.retryAfterSeconds }
        : {}),
    },
  };
}

async function parseWithEnv(
  env: Env,
  input: ParseInput,
  aiClient: AiClient,
): Promise<RecipeImportParseResponse> {
  const parseStart = Date.now();
  const strategy = input.strategy ?? "ai-assisted";
  try {
    let result: ParseResponse;

    switch (input.type) {
      case "url":
        result = await parseUrl(env, input.data, {
          strategy,
          aiClient,
        });
        break;

      case "text":
        result = await parseText(env, input.data, aiClient);
        break;

      case "image":
        {
          const sourceResponse = await env.IMAGE_SERVICE.getImportSource(
            input.jobId,
          );
          if (!sourceResponse.ok) {
            result = {
              success: false,
              error: {
                code: "FETCH_FAILED",
                message: `Import source image was unavailable (${sourceResponse.status}).`,
                disposition:
                  sourceResponse.status >= 500 ? "retry" : "terminal",
              },
              metadata: { source: "image", confidence: "low" },
            };
            break;
          }
          const imageData = await readBoundedBody(
            sourceResponse,
            RECIPE_IMPORT_LIMITS.sourceImageBytes,
            "Image service",
          );
          result = await parseImage(
            env,
            imageData,
            "image/jpeg",
            publicImageUrlForKey(
              env.IMAGE_PUBLIC_URL,
              `imports/${input.jobId}/source.jpg`,
            ),
            aiClient,
          );
        }
        break;

      default:
        return normalizeImportFailure(
          finalizeParseDiagnostics(
            {
              success: false,
              error: {
                code: "INVALID_INPUT_TYPE",
                message: "Input type must be 'url', 'text', or 'image'",
              },
            },
            "url",
            parseStart,
          ) as Extract<ParseResponse, { success: false }>,
        );
    }

    const finalized = finalizeParseDiagnostics(
      await rehostParsedRecipeImagesForResponse(
        env,
        result,
        input.imageStagingId,
      ),
      parseInputSource(input),
      parseStart,
    );
    if (!finalized.success) return normalizeImportFailure(finalized);
    return {
      ...finalized,
      metadata: {
        ...finalized.metadata,
        strategy,
        provenance:
          finalized.metadata.provenance ??
          (finalized.metadata.parseMethod?.startsWith("ai")
            ? "ai-assisted"
            : "deterministic"),
      },
    };
  } catch (error) {
    console.error(error);
    if (
      input.type === "image" &&
      error instanceof Error &&
      error.message.startsWith("Image service response exceeded")
    ) {
      return normalizeImportFailure(
        finalizeParseDiagnostics(
          {
            success: false,
            error: {
              code: "IMAGE_TOO_LARGE",
              message: error.message,
              disposition: "terminal",
            },
          },
          "image",
          parseStart,
        ) as Extract<ParseResponse, { success: false }>,
      );
    }
    return normalizeImportFailure(
      finalizeParseDiagnostics(
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
      ) as Extract<ParseResponse, { success: false }>,
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
   * const result = await env.RECIPE_AI.parse({
   *   type: "url",
   *   data: "https://example.com/recipe",
   *   strategy: "ai-assisted"
   * });
   *
   * @example
   * // Parse from text
   * const result = await env.RECIPE_AI.parse({
   *   type: "text",
   *   data: "Recipe: Pasta...",
   *   strategy: "ai-assisted"
   * });
   *
   * @example
   * // Parse from image
   * const result = await env.RECIPE_AI.parse({
   *   type: "image",
   *   jobId: "0d7de7c2-b3fc-4644-87ca-cf00e1cbf1b2",
   *   strategy: "ai-assisted"
   * });
   */
  async parse(input: ParseInput): Promise<RecipeImportParseResponse> {
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
