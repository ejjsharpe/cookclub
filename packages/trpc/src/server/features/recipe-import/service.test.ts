import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecipeImportJob,
  fingerprintRecipeImportRequest,
  processRecipeImportJob,
  recoverStaleRecipeImportJobs,
} from "./service";

const mocks = vi.hoisted(() => ({
  consumeSmartImportAllowance: vi.fn(),
  refundSmartImportUsageForPeriod: vi.fn(),
}));

vi.mock("../../services/subscription.service", () => ({
  consumeSmartImportAllowance: mocks.consumeSmartImportAllowance,
}));
vi.mock("@repo/db/services", () => ({
  refundSmartImportUsageForPeriod: mocks.refundSmartImportUsageForPeriod,
}));

const JOB_ID = "2d4976e7-c19b-46de-b893-dc18013097de";

function createEnvironment() {
  return {
    RECIPE_IMPORT_BASIC_QUEUE: { send: vi.fn() },
    RECIPE_IMPORT_URL_QUEUE: { send: vi.fn() },
    RECIPE_IMPORT_TEXT_QUEUE: { send: vi.fn() },
    RECIPE_IMPORT_IMAGE_QUEUE: { send: vi.fn() },
    IMAGE_SERVICE: {
      stageImportSource: vi.fn(),
    },
  };
}

function createCreateDb(options?: {
  activeCount?: number;
  existing?: Record<string, unknown> | null;
}) {
  const state = {
    activeCount: options?.activeCount ?? 0,
    existing: options?.existing ?? null,
    inserted: [] as Record<string, unknown>[],
  };
  const execute = vi.fn();
  const insert = vi.fn(() => ({
    values: vi.fn((values: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        const row = {
          recipe: null,
          error: null,
          errorCode: null,
          completedAt: null,
          processingStartedAt: null,
          refundedAt: null,
          completionFingerprint: null,
          recipeId: null,
          consumedAt: null,
          ...values,
        };
        state.inserted.push(row);
        state.existing = row;
        return [row];
      }),
    })),
  }));
  const select = vi.fn((fields?: { value?: unknown }) => {
    const rows = () =>
      fields?.value
        ? [{ value: state.activeCount }]
        : state.existing
          ? [state.existing]
          : [];
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      then: (
        resolve: (value: Record<string, unknown>[]) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve(rows()).then(resolve, reject),
    };
    return builder;
  });
  const db = {
    execute,
    select,
    insert,
    transaction: vi.fn(
      async (callback: (transaction: typeof db) => Promise<unknown>) =>
        await callback(db),
    ),
  };
  return { db, state };
}

function createContext(db: unknown, env: ReturnType<typeof createEnvironment>) {
  return { db, env };
}

function createProcessDb(importType: "basic" | "smart" = "smart") {
  const state = {
    job: {
      id: JOB_ID,
      userId: "user-1",
      importType,
      mode: "url",
      title: "example.com",
      sourceData: "https://example.com/recipe",
      requestFingerprint: "fingerprint",
      status: "pending",
      recipe: null,
      error: null,
      errorCode: null,
      completionFingerprint: null,
      recipeId: null,
      consumedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      processingStartedAt: null,
      usagePeriodStart: null,
      refundedAt: null,
    } as Record<string, unknown>,
  };
  const update = vi.fn(() => {
    let values: Record<string, unknown> = {};
    const builder = {
      set: vi.fn((next: Record<string, unknown>) => {
        values = next;
        return builder;
      }),
      where: vi.fn(() => builder),
      returning: vi.fn(async (fields?: Record<string, unknown>) => {
        Object.assign(state.job, values);
        if (!fields) return [{ ...state.job }];
        return [
          Object.fromEntries(
            Object.keys(fields).map((key) => [key, state.job[key]]),
          ),
        ];
      }),
    };
    return builder;
  });
  const select = vi.fn(() => {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      then: (resolve: (rows: Record<string, unknown>[]) => unknown) =>
        Promise.resolve(resolve([{ ...state.job }])),
    };
    return builder;
  });
  const db = {
    update,
    select,
    transaction: vi.fn(
      async (callback: (transaction: typeof db) => Promise<unknown>) =>
        await callback(db),
    ),
  };
  return { db, state };
}

