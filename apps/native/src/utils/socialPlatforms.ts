import {
  FACEBOOK_IMPORT_HOSTS,
  PINTEREST_IMPORT_HOSTS,
  REDDIT_IMPORT_HOSTS,
} from "@repo/contracts/recipe-import";
import type { ComponentProps } from "react";

import type { Ionicons } from "@/components/Ionicons";

export type RecipeImportSocialPlatform =
  "tiktok" | "instagram" | "facebook" | "youtube" | "pinterest" | "reddit";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export interface RecipeImportSocialPlatformInfo {
  id: RecipeImportSocialPlatform;
  displayName: string;
  icon: IoniconName;
  color: string;
}

const SOCIAL_PLATFORMS: Record<
  RecipeImportSocialPlatform,
  RecipeImportSocialPlatformInfo & { domains: string[] }
> = {
  tiktok: {
    id: "tiktok",
    displayName: "TikTok",
    icon: "logo-tiktok",
    color: "#FE2C55",
    domains: ["tiktok.com"],
  },
  instagram: {
    id: "instagram",
    displayName: "Instagram",
    icon: "logo-instagram",
    color: "#E4405F",
    domains: ["instagram.com", "instagr.am"],
  },
  facebook: {
    id: "facebook",
    displayName: "Facebook",
    icon: "logo-facebook",
    color: "#1877F2",
    domains: [...FACEBOOK_IMPORT_HOSTS],
  },
  youtube: {
    id: "youtube",
    displayName: "YouTube",
    icon: "logo-youtube",
    color: "#FF0000",
    domains: ["youtube.com", "youtu.be"],
  },
  pinterest: {
    id: "pinterest",
    displayName: "Pinterest",
    icon: "logo-pinterest",
    color: "#E60023",
    domains: [...PINTEREST_IMPORT_HOSTS],
  },
  reddit: {
    id: "reddit",
    displayName: "Reddit",
    icon: "logo-reddit",
    color: "#FF4500",
    domains: [...REDDIT_IMPORT_HOSTS],
  },
};

const SOCIAL_PLATFORM_NAMES = Object.values(SOCIAL_PLATFORMS);

function hostnameMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function getRecipeImportSocialPlatform(
  source: string,
): RecipeImportSocialPlatform | null {
  try {
    const hostname = new URL(source).hostname.toLowerCase().replace(/\.$/, "");
    const match = SOCIAL_PLATFORM_NAMES.find((platform) =>
      platform.domains.some((domain) => hostnameMatches(hostname, domain)),
    );

    return match?.id ?? null;
  } catch {
    const normalized = source.trim().toLowerCase();
    const match = SOCIAL_PLATFORM_NAMES.find((platform) =>
      normalized.includes(platform.displayName.toLowerCase()),
    );

    return match?.id ?? null;
  }
}

export function getRecipeImportSocialPlatformInfo(
  platform: RecipeImportSocialPlatform,
): RecipeImportSocialPlatformInfo {
  const info = SOCIAL_PLATFORMS[platform];
  return {
    id: info.id,
    displayName: info.displayName,
    icon: info.icon,
    color: info.color,
  };
}

export function getRecipeImportSourceTitle(source: string) {
  const platform = getRecipeImportSocialPlatform(source);
  if (!platform) return source;

  const info = getRecipeImportSocialPlatformInfo(platform);
  return `Importing recipe from ${info.displayName}`;
}
