import { isBasicImportUnsupportedUrl } from "@repo/contracts/recipe-import";
import { describe, expect, it } from "vitest";

import {
  getRecipeImportSocialPlatform,
  getRecipeImportSocialPlatformInfo,
  getRecipeImportSourceTitle,
} from "./socialPlatforms";

describe("social platform import utilities", () => {
  it.each([
    "https://www.reddit.com/r/recipes/comments/abc123/recipe/",
    "https://old.reddit.com/comments/abc123/",
    "https://www.reddit.com/r/recipes/s/Share123",
    "https://redd.it/abc123",
  ])("routes Reddit source %s to Smart Import", (url) => {
    expect(getRecipeImportSocialPlatform(url)).toBe("reddit");
    expect(getRecipeImportSourceTitle(url)).toBe(
      "Importing recipe from Reddit",
    );
    expect(isBasicImportUnsupportedUrl(url)).toBe(true);
    expect(getRecipeImportSocialPlatformInfo("reddit")).toMatchObject({
      displayName: "Reddit",
      icon: "logo-reddit",
    });
  });
  it.each([
    "https://uk.pinterest.com/pin/1970393584794073/",
    "https://www.pinterest.com/pin/pecan-pie--1970393584794073/",
    "https://pin.it/abc123",
  ])("routes Pinterest source %s to Smart Import", (url) => {
    expect(getRecipeImportSocialPlatform(url)).toBe("pinterest");
    expect(getRecipeImportSourceTitle(url)).toBe(
      "Importing recipe from Pinterest",
    );
    expect(isBasicImportUnsupportedUrl(url)).toBe(true);
    expect(getRecipeImportSocialPlatformInfo("pinterest")).toMatchObject({
      displayName: "Pinterest",
      icon: "logo-pinterest",
    });
  });

  it.each([
    "https://www.facebook.com/reel/973273425043117",
    "https://www.facebook.com/reel/1789858525376832",
    "https://www.facebook.com/share/r/1GNKTPHWS9/",
    "https://fb.watch/recipe/",
    "https://m.facebook.com/chef/posts/pfbidABC/",
  ])("routes Facebook source %s to Smart Import", (url) => {
    expect(getRecipeImportSocialPlatform(url)).toBe("facebook");
    expect(getRecipeImportSourceTitle(url)).toBe(
      "Importing recipe from Facebook",
    );
    expect(isBasicImportUnsupportedUrl(url)).toBe(true);
  });
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
