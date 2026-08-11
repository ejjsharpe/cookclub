import { beforeEach, describe, expect, it, vi } from "vitest";

import { consumeEmailVerificationCallback } from "./emailVerificationCallback";

const mocks = vi.hoisted(() => ({
  getSetCookie: vi.fn(),
  hasBetterAuthCookies: vi.fn(),
  getString: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@better-auth/expo/client", () => ({
  getSetCookie: mocks.getSetCookie,
  hasBetterAuthCookies: mocks.hasBetterAuthCookies,
}));

vi.mock("./mmkv", () => ({
  storage: {
    getString: mocks.getString,
    set: mocks.set,
  },
}));

describe("consumeEmailVerificationCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasBetterAuthCookies.mockReturnValue(true);
    mocks.getSetCookie.mockReturnValue('{"better-auth.session_token":{}}');
  });

  it("persists the session cookie from the verification redirect", () => {
    const setCookie =
      "__Secure-better-auth.session_token=session-token; Path=/; HttpOnly";
    mocks.getString.mockReturnValue('{"existing":{}}');

    const result = consumeEmailVerificationCallback(
      `cookclub://email-verification?cookie=${encodeURIComponent(setCookie)}`,
    );

    expect(result).toEqual({ handled: true, status: "authenticated" });
    expect(mocks.hasBetterAuthCookies).toHaveBeenCalledWith(
      setCookie,
      "better-auth",
    );
    expect(mocks.getSetCookie).toHaveBeenCalledWith(
      setCookie,
      '{"existing":{}}',
    );
    expect(mocks.set).toHaveBeenCalledWith(
      "cookclub_cookie",
      '{"better-auth.session_token":{}}',
    );
  });

  it("returns a useful error for an expired verification link", () => {
    const result = consumeEmailVerificationCallback(
      "cookclub://email-verification?error=TOKEN_EXPIRED",
    );

    expect(result).toEqual({
      handled: true,
      status: "error",
      message: "This verification link has expired. Please request a new one.",
    });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("does not persist a callback without an auth session cookie", () => {
    mocks.hasBetterAuthCookies.mockReturnValue(false);

    const result = consumeEmailVerificationCallback(
      `cookclub://email-verification?cookie=${encodeURIComponent("unrelated=value")}`,
    );

    expect(result).toEqual({
      handled: true,
      status: "error",
      message: "We couldn't finish signing you in. Please sign in to continue.",
    });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("asks an already-verified user to sign in when no session is returned", () => {
    const result = consumeEmailVerificationCallback(
      "cookclub://email-verification",
    );

    expect(result).toEqual({
      handled: true,
      status: "verified-without-session",
      message: "Your email is verified. Please sign in to continue.",
    });
  });

  it("ignores non-verification deep links", () => {
    const result = consumeEmailVerificationCallback(
      "cookclub://activity/123?cookie=not-an-auth-callback",
    );

    expect(result).toEqual({ handled: false });
    expect(mocks.hasBetterAuthCookies).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
