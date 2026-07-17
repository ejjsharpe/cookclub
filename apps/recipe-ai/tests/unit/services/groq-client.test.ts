import { afterEach, describe, expect, it, vi } from "vitest";

import { createGroqClient } from "../../../src/services/groq-client";

function completionResponse(content: string) {
  return Response.json({
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
  });
}

describe("Groq client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps text workloads to GPT-OSS with strict structured output", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completionResponse('{"name":"Pasta"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createGroqClient("test-key").complete("text", {
      messages: [{ role: "user", content: "Return JSON" }],
      max_tokens: 512,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "recipe",
          schema: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      },
    });

    expect(result).toBe('{"name":"Pasta"}');
    const [requestUrl, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(requestUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(body).toMatchObject({
      model: "openai/gpt-oss-120b",
      max_completion_tokens: 512,
      reasoning_effort: "low",
      stream: false,
    });
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
  });

  it("uses Qwen 3.6 JSON object mode for vision workloads", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completionResponse('{"name":"Pasta"}'));
    vi.stubGlobal("fetch", fetchMock);

    await createGroqClient("test-key").complete("vision", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract this recipe" },
            {
              type: "image_url",
              image_url: { url: "data:image/jpeg;base64,AA==" },
            },
          ],
        },
      ],
      max_tokens: 512,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "recipe",
          schema: { type: "object", properties: {} },
        },
      },
    });

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "qwen/qwen3.6-27b",
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    });
  });

  it("surfaces failed provider calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: { message: "Service overloaded" } },
            { status: 503 },
          ),
        ),
    );

    await expect(
      createGroqClient("test-key").complete("text", {
        messages: [{ role: "user", content: "Return JSON" }],
      }),
    ).rejects.toThrow(
      "Groq request failed with status 503: Service overloaded",
    );
  });

  it("fails before fetching when the API key is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createGroqClient("").complete("text", {
        messages: [{ role: "user", content: "Return JSON" }],
      }),
    ).rejects.toThrow("GROQ_API_KEY is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
