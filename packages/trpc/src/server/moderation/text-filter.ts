import { checkProfanity, type ProfanityCheckerConfig } from "glin-profanity";

import { PublicTRPCError } from "../public-errors";

const PUBLIC_TEXT_PROFANITY_CONFIG = {
  languages: ["english"],
  detectLeetspeak: true,
  leetspeakLevel: "aggressive",
  normalizeUnicode: true,
  wordBoundaries: true,
} satisfies ProfanityCheckerConfig;

export function normalizePublicText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .trim();
}

export function containsObjectionablePublicText(value: string): boolean {
  return checkProfanity(
    normalizePublicText(value),
    PUBLIC_TEXT_PROFANITY_CONFIG,
  ).containsProfanity;
}

export function filterPublicText(value: string, fieldName: string): string {
  const normalized = normalizePublicText(value);
  if (containsObjectionablePublicText(normalized)) {
    throw new PublicTRPCError({
      code: "BAD_REQUEST",
      appCode: "INVALID_INPUT",
      message: `${fieldName} contains content that cannot be published.`,
    });
  }
  return normalized;
}

export function filterOptionalPublicText(
  value: string | null,
  fieldName: string,
): string | null;
export function filterOptionalPublicText(
  value: string | undefined,
  fieldName: string,
): string | undefined;
export function filterOptionalPublicText(
  value: string | null | undefined,
  fieldName: string,
): string | null | undefined;
export function filterOptionalPublicText(
  value: string | null | undefined,
  fieldName: string,
): string | null | undefined {
  if (value === null || value === undefined) return value;
  return filterPublicText(value, fieldName);
}
