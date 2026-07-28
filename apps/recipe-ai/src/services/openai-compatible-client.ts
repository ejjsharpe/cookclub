import {
  ProviderRequestError,
  providerResponseError,
  providerTransportError,
  readBoundedText,
} from "./provider-response";
import type { AiClient, AiWorkload } from "../utils/ai-response-parser";

const UNSUPPORTED_STRICT_SCHEMA_KEYS = new Set(["minItems", "maxItems"]);

interface OpenAiCompatibleClientConfig {
  providerName: string;
  apiKey: string;
  apiKeyEnvName: string;
  chatCompletionsUrl: string;
  models: Record<AiWorkload, string>;
  maxTokensField: "max_tokens" | "max_completion_tokens";
  reasoningEffort?: Partial<Record<AiWorkload, string>>;
  jsonSchemaWorkloads?: readonly AiWorkload[];
  extraHeaders?: Record<string, string>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeStrictSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeStrictSchema);
  }

  const record = asRecord(value);
  if (!record) return value;

  const sanitized = Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !UNSUPPORTED_STRICT_SCHEMA_KEYS.has(key))
      .map(([key, child]) => [key, sanitizeStrictSchema(child)]),
  ) as Record<string, unknown>;
  const properties = asRecord(sanitized.properties);

  if (sanitized.type === "object" && properties) {
    sanitized.required = Object.keys(properties);
    sanitized.additionalProperties = false;
  }

  return sanitized;
}

function normalizeResponseFormat(
  value: unknown,
  supportsJsonSchema: boolean,
): Record<string, unknown> {
  const responseFormat = asRecord(value);
  if (!responseFormat) return { type: "json_object" };
  if (responseFormat.type !== "json_schema") return responseFormat;
  if (!supportsJsonSchema) return { type: "json_object" };

  const existingJsonSchema = asRecord(responseFormat.json_schema);
  if (!existingJsonSchema) return { type: "json_object" };

  const schema =
    "schema" in existingJsonSchema
      ? existingJsonSchema.schema
      : existingJsonSchema;

  return {
    type: "json_schema",
    json_schema: {
      name:
        typeof existingJsonSchema.name === "string"
          ? existingJsonSchema.name
          : "recipe_response",
      strict: true,
      schema: sanitizeStrictSchema(schema),
    },
  };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function extractCompletion(payload: unknown, providerName: string): string {
  const response = asRecord(payload);
  const choices = response?.choices;
  const firstChoice = Array.isArray(choices) ? asRecord(choices[0]) : null;
  const message = asRecord(firstChoice?.message);
  const content = message?.content;

  if (firstChoice?.finish_reason === "length") {
    throw new Error(`${providerName} reached the recipe output token limit.`);
  }
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`${providerName} returned an empty completion.`);
  }

  return content;
}

function requestId(response: Response): string | undefined {
  return (
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    undefined
  );
}

function toRequest(
  config: OpenAiCompatibleClientConfig,
  workload: AiWorkload,
  request: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(request.messages)) {
    throw new Error(
      `${config.providerName} chat requests require a messages array.`,
    );
  }

  const maxTokens = positiveInteger(request.max_tokens);
  const reasoningEffort = config.reasoningEffort?.[workload];
  const supportsJsonSchema =
    !config.jsonSchemaWorkloads ||
    config.jsonSchemaWorkloads.includes(workload);

  return {
    model: config.models[workload],
    messages: request.messages,
    stream: false,
    response_format: normalizeResponseFormat(
      request.response_format,
      supportsJsonSchema,
    ),
    ...(maxTokens ? { [config.maxTokensField]: maxTokens } : {}),
    ...(typeof request.temperature === "number"
      ? { temperature: request.temperature }
      : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };
}

export function createOpenAiCompatibleClient(
  config: OpenAiCompatibleClientConfig,
): AiClient {
  return {
    async complete(workload, request) {
      if (!config.apiKey) {
        throw new Error(
          `${config.apiKeyEnvName} is required for recipe AI requests.`,
        );
      }

      const body = toRequest(config, workload, request);
      let response: Response;
      try {
        response = await fetch(config.chatCompletionsUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            ...config.extraHeaders,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw providerTransportError(error, config.providerName);
      }

      if (!response.ok) {
        throw await providerResponseError(response, config.providerName);
      }

      let payload: unknown = null;
      try {
        const text = await readBoundedText(
          response,
          MAX_RESPONSE_BYTES,
          config.providerName,
        );
        payload = JSON.parse(text);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith(`${config.providerName} response exceeded`)
        ) {
          throw error;
        }
        // Status and request ID still provide bounded diagnostics.
      }

      try {
        return extractCompletion(payload, config.providerName);
      } catch (error) {
        throw new ProviderRequestError(
          error instanceof Error
            ? error.message
            : `${config.providerName} returned an invalid response.`,
          {
            provider: config.providerName,
            status: response.status,
            requestId: requestId(response),
            retryable: true,
            cause: error,
          },
        );
      }
    },
  };
}
