import { describe, expect, it } from "vitest";

import {
  RECIPE_IMPORT_LIMITS,
  isBasicImportUnsupportedHost,
  isBasicImportUnsupportedUrl,
  isRecipeImportSourceImageType,
  normalizeRecipeImportUrl,
  recipeImportPlaceholderTitle,
  recipeImportSourceImageByteBudget,
  recipeImportStrategyForType,
} from "./recipe-import";

describe("recipe import source validation", () => {
  it.each([
    "instagram.com",
    "WWW.TIKTOK.COM.",
    "m.youtube.com",
    "facebook.com",
    "m.facebook.com",
    "fb.com",
    "fb.watch",
    "pinterest.com",
    "UK.PINTEREST.COM.",
    "pin.it",
    "reddit.com",
    "OLD.REDDIT.COM.",
    "redd.it",
  ])("blocks unsupported host %s", (hostname) => {
    expect(isBasicImportUnsupportedHost(hostname)).toBe(true);
  });

  it.each([
    "notyoutube.com",
    "youtube.com.evil.test",
    "example.com",
    "notpinterest.com",
    "pinterest.com.evil.test",
    "pin.it.evil.test",
    "notreddit.com",
    "reddit.com.evil.test",
    "redd.it.evil.test",
  ])("does not over-block host %s", (hostname) => {
    expect(isBasicImportUnsupportedHost(hostname)).toBe(false);
  });

  it("extracts the hostname from URLs and treats malformed input separately", () => {
    expect(isBasicImportUnsupportedUrl("https://youtu.be/recipe")).toBe(true);
    expect(isBasicImportUnsupportedUrl("not a URL")).toBe(false);
  });

  it.each(["image/jpeg", "image/png", "image/webp"])(
    "accepts source image type %s",
    (contentType) => {
      expect(isRecipeImportSourceImageType(contentType)).toBe(true);
    },
  );

  it.each([null, undefined, "image/gif", "IMAGE/JPEG"])(
    "rejects source image type %s",
    (contentType) => {
      expect(isRecipeImportSourceImageType(contentType)).toBe(false);
    },
  );
});

describe("recipe import normalization", () => {
  it("divides the provider-safe image payload across all sources", () => {
    expect(recipeImportSourceImageByteBudget(1)).toBe(
      RECIPE_IMPORT_LIMITS.sourceImagesTotalBytes,
    );
    expect(recipeImportSourceImageByteBudget(3) * 3).toBeLessThanOrEqual(
      RECIPE_IMPORT_LIMITS.sourceImagesTotalBytes,
    );
    expect(() => recipeImportSourceImageByteBudget(0)).toThrow(
      "Invalid recipe import source count",
    );
  });

  it("trims, canonicalizes, and removes fragments from HTTP URLs", () => {
    expect(
      normalizeRecipeImportUrl("  https://example.com/recipe?q=1#method  "),
    ).toBe("https://example.com/recipe?q=1");
  });

  it.each(["ftp://example.com/recipe", "mailto:chef@example.com"])(
    "rejects non-HTTP URL %s",
    (url) => {
      expect(() => normalizeRecipeImportUrl(url)).toThrow(
        "Recipe import URLs must use HTTP or HTTPS.",
      );
    },
  );

  it("selects the processing strategy from the import type", () => {
    expect(recipeImportStrategyForType("basic")).toBe("deterministic");
    expect(recipeImportStrategyForType("smart")).toBe("ai-assisted");
  });

  it("creates concise, source-specific placeholder titles", () => {
    expect(
      recipeImportPlaceholderTitle({
        type: "url",
        value: "https://www.example.com/recipes/1",
      }),
    ).toBe("example.com");
    expect(
      recipeImportPlaceholderTitle({ type: "url", value: "not a URL" }),
    ).toBe("Recipe URL");
    expect(
      recipeImportPlaceholderTitle({ type: "text", value: "Recipe" }),
    ).toBe("Pasted recipe text");
    expect(
      recipeImportPlaceholderTitle({
        type: "image",
        uploadKeys: ["job/source"],
      }),
    ).toBe("Recipe image");
  });
});
