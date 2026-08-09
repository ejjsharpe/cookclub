import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
  getDb: vi.fn(),
  recordAdaptyWebhookEvent: vi.fn(),
  processAdaptyWebhookEvent: vi.fn(),
}));

vi.mock("@repo/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@repo/db/services", () => ({
  DEFAULT_PRO_ACCESS_LEVEL_ID: "premium",
  recordAdaptyWebhookEvent: mocks.recordAdaptyWebhookEvent,
  processAdaptyWebhookEvent: mocks.processAdaptyWebhookEvent,
}));

// eslint-disable-next-line import/first
import { registerAdaptyWebhookRoutes } from "./adapty-webhook";

function createApp() {
  const app = new Hono();
  registerAdaptyWebhookRoutes(app as never);
  return app;
}

function request(
  body: BodyInit | null,
  env: Record<string, unknown> = {},
  headers: HeadersInit = {},
) {
  return createApp().request(
    "https://api.example.com/api/adapty/webhook",
    {
      method: "POST",
      body,
      headers: {
        authorization: "Bearer webhook-secret",
        ...headers,
      },
    },
    {
      ADAPTY_WEBHOOK_AUTHORIZATION: "Bearer webhook-secret",
      ADAPTY_PRO_ACCESS_LEVEL_ID: "pro",
      ...env,
    } as never,
  );
}

describe("Adapty webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(mocks.db);
    mocks.recordAdaptyWebhookEvent.mockResolvedValue(undefined);
    mocks.processAdaptyWebhookEvent.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed when the secret is missing or does not match", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const unconfigured = await request("{}", {
      ADAPTY_WEBHOOK_AUTHORIZATION: "",
    });
    const unauthorized = await request(
      "{}",
      {},
      {
        authorization: "Bearer wrong-secret",
      },
    );

    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toEqual({
      error: "Webhook not configured",
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });
    expect(consoleSpy).toHaveBeenCalledWith(
      "Adapty webhook rejected: authorization secret is not set",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects oversized declared bodies and invalid JSON before database work", async () => {
    const oversized = await request(
      "{}",
      {},
      {
        "content-length": String(256 * 1024 + 1),
      },
    );
    const invalid = await request("{not-json");

    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "Payload too large" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid JSON" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("enforces the byte limit after reading when Content-Length is unavailable", async () => {
    const response = await request("😀".repeat(65_537));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Payload too large" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("accepts empty keepalive deliveries without database work", async () => {
    const response = await request("   ");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("records and ignores events that cannot map to a user", async () => {
    const response = await request(
      JSON.stringify({
        event_id: "event-1",
        event_type: "subscription_started",
      }),
    );

    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(mocks.recordAdaptyWebhookEvent).toHaveBeenCalledWith(mocks.db, {
      eventId: "event-1",
      eventType: "subscription_started",
      profileId: null,
      customerUserId: null,
      payload: {
        event_id: "event-1",
        event_type: "subscription_started",
      },
    });
    expect(mocks.processAdaptyWebhookEvent).not.toHaveBeenCalled();
  });

  it("records and ignores unrelated access levels", async () => {
    const response = await request(
      JSON.stringify({
        event_id: "event-2",
        customer_user_id: "user-1",
        access_level_id: "free",
      }),
    );

    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(mocks.recordAdaptyWebhookEvent).toHaveBeenCalledOnce();
    expect(mocks.processAdaptyWebhookEvent).not.toHaveBeenCalled();
  });

  it("normalizes nested aliases and entitlement state for processing", async () => {
    mocks.processAdaptyWebhookEvent.mockResolvedValue(false);
    const response = await request(
      JSON.stringify({
        event_datetime: "2026-08-09T12:00:00.000Z",
        event_properties: {
          customerUserId: " user-1 ",
          eventType: "subscription_cancelled",
          accessLevelId: "pro",
          expiresAt: "2026-09-01T00:00:00.000Z",
          isActive: true,
        },
        profile: { profile_id: "profile-1" },
      }),
    );

    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(mocks.processAdaptyWebhookEvent).toHaveBeenCalledWith(mocks.db, {
      event: {
        eventId:
          "profile-1:user-1:subscription_cancelled:2026-08-09T12:00:00.000Z",
        eventType: "subscription_cancelled",
        profileId: "profile-1",
        customerUserId: "user-1",
        payload: expect.any(Object),
      },
      entitlement: {
        userId: "user-1",
        adaptyCustomerUserId: "user-1",
        adaptyProfileId: "profile-1",
        accessLevelId: "pro",
        isActive: true,
        willRenew: false,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        lastEventAt: new Date("2026-08-09T12:00:00.000Z"),
      },
    });
  });

  it("marks expiry events inactive even when no explicit flag is supplied", async () => {
    const response = await request(
      JSON.stringify({
        event_id: "event-expired",
        event_type: "subscription_expired",
        customer_user_id: "user-1",
        access_level_id: "pro",
      }),
    );

    expect(await response.json()).toEqual({ ok: true, ignored: false });
    expect(mocks.processAdaptyWebhookEvent).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        entitlement: expect.objectContaining({
          isActive: false,
          willRenew: null,
        }),
      }),
    );
  });
});
