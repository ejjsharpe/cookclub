import { PUBLIC_ERROR_CODES, type PublicErrorCode } from "@repo/contracts";

export interface ResolvedPublicError {
  code: PublicErrorCode | AuthErrorCode;
  message: string;
  requestId?: string;
}

export type AuthErrorCode =
  | "INVALID_EMAIL_OR_PASSWORD"
  | "EMAIL_NOT_VERIFIED"
  | "USER_ALREADY_EXISTS"
  | "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "INVALID_PASSWORD"
  | "EMAIL_ALREADY_VERIFIED"
  | "SESSION_NOT_FRESH";

const publicCodes = new Set<string>(PUBLIC_ERROR_CODES);

const fixedMessages: Partial<Record<PublicErrorCode, string>> = {
  AUTH_REQUIRED: "Please sign in to continue.",
  ACCESS_DENIED: "You do not have access to do that.",
  PAYLOAD_TOO_LARGE: "That content is too large.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  TERMS_ACCEPTANCE_REQUIRED:
    "Review and accept the current Terms of Service in Settings to continue.",
  PRO_REQUIRED: "This feature requires Cook Club Pro.",
  SMART_IMPORT_LIMIT_REACHED:
    "You have used your free Smart Imports for this month. Upgrade to Cook Club Pro for unlimited Smart Imports.",
  IMPORT_ACTIVE_LIMIT_REACHED:
    "You can have up to five imports in progress at once.",
  EXTERNAL_RECIPE_SOURCE:
    "This recipe can only be viewed on the original source website.",
  IMPORT_INVALID_URL: "Enter a valid recipe URL and try again.",
  IMPORT_UNSUPPORTED_SOURCE: "This recipe source is not supported.",
  IMPORT_SOURCE_UNAVAILABLE:
    "The recipe source is unavailable. Please try again later.",
  IMPORT_RECIPE_NOT_FOUND: "We could not find a recipe at that source.",
  IMPORT_IMAGE_INVALID: "Choose a valid recipe image and try again.",
  IMPORT_TIMED_OUT: "The import timed out. Please try again.",
  SERVICE_UNAVAILABLE:
    "Cook Club is temporarily unavailable. Please try again.",
};

const authMessages: Record<AuthErrorCode, string> = {
  INVALID_EMAIL_OR_PASSWORD: "The email or password is incorrect.",
  EMAIL_NOT_VERIFIED: "Please verify your email before signing in.",
  USER_ALREADY_EXISTS:
    "An account with this email already exists. Please sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Please sign in instead.",
  PASSWORD_TOO_SHORT: "Choose a longer password and try again.",
  PASSWORD_TOO_LONG: "Choose a shorter password and try again.",
  INVALID_PASSWORD: "The password is incorrect.",
  EMAIL_ALREADY_VERIFIED: "This email address is already verified.",
  SESSION_NOT_FRESH: "Please sign in again to continue.",
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function resolvePublicError(
  error: unknown,
  fallback: string,
): ResolvedPublicError {
  const root = record(error);
  const data = record(root?.data);
  const body = record(root?.body);
  const response = record(record(root?.meta)?.response);
  const requestId =
    stringValue(data?.requestId) ??
    stringValue(root?.requestId) ??
    stringValue(body?.requestId);
  const status =
    numberValue(root?.status) ??
    numberValue(data?.httpStatus) ??
    numberValue(response?.status);
  const candidateCode =
    stringValue(data?.appCode) ??
    stringValue(root?.appCode) ??
    stringValue(body?.code) ??
    stringValue(root?.code);
  const transportCode = stringValue(data?.code);

  if (candidateCode && Object.hasOwn(authMessages, candidateCode)) {
    const code = candidateCode as AuthErrorCode;
    return {
      code,
      message: authMessages[code],
      ...(requestId && { requestId }),
    };
  }

  let code: PublicErrorCode;
  if (candidateCode && publicCodes.has(candidateCode)) {
    code = candidateCode as PublicErrorCode;
  } else if (transportCode === "UNAUTHORIZED") {
    code = "AUTH_REQUIRED";
  } else if (transportCode === "FORBIDDEN") {
    code = "ACCESS_DENIED";
  } else if (transportCode === "NOT_FOUND") {
    code = "NOT_FOUND";
  } else if (transportCode === "CONFLICT") {
    code = "CONFLICT";
  } else if (transportCode === "PAYLOAD_TOO_LARGE") {
    code = "PAYLOAD_TOO_LARGE";
  } else if (transportCode === "TOO_MANY_REQUESTS") {
    code = "RATE_LIMITED";
  } else if (
    transportCode === "BAD_GATEWAY" ||
    transportCode === "SERVICE_UNAVAILABLE" ||
    transportCode === "GATEWAY_TIMEOUT"
  ) {
    code = "SERVICE_UNAVAILABLE";
  } else if (
    transportCode === "BAD_REQUEST" ||
    transportCode === "UNPROCESSABLE_CONTENT"
  ) {
    code = "INVALID_INPUT";
  } else if (status === 401) {
    code = "AUTH_REQUIRED";
  } else if (status === 403) {
    code = "ACCESS_DENIED";
  } else if (status === 404) {
    code = "NOT_FOUND";
  } else if (status === 409) {
    code = "CONFLICT";
  } else if (status === 413) {
    code = "PAYLOAD_TOO_LARGE";
  } else if (status === 429) {
    code = "RATE_LIMITED";
  } else if (status !== undefined && status >= 400 && status < 500) {
    code = "INVALID_INPUT";
  } else if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 0 ||
    root?.name === "TypeError"
  ) {
    code = "SERVICE_UNAVAILABLE";
  } else {
    code = "UNEXPECTED_ERROR";
  }

  const message = fixedMessages[code] ?? fallback;
  return { code, message, ...(requestId && { requestId }) };
}

export function publicErrorDetails(error: unknown): { sourceUrl?: string } {
  const data = record(record(error)?.data);
  const details = record(data?.details);
  const sourceUrl = stringValue(details?.sourceUrl);
  if (!sourceUrl) return {};
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? { sourceUrl }
      : {};
  } catch {
    return {};
  }
}
