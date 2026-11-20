import type { ShareIntent } from "expo-share-intent";

import { MIN_RECIPE_TEXT_LENGTH, URL_PATTERN } from "../lib/recipeImportSource";

export type DetectedShareIntent = {
  type: "url" | "text" | "image";
  content: string;
  mimeType?: string;
};

export function detectPendingShareIntent(
  intent: ShareIntent | null,
): DetectedShareIntent | null {
  if (intent?.webUrl) {
    return { type: "url", content: intent.webUrl };
  }

  const file = intent?.files?.[0];
  if (file?.mimeType?.startsWith("image/")) {
    return {
      type: "image",
      content: file.path,
      mimeType: file.mimeType,
    };
  }

  if (!intent?.text) return null;

  const [url] = intent.text.match(URL_PATTERN) ?? [];
  if (url) {
    return { type: "url", content: url };
  }

  if (intent.text.length >= MIN_RECIPE_TEXT_LENGTH) {
    return { type: "text", content: intent.text };
  }

  return null;
}
