import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refundSmartImportUsageForPeriod: vi.fn(),
}));

vi.mock("@repo/db/schemas", () => ({
  recipeImportJobs: {
    id: "id",
    userId: "userId",
    importType: "importType",
    mode: "mode",
    title: "title",
    inputData: "inputData",
    mimeType: "mimeType",
    status: "status",
    recipe: "recipe",
    error: "error",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    completedAt: "completedAt",
    dismissedAt: "dismissedAt",
    processingStartedAt: "processingStartedAt",
    usagePeriodStart: "usagePeriodStart",
    usageConsumedAt: "usageConsumedAt",
    refundedAt: "refundedAt",
  },
}));

vi.mock("@repo/db/services", () => ({
  refundSmartImportUsageForPeriod: mocks.refundSmartImportUsageForPeriod,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ type: "and", conditions })),
  eq: vi.fn((field, value) => ({ type: "eq", field, value })),
  isNull: vi.fn((field) => ({ type: "isNull", field })),
  lt: vi.fn((field, value) => ({ type: "lt", field, value })),
  ne: vi.fn((field, value) => ({ type: "ne", field, value })),
  or: vi.fn((...conditions) => ({ type: "or", conditions })),
}));

// eslint-disable-next-line import/first
import {
  failRecipeImportJob,
  failStaleRecipeImportJobs,
  isRecipeImportJobStale,
  RECIPE_IMPORT_JOB_STALE_ERROR,
  processRecipeImportJob,
} from "./recipe-import-job.service";

type FakeJob = {
  id: string;
  userId: string;
  importType: "basic" | "smart";
  mode: "url" | "text" | "image";
  title: string;
  inputData: string;
  mimeType: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  processingStartedAt: Date | null;
  usagePeriodStart: Date | null;
  usageConsumedAt: Date | null;
  refundedAt: Date | null;
  recipe?: unknown;
  error?: string | null;
  completedAt?: Date | null;
  updatedAt?: Date | null;
};

function createJob(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    id: "job-1",
    userId: "user-1",
    importType: "smart",
    mode: "url",
    title: "https://example.com/recipe",
    inputData: "https://example.com/recipe",
    mimeType: null,
    status: "pending",
    processingStartedAt: null,
    usagePeriodStart: null,
    usageConsumedAt: null,
    refundedAt: null,
    recipe: null,
    error: null,
    completedAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function createFakeDb(initialJob: FakeJob | null) {
  const state = { job: initialJob };

  const serializeJob = () => (state.job ? { ...state.job } : null);

  const valuesEqual = (left: unknown, right: unknown) => {
    if (left instanceof Date && right instanceof Date) {
      return left.getTime() === right.getTime();
    }
    return left === right;
  };

  const readField = (field: unknown) => {
    if (!state.job || typeof field !== "string") return undefined;
    return state.job[field as keyof FakeJob];
  };

  const conditionMatches = (condition: any): boolean => {
    if (!condition) return true;

    switch (condition.type) {
      case "and":
        return condition.conditions.every(conditionMatches);
      case "or":
        return condition.conditions.some(conditionMatches);
      case "eq":
        return valuesEqual(readField(condition.field), condition.value);
      case "ne":
        return !valuesEqual(readField(condition.field), condition.value);
      case "isNull": {
        const value = readField(condition.field);
        return value === null || value === undefined;
      }
      case "lt": {
        const value = readField(condition.field);
        if (value instanceof Date && condition.value instanceof Date) {
          return value.getTime() < condition.value.getTime();
        }
        return Number(value) < Number(condition.value);
      }
      default:
        return true;
    }
  };

  const applyUpdate = (values: Partial<FakeJob>, condition: unknown) => {
    if (!state.job) return [];

    if (!conditionMatches(condition)) {
      return [];
    }

    Object.assign(state.job, values);
    const row = serializeJob();
    return row ? [row] : [];
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          then: (resolve: (rows: unknown[]) => unknown) =>
            Promise.resolve(resolve(state.job ? [serializeJob()] : [])),
        })),
      })),
    })),
    update: vi.fn(() => {
      let values: Partial<FakeJob> = {};
      let condition: unknown;
      const builder = {
        set: vi.fn((nextValues: Partial<FakeJob>) => {
          values = nextValues;
          return builder;
        }),
        where: vi.fn((nextCondition: unknown) => {
          condition = nextCondition;
          return builder;
        }),
        returning: vi.fn(async () => applyUpdate(values, condition)),
        then: (
          resolve: (rows: unknown[]) => unknown,
          reject?: (error: unknown) => unknown,
        ) =>
          Promise.resolve(applyUpdate(values, condition)).then(resolve, reject),
      };
      return builder;
    }),
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db),
    ),
    _state: state,
  };

  return db;
}

