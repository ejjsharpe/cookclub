import { describe, expect, it } from "vitest";

import {
  defaultImportType,
  detectImportSource,
  importSourceProblem,
} from "./recipeImportSource";

describe("detectImportSource", () => {
  it("reads a recipe website link, with or without https", () => {
    for (const input of [
      "https://www.bbcgoodfood.com/recipes/butter-chicken",
      "  bbcgoodfood.com/recipes/butter-chicken ",
    ]) {
      const source = detectImportSource(input);
      expect(source).toMatchObject({
        kind: "url",
        site: "bbcgoodfood.com",
        social: null,
        canQuickImport: true,
      });
      expect(defaultImportType(source)).toBe("basic");
    }
  });

  it("sends social links to smart import", () => {
    const source = detectImportSource("https://www.instagram.com/reel/C9x2Lk");
    expect(source).toMatchObject({
      kind: "url",
      social: "instagram",
      canQuickImport: false,
    });
    expect(defaultImportType(source)).toBe("smart");
  });

  it("treats anything else as recipe text", () => {
    const text = "2 onions\n1 tin tomatoes\nFry the onions, add the tomatoes";
    expect(detectImportSource(text)).toEqual({ kind: "text", text });
    expect(detectImportSource("butter chicken")).toEqual({
      kind: "text",
      text: "butter chicken",
    });
    expect(defaultImportType(detectImportSource(text))).toBe("smart");
    expect(detectImportSource("   ")).toEqual({ kind: "empty" });
  });

  it("uses smart import for photos", () => {
    expect(defaultImportType({ kind: "empty" }, 2)).toBe("smart");
  });
});

describe("links in other text", () => {
  it("finds the link in a short caption", () => {
    const source = detectImportSource(
      "Butter chicken 🔥 https://www.instagram.com/reel/abc123 so good",
    );
    expect(source).toMatchObject({
      kind: "url",
      url: "https://www.instagram.com/reel/abc123",
      social: "instagram",
    });
  });

  it("keeps a typed-out recipe with a source link as text", () => {
    const recipe = `${"Fry 2 onions, add garlic and ginger. ".repeat(5)}From https://example.com/curry`;
    expect(detectImportSource(recipe).kind).toBe("text");
  });

  it("keeps text with two links as text", () => {
    expect(detectImportSource("https://a.com/x or https://b.com/y").kind).toBe(
      "text",
    );
  });

  it("doesn't mistake ordinary words for links", () => {
    for (const input of [
      "1.5",
      "e.g",
      "salt.pepper",
      "http://x",
      "http://1.2.3.4/r",
    ]) {
      expect(detectImportSource(input).kind).toBe("text");
    }
    expect(detectImportSource("www.bbcgoodfood.com").kind).toBe("url");
  });
});

describe("importSourceProblem", () => {
  it("asks for more than a few words of text", () => {
    expect(importSourceProblem(detectImportSource("curry"))).toMatch(
      /a bit more/,
    );
    expect(importSourceProblem(detectImportSource("a".repeat(60)))).toBeNull();
    expect(importSourceProblem({ kind: "empty" })).not.toBeNull();
    expect(importSourceProblem({ kind: "empty" }, 1)).toBeNull();
    expect(importSourceProblem(detectImportSource("nyt.com/r"))).toBeNull();
  });
});
