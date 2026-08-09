import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeSmartImportAllowance,
  getCurrentSubscriptionStatus,
  refreshAdaptyEntitlement,
  requirePro,
} from "./subscription.service";

const dbMocks = vi.hoisted(() => ({
  consumeSmartImportUsage: vi.fn(),
  getSubscriptionStatus: vi.fn(),
  upsertSubscriptionEntitlement: vi.fn(),
}));

vi.mock("@repo/db/services", () => ({
  DEFAULT_PRO_ACCESS_LEVEL_ID: "pro",
  ...dbMocks,
}));

const freeStatus = {
  isPro: false,
  smartImports: { used: 5, limit: 5, remaining: 0 },
};
const proStatus = {
  isPro: true,
  smartImports: { used: 100, limit: null, remaining: null },
};

function createContext(env: Record<string, unknown> = {}) {
  return {
    db: { name: "db" },
    user: { id: "user-1" },
    env,
  };
}

describe("subscription feature gates", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("loads status for the current user", async () => {
    dbMocks.getSubscriptionStatus.mockResolvedValue(freeStatus);
    const ctx = createContext();

    await expect(getCurrentSubscriptionStatus(ctx as never)).resolves.toBe(
      freeStatus,
    );
    expect(dbMocks.getSubscriptionStatus).toHaveBeenCalledWith(
      ctx.db,
      "user-1",
    );
  });

  it("returns Pro status and rejects free access with a stable app code", async () => {
    dbMocks.getSubscriptionStatus.mockResolvedValueOnce(proStatus);
    await expect(requirePro(createContext() as never)).resolves.toBe(proStatus);

    dbMocks.getSubscriptionStatus.mockResolvedValueOnce(freeStatus);
    await expect(requirePro(createContext() as never)).rejects.toMatchObject({
      code: "FORBIDDEN",
      appCode: "PRO_REQUIRED",
    });
  });

  it("does not consume usage after the free allowance is exhausted", async () => {
    dbMocks.getSubscriptionStatus.mockResolvedValue(freeStatus);

    await expect(
      consumeSmartImportAllowance(createContext() as never),
    ).rejects.toMatchObject({ appCode: "SMART_IMPORT_LIMIT_REACHED" });
    expect(dbMocks.consumeSmartImportUsage).not.toHaveBeenCalled();
  });

  it("guards against a concurrent final allowance being consumed elsewhere", async () => {
    dbMocks.getSubscriptionStatus.mockResolvedValue({
      ...freeStatus,
      smartImports: { used: 4, limit: 5, remaining: 1 },
    });
    dbMocks.consumeSmartImportUsage.mockResolvedValue({
      ...freeStatus,
      consumedSmartImport: false,
    });

    await expect(
      consumeSmartImportAllowance(createContext() as never),
    ).rejects.toMatchObject({ appCode: "SMART_IMPORT_LIMIT_REACHED" });
  });

  it("returns the atomic consumption result when allowance remains", async () => {
    const consumed = {
      ...freeStatus,
      consumedSmartImport: true,
      smartImports: { used: 5, limit: 5, remaining: 0 },
    };
    dbMocks.getSubscriptionStatus.mockResolvedValue({
      ...freeStatus,
      smartImports: { used: 4, limit: 5, remaining: 1 },
    });
    dbMocks.consumeSmartImportUsage.mockResolvedValue(consumed);

    await expect(
      consumeSmartImportAllowance(createContext() as never),
    ).resolves.toBe(consumed);
  });
});

describe("Adapty entitlement refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getSubscriptionStatus.mockResolvedValue(freeStatus);
    dbMocks.upsertSubscriptionEntitlement.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses stored status when the Adapty secret is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      refreshAdaptyEntitlement(createContext() as never),
    ).resolves.toBe(freeStatus);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbMocks.upsertSubscriptionEntitlement).not.toHaveBeenCalled();
  });

  it("treats an unknown Adapty profile as no remote update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    await expect(
      refreshAdaptyEntitlement(
        createContext({ ADAPTY_SECRET_API_KEY: "secret" }) as never,
      ),
    ).resolves.toBe(freeStatus);
    expect(dbMocks.upsertSubscriptionEntitlement).not.toHaveBeenCalled();
  });

  it("maps upstream failures to a safe service-unavailable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("failure", { status: 503 })),
    );

    await expect(
      refreshAdaptyEntitlement(
        createContext({ ADAPTY_SECRET_API_KEY: "secret" }) as never,
      ),
    ).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      appCode: "SERVICE_UNAVAILABLE",
    });
  });

  it("persists the selected access level and normalized renewal fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          profile_id: "profile-1",
          customer_user_id: "customer-1",
          access_levels: {
            premium: {
              is_active: true,
              renewal_cancelled_at: "2026-08-01T00:00:00Z",
              expires_at: "2026-09-01T00:00:00Z",
            },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ctx = createContext({
      ADAPTY_SECRET_API_KEY: "secret",
      ADAPTY_PRO_ACCESS_LEVEL_ID: "premium",
    });

    await refreshAdaptyEntitlement(ctx as never);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.adapty.io/api/v2/server-side-api/profile/",
      {
        headers: {
          Authorization: "Api-Key secret",
          "adapty-customer-user-id": "user-1",
        },
      },
    );
    expect(dbMocks.upsertSubscriptionEntitlement).toHaveBeenCalledWith(
      ctx.db,
      expect.objectContaining({
        userId: "user-1",
        adaptyProfileId: "profile-1",
        adaptyCustomerUserId: "customer-1",
        accessLevelId: "premium",
        isActive: true,
        willRenew: false,
        expiresAt: new Date("2026-09-01T00:00:00Z"),
        lastEventAt: expect.any(Date),
      }),
    );
  });
});
