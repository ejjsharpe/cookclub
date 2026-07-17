import { createOpenAiCompatibleClient } from "./openai-compatible-client";
import type { AiClient } from "../utils/ai-response-parser";

const CEREBRAS_CHAT_COMPLETIONS_URL =
  "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_API_VERSION = "2";
const CEREBRAS_MODELS = {
  text: "gpt-oss-120b",
  vision: "gemma-4-31b",
} as const;

export function createCerebrasClient(apiKey: string): AiClient {
  return createOpenAiCompatibleClient({
    providerName: "Cerebras",
    apiKey,
    apiKeyEnvName: "CEREBRAS_API_KEY",
    chatCompletionsUrl: CEREBRAS_CHAT_COMPLETIONS_URL,
    models: CEREBRAS_MODELS,
    maxTokensField: "max_completion_tokens",
    reasoningEffort: {
      text: "low",
      vision: "none",
    },
    extraHeaders: {
      "X-Cerebras-Version-Patch": CEREBRAS_API_VERSION,
    },
  });
}
