import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuth } from "./index";

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, Record<string, unknown>[]>,
  sendEmail: vi.fn(),
}));

vi.mock("@repo/db", () => ({ getDb: () => ({}) }));
vi.mock("@repo/db/services", () => ({
  getOrCreateDefaultCollections: vi.fn(),
}));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter(mocks.data) };
});
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.sendEmail };
  },
}));

const baseURL = "http://localhost:8787";
const email = "recovery@example.com";
const oldPassword = "Original-test-password-1";
const newPassword = "Replacement-test-password-2";

async function createAuth() {
  const auth = getAuth({
    DATABASE_URL: "mock://database",
    BETTER_AUTH_URL: baseURL,
    BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
    RESEND_API_KEY: "test-only",
  });
  // Better Auth disables origin validation under NODE_ENV=test by default.
  // Exercise the production behavior, including rejected redirect URLs.
  (await auth.$context).skipOriginCheck = false;
  return auth;
}

async function post(
  auth: ReturnType<typeof getAuth>,
  path: string,
  body: unknown,
) {
  return auth.handler(
    new Request(`${baseURL}/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:4321",
      },
      body: JSON.stringify(body),
    }),
  );
}

function emailedToken() {
  const html = mocks.sendEmail.mock.calls.at(-1)?.[0]?.html as string;
  const href = html.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  if (!href) throw new Error("Reset email did not contain a link");
  const link = new URL(href);
  expect(link.searchParams.has("token")).toBe(false);
  const token = new URLSearchParams(link.hash.slice(1)).get("token");
  expect(token).toBeTruthy();
  return { token, link };
}

describe("password recovery through the real Better Auth endpoints", () => {
  beforeEach(() => {
    mocks.data = { user: [], account: [], session: [], verification: [] };
    mocks.sendEmail.mockReset().mockResolvedValue({ error: null });
  });

  it.each(["user", "admin"])(
    "resets a %s password, preserves the role, revokes sessions and consumes the link",
    async (role) => {
      const auth = await createAuth();
      expect(
        (
          await post(auth, "sign-up/email", {
            email,
            password: oldPassword,
            name: "Test Cook",
          })
        ).status,
      ).toBe(200);
      mocks.data.user![0]!.role = role;
      expect(mocks.data.session!.length).toBeGreaterThan(0);

      const request = await post(auth, "request-password-reset", {
        email,
        redirectTo: `http://localhost:4321/reset-password${role === "admin" ? "?source=admin" : ""}`,
      });
      expect(request.status).toBe(200);
      expect(mocks.sendEmail).toHaveBeenCalledOnce();
      const { token, link } = emailedToken();
      expect(link.origin).toBe("http://localhost:4321");
      expect(link.pathname).toBe("/reset-password");
      expect(link.searchParams.get("source")).toBe(
        role === "admin" ? "admin" : null,
      );

      expect(
        (await post(auth, "reset-password", { token, newPassword })).status,
      ).toBe(200);
      expect(mocks.data.user![0]!.role).toBe(role);
      expect(mocks.data.session).toHaveLength(0);
      expect(
        (await post(auth, "sign-in/email", { email, password: oldPassword }))
          .status,
      ).toBe(401);
      expect(
        (await post(auth, "sign-in/email", { email, password: newPassword }))
          .status,
      ).toBe(200);
      const reused = await post(auth, "reset-password", {
        token,
        newPassword: oldPassword,
      });
      expect(reused.status).toBe(400);
      expect(await reused.json()).toMatchObject({ code: "INVALID_TOKEN" });
    },
  );

  it("returns the same response for registered and unknown emails", async () => {
    const auth = await createAuth();
    await post(auth, "sign-up/email", {
      email,
      password: oldPassword,
      name: "Test Cook",
    });
    const known = await post(auth, "request-password-reset", {
      email,
      redirectTo: "http://localhost:4321/reset-password",
    });
    const unknown = await post(auth, "request-password-reset", {
      email: "unknown@example.com",
      redirectTo: "http://localhost:4321/reset-password",
    });
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });

  it.each([undefined, "/reset-password?source=admin"])(
    "sends a usable link with the default web origin for redirect %s",
    async (redirectTo) => {
      const auth = await createAuth();
      await post(auth, "sign-up/email", {
        email,
        password: oldPassword,
        name: "Test Cook",
      });

      const response = await post(auth, "request-password-reset", {
        email,
        redirectTo,
      });
      expect(response.status).toBe(200);
      expect(mocks.sendEmail).toHaveBeenCalledOnce();
      const { token, link } = emailedToken();
      expect(link.origin).toBe("https://cookclub.app");
      expect(link.pathname).toBe("/reset-password");
      expect(link.searchParams.get("source")).toBe(redirectTo ? "admin" : null);
      expect(
        (await post(auth, "reset-password", { token, newPassword })).status,
      ).toBe(200);
    },
  );

  it("rejects expired and invalid links without changing the password", async () => {
    const auth = await createAuth();
    await post(auth, "sign-up/email", {
      email,
      password: oldPassword,
      name: "Test Cook",
    });
    await post(auth, "request-password-reset", {
      email,
      redirectTo: "http://localhost:4321/reset-password",
    });
    const { token } = emailedToken();
    const verification = mocks.data.verification!.find((row) =>
      String(row.identifier).startsWith("reset-password:"),
    )!;
    verification.expiresAt = new Date(Date.now() - 1000);
    for (const badToken of [token, "not-a-real-token"]) {
      const response = await post(auth, "reset-password", {
        token: badToken,
        newPassword,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_TOKEN" });
    }
    expect(
      (await post(auth, "sign-in/email", { email, password: oldPassword }))
        .status,
    ).toBe(200);
  });

  it("rejects weak passwords without consuming the link and disallows untrusted redirects", async () => {
    const auth = await createAuth();
    await post(auth, "sign-up/email", {
      email,
      password: oldPassword,
      name: "Test Cook",
    });
    const untrusted = await post(auth, "request-password-reset", {
      email,
      redirectTo: "https://untrusted.example/reset",
    });
    expect(untrusted.status).toBe(403);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    await post(auth, "request-password-reset", {
      email,
      redirectTo: "http://localhost:4321/reset-password",
    });
    const { token } = emailedToken();
    const weak = await post(auth, "reset-password", {
      token,
      newPassword: "short",
    });
    expect(weak.status).toBe(400);
    expect(await weak.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    expect(
      (await post(auth, "reset-password", { token, newPassword })).status,
    ).toBe(200);
  });
});
