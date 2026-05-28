/**
 * TRPCEnv - Environment bindings required by tRPC routers.
 * Types flow from microservices → tRPC → server.
 */

import type { AuthEnv } from "@repo/auth";
import type {
  DurableObjectNamespace,
  ImageService,
  RecipeAIService,
} from "@repo/contracts";

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RecipeImportJobMessage {
  jobId: string;
  userId: string;
}

export interface QueueBinding<Message> {
  send(message: Message): Promise<unknown>;
}

// Re-export service types for convenience
export type { ImageService, RecipeAIService } from "@repo/contracts";
export type {
  DurableObjectNamespace,
  DurableObjectId,
  DurableObjectStub,
} from "@repo/contracts";

/**
 * Environment bindings required by tRPC routers.
 * The server's Env type extends this.
 */
export interface TRPCEnv extends AuthEnv {
  // Service bindings
  RECIPE_AI: RecipeAIService;
  USER_FEED: DurableObjectNamespace;
  IMAGE_SERVICE: ImageService;
  IMAGE_PUBLIC_URL: string;
  EXPO_ACCESS_TOKEN?: string;
  ADAPTY_SECRET_API_KEY?: string;
  ADAPTY_WEBHOOK_AUTHORIZATION?: string;
  ADAPTY_PRO_ACCESS_LEVEL_ID?: string;
  API_RATE_LIMITER?: RateLimitBinding;
  AI_RATE_LIMITER?: RateLimitBinding;
  IMAGE_AI_RATE_LIMITER?: RateLimitBinding;
  UPLOAD_RATE_LIMITER?: RateLimitBinding;
  RECIPE_IMPORT_BASIC_QUEUE: QueueBinding<RecipeImportJobMessage>;
  RECIPE_IMPORT_URL_QUEUE: QueueBinding<RecipeImportJobMessage>;
  RECIPE_IMPORT_TEXT_QUEUE: QueueBinding<RecipeImportJobMessage>;
  RECIPE_IMPORT_IMAGE_QUEUE: QueueBinding<RecipeImportJobMessage>;
}
