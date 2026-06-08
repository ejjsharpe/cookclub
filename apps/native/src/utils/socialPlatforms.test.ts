import { describe, expect, it } from "vitest";

import { isBasicImportUnsupportedUrl } from "./basicImport";
import {
  getRecipeImportSocialPlatform,
  getRecipeImportSocialPlatformInfo,
  getRecipeImportSourceTitle,
} from "./socialPlatforms";

describe("social platform import utilities", () => {
  it("detects and labels YouTube sources", () => {
    expect(
      getRecipeImportSocialPlatform(
        "https://www.youtube.com/watch?v=abc123DEF_-",
      ),
    ).toBe("youtube");
    expect(getRecipeImportSocialPlatform("https://youtu.be/abc123DEF_-")).toBe(
      "youtube",
    );
    expect(getRecipeImportSocialPlatform("YouTube")).toBe("youtube");

    expect(getRecipeImportSocialPlatformInfo("youtube")).toMatchObject({
      displayName: "YouTube",
      icon: "logo-youtube",
    });
    expect(getRecipeImportSourceTitle("https://youtu.be/abc123DEF_-")).toBe(
      "Importing recipe from YouTube",
    );
  });

  it("blocks YouTube URLs in Basic Import", () => {
    expect(
      isBasicImportUnsupportedUrl(
        "https://www.youtube.com/shorts/abc123DEF_-?si=tracking",
      ),
    ).toBe(true);
    expect(isBasicImportUnsupportedUrl("https://youtu.be/abc123DEF_-")).toBe(
      true,
    );
  });
});
