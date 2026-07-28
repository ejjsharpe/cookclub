import type { ParsedRecipe, ParsedRecipeNutrition } from "./recipe";
import type { ParseFailure, RecipeImportStrategy } from "./recipe-import";

interface ParseImageStagingOptions {
  /**
   * Keeps rehosted images available for the lifetime of a background import
   * job instead of placing them in the short-lived temp namespace.
   */
  imageStagingId?: string;
}

export type ParseInput =
  | ({
      type: "url";
      data: string;
      strategy: RecipeImportStrategy;
    } & ParseImageStagingOptions)
  | ({
      type: "text";
      data: string;
      strategy: "ai-assisted";
    } & ParseImageStagingOptions)
  | {
      type: "image";
      jobId: string;
      strategy: "ai-assisted";
      imageStagingId?: string;
    };

export type PersonalizationGoal =
  | "vegetarian"
  | "vegan"
  | "gluten_free"
  | "dairy_free"
  | "low_carb"
  | "high_protein"
  | "budget"
  | "healthier"
  | "kid_friendly"
  | "batch_cook"
  | "meal_prep";

export interface ParseMetadata {
  source: "url" | "text" | "image";
  strategy?: RecipeImportStrategy;
  parseMethod?:
    | "structured_data"
    | "schema_org"
    | "visible_card"
    | "reader"
    | "caption_rules"
    | "outline_rules"
    | "ai_repair"
    | "ai_enhanced"
    | "media_enriched"
    | "ai_only";
  provenance?: "deterministic" | "ai-assisted";
  confidence: "high" | "medium" | "low";
  cached?: boolean;
  canonicalUrl?: string;
  diagnostics?: ParseDiagnostics;
}

export interface ParseDiagnosticsAttempt {
  id: string;
  method: string;
  source: string;
  status: "accepted" | "rejected" | "error";
  score?: number;
  confidence?: "high" | "medium" | "low";
  reasons?: string[];
  ingredientCount?: number;
  instructionCount?: number;
  elapsedMs?: number;
  evidence?: {
    imageCount?: number;
    textLength?: number;
    sourceUrl?: string;
  };
}

export interface ParseDiagnosticsStage {
  name: string;
  status: "success" | "skipped" | "error";
  elapsedMs: number;
  detail?: string;
}

export interface ParseDiagnostics {
  originalUrl?: string;
  canonicalUrl?: string;
  platform?: string;
  selectedAttempt?: string;
  qualityScore?: number;
  fallbackPath?: string[];
  totalElapsedMs?: number;
  stageTimings?: ParseDiagnosticsStage[];
  attempts?: ParseDiagnosticsAttempt[];
}

export type ParseResponse =
  | {
      success: true;
      data: ParsedRecipe;
      metadata: ParseMetadata;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        disposition?: "terminal" | "retry";
        retryAfterSeconds?: number;
      };
      metadata?: ParseMetadata;
    };

export type RecipeImportParseResponse =
  | Extract<ParseResponse, { success: true }>
  | {
      success: false;
      error: ParseFailure & { message: string };
      metadata?: ParseMetadata;
    };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RecipeConversationState {
  ingredients: string[] | null;
  cuisinePreference: string | null;
  willingToShop: boolean | null;
  maxCookingTime: string | null;
}

export interface ChatInput {
  messages: ChatMessage[];
  conversationState: RecipeConversationState;
}

export interface PersonalizeRecipeInput {
  recipe: ParsedRecipe;
  goals: PersonalizationGoal[];
  allergyNotes?: string | null;
  customNotes?: string | null;
}

export interface GenerateRecipeImageInput {
  name: string;
  description?: string | null;
  ingredients?: string[];
  instructions?: string[];
  ownerId?: string;
}

export interface NutritionInput {
  recipe: ParsedRecipe;
  sourceUrl?: string | null;
}

export type GenerateRecipeImageResponse =
  | {
      success: true;
      imageUploadId: string;
      publicUrl: string;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
      };
    };

export type NutritionResponse =
  | {
      success: true;
      data: ParsedRecipeNutrition;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
      };
    };

export type ChatResponse =
  | {
      type: "message";
      message: string;
      suggestedReplies?: string[];
      updatedState: RecipeConversationState;
      isComplete: false;
    }
  | {
      type: "recipe";
      recipe: ParsedRecipe;
      isComplete: true;
    }
  | {
      type: "error";
      error: { code: string; message: string };
    };

export interface RecipeAIService {
  parse(input: ParseInput): Promise<RecipeImportParseResponse>;
  chat(input: ChatInput): Promise<ChatResponse>;
  personalize(input: PersonalizeRecipeInput): Promise<ParseResponse>;
  generateImage(
    input: GenerateRecipeImageInput,
  ): Promise<GenerateRecipeImageResponse>;
  nutrition(input: NutritionInput): Promise<NutritionResponse>;
}
