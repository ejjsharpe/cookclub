import { describe, expect, it } from "vitest";

import {
  getEmailError,
  getSignUpPasswordError,
  getSignInPasswordError,
} from "./sign-up-validation";

describe("signup validation", () => {
  it("requires a valid email address", () => {
    expect(getEmailError("   ")).toBe("Enter your email address.");
    expect(getEmailError("gordon@superchef")).toBe(
      "Enter a valid email address.",
    );
    expect(getEmailError(" gordon@superchef.com ")).toBeUndefined();
  });

  it("requires a password between 8 and 128 characters", () => {
    expect(getSignUpPasswordError("")).toBe("Enter a password.");
    expect(getSignUpPasswordError("1234567")).toBe("Minimum 8 characters.");
    expect(getSignUpPasswordError("12345678")).toBeUndefined();
    expect(getSignUpPasswordError("a".repeat(129))).toBe(
      "Maximum 128 characters.",
    );
  });

  it("requires a password when signing in", () => {
    expect(getSignInPasswordError("")).toBe("Enter your password.");
    expect(getSignInPasswordError("any-existing-password")).toBeUndefined();
  });
});
