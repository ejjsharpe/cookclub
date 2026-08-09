import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenAiCompatibleClient } from "../../../src/services/openai-compatible-client";
import { ProviderRequestError } from "../../../src/services/provider-response";

function createClient() {
  return createOpenAiCompatibleClient({
    providerName: "TestProvider",
    apiKey: "test-key",
    apiKeyEnvName: "TEST_PROVIDER_API_KEY",
    chatCompletionsUrl: "https://provider.example.com/chat/completions",
    models: { text: "text-model", vision: "vision-model" },
    maxTokensField: "max_tokens",
  });
}

describe("createOpenAiCompatibleClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects malformed requests before starting a provider call", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createClient().complete("text", { max_tokens: 100 }),
    ).rejects.toThrow("chat requests require a messages array");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies transport failures as retryable provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError("connection reset")),
    );

    const error = await createClient()
      .complete("text", { messages: [] })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject({
      provider: "TestProvider",
      retryable: true,
      timedOut: false,
      message: "TestProvider network request failed.",
    });
    if (!(error instanceof ProviderRequestError)) throw error;
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it("turns token-limit completions into errors with provider diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            choices: [
              {
                finish_reason: "length",
                message: { content: '{"partial":true}' },
              },
            ],
          },
          {
            status: 200,
            headers: { "x-request-id": "request-123" },
          },
        ),
      ),
    );

    const error = await createClient()
      .complete("text", { messages: [] })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject({
      provider: "TestProvider",
      status: 200,
      requestId: "request-123",
      retryable: true,
      message: "TestProvider reached the recipe output token limit.",
    });
  });

  it("reports invalid successful payloads as retryable empty completions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "request-id": "fallback-request-id" },
        }),
      ),
    );

    const error = await createClient()
      .complete("text", { messages: [] })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject({
      status: 200,
      requestId: "fallback-request-id",
      retryable: true,
      message: "TestProvider returned an empty completion.",
    });
  });

  it("does not swallow bounded-response failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(4 * 1024 * 1024 + 1) },
        }),
      ),
    );

    await expect(
      createClient().complete("text", { messages: [] }),
    ).rejects.toThrow("TestProvider response exceeded 4194304 bytes");
  });
});
