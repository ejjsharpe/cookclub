import { afterEach, describe, expect, it, vi } from "vitest";

import { createCerebrasClient } from "../../../src/services/cerebras-client";

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

describe("createCerebrasClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("translates text workloads to Cerebras chat completions", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completionResponse('{"name":"Pasta"}'));
    vi.stubGlobal("fetch", fetchMock);

    const client = createCerebrasClient("test-key");
    const result = await client.complete("text", {
      messages: [{ role: "user", content: "Return a recipe as JSON" }],
      max_tokens: 512,
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            ingredients: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
          },
          required: ["name", "ingredients"],
          additionalProperties: false,
        },
      },
    });

    expect(result).toBe('{"name":"Pasta"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const responseFormat = body.response_format as {
      json_schema: { strict: boolean; schema: Record<string, unknown> };
    };
    const schema = responseFormat.json_schema.schema;
    const properties = schema.properties as Record<string, unknown>;
    const ingredients = properties.ingredients as Record<string, unknown>;

    expect(url).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(headers.get("X-Cerebras-Version-Patch")).toBe("2");
    expect(body).toMatchObject({
      model: "gpt-oss-120b",
      max_completion_tokens: 512,
      reasoning_effort: "low",
      stream: false,
    });
    expect(body).not.toHaveProperty("max_tokens");
    expect(responseFormat.json_schema.strict).toBe(true);
    expect(ingredients).not.toHaveProperty("minItems");
  });

  it("uses JSON mode when the caller does not provide a schema", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completionResponse("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await createCerebrasClient("test-key").complete("text", {
      messages: [{ role: "user", content: "Return JSON" }],
    });

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("surfaces bounded API errors with the request ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { error: { message: "Rate limit exceeded" } },
          {
            status: 429,
            headers: { "x-request-id": "req-123" },
          },
        ),
      ),
    );

    await expect(
      createCerebrasClient("test-key").complete("text", {
        messages: [{ role: "user", content: "Return JSON" }],
      }),
    ).rejects.toThrow(
      "Cerebras request failed with status 429: Rate limit exceeded: request req-123",
    );
  });

  it("fails before making a request when the secret is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createCerebrasClient("").complete("text", {
        messages: [{ role: "user", content: "Return JSON" }],
      }),
    ).rejects.toThrow("CEREBRAS_API_KEY is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
