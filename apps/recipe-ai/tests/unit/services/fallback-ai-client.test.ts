import { describe, expect, it, vi } from "vitest";

import { createFallbackAiClient } from "../../../src/services/fallback-ai-client";

describe("createFallbackAiClient", () => {
  it("returns the Cerebras response without calling Groq", async () => {
    const primary = { complete: vi.fn().mockResolvedValue("primary") };
    const secondary = {
      complete: vi.fn().mockResolvedValue("secondary"),
    };

    await expect(
      createFallbackAiClient(primary, secondary).complete("text", {
        messages: [],
      }),
    ).resolves.toBe("primary");
    expect(secondary.complete).not.toHaveBeenCalled();
  });

  it("uses Groq after a Cerebras failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = {
      complete: vi.fn().mockRejectedValue(new Error("Cerebras unavailable")),
    };
    const secondary = {
      complete: vi.fn().mockResolvedValue("secondary"),
    };
    const request = { messages: [{ role: "user", content: "Recipe" }] };

    await expect(
      createFallbackAiClient(primary, secondary).complete("text", request),
    ).resolves.toBe("secondary");
    expect(secondary.complete).toHaveBeenCalledWith("text", request);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("ai_provider_fallback"),
    );
  });

  it("reports both failures when neither provider succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = {
      complete: vi.fn().mockRejectedValue(new Error("primary failed")),
    };
    const secondary = {
      complete: vi.fn().mockRejectedValue(new Error("secondary failed")),
    };

    await expect(
      createFallbackAiClient(primary, secondary).complete("text", {
        messages: [],
      }),
    ).rejects.toThrow(
      "Cerebras failed (primary failed); Groq fallback failed (secondary failed)",
    );
  });
});
