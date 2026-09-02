import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AuthEnv, getAuth } from "./index";

const mocks = vi.hoisted(() => ({
  admin: vi.fn((options) => ({ name: "admin", options })),
  betterAuth: vi.fn(),
  drizzleAdapter: vi.fn(() => ({ adapter: true })),
  expo: vi.fn(() => ({ name: "expo" })),
  getDb: vi.fn(),
  getOrCreateDefaultCollections: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@better-auth/expo", () => ({ expo: mocks.expo }));
vi.mock("@repo/db", () => ({ getDb: mocks.getDb }));
vi.mock("@repo/db/schemas", () => ({ user: { id: "user-schema" } }));
vi.mock("@repo/db/services", () => ({
  getOrCreateDefaultCollections: mocks.getOrCreateDefaultCollections,
}));
vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: mocks.drizzleAdapter,
}));
vi.mock("better-auth/plugins", () => ({ admin: mocks.admin }));
vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: mocks.sendEmail };
  },
}));

type AuthConfig = {
  trustedOrigins: string[];
  session: {
    expiresIn: number;
  };
  emailAndPassword: {
    requireEmailVerification: boolean;
  };
  emailVerification: {
    sendOnSignUp: boolean;
    sendVerificationEmail(input: {
      user: { name: string; email: string };
      url: string;
    }): Promise<unknown>;
  };
  user: {
    changeEmail: {
      sendChangeEmailConfirmation(input: {
        user: { name: string };
        newEmail: string;
        url: string;
      }): Promise<unknown>;
    };
  };
  databaseHooks: {
    user: { create: { after(user: { id: string }): Promise<void> } };
  };
  socialProviders: Record<
    string,
    {
      redirectURI: string;
      appBundleIdentifier?: string;
      mapProfileToUser?(profile: { sub: string; email?: string | null }): {
        email: string;
      };
    }
  >;
  onAPIError: { onError(error: unknown): void };
};

const db = { name: "db" };
const baseEnv: AuthEnv = {
  DATABASE_URL: "postgres://test",
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "http://localhost:8787/",
  RESEND_API_KEY: "resend-key",
};

function captureConfig(
  env: AuthEnv = baseEnv,
  runtime?: { requestId?: string; route?: string },
) {
  getAuth(env, runtime);
  return mocks.betterAuth.mock.calls.at(-1)?.[0] as AuthConfig;
}

describe("auth configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
    mocks.betterAuth.mockReturnValue({ api: {} });
    mocks.sendEmail.mockResolvedValue({ error: null });
  });

  it("skips email verification locally but requires it for deployed hosts", () => {
    const local = captureConfig();
    const deployed = captureConfig({
      ...baseEnv,
      BETTER_AUTH_URL: "https://api.cookclub.app",
    });

    expect(local.emailAndPassword.requireEmailVerification).toBe(false);
    expect(local.emailVerification.sendOnSignUp).toBe(false);
    expect(deployed.emailAndPassword.requireEmailVerification).toBe(true);
    expect(deployed.emailVerification.sendOnSignUp).toBe(true);
  });

  it("keeps sessions valid for 30 days", () => {
    const config = captureConfig();

    expect(config.session.expiresIn).toBe(60 * 60 * 24 * 30);
  });

  it("deduplicates configured origins and builds provider callbacks", () => {
    const config = captureConfig({
      ...baseEnv,
      BETTER_AUTH_URL: "https://api.example.com/",
      TRUSTED_ORIGINS:
        "https://extra.example.com, https://extra.example.com,  ",
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      APPLE_CLIENT_ID: "apple-id",
      APPLE_CLIENT_SECRET: "apple-secret",
      APPLE_BUNDLE_IDENTIFIER: "app.cookclub",
    });

    expect(
      config.trustedOrigins.filter(
        (origin) => origin === "https://extra.example.com",
      ),
    ).toHaveLength(1);
    expect(config.socialProviders.google?.redirectURI).toBe(
      "https://api.example.com/auth/callback/google",
    );
    expect(config.socialProviders.apple).toMatchObject({
      redirectURI: "https://api.example.com/auth/callback/apple",
      appBundleIdentifier: "app.cookclub",
    });
  });

  it("supplies Apple's placeholder email only when Apple omits one", () => {
    const config = captureConfig({
      ...baseEnv,
      APPLE_CLIENT_ID: "apple-id",
      APPLE_CLIENT_SECRET: "apple-secret",
    });
    const mapProfile = config.socialProviders.apple?.mapProfileToUser;

    expect(
      mapProfile?.({ sub: "apple-user", email: "real@example.com" }),
    ).toEqual({ email: "real@example.com" });
    expect(mapProfile?.({ sub: "apple-user", email: null })).toEqual({
      email: "apple-user@apple.placeholder.local",
    });
  });

  it("creates default collections after a user is created", async () => {
    const config = captureConfig();

    await config.databaseHooks.user.create.after({ id: "user-1" });

    expect(mocks.getOrCreateDefaultCollections).toHaveBeenCalledWith(
      db,
      "user-1",
    );
  });
});

describe("auth emails and error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
    mocks.betterAuth.mockReturnValue({ api: {} });
    mocks.sendEmail.mockResolvedValue({ error: null });
  });

  it("escapes user-controlled names and links in verification email HTML", async () => {
    const config = captureConfig();

    await config.emailVerification.sendVerificationEmail({
      user: { name: `<Chef & "Friend">`, email: "chef@example.com" },
      url: `https://api.example.com/verify?a=1&next="profile"`,
    });

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Cook Club <noreply@cookclub.app>",
        replyTo: "help@cookclub.app",
        to: "chef@example.com",
        html: expect.stringContaining("&lt;Chef &amp; &quot;Friend&quot;&gt;"),
      }),
    );
    const html = mocks.sendEmail.mock.calls[0]?.[0]?.html as string;
    expect(html).toContain("a=1&amp;next=&quot;profile&quot;");
    expect(html).not.toContain(`<Chef & "Friend">`);
  });

  it("sends change-email confirmation to the new address", async () => {
    const config = captureConfig();

    await config.user.changeEmail.sendChangeEmailConfirmation({
      user: { name: "Chef" },
      newEmail: "new@example.com",
      url: "https://api.example.com/change-email",
    });

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new@example.com",
        subject: "Verify your new email - Cook Club",
      }),
    );
  });

  it("turns provider failures into a stable internal error", async () => {
    mocks.sendEmail.mockResolvedValue({
      error: { message: "provider detail" },
    });
    const config = captureConfig();

    await expect(
      config.emailVerification.sendVerificationEmail({
        user: { name: "Chef", email: "chef@example.com" },
        url: "https://api.example.com/verify",
      }),
    ).rejects.toThrow("Email provider request failed");
  });

  it("logs unexpected server errors with request metadata but ignores 4xx", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const config = captureConfig(baseEnv, {
      requestId: "request-1",
      route: "auth/sign-in",
    });

    config.onAPIError.onError({ statusCode: 401 });
    expect(errorSpy).not.toHaveBeenCalled();

    config.onAPIError.onError(new Error("database unavailable"));
    const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(payload).toMatchObject({
      requestId: "request-1",
      route: "auth/sign-in",
      status: 500,
      publicCode: "SERVICE_UNAVAILABLE",
    });
    expect(payload.errorStack).toContain("database unavailable");

    errorSpy.mockRestore();
  });
});