describe("durable recipe import creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeSmartImportAllowance.mockResolvedValue({
      isPro: false,
      consumedSmartImport: true,
      smartImports: {
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
  });

  it("returns the same pending job and consumes Smart allowance once", async () => {
    const { db, state } = createCreateDb();
    const env = createEnvironment();
    const request = {
      id: JOB_ID,
      importType: "smart" as const,
      source: { type: "url" as const, value: "https://example.com/Recipe?A=B" },
    };

    const first = await createRecipeImportJob(
      createContext(db, env) as never,
      "user-1",
      request,
    );
    const replay = await createRecipeImportJob(
      createContext(db, env) as never,
      "user-1",
      request,
    );

    expect(replay).toEqual(first);
    expect(state.inserted).toHaveLength(1);
    expect(mocks.consumeSmartImportAllowance).toHaveBeenCalledTimes(1);
    expect(env.RECIPE_IMPORT_URL_QUEUE.send).toHaveBeenCalledTimes(2);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("conflicts when the same id is replayed with different input", async () => {
    const { db } = createCreateDb();
    const env = createEnvironment();
    await createRecipeImportJob(createContext(db, env) as never, "user-1", {
      id: JOB_ID,
      importType: "smart",
      source: { type: "url", value: "https://example.com/one" },
    });

    await expect(
      createRecipeImportJob(createContext(db, env) as never, "user-1", {
        id: JOB_ID,
        importType: "smart",
        source: { type: "url", value: "https://example.com/two" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.consumeSmartImportAllowance).toHaveBeenCalledTimes(1);
  });

  it("rejects a sixth active job while holding the user-row lock", async () => {
    const { db, state } = createCreateDb({ activeCount: 5 });
    const env = createEnvironment();

    await expect(
      createRecipeImportJob(createContext(db, env) as never, "user-1", {
        id: JOB_ID,
        importType: "basic",
        source: { type: "url", value: "https://example.com/recipe" },
      }),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      appCode: "IMPORT_ACTIVE_LIMIT_REACHED",
    });

    expect(db.execute).toHaveBeenCalledOnce();
    expect(state.inserted).toHaveLength(0);
  });

  it("keeps the accepted job pending when queue delivery fails", async () => {
    const { db, state } = createCreateDb();
    const env = createEnvironment();
    env.RECIPE_IMPORT_BASIC_QUEUE.send.mockRejectedValue(
      new Error("queue unavailable"),
    );

    await expect(
      createRecipeImportJob(createContext(db, env) as never, "user-1", {
        id: JOB_ID,
        importType: "basic",
        source: { type: "url", value: "https://example.com/recipe" },
      }),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      appCode: "SERVICE_UNAVAILABLE",
    });
    expect(state.inserted[0]?.status).toBe("pending");
  });

  it("stages image bytes outside Postgres and stores only a null source", async () => {
    const { db, state } = createCreateDb();
    const env = createEnvironment();

    await createRecipeImportJob(createContext(db, env) as never, "user-1", {
      id: JOB_ID,
      importType: "smart",
      source: {
        type: "image",
        uploadKeys: ["temp/user-1/source.jpg"],
      },
    });

    expect(env.IMAGE_SERVICE.stageImportSource).toHaveBeenCalledWith(
      "temp/user-1/source.jpg",
      "user-1",
      JOB_ID,
      0,
      1,
    );
    expect(state.inserted[0]).toMatchObject({
      mode: "image",
      sourceData: null,
    });
  });

  it("stages multiple image sources and records their count", async () => {
    const { db, state } = createCreateDb();
    const env = createEnvironment();

    await createRecipeImportJob(createContext(db, env) as never, "user-1", {
      id: JOB_ID,
      importType: "smart",
      source: {
        type: "image",
        uploadKeys: ["temp/user-1/source-1.jpg", "temp/user-1/source-2.jpg"],
      },
    });

    expect(env.IMAGE_SERVICE.stageImportSource).toHaveBeenNthCalledWith(
      1,
      "temp/user-1/source-1.jpg",
      "user-1",
      JOB_ID,
      0,
      2,
    );
    expect(env.IMAGE_SERVICE.stageImportSource).toHaveBeenNthCalledWith(
      2,
      "temp/user-1/source-2.jpg",
      "user-1",
      JOB_ID,
      1,
      2,
    );
    expect(state.inserted[0]).toMatchObject({
      mode: "image",
      sourceData: "2",
    });
  });

  it("rejects empty and over-limit image source lists", async () => {
    const { db } = createCreateDb();
    const env = createEnvironment();

    await expect(
      createRecipeImportJob(createContext(db, env) as never, "user-1", {
        id: JOB_ID,
        importType: "smart",
        source: { type: "image", uploadKeys: [] },
      }),
    ).rejects.toMatchObject({ appCode: "IMPORT_IMAGE_INVALID" });

    await expect(
      createRecipeImportJob(createContext(db, env) as never, "user-1", {
        id: JOB_ID,
        importType: "smart",
        source: {
          type: "image",
          uploadKeys: Array.from(
            { length: 4 },
            (_, index) => `temp/user-1/source-${index}.jpg`,
          ),
        },
      }),
    ).rejects.toMatchObject({ appCode: "PAYLOAD_TOO_LARGE" });

    expect(env.IMAGE_SERVICE.stageImportSource).not.toHaveBeenCalled();
  });

  it("uses canonical stable fingerprints", async () => {
    await expect(
      fingerprintRecipeImportRequest({ b: 2, a: { d: 4, c: 3 } }),
    ).resolves.toBe(
      await fingerprintRecipeImportRequest({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});

describe("recipe import processing outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the stored image count to the recipe AI worker", async () => {
    const { db, state } = createProcessDb();
    state.job.mode = "image";
    state.job.sourceData = "2";
    const parse = vi.fn().mockResolvedValue({
      success: false,
      error: {
        code: "IMPORT_SOURCE_UNAVAILABLE",
        message: "Temporary fetch failure",
        disposition: "retry",
      },
    });
    const env = {
      ...createEnvironment(),
      RECIPE_AI: { parse },
      IMAGE_SERVICE: {
        stageImportSource: vi.fn(),
        deleteImportImages: vi.fn(),
      },
    };

    await processRecipeImportJob({ db, env } as never, {
      jobId: JOB_ID,
      userId: "user-1",
    });

    expect(parse).toHaveBeenCalledWith({
      type: "image",
      jobId: JOB_ID,
      imageCount: 2,
      strategy: "ai-assisted",
      imageStagingId: JOB_ID,
    });
  });

  it("resets a retryable parse to pending without refund or cleanup", async () => {
    const { db, state } = createProcessDb();
    const env = {
      ...createEnvironment(),
      RECIPE_AI: {
        parse: vi.fn().mockResolvedValue({
          success: false,
          error: {
            code: "IMPORT_SOURCE_UNAVAILABLE",
            message: "Temporary fetch failure",
            disposition: "retry",
            retryAfterSeconds: 12,
          },
        }),
      },
      IMAGE_SERVICE: {
        stageImportSource: vi.fn(),
        deleteImportImages: vi.fn(),
      },
    };

    await expect(
      processRecipeImportJob({ db, env } as never, {
        jobId: JOB_ID,
        userId: "user-1",
      }),
    ).resolves.toEqual({
      outcome: "retry",
      errorCode: "IMPORT_SOURCE_UNAVAILABLE",
      retryAfterSeconds: 12,
    });
    expect(state.job.status).toBe("pending");
    expect(state.job.processingStartedAt).toBeNull();
    expect(mocks.refundSmartImportUsageForPeriod).not.toHaveBeenCalled();
    expect(env.IMAGE_SERVICE.deleteImportImages).not.toHaveBeenCalled();
  });

  it("reports the full URL before clearing a terminal failure's source and staging", async () => {
    const { db, state } = createProcessDb("basic");
    const sourceUrl = "https://example.com/cookbook/recipes/ragu?servings=2";
    state.job.sourceData = sourceUrl;
    const reportFailure = vi.fn();
    const env = {
      ...createEnvironment(),
      RECIPE_AI: {
        parse: vi.fn().mockResolvedValue({
          success: false,
          error: {
            code: "IMPORT_RECIPE_NOT_FOUND",
            message: "No recipe found",
            disposition: "terminal",
          },
        }),
      },
      IMAGE_SERVICE: {
        stageImportSource: vi.fn(),
        deleteImportImages: vi.fn(),
      },
    };

    await expect(
      processRecipeImportJob({ db, env, reportFailure } as never, {
        jobId: JOB_ID,
        userId: "user-1",
      }),
    ).resolves.toEqual({ outcome: "ready" });
    expect(reportFailure).toHaveBeenCalledWith({
      event: "recipe_import_terminal_failure",
      jobId: JOB_ID,
      userId: "user-1",
      importType: "basic",
      mode: "url",
      errorCode: "IMPORT_RECIPE_NOT_FOUND",
      message: "No recipe found",
      sourceHost: "example.com",
      sourceUrl,
    });
    expect(state.job.status).toBe("failed");
    expect(state.job.sourceData).toBeNull();
    expect(state.job.errorCode).toBe("IMPORT_RECIPE_NOT_FOUND");
    expect(env.IMAGE_SERVICE.deleteImportImages).toHaveBeenCalledOnce();
  });

  it.each(["terminal", "retry"] as const)(
    "reports handled image provider failures with %s disposition before clearing diagnostics",
    async (disposition) => {
      const { db, state } = createProcessDb();
      state.job.mode = "image";
      state.job.sourceData = "2";
      const reportFailure = vi.fn();
      const message = "Cerebras request failed with status 404: model_archived";
      const env = {
        ...createEnvironment(),
        RECIPE_AI: {
          parse: vi.fn().mockResolvedValue({
            success: false,
            error: { code: "SERVICE_UNAVAILABLE", message, disposition },
          }),
        },
        IMAGE_SERVICE: { deleteImportImages: vi.fn() },
      };

      await processRecipeImportJob({ db, env, reportFailure } as never, {
        jobId: JOB_ID,
        userId: "user-1",
      });

      expect(reportFailure).toHaveBeenCalledWith({
        event:
          disposition === "retry"
            ? "recipe_import_retry_scheduled"
            : "recipe_import_terminal_failure",
        jobId: JOB_ID,
        userId: "user-1",
        importType: "smart",
        mode: "image",
        errorCode: "SERVICE_UNAVAILABLE",
        message,
      });
      expect(state.job.status).toBe(
        disposition === "retry" ? "pending" : "failed",
      );
      expect(JSON.stringify(state.job)).not.toContain(message);
    },
  );

  it("reports unexpected RPC failures that are handled as retries", async () => {
    const { db } = createProcessDb();
    const reportFailure = vi.fn();
    const env = {
      ...createEnvironment(),
      RECIPE_AI: {
        parse: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
      },
    };

    await expect(
      processRecipeImportJob({ db, env, reportFailure } as never, {
        jobId: JOB_ID,
        userId: "user-1",
      }),
    ).resolves.toEqual({ outcome: "retry", errorCode: "SERVICE_UNAVAILABLE" });
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "recipe_import_retry_scheduled",
        errorCode: "SERVICE_UNAVAILABLE",
        message: "RPC unavailable",
      }),
    );
  });

  it.each([
    ["text", "Private pasted recipe text"],
    ["image", "2"],
    ["url", "invalid-url"],
  ])(
    "omits source URLs for %s imports without a valid URL",
    async (mode, sourceData) => {
      const { db, state } = createProcessDb();
      state.job.mode = mode;
      state.job.sourceData = sourceData;
      const reportFailure = vi.fn();
      const env = {
        ...createEnvironment(),
        RECIPE_AI: {
          parse: vi.fn().mockResolvedValue({
            success: false,
            error: {
              code: "IMPORT_RECIPE_NOT_FOUND",
              disposition: "terminal",
            },
          }),
        },
      };

      await processRecipeImportJob({ db, env, reportFailure } as never, {
        jobId: JOB_ID,
        userId: "user-1",
      });

      expect(reportFailure).toHaveBeenCalledOnce();
      expect(reportFailure.mock.calls[0]?.[0]).not.toHaveProperty("sourceUrl");
      expect(reportFailure.mock.calls[0]?.[0]).not.toHaveProperty("sourceHost");
    },
  );

  it("recovers stale jobs without requiring a user poll", async () => {
    const { db, state } = createProcessDb("basic");
    state.job.status = "pending";
    state.job.updatedAt = new Date("2026-07-01T09:00:00.000Z");
    const env = {
      ...createEnvironment(),
      IMAGE_SERVICE: {
        stageImportSource: vi.fn(),
        deleteImportImages: vi.fn(),
      },
    };
    const reportFailure = vi.fn();

    await expect(
      recoverStaleRecipeImportJobs(
        { db, env, reportFailure } as never,
        new Date("2026-07-01T10:00:00.000Z"),
      ),
    ).resolves.toEqual({ checked: 1, recovered: 1 });
    expect(state.job.status).toBe("failed");
    expect(state.job.errorCode).toBe("IMPORT_TIMED_OUT");
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ event: "recipe_import_stale_recovery" }),
    );
  });
});
