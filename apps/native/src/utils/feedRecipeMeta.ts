import type { RecipeMetadata } from "@repo/contracts/feed";

import {
  getRecipeImportSocialPlatform,
  getRecipeImportSocialPlatformInfo,
} from "./socialPlatforms";
import { formatMinutesShort } from "./timeUtils";

/** Where a feed recipe came from, in a few words ("TikTok", "@sam", "bbc.co.uk"). */
export function getFeedRecipeSource(recipe: RecipeMetadata): string | null {
  switch (recipe.sourceType) {
    case "url": {
      const platform = getRecipeImportSocialPlatform(recipe.sourceUrl);
      return platform
        ? getRecipeImportSocialPlatformInfo(platform).displayName
        : recipe.sourceDomain;
    }
    case "user":
      if (!recipe.originalOwner) return null;
      return recipe.originalOwner.username
        ? `@${recipe.originalOwner.username}`
        : recipe.originalOwner.name;
    default:
      return null;
  }
}

/** The card meta line: "seriouseats.com · 25 min · Noodles, Thai". */
export function formatFeedRecipeMeta(recipe: RecipeMetadata): string {
  return [
    getFeedRecipeSource(recipe),
    formatMinutesShort(recipe.totalTime),
    recipe.tags?.length ? recipe.tags.join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
