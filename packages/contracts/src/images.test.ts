import { describe, expect, it } from "vitest";

import {
  imageKeyFromPublicUrl,
  isHostedImageUrl,
  isValidImportImageStagingId,
  normalizeImagePublicUrl,
  publicImageUrlForKey,
} from "./images";

describe("image public URLs", () => {
  const publicUrl = "https://images.cookclub.app///";

  it("normalizes the public base and encodes each storage-key segment", () => {
    expect(normalizeImagePublicUrl(publicUrl)).toBe(
      "https://images.cookclub.app",
    );
    expect(publicImageUrlForKey(publicUrl, "recipes/My photo #1.webp")).toBe(
      "https://images.cookclub.app/recipes/My%20photo%20%231.webp",
    );
  });

  it("round-trips hosted image keys and ignores query strings or fragments", () => {
    const url = publicImageUrlForKey(publicUrl, "recipes/My photo.webp");

    expect(imageKeyFromPublicUrl(`${url}?width=720#preview`, publicUrl)).toBe(
      "recipes/My photo.webp",
    );
    expect(isHostedImageUrl(url, publicUrl)).toBe(true);
  });

  it.each([
    [null, "missing URLs"],
    ["https://example.com/image.webp", "foreign origins"],
    ["https://images.cookclub.app.evil.test/image.webp", "prefix origins"],
    ["https://images.cookclub.app/", "empty keys"],
    ["https://images.cookclub.app/%2Fsecret", "absolute decoded keys"],
    ["https://images.cookclub.app/a/%2E%2E/secret", "parent traversal"],
    ["https://images.cookclub.app/%E0%A4%A", "malformed encoding"],
  ] as const)("rejects %s (%s)", (url, _reason) => {
    expect(imageKeyFromPublicUrl(url, publicUrl)).toBeNull();
    expect(isHostedImageUrl(url, publicUrl)).toBe(false);
  });
});

describe("import image staging IDs", () => {
  it.each(["a", "job_123-ABC", "x".repeat(128)])("accepts %s", (value) => {
    expect(isValidImportImageStagingId(value)).toBe(true);
  });

  it.each(["", "contains/slash", "contains space", "x".repeat(129)])(
    "rejects %s",
    (value) => {
      expect(isValidImportImageStagingId(value)).toBe(false);
    },
  );
});
