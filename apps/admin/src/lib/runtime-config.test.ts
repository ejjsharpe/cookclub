import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getApiBaseUrl, getTrpcUrl } from "./runtime-config";

describe("admin runtime configuration", () => {
  beforeEach(() => {
    vi.stubEnv("PROD", false);
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_TRPC_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses configured endpoints and trims the API base URL", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com///");
    vi.stubEnv("VITE_TRPC_URL", "https://rpc.example.com/custom");

    expect(getApiBaseUrl()).toBe("https://api.example.com");
    expect(getTrpcUrl()).toBe("https://rpc.example.com/custom");
  });

  it("uses the local API and derived tRPC endpoint during development", () => {
    expect(getApiBaseUrl()).toBe("http://localhost:8787");
    expect(getTrpcUrl()).toBe("http://localhost:8787/trpc");
  });

  it("uses the production API when no endpoint override is configured", () => {
    vi.stubEnv("PROD", true);

    expect(getApiBaseUrl()).toBe("https://api.cookclub.app");
    expect(getTrpcUrl()).toBe("https://api.cookclub.app/trpc");
  });
});
