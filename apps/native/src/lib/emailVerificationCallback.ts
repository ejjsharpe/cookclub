import { getSetCookie, hasBetterAuthCookies } from "@better-auth/expo/client";

import { storage } from "./mmkv";

const AUTH_COOKIE_STORAGE_KEY = "cookclub_cookie";
const AUTH_COOKIE_PREFIX = "better-auth";
const APP_SCHEME = "cookclub:";
const EMAIL_VERIFICATION_CALLBACK_HOST = "email-verification";

export const EMAIL_VERIFICATION_CALLBACK_URL = "cookclub://email-verification";

export type EmailVerificationCallbackResult =
  | { handled: false }
  | { handled: true; status: "authenticated" }
  | {
      handled: true;
      status: "verified-without-session";
      message: string;
    }
  | { handled: true; status: "error"; message: string };

const getVerificationErrorMessage = (code: string): string => {
  switch (code.toUpperCase()) {
    case "TOKEN_EXPIRED":
      return "This verification link has expired. Please request a new one.";
    case "INVALID_TOKEN":
      return "This verification link is invalid. Please request a new one.";
    case "USER_NOT_FOUND":
      return "We couldn't find the account for this verification link.";
    default:
      return "We couldn't verify your email. Please request a new link and try again.";
  }
};

const isEmailVerificationCallback = (url: URL): boolean => {
  if (url.protocol !== APP_SCHEME) return false;

  const callbackPath = url.pathname.replace(/^\/+|\/+$/g, "");
  return (
    url.hostname === EMAIL_VERIFICATION_CALLBACK_HOST ||
    callbackPath === EMAIL_VERIFICATION_CALLBACK_HOST
  );
};

export const consumeEmailVerificationCallback = (
  callbackUrl: string,
): EmailVerificationCallbackResult => {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return { handled: false };
  }

  if (!isEmailVerificationCallback(url)) return { handled: false };

  const errorCode = url.searchParams.get("error");
  if (errorCode) {
    return {
      handled: true,
      status: "error",
      message: getVerificationErrorMessage(errorCode),
    };
  }

  const setCookie = url.searchParams.get("cookie");
  if (!setCookie) {
    return {
      handled: true,
      status: "verified-without-session",
      message: "Your email is verified. Please sign in to continue.",
    };
  }

  if (!hasBetterAuthCookies(setCookie, AUTH_COOKIE_PREFIX)) {
    return {
      handled: true,
      status: "error",
      message: "We couldn't finish signing you in. Please sign in to continue.",
    };
  }

  const previousCookie = storage.getString(AUTH_COOKIE_STORAGE_KEY);
  const nextCookie = getSetCookie(setCookie, previousCookie);
  storage.set(AUTH_COOKIE_STORAGE_KEY, nextCookie);

  return { handled: true, status: "authenticated" };
};
