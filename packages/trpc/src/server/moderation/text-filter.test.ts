import { describe, expect, it } from "vitest";

import {
  containsObjectionablePublicText,
  filterOptionalPublicText,
  filterPublicText,
  normalizePublicText,
} from "./text-filter";

describe("public text moderation", () => {
  it("normalizes Unicode, whitespace, controls, and bidi formatting", () => {
    expect(normalizePublicText("  Ｐasta\u0000\twith\u202Espice  ")).toBe(
      "Pasta withspice",
    );
  });

  it.each(["shit", "f4ck", "shіt", "f u c k", "fuuuuck"])(
    "rejects profanity and obfuscated variants: %s",
    (text) => {
      expect(containsObjectionablePublicText(text)).toBe(true);
      expect(() => filterPublicText(text, "Comment")).toThrow(
        "Comment contains content that cannot be published.",
      );
    },
  );

  it("does not reject ordinary recipe language", () => {
    expect(filterPublicText("Whisk the egg whites until stiff", "Step")).toBe(
      "Whisk the egg whites until stiff",
    );
  });

  it("preserves null and undefined optional fields", () => {
    expect(filterOptionalPublicText(null, "Bio")).toBeNull();
    expect(filterOptionalPublicText(undefined, "Bio")).toBeUndefined();
  });
});
