import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isAppleSignInCancellation,
  requestAppleSignIn,
} from "./appleAuthentication";

const mocks = vi.hoisted(() => ({
  randomUUID: vi.fn(() => "81d7ca21-0d85-4a9d-a52a-a561696bc15e"),
  signInAsync: vi.fn(),
}));

vi.mock("expo-apple-authentication", () => ({
  AppleAuthenticationScope: {
    FULL_NAME: 0,
    EMAIL: 1,
  },
  signInAsync: mocks.signInAsync,
}));

vi.mock("expo-crypto", () => ({
  randomUUID: mocks.randomUUID,
}));

describe("requestAppleSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an Apple ID token with its nonce and first-login profile", async () => {
    mocks.signInAsync.mockResolvedValue({
      identityToken: "apple-id-token",
      email: "cook@privaterelay.appleid.com",
      fullName: {
        givenName: "Cook",
        familyName: "Club",
      },
    });

    await expect(requestAppleSignIn()).resolves.toEqual({
      token: "apple-id-token",
      nonce: "81d7ca21-0d85-4a9d-a52a-a561696bc15e",
      user: {
        name: {
          firstName: "Cook",
          lastName: "Club",
        },
        email: "cook@privaterelay.appleid.com",
      },
    });
    expect(mocks.signInAsync).toHaveBeenCalledWith({
      nonce: "81d7ca21-0d85-4a9d-a52a-a561696bc15e",
      requestedScopes: [0, 1],
    });
  });

  it("supports repeat sign-ins where Apple omits profile fields", async () => {
    mocks.signInAsync.mockResolvedValue({
      identityToken: "repeat-apple-id-token",
      email: null,
      fullName: null,
    });

    await expect(requestAppleSignIn()).resolves.toEqual({
      token: "repeat-apple-id-token",
      nonce: "81d7ca21-0d85-4a9d-a52a-a561696bc15e",
    });
  });

  it("rejects a response without an identity token", async () => {
    mocks.signInAsync.mockResolvedValue({
      identityToken: null,
      email: null,
      fullName: null,
    });

    await expect(requestAppleSignIn()).rejects.toThrow(
      "Apple did not return an identity token.",
    );
  });
});

describe("isAppleSignInCancellation", () => {
  it("recognizes only Apple's cancellation error", () => {
    expect(
      isAppleSignInCancellation(
        Object.assign(new Error("cancelled"), {
          code: "ERR_REQUEST_CANCELED",
        }),
      ),
    ).toBe(true);
    expect(isAppleSignInCancellation(new Error("failed"))).toBe(false);
  });
});
