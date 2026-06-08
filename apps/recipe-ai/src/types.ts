import type { ImageService } from "@repo/contracts/images";

export type Env = Omit<Cloudflare.Env, "IMAGE_SERVICE"> & {
  IMAGE_SERVICE: ImageService;
  YOUTUBE_API_KEY: string;
};

// Re-export service types for convenience
export type {
  RecipeAIService,
  ParseInput,
  ParseDiagnostics,
  ParseMetadata,
  ParseResponse,
  ChatMessage,
  RecipeConversationState,
  ChatInput,
  ChatResponse,
  GenerateRecipeImageInput,
  GenerateRecipeImageResponse,
  NutritionInput,
  NutritionResponse,
  PersonalizationGoal,
  PersonalizeRecipeInput,
} from "./service";

// Alias for backwards compatibility
export type ParseResult = import("./service").ParseResponse;
export type ParseError = Extract<ParseResult, { success: false }>;
