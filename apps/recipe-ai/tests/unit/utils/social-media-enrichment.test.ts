import { describe, expect, it } from "vitest";

import { buildEnrichedSocialRecipeText } from "../../../src/import/social/enrichment";

describe("social-media-enrichment", () => {
  it("builds combined caption, transcript, and frame text", () => {
    const text = buildEnrichedSocialRecipeText({
      caption: "Caption ingredients",
      pageText: "Pinned comment method",
      transcript: "Mix the batter and bake.",
      frameText: "Bake at 350F for 25 minutes.",
    });

    expect(text).toContain("Caption:\nCaption ingredients");
    expect(text).toContain("Rendered page text:\nPinned comment method");
    expect(text).toContain("Audio transcript:\nMix the batter and bake.");
    expect(text).toContain(
      "On-screen text from video frames:\nBake at 350F for 25 minutes.",
    );
  });
});
