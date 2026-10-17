import type { ShareIntent } from "expo-share-intent";
import { describe, expect, it } from "vitest";

import { detectPendingShareIntent } from "./shareIntent";

function makeIntent(overrides: Partial<ShareIntent> = {}): ShareIntent {
  return {
    files: null,
    type: null,
    webUrl: null,
    ...overrides,
  };
}

describe("detectPendingShareIntent", () => {
  it.each([
    "https://www.facebook.com/reel/973273425043117",
    "https://www.facebook.com/reel/1789858525376832",
    "https://www.facebook.com/share/r/1GNKTPHWS9/",
  ])("preserves shared Facebook URL %s", (url) => {
    expect(detectPendingShareIntent(makeIntent({ webUrl: url }))).toEqual({
      type: "url",
      content: url,
    });
    expect(
      detectPendingShareIntent(makeIntent({ text: `Try this recipe: ${url}` })),
    ).toEqual({ type: "url", content: url });
  });
  it("prefers a platform web URL over files and text", () => {
    expect(
      detectPendingShareIntent(
        makeIntent({
          webUrl: "https://example.com/recipe",
          files: [
            {
              fileName: "recipe.jpg",
              mimeType: "image/jpeg",
              path: "file:///recipe.jpg",
              size: 42,
              width: 10,
              height: 10,
              duration: null,
            },
          ],
          text: "A sufficiently long recipe description that should not win.",
        }),
      ),
    ).toEqual({ type: "url", content: "https://example.com/recipe" });
  });

  it("detects the first shared image and preserves its MIME type", () => {
    expect(
      detectPendingShareIntent(
        makeIntent({
          files: [
            {
              fileName: "recipe.png",
              mimeType: "image/png",
              path: "file:///shared/recipe.png",
              size: null,
              width: null,
              height: null,
              duration: null,
            },
          ],
        }),
      ),
    ).toEqual({
      type: "image",
      content: "file:///shared/recipe.png",
      mimeType: "image/png",
    });
  });

  it("extracts a URL embedded in shared text", () => {
    expect(
      detectPendingShareIntent(
        makeIntent({
          text: "Try this recipe: https://example.com/pasta?serves=4",
        }),
      ),
    ).toEqual({
      type: "url",
      content: "https://example.com/pasta?serves=4",
    });
  });

  it("accepts recipe text at the minimum length boundary", () => {
    const text = "x".repeat(50);

    expect(detectPendingShareIntent(makeIntent({ text }))).toEqual({
      type: "text",
      content: text,
    });
  });

  it("rejects empty, short, and unsupported file shares", () => {
    expect(detectPendingShareIntent(null)).toBeNull();
    expect(
      detectPendingShareIntent(makeIntent({ text: "x".repeat(49) })),
    ).toBeNull();
    expect(
      detectPendingShareIntent(
        makeIntent({
          files: [
            {
              fileName: "recipe.pdf",
              mimeType: "application/pdf",
              path: "file:///shared/recipe.pdf",
              size: 42,
              width: null,
              height: null,
              duration: null,
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});
