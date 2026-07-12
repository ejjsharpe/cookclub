/**
 * Chat types for AI recipe generation
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestedReplies?: string[];
  isError?: boolean;
  timestamp: Date;
}

export interface ConversationState {
  ingredients: string[] | null;
  cuisinePreference: string | null;
  willingToShop: boolean | null;
  maxCookingTime: string | null;
}

export type ChatStatus = "idle" | "sending" | "generating";
