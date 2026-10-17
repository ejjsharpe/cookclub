import { describe, expect, it } from "vitest";

import { createApp } from "./app";
import { withSafeAuthErrorBody } from "./routes/auth";

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
  it.each(["http://localhost:4321", "https://cookclub.app"])(
    "allows password recovery from %s",
    async (origin) => {
      const response = await createApp().request(
        "http://localhost:8787/auth/reset-password",
        {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
          },
        },
        createEnv() as any,
      );
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    },
  );

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

describe("safe API errors", () => {
  it("redacts Better Auth JSON 5xx responses", async () => {
    const response = await withSafeAuthErrorBody(
      Response.json(
        {
          code: "DATABASE_ERROR",
          message: "relation user does not exist; password=secret",
          stack: "private stack",
        },
        { status: 500 },
      ),
      "request-1",
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "Cook Club is temporarily unavailable. Please try again.",
      requestId: "request-1",
    });
  });

  it("preserves expected Better Auth codes and adds a request id", async () => {
    const response = await withSafeAuthErrorBody(
      Response.json(
        { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid credentials" },
        { status: 401 },
      ),
      "request-2",
    );

    expect(await response.json()).toEqual({
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid credentials",
      requestId: "request-2",
    });
  });

  it("returns a safe rate-limit body with the request id", async () => {
    const response = await createApp().request(
      "http://localhost:8787/api/adapty/webhook",
      { method: "POST" },
      {
        ...createEnv(),
        API_RATE_LIMITER: { limit: async () => ({ success: false }) },
      } as any,
    );

    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(429);
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.message).toBe("Too many requests. Please try again later.");
    expect(body.requestId).toEqual(expect.any(String));
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("redacts unhandled Hono errors", async () => {
    const app = createApp();
    app.get("/test-unhandled-error", () => {
      throw new Error(
        "relation users does not exist; provider=secret; storage=temp/private",
      );
    });

    const response = await app.request(
      "http://localhost:8787/test-unhandled-error",
      {},
      createEnv() as any,
    );
    const body = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      code: "UNEXPECTED_ERROR",
      message: "Something went wrong. Please try again.",
      requestId: expect.any(String),
    });
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
    expect(serialized).not.toContain("relation users");
    expect(serialized).not.toContain("provider=secret");
    expect(serialized).not.toContain("storage=temp/private");
  });
});
