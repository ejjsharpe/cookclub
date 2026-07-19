import type { ShareIntent } from "expo-share-intent";

import type { PendingShareIntent } from "@/lib/pendingShareIntent";

const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;
const MIN_RECIPE_TEXT_LENGTH = 50;

export function detectPendingShareIntent(
  intent: ShareIntent | null,
): PendingShareIntent | null {
  const timestamp = Date.now();

  if (intent?.webUrl) {
    return { type: "url", content: intent.webUrl, timestamp };
  }

  const file = intent?.files?.[0];
  if (file?.mimeType?.startsWith("image/")) {
    return {
      type: "image",
      content: file.path,
      mimeType: file.mimeType,
      timestamp,
    };
  }

  if (!intent?.text) return null;

  const urlMatch = intent.text.match(URL_PATTERN);
  if (urlMatch) {
    return { type: "url", content: urlMatch[0], timestamp };
  }

  if (intent.text.length >= MIN_RECIPE_TEXT_LENGTH) {
    return { type: "text", content: intent.text, timestamp };
  }

  return null;
}
