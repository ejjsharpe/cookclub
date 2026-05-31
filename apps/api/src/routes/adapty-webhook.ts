import { getDb } from "@repo/db";
import {
  DEFAULT_PRO_ACCESS_LEVEL_ID,
  processAdaptyWebhookEvent,
  recordAdaptyWebhookEvent,
} from "@repo/db/services";
import type { Hono } from "hono";

import type { Env } from "../types";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const textEncoder = new TextEncoder();

function byteLength(value: string) {
  return textEncoder.encode(value).byteLength;
}

function timingSafeEqualString(a: string, b: string) {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  const length = Math.max(aBytes.byteLength, bBytes.byteLength);

  let diff = aBytes.byteLength ^ bBytes.byteLength;
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }

  return diff === 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function dateValue(value: unknown): Date | null {
  const text = stringValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickString(
  payload: Record<string, unknown>,
  eventProperties: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const direct = stringValue(payload[key]);
    if (direct) return direct;
    const nested = stringValue(eventProperties[key]);
    if (nested) return nested;
  }
  return null;
}

function pickBoolean(
  payload: Record<string, unknown>,
  eventProperties: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const direct = booleanValue(payload[key]);
    if (direct !== null) return direct;
    const nested = booleanValue(eventProperties[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function pickDate(
  payload: Record<string, unknown>,
  eventProperties: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const direct = dateValue(payload[key]);
    if (direct) return direct;
    const nested = dateValue(eventProperties[key]);
    if (nested) return nested;
  }
  return null;
}

export function registerAdaptyWebhookRoutes(app: Hono<{ Bindings: Env }>) {
  app.post("/api/adapty/webhook", async (c) => {
    const expectedAuthorization = c.env.ADAPTY_WEBHOOK_AUTHORIZATION;
    if (!expectedAuthorization) {
      console.error("Adapty webhook rejected: authorization secret is not set");
      return c.json({ error: "Webhook not configured" }, 503);
    }

    const authorization = c.req.header("authorization") ?? "";
    if (!timingSafeEqualString(authorization, expectedAuthorization)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_WEBHOOK_BODY_BYTES
    ) {
      return c.json({ error: "Payload too large" }, 413);
    }

    const text = await c.req.text();
    if (byteLength(text) > MAX_WEBHOOK_BODY_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }

    if (!text.trim()) {
      return c.json({ ok: true });
    }

    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(text));
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const eventProperties = asRecord(payload.event_properties);
    const profile = asRecord(payload.profile);
    const accessLevel = asRecord(payload.access_level);
    const proAccessLevelId =
      c.env.ADAPTY_PRO_ACCESS_LEVEL_ID ?? DEFAULT_PRO_ACCESS_LEVEL_ID;

    const customerUserId =
      pickString(payload, eventProperties, [
        "customer_user_id",
        "customerUserId",
      ]) ?? stringValue(profile.customer_user_id);
    const eventType = pickString(payload, eventProperties, [
      "event_type",
      "eventType",
    ]);
    const profileId =
      pickString(payload, eventProperties, ["profile_id", "profileId"]) ??
      stringValue(profile.profile_id);
    const accessLevelId =
      pickString(payload, eventProperties, [
        "access_level_id",
        "accessLevelId",
        "access_level_identifier",
      ]) ?? stringValue(accessLevel.id);

    const fallbackEventId = [
      profileId,
      customerUserId,
      eventType,
      payload.event_datetime,
    ]
      .filter(Boolean)
      .join(":");
    const pickedEventId = pickString(payload, eventProperties, [
      "event_id",
      "eventId",
      "id",
    ]);
    const eventId = pickedEventId ?? (fallbackEventId || crypto.randomUUID());
    const event = {
      eventId,
      eventType,
      profileId,
      customerUserId,
      payload,
    };

    if (!customerUserId) {
      await recordAdaptyWebhookEvent(getDb(c.env), event);
      return c.json({ ok: true, ignored: true });
    }

    if (accessLevelId && accessLevelId !== proAccessLevelId) {
      await recordAdaptyWebhookEvent(getDb(c.env), event);
      return c.json({ ok: true, ignored: true });
    }

    const expiresAt = pickDate(payload, eventProperties, [
      "expires_at",
      "expiresAt",
      "subscription_expires_at",
    ]);
    const explicitActive = pickBoolean(payload, eventProperties, [
      "is_active",
      "isActive",
    ]);
    const isInactiveEvent = eventType
      ? /expired|refund|revoked|billing_issue|billing issue/i.test(eventType)
      : false;
    const isActive =
      explicitActive ??
      (!isInactiveEvent && (!expiresAt || expiresAt > new Date()));
    const willRenew =
      pickBoolean(payload, eventProperties, ["will_renew", "willRenew"]) ??
      (eventType && /cancel/i.test(eventType) ? false : null);

    const isFirstDelivery = await processAdaptyWebhookEvent(getDb(c.env), {
      event,
      entitlement: {
        userId: customerUserId,
        adaptyCustomerUserId: customerUserId,
        adaptyProfileId: profileId,
        accessLevelId: accessLevelId ?? proAccessLevelId,
        isActive,
        willRenew,
        expiresAt,
        lastEventAt: pickDate(payload, eventProperties, [
          "event_datetime",
          "eventDateTime",
          "event_created_at",
        ]),
      },
    });

    return c.json({ ok: true, ignored: !isFirstDelivery });
  });
}