function createEnv(parse = vi.fn()) {
  return {
    RECIPE_AI: {
      parse,
    },
  };
}

describe("recipe import job service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T10:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("claims a pending job before parsing and stores the ready recipe", async () => {
    const db = createFakeDb(createJob());
    const parse = vi.fn().mockResolvedValue({
      success: true,
      data: {
        name: "Tomato Pasta",
        ingredientSections: [
          {
            name: null,
            ingredients: [
              { index: 0, quantity: 200, unit: "g", name: "spaghetti" },
            ],
          },
        ],
        instructionSections: [],
        nutrition: { calories: 500 },
      },
      metadata: {
        source: "url",
        parseMethod: "ai_only",
        confidence: "high",
      },
    });

    const result = await processRecipeImportJob(
      { db: db as any, env: createEnv(parse) as any },
      { jobId: "job-1", userId: "user-1" },
    );

    expect(result).toBe("processed");
    expect(parse).toHaveBeenCalledTimes(1);
    expect(db._state.job?.status).toBe("ready");
    expect(db._state.job?.title).toBe("Tomato Pasta");
    expect(db._state.job?.inputData).toBe("");
    expect(db._state.job?.mimeType).toBeNull();
    expect(db._state.job?.processingStartedAt).toBeNull();
    expect(db._state.job?.recipe).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          instructionSections: [],
          nutrition: { calories: 500 },
        }),
        metadata: expect.objectContaining({
          diagnostics: expect.objectContaining({
            stageTimings: expect.arrayContaining([
              expect.objectContaining({ name: "job_update" }),
            ]),
          }),
        }),
      }),
    );
  });

  it("does not parse a job already claimed by another consumer", async () => {
    const db = createFakeDb(
      createJob({
        status: "processing",
        processingStartedAt: new Date("2026-06-02T09:59:00.000Z"),
      }),
    );
    const parse = vi.fn();

    const result = await processRecipeImportJob(
      { db: db as any, env: createEnv(parse) as any },
      { jobId: "job-1", userId: "user-1" },
    );

    expect(result).toBe("busy");
    expect(parse).not.toHaveBeenCalled();
    expect(db._state.job?.status).toBe("processing");
  });

  it("resets a claimed job to pending when a retryable error escapes", async () => {
    const db = createFakeDb(createJob());
    const parse = vi.fn().mockRejectedValue(new Error("temporary outage"));

    await expect(
      processRecipeImportJob(
        { db: db as any, env: createEnv(parse) as any },
        { jobId: "job-1", userId: "user-1" },
      ),
    ).rejects.toThrow("temporary outage");

    expect(db._state.job?.status).toBe("pending");
    expect(db._state.job?.processingStartedAt).toBeNull();
  });

  it("does not complete a job when a newer processing claim has replaced it", async () => {
    const db = createFakeDb(createJob());
    const parse = vi.fn().mockImplementation(async () => {
      db._state.job!.processingStartedAt = new Date("2026-06-02T10:01:00.000Z");
      return {
        success: true,
        data: {
          name: "Tomato Pasta",
          nutrition: { calories: 500 },
        },
        metadata: {
          source: "url",
          parseMethod: "ai_only",
          confidence: "high",
        },
      };
    });

    const result = await processRecipeImportJob(
      { db: db as any, env: createEnv(parse) as any },
      { jobId: "job-1", userId: "user-1" },
    );

    expect(result).toBe("busy");
    expect(db._state.job?.status).toBe("processing");
    expect(db._state.job?.title).toBe("https://example.com/recipe");
    expect(db._state.job?.recipe).toBeNull();
  });

  it("does not reset a job when a newer processing claim has replaced it", async () => {
    const db = createFakeDb(createJob());
    const parse = vi.fn().mockImplementation(async () => {
      db._state.job!.processingStartedAt = new Date("2026-06-02T10:01:00.000Z");
      throw new Error("temporary outage");
    });

    const result = await processRecipeImportJob(
      { db: db as any, env: createEnv(parse) as any },
      { jobId: "job-1", userId: "user-1" },
    );

    expect(result).toBe("busy");
    expect(db._state.job?.status).toBe("processing");
    expect(db._state.job?.processingStartedAt).toEqual(
      new Date("2026-06-02T10:01:00.000Z"),
    );
  });

  it("marks parse errors failed and refunds the recorded quota period", async () => {
    const usagePeriodStart = new Date("2026-05-01T00:00:00.000Z");
    const db = createFakeDb(
      createJob({
        usagePeriodStart,
        usageConsumedAt: new Date("2026-05-31T23:59:00.000Z"),
      }),
    );
    const parse = vi.fn().mockResolvedValue({
      success: false,
      error: { code: "NO_RECIPE", message: "No recipe found" },
    });

    const result = await processRecipeImportJob(
      { db: db as any, env: createEnv(parse) as any },
      { jobId: "job-1", userId: "user-1" },
    );

    expect(result).toBe("processed");
    expect(db._state.job?.status).toBe("failed");
    expect(db._state.job?.inputData).toBe("");
    expect(db._state.job?.mimeType).toBeNull();
    expect(db._state.job?.error).toBe("No recipe found");
    expect(mocks.refundSmartImportUsageForPeriod).toHaveBeenCalledWith(
      db,
      "user-1",
      usagePeriodStart,
      new Date("2026-06-02T10:00:00.000Z"),
    );
  });

  it("does not refund smart jobs that never consumed free quota", async () => {
    const db = createFakeDb(createJob({ usagePeriodStart: null }));

    await failRecipeImportJob(
      { db: db as any, env: createEnv() as any },
      { jobId: "job-1", userId: "user-1" },
      "Unable to queue this import.",
    );

    expect(db._state.job?.status).toBe("failed");
    expect(db._state.job?.inputData).toBe("");
    expect(db._state.job?.mimeType).toBeNull();
    expect(mocks.refundSmartImportUsageForPeriod).not.toHaveBeenCalled();
  });

  it("does not overwrite a ready job with a late failure", async () => {
    const db = createFakeDb(createJob({ status: "ready" }));

    await failRecipeImportJob(
      { db: db as any, env: createEnv() as any },
      { jobId: "job-1", userId: "user-1" },
      "Late failure",
    );

    expect(db._state.job?.status).toBe("ready");
    expect(mocks.refundSmartImportUsageForPeriod).not.toHaveBeenCalled();
  });

  it("marks validation errors failed without rethrowing", async () => {
    const db = createFakeDb(createJob({ mode: "image", mimeType: null }));

    await expect(
      processRecipeImportJob(
        { db: db as any, env: createEnv() as any },
        { jobId: "job-1", userId: "user-1" },
      ),
    ).resolves.toBe("processed");

    expect(db._state.job?.status).toBe("failed");
    expect(db._state.job?.error).toBe("Unsupported image type.");
  });

  it("uses the TRPCError message when failing jobs", async () => {
    const db = createFakeDb(createJob());
    const parse = vi.fn().mockRejectedValue(
      new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot parse this recipe.",
      }),
    );

    await processRecipeImportJob(
      { db: db as any, env: createEnv(parse) as any },
      { jobId: "job-1", userId: "user-1" },
    );

    expect(db._state.job?.status).toBe("failed");
    expect(db._state.job?.error).toBe("Cannot parse this recipe.");
  });

  it("detects pending and processing jobs that have exceeded the stale timeout", () => {
    const now = new Date("2026-06-02T10:00:00.000Z");

    expect(
      isRecipeImportJobStale(
        {
          id: "job-1",
          status: "pending",
          updatedAt: new Date("2026-06-02T09:58:59.000Z"),
          processingStartedAt: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isRecipeImportJobStale(
        {
          id: "job-1",
          status: "processing",
          updatedAt: new Date("2026-06-02T09:59:00.000Z"),
          processingStartedAt: new Date("2026-06-02T09:58:59.000Z"),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isRecipeImportJobStale(
        {
          id: "job-1",
          status: "processing",
          updatedAt: new Date("2026-06-02T09:59:00.000Z"),
          processingStartedAt: new Date("2026-06-02T09:59:00.000Z"),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isRecipeImportJobStale(
        {
          id: "job-1",
          status: "ready",
          updatedAt: new Date("2026-06-02T09:00:00.000Z"),
          processingStartedAt: null,
        },
        now,
      ),
    ).toBe(false);
  });

  it("marks stale active jobs failed", async () => {
    const db = createFakeDb(
      createJob({
        updatedAt: new Date("2026-06-02T09:58:00.000Z"),
      }),
    );

    const failedJobIds = await failStaleRecipeImportJobs(
      { db: db as any, env: createEnv() as any },
      "user-1",
      [
        {
          id: "job-1",
          status: "pending",
          updatedAt: new Date("2026-06-02T09:58:00.000Z"),
          processingStartedAt: null,
        },
      ],
    );

    expect(failedJobIds).toEqual(new Set(["job-1"]));
    expect(db._state.job?.status).toBe("failed");
    expect(db._state.job?.error).toBe(RECIPE_IMPORT_JOB_STALE_ERROR);
    expect(db._state.job?.inputData).toBe("");
  });
});
