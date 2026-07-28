import { describe, expect, it } from "vitest";

import {
  ProviderRequestError,
  providerFailureFields,
  providerResponseError,
  providerTransportError,
} from "../../../src/services/provider-response";

describe("provider failure classification", () => {
  it("preserves 429 metadata and Retry-After", async () => {
    const error = await providerResponseError(
      Response.json(
        { error: { message: "Slow down" } },
        {
          status: 429,
          headers: {
            "Retry-After": "17",
            "x-request-id": "request-123",
          },
        },
      ),
      "Provider",
    );

    expect(error).toMatchObject({
      status: 429,
      retryable: true,
      retryAfterSeconds: 17,
      requestId: "request-123",
      timedOut: false,
    });
  });

  it("classifies provider 5xx as retryable and validation 4xx as terminal", async () => {
    const unavailable = await providerResponseError(
      Response.json({ error: "Unavailable" }, { status: 503 }),
      "Provider",
    );
    const invalid = await providerResponseError(
      Response.json({ error: "Invalid request" }, { status: 400 }),
      "Provider",
    );

    expect(unavailable.retryable).toBe(true);
    expect(invalid.retryable).toBe(false);
    expect(providerFailureFields(unavailable)).toEqual({
      disposition: "retry",
    });
    expect(providerFailureFields(invalid)).toEqual({
      disposition: "terminal",
    });
  });

  it("retains timeout and network causes", () => {
    const timeout = providerTransportError(
      new DOMException("Timed out", "AbortError"),
      "Provider",
    );
    const network = providerTransportError(
      new TypeError("connection reset"),
      "Provider",
    );

    expect(timeout).toBeInstanceOf(ProviderRequestError);
    expect(timeout).toMatchObject({ retryable: true, timedOut: true });
    expect(network).toMatchObject({ retryable: true, timedOut: false });
    expect(network.cause).toBeInstanceOf(TypeError);
  });
});
