import type { PublicErrorCode, PublicErrorDetails } from "@repo/contracts";
import { TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";

const PUBLIC_ERROR_MESSAGES: Record<PublicErrorCode, string> = {
  AUTH_REQUIRED: "Please sign in to continue.",
  ACCESS_DENIED: "You do not have access to do that.",
  NOT_FOUND: "We could not find what you were looking for.",
  INVALID_INPUT: "Please check your input and try again.",
  CONFLICT: "That change conflicts with the current state.",
  PAYLOAD_TOO_LARGE: "That content is too large.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  PRO_REQUIRED: "This feature requires Cook Club Pro.",
  SMART_IMPORT_LIMIT_REACHED:
    "You have used your free Smart Imports for this month.",
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
  IMPORT_FAILED: "Something went wrong while importing. Please try again.",
  SERVICE_UNAVAILABLE:
    "Cook Club is temporarily unavailable. Please try again.",
  UNEXPECTED_ERROR: "Something went wrong. Please try again.",
};

export function getPublicErrorMessage(code: PublicErrorCode): string {
  return PUBLIC_ERROR_MESSAGES[code];
}

export class PublicTRPCError extends TRPCError {
  readonly appCode: PublicErrorCode;
  readonly details: PublicErrorDetails | undefined;

  constructor(options: {
    code: TRPC_ERROR_CODE_KEY;
    appCode: PublicErrorCode;
    message?: string;
    details?: PublicErrorDetails;
    cause?: unknown;
  }) {
    super({
      code: options.code,
      message: options.message ?? getPublicErrorMessage(options.appCode),
      cause: options.cause,
    });
    this.name = "PublicTRPCError";
    this.appCode = options.appCode;
    this.details = sanitizePublicErrorDetails(options.details);
  }
}

function isSafeSourceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function sanitizePublicErrorDetails(
  details: PublicErrorDetails | undefined,
): PublicErrorDetails | undefined {
  if (!isSafeSourceUrl(details?.sourceUrl)) return undefined;
  return { sourceUrl: details.sourceUrl };
}

export function publicCodeForTransport(
  transportCode: TRPC_ERROR_CODE_KEY,
  httpStatus: number,
): PublicErrorCode {
  if (httpStatus >= 502 && httpStatus <= 504) return "SERVICE_UNAVAILABLE";

  switch (transportCode) {
    case "UNAUTHORIZED":
      return "AUTH_REQUIRED";
    case "FORBIDDEN":
      return "ACCESS_DENIED";
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "CONFLICT":
      return "CONFLICT";
    case "PAYLOAD_TOO_LARGE":
      return "PAYLOAD_TOO_LARGE";
    case "TOO_MANY_REQUESTS":
      return "RATE_LIMITED";
    case "BAD_REQUEST":
    case "UNPROCESSABLE_CONTENT":
      return "INVALID_INPUT";
    case "BAD_GATEWAY":
    case "SERVICE_UNAVAILABLE":
    case "GATEWAY_TIMEOUT":
      return "SERVICE_UNAVAILABLE";
    default:
      return httpStatus >= 500 ? "UNEXPECTED_ERROR" : "INVALID_INPUT";
  }
}

export function publicErrorForResponse(
  error: TRPCError,
  httpStatus: number,
): {
  appCode: PublicErrorCode;
  message: string;
  details?: PublicErrorDetails;
} {
  if (error instanceof PublicTRPCError) {
    return {
      appCode: error.appCode,
      message: error.message,
      ...(error.details && { details: error.details }),
    };
  }

  const appCode = publicCodeForTransport(error.code, httpStatus);
  return { appCode, message: getPublicErrorMessage(appCode) };
}
