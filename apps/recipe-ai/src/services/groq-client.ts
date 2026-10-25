import { createOpenAiCompatibleClient } from "./openai-compatible-client";
import type { AiClient } from "../utils/ai-response-parser";

const GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS = {
  text: "openai/gpt-oss-120b",
  vision: "qwen/qwen3.8-27b",
} as const;

export function createGroqClient(apiKey: string): AiClient {
  return createOpenAiCompatibleClient({
    providerName: "Groq",
    apiKey,
    apiKeyEnvName: "GROQ_API_KEY",
    chatCompletionsUrl: GROQ_CHAT_COMPLETIONS_URL,
    models: GROQ_MODELS,
    maxTokensField: "max_completion_tokens",
    reasoningEffort: { text: "low", vision: "none" },
    jsonSchemaWorkloads: ["text"],
  });
}
