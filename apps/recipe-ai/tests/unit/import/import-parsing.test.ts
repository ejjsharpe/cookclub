import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseImage } from "../../../src/import/image";
import { parseText } from "../../../src/import/text";
import type { ParsedRecipe } from "../../../src/schema";
import type { AiRecipeResult } from "../../../src/services/ai-client";
import { ProviderRequestError } from "../../../src/services/provider-response";
import type { Env } from "../../../src/types";

const importMocks = vi.hoisted(() => ({
  acceptedCandidate: vi.fn(),
  extractRecipeOutline: vi.fn(),
  parseRecipeFromImage: vi.fn(),
  parseRecipeFromText: vi.fn(),
}));

vi.mock("../../../src/import/url/parse", () => ({
  acceptedCandidate: importMocks.acceptedCandidate,
}));
vi.mock("../../../src/utils/recipe-outline-parser", () => ({
  extractRecipeOutline: importMocks.extractRecipeOutline,
}));
vi.mock("../../../src/services/ai-client", () => ({
  parseRecipeFromImage: importMocks.parseRecipeFromImage,
  parseRecipeFromText: importMocks.parseRecipeFromText,
}));

const aiRecipe: AiRecipeResult = {
  name: "Tomato Pasta",
  description: "A simple pasta",
  prepTime: 10,
  cookTime: 20,
  totalTime: 30,
  servings: 4,
  ingredientSections: [
    {
      name: null,
      ingredients: [
        {
          index: 0,
          quantity: 2,
          unit: "cups",
          name: "tomatoes",
          preparation: null,
        },
      ],
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [
        { index: 0, instruction: "Simmer the sauce.", imageUrl: null },
      ],
    },
  ],
  suggestedTags: ["pasta"],
};

const outlineRecipe: ParsedRecipe = {
  name: "Rule Parsed Pasta",
  sourceType: "text",
  sourceUrl: null,
  ingredientSections: [
    {
      name: null,
      ingredients: [{ index: 0, quantity: 2, unit: "cup", name: "tomatoes" }],
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [{ index: 0, instruction: "Simmer the sauce." }],
    },
  ],
  images: [],
};

const env = {} as Env;
const ai = { complete: vi.fn() };

function successfulResult(recipe: ParsedRecipe, source: "text" | "image") {
  return {
    success: true as const,
    data: recipe,
    metadata: { source, confidence: "high" as const },
  };
}

describe("text and image import orchestration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(importMocks).forEach((mock) => mock.mockReset());
    importMocks.parseRecipeFromImage.mockResolvedValue(aiRecipe);
    importMocks.parseRecipeFromText.mockResolvedValue(aiRecipe);
    importMocks.extractRecipeOutline.mockReturnValue(null);
  });

  it("returns a deterministic text outline without spending an AI request", async () => {
    importMocks.extractRecipeOutline.mockReturnValue(outlineRecipe);
    importMocks.acceptedCandidate.mockResolvedValue(
      successfulResult(outlineRecipe, "text"),
    );

    const result = await parseText(
      env,
      "Tomato pasta recipe with two cups of tomatoes. Simmer the sauce until thick.",
      ai,
    );

    expect(result.success).toBe(true);
    expect(importMocks.parseRecipeFromText).not.toHaveBeenCalled();
    expect(importMocks.acceptedCandidate).toHaveBeenCalledWith(
      env,
      "text",
      outlineRecipe,
      "ai",
      expect.objectContaining({
        parseMethod: "outline_rules",
        cache: false,
        metadataSource: "text",
      }),
    );
  });

  it("returns validation failure when neither text candidate is accepted", async () => {
    importMocks.acceptedCandidate.mockResolvedValue(null);

    const result = await parseText(
      env,
      "Tomato pasta recipe with two cups of tomatoes. Simmer the sauce until thick.",
      ai,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "VALIDATION_FAILED" },
      metadata: { source: "text", confidence: "low" },
    });
    expect(importMocks.acceptedCandidate).toHaveBeenCalledTimes(2);
    const aiCandidate = importMocks.acceptedCandidate.mock.calls[1]?.[2] as
      ParsedRecipe | undefined;
    expect(aiCandidate).toMatchObject({
      name: "Tomato Pasta",
      sourceType: "text",
      sourceUrl: null,
    });
    expect(aiCandidate?.ingredientSections[0]?.ingredients[0]?.unit).toBe(
      "cup",
    );
  });

  it("preserves retry metadata when text AI parsing fails", async () => {
    importMocks.acceptedCandidate.mockResolvedValueOnce(null);
    importMocks.parseRecipeFromText.mockRejectedValue(
      new ProviderRequestError("Rate limited", {
        provider: "TestProvider",
        status: 429,
        retryAfterSeconds: 12,
        retryable: true,
      }),
    );

    const result = await parseText(
      env,
      "Tomato pasta recipe with two cups of tomatoes. Simmer the sauce until thick.",
      ai,
    );

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "AI_PARSE_FAILED",
        message: "Rate limited",
        disposition: "retry",
        retryAfterSeconds: 12,
      },
    });
  });

  it("rejects unsupported image types before invoking vision AI", async () => {
    const result = await parseImage(
      env,
      Uint8Array.from([1, 2, 3]).buffer,
      "image/gif",
      "https://images.example.com/source.gif",
      ai,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "INVALID_MIME_TYPE" },
      metadata: { source: "image" },
    });
    expect(importMocks.parseRecipeFromImage).not.toHaveBeenCalled();
  });

  it("rejects oversized images before base64 encoding", async () => {
    const oversizedImage = { byteLength: 10 * 1024 * 1024 + 1 } as ArrayBuffer;

    const result = await parseImage(
      env,
      oversizedImage,
      "image/jpeg",
      "https://images.example.com/source.jpg",
      ai,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "IMAGE_TOO_LARGE" },
    });
    expect(importMocks.parseRecipeFromImage).not.toHaveBeenCalled();
  });

  it("encodes valid images and attaches their source URL to the candidate", async () => {
    const sourceImageUrl = "https://images.example.com/source.jpg";
    importMocks.acceptedCandidate.mockImplementation(
      async (_env: Env, _cacheUrl: string, candidate: ParsedRecipe) =>
        successfulResult(candidate, "image"),
    );

    const result = await parseImage(
      env,
      Uint8Array.from([1, 2, 3]).buffer,
      "image/jpeg",
      sourceImageUrl,
      ai,
    );

    expect(result.success).toBe(true);
    expect(importMocks.parseRecipeFromImage).toHaveBeenCalledWith(
      ai,
      "AQID",
      "image/jpeg",
    );
    expect(importMocks.acceptedCandidate).toHaveBeenCalledWith(
      env,
      "image",
      expect.objectContaining({
        name: "Tomato Pasta",
        sourceType: "image",
        sourceUrl: null,
        images: [sourceImageUrl],
      }),
      "ai",
      expect.objectContaining({
        parseMethod: "ai_only",
        cache: false,
        metadataSource: "image",
      }),
    );
  });

  it("returns validation failure when a vision candidate is rejected", async () => {
    importMocks.acceptedCandidate.mockResolvedValue(null);

    const result = await parseImage(
      env,
      Uint8Array.from([1]).buffer,
      "image/png",
      "https://images.example.com/source.png",
      ai,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "VALIDATION_FAILED" },
      metadata: { source: "image", confidence: "low" },
    });
  });
});
