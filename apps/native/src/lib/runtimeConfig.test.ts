import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getApiUrl,
  getAuthBaseUrl,
  getImagePublicUrl,
  getPasswordResetUrl,
  shouldShowEmailVerificationAfterSignUp,
} from "./runtimeConfig";

const mocks = vi.hoisted(() => ({
  constants: {
    expoConfig: { hostUri: "192.168.1.20:8081" } as { hostUri?: string } | null,
  },
}));

vi.mock("expo-constants", () => ({ default: mocks.constants }));

describe("native runtime configuration", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    vi.stubEnv("EXPO_PUBLIC_AUTH_BASE_URL", "");
    vi.stubEnv("EXPO_PUBLIC_IMAGE_PUBLIC_URL", "");
    vi.stubEnv("EXPO_PUBLIC_PASSWORD_RESET_URL", "");
    mocks.constants.expoConfig = { hostUri: "192.168.1.20:8081" };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses configured endpoints and removes trailing auth/image slashes", () => {
    vi.stubEnv("EXPO_PUBLIC_AUTH_BASE_URL", "https://auth.example.com///");
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://rpc.example.com/custom");
    vi.stubEnv("EXPO_PUBLIC_IMAGE_PUBLIC_URL", "https://img.example.com//");

    expect(getAuthBaseUrl()).toBe("https://auth.example.com");
    expect(getApiUrl()).toBe("https://rpc.example.com/custom");
    expect(getImagePublicUrl()).toBe("https://img.example.com");
    expect(shouldShowEmailVerificationAfterSignUp()).toBe(true);
  });

  it("derives local API and image endpoints from the Expo development host", () => {
    expect(getAuthBaseUrl()).toBe("http://192.168.1.20:8787");
    expect(getApiUrl()).toBe("http://192.168.1.20:8787/trpc");
    expect(getImagePublicUrl()).toBe("http://192.168.1.20:8789");
    expect(getPasswordResetUrl()).toBe(
      "http://192.168.1.20:4321/reset-password",
    );
    expect(shouldShowEmailVerificationAfterSignUp()).toBe(false);
  });

  it("falls back to localhost when Expo does not provide a host", () => {
    mocks.constants.expoConfig = null;

    expect(getAuthBaseUrl()).toBe("http://localhost:8787");
    expect(getImagePublicUrl()).toBe("http://localhost:8789");
  });

  it("uses production services and requires verification in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(getAuthBaseUrl()).toBe("https://api.cookclub.app");
    expect(getApiUrl()).toBe("https://api.cookclub.app/trpc");
    expect(getImagePublicUrl()).toBe("https://images.cookclub.app");
    expect(getPasswordResetUrl()).toBe("https://cookclub.app/reset-password");
    expect(shouldShowEmailVerificationAfterSignUp()).toBe(true);
  });

  it("uses the production reset page with a production API, or an explicit override", () => {
    vi.stubEnv("EXPO_PUBLIC_AUTH_BASE_URL", "https://api.cookclub.app");
    expect(getPasswordResetUrl()).toBe("https://cookclub.app/reset-password");
    vi.stubEnv(
      "EXPO_PUBLIC_PASSWORD_RESET_URL",
      "https://preview.cookclub.app/reset-password",
    );
    expect(getPasswordResetUrl()).toBe(
      "https://preview.cookclub.app/reset-password",
    );
  });
});
