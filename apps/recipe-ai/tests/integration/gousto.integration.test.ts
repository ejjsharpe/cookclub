import { describe, expect, it } from "vitest";

import { collectGoustoRecipeCandidates } from "../../src/import/url/gousto";
import { evaluateRecipeCandidates } from "../../src/import/url/parse";
import { goustoResponse, goustoUrl } from "../fixtures/gousto";

describe("Gousto imports in the Workers runtime", () => {
  it("fetches and parses the recipe using native Workers fetch", async () => {
    // The integration config supplies the origin response. Do not mock global
    // fetch here: Node mocks previously hid an unsupported redirect setting.
    const candidates = await collectGoustoRecipeCandidates(goustoUrl);

    expect(candidates[0]?.error).toBeUndefined();
    expect(candidates[0]?.recipe).toMatchObject({
      name: goustoResponse.data.entry.title,
      sourceUrl: goustoUrl,
      servings: 2,
      totalTime: 50,
    });
    expect(evaluateRecipeCandidates(candidates).accepted).toHaveLength(1);
  });

  it("rejects API redirects without following them", async () => {
    const [candidate] = await collectGoustoRecipeCandidates(
      "https://www.gousto.co.uk/cookbook/recipes/redirect-recipe",
    );

    expect(candidate?.recipe).toBeNull();
    expect(candidate?.error).toEqual(
      new Error("Gousto recipe request failed: 302"),
    );
  });
});
