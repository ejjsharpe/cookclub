import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateRecipeImage } from "../../../src/services/recipe-image-generator";
import type { Env } from "../../../src/types";

const replicateMocks = vi.hoisted(() => ({
  generateReplicateImage: vi.fn(),
}));

vi.mock("../../../src/services/replicate-image-client", () => replicateMocks);

function createEnv() {
  const env: Env = {
    RECIPE_CACHE: {} as KVNamespace,
    BROWSER: {} as BrowserRun,
    IMAGE_PUBLIC_URL: "https://images.example.com",
    CEREBRAS_API_KEY: "cerebras-token",
    GROQ_API_KEY: "groq-token",
    REPLICATE_API_TOKEN: "replicate-token",
    YOUTUBE_API_KEY: "youtube-token",
    IMAGE_SERVICE: {
      presign: vi.fn(),
      verify: vi.fn(),
      move: vi.fn(),
      delete: vi.fn(),
      deleteImportImages: vi.fn(),
      deleteImportImageStagingIds: vi.fn(),
      listImportImageStagingIds: vi.fn(),
      uploadFromUrl: vi.fn(),
      uploadImage: vi.fn().mockResolvedValue({
        success: true,
        key: "recipes/generated.jpg",
        publicUrl: "https://images.example.com/recipes/generated.jpg",
      }),
      normalizeImage: vi.fn(),
      stageImportSource: vi.fn(),
      getImportSource: vi.fn(),
    },
  };
  return env;
}

describe("generateRecipeImage", () => {
  beforeEach(() => {
    replicateMocks.generateReplicateImage.mockReset();
    replicateMocks.generateReplicateImage.mockResolvedValue(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a blank title before calling either external service", async () => {
    const env = createEnv();

    await expect(
      generateRecipeImage(env, { name: "   ", ownerId: "owner-1" }),
    ).resolves.toEqual({
      success: false,
      error: {
        code: "MISSING_RECIPE_NAME",
        message: "Add a recipe title before creating an image.",
      },
    });

    expect(replicateMocks.generateReplicateImage).not.toHaveBeenCalled();
    expect(env.IMAGE_SERVICE.uploadImage).not.toHaveBeenCalled();
  });

  it("builds a bounded food prompt and stores the generated JPEG", async () => {
    const env = createEnv();
    const ingredients = Array.from(
      { length: 13 },
      (_, index) => `ingredient-${index + 1}`,
    );
    const instructions = Array.from(
      { length: 5 },
      (_, index) => `step-${index + 1}.`,
    );

    const result = await generateRecipeImage(env, {
      name: "  Tomato Pasta  ",
      description: "  A bright weeknight pasta  ",
      ingredients,
      instructions,
      ownerId: "owner-1",
    });

    expect(result).toEqual({
      success: true,
      imageUploadId: "recipes/generated.jpg",
      publicUrl: "https://images.example.com/recipes/generated.jpg",
    });
    expect(replicateMocks.generateReplicateImage).toHaveBeenCalledTimes(1);
    const generationInput = replicateMocks.generateReplicateImage.mock
      .calls[0]?.[0] as { apiToken: string; prompt: string; seed: number };
    expect(generationInput.apiToken).toBe("replicate-token");
    expect(generationInput.seed).toBeGreaterThanOrEqual(0);
    expect(generationInput.seed).toBeLessThan(1_000_000);
    expect(generationInput.prompt).toContain("Dish: Tomato Pasta.");
    expect(generationInput.prompt).toContain(
      "Description: A bright weeknight pasta.",
    );
    expect(generationInput.prompt).toContain("ingredient-12");
    expect(generationInput.prompt).not.toContain("ingredient-13");
    expect(generationInput.prompt).toContain("step-4.");
    expect(generationInput.prompt).not.toContain("step-5.");
    expect(generationInput.prompt).toContain("no text, no watermark");

    expect(env.IMAGE_SERVICE.uploadImage).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "image/jpeg",
      "owner-1",
    );
  });

  it("returns a stable failure when image storage rejects the upload", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = createEnv();
    vi.mocked(env.IMAGE_SERVICE.uploadImage).mockResolvedValue({
      success: false,
      error: "Image storage unavailable",
    });

    const result = await generateRecipeImage(env, { name: "Tomato Pasta" });

    expect(result).toEqual({
      success: false,
      error: {
        code: "IMAGE_GENERATION_ERROR",
        message: "Image storage unavailable",
      },
    });
  });

  it("surfaces provider failures without attempting an upload", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = createEnv();
    replicateMocks.generateReplicateImage.mockRejectedValue(
      new Error("Replicate timed out"),
    );

    const result = await generateRecipeImage(env, { name: "Tomato Pasta" });

    expect(result).toEqual({
      success: false,
      error: {
        code: "IMAGE_GENERATION_ERROR",
        message: "Replicate timed out",
      },
    });
    expect(env.IMAGE_SERVICE.uploadImage).not.toHaveBeenCalled();
  });
});
