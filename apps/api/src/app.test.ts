import { describe, expect, it } from "vitest";

import { createApp } from "./app";

function createEnv() {
  return {
    BETTER_AUTH_URL: "http://localhost:8787",
    DATABASE_URL: "mock://database",
    BETTER_AUTH_SECRET: "test-secret",
    RESEND_API_KEY: "test-resend",
    IMAGE_PUBLIC_URL: "https://images.example.com",
  };
}

describe("API CORS", () => {
  it("allows credentialed admin preflight requests for tRPC", async () => {
    const response = await createApp().request(
      "http://localhost:8787/trpc/admin.listUsers",
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      },
      createEnv() as any,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });

  it("allows credentialed admin preflight requests for auth", async () => {
    const response = await createApp().request(
      "http://localhost:8787/auth/sign-in/email",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://admin.cookclub.app",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      },
      createEnv() as any,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://admin.cookclub.app",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });
});
