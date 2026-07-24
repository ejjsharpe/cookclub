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
    errorCode: "errorCode",
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
  mapImportFailure,
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
  errorCode?: string | null;
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
    errorCode: null,
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

function createEnv(parse = vi.fn(), deleteImportImages = vi.fn()) {
  return {
    RECIPE_AI: {
      parse,
    },
    IMAGE_SERVICE: {
      deleteImportImages,
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
    expect(parse).toHaveBeenCalledWith({
      type: "url",
      data: "https://example.com/recipe",
      imageStagingId: "job-1",
    });
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
    const deleteImportImages = vi.fn();
    const reportFailure = vi.fn();

    const result = await processRecipeImportJob(
      {
        db: db as any,
        env: createEnv(parse, deleteImportImages) as any,
        reportFailure,
      },
      { jobId: "job-1", userId: "user-1" },
    );

    expect(result).toBe("processed");
    expect(db._state.job?.status).toBe("failed");
    expect(db._state.job?.inputData).toBe("");
    expect(db._state.job?.mimeType).toBeNull();
    expect(db._state.job?.errorCode).toBe("IMPORT_RECIPE_NOT_FOUND");
    expect(db._state.job?.error).toBe(
      "We could not find a recipe at that source.",
    );
    expect(reportFailure).toHaveBeenCalledWith({
      jobId: "job-1",
      userId: "user-1",
      importType: "smart",
      mode: "url",
      errorCode: "IMPORT_RECIPE_NOT_FOUND",
      upstreamCode: "NO_RECIPE",
      sourceHost: "example.com",
    });
    expect(mocks.refundSmartImportUsageForPeriod).toHaveBeenCalledWith(
      db,
      "user-1",
      usagePeriodStart,
      new Date("2026-06-02T10:00:00.000Z"),
    );
    expect(deleteImportImages).toHaveBeenCalledWith("job-1");
  });

  it("cleans up staged images when the job disappears during parsing", async () => {
    const db = createFakeDb(createJob());
    const parse = vi.fn().mockImplementation(async () => {
      db._state.job = null;
      return {
        success: true,
        data: {
          name: "Tomato Pasta",
          ingredientSections: [],
          instructionSections: [],
        },
        metadata: {
          source: "url",
          confidence: "high",
        },
      };
    });
    const deleteImportImages = vi.fn();

    const result = await processRecipeImportJob(
      {
        db: db as any,
        env: createEnv(parse, deleteImportImages) as any,
      },
      { jobId: "job-1", userId: "user-1" },
    );

    expect(result).toBe("skipped");
    expect(deleteImportImages).toHaveBeenCalledWith("job-1");
  });

  it("does not refund smart jobs that never consumed free quota", async () => {
    const db = createFakeDb(createJob({ usagePeriodStart: null }));

    await failRecipeImportJob(
      { db: db as any, env: createEnv() as any },
      { jobId: "job-1", userId: "user-1" },
      "SERVICE_UNAVAILABLE",
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
      "IMPORT_FAILED",
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
    expect(db._state.job?.errorCode).toBe("IMPORT_IMAGE_INVALID");
    expect(db._state.job?.error).toBe(
      "Choose a valid recipe image and try again.",
    );
  });

  it("does not persist an arbitrary TRPCError message", async () => {
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
    expect(db._state.job?.errorCode).toBe("IMPORT_FAILED");
    expect(db._state.job?.error).toBe(
      "Something went wrong while importing. Please try again.",
    );
  });

  it("detects pending and processing jobs that have exceeded the stale timeout", () => {
    const now = new Date("2026-06-02T10:00:00.000Z");

    expect(
      isRecipeImportJobStale(
        {
          id: "job-1",
          status: "pending",
          updatedAt: new Date("2026-06-02T09:49:59.000Z"),
          processingStartedAt: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isRecipeImportJobStale(
        {
          id: "job-1",
          status: "pending",
          updatedAt: new Date("2026-06-02T09:50:00.000Z"),
          processingStartedAt: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isRecipeImportJobStale(
        {
          id: "job-1",
          status: "processing",
          updatedAt: new Date("2026-06-02T09:59:00.000Z"),
          processingStartedAt: new Date("2026-06-02T09:53:59.000Z"),
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
          processingStartedAt: new Date("2026-06-02T09:54:00.000Z"),
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
        updatedAt: new Date("2026-06-02T09:49:00.000Z"),
      }),
    );

    const failedJobIds = await failStaleRecipeImportJobs(
      { db: db as any, env: createEnv() as any },
      "user-1",
      [
        {
          id: "job-1",
          status: "pending",
          updatedAt: new Date("2026-06-02T09:49:00.000Z"),
          processingStartedAt: null,
        },
      ],
    );

    expect(failedJobIds).toEqual(new Set(["job-1"]));
    expect(db._state.job?.status).toBe("failed");
    expect(db._state.job?.error).toBe(RECIPE_IMPORT_JOB_STALE_ERROR);
    expect(db._state.job?.errorCode).toBe("IMPORT_TIMED_OUT");
    expect(db._state.job?.inputData).toBe("");
  });

  it("does not fail a stale candidate after its processing lease is renewed", async () => {
    const db = createFakeDb(
      createJob({
        status: "processing",
        updatedAt: new Date("2026-06-02T09:53:00.000Z"),
        processingStartedAt: new Date("2026-06-02T09:59:00.000Z"),
      }),
    );

    const failedJobIds = await failStaleRecipeImportJobs(
      { db: db as any, env: createEnv() as any },
      "user-1",
      [
        {
          id: "job-1",
          status: "processing",
          updatedAt: new Date("2026-06-02T09:53:00.000Z"),
          processingStartedAt: new Date("2026-06-02T09:53:00.000Z"),
        },
      ],
    );

    expect(failedJobIds).toEqual(new Set());
    expect(db._state.job?.status).toBe("processing");
    expect(db._state.job?.processingStartedAt).toEqual(
      new Date("2026-06-02T09:59:00.000Z"),
    );
  });

  it.each([
    ["INVALID_URL", "url", "IMPORT_INVALID_URL"],
    ["UNSUPPORTED_URL", "url", "IMPORT_UNSUPPORTED_SOURCE"],
    ["FETCH_FAILED", "url", "IMPORT_SOURCE_UNAVAILABLE"],
    ["NO_CONTENT", "url", "IMPORT_RECIPE_NOT_FOUND"],
    ["VALIDATION_FAILED", "url", "IMPORT_RECIPE_NOT_FOUND"],
    ["VALIDATION_FAILED", "text", "IMPORT_FAILED"],
    ["INVALID_MIME_TYPE", "image", "IMPORT_IMAGE_INVALID"],
    ["INVALID_BASE64", "image", "IMPORT_IMAGE_INVALID"],
    ["INPUT_TOO_LONG", "text", "PAYLOAD_TOO_LARGE"],
    ["IMAGE_TOO_LARGE", "image", "PAYLOAD_TOO_LARGE"],
    ["AI_PARSE_FAILED", "url", "IMPORT_FAILED"],
  ] as const)("maps %s %s failures to %s", (code, mode, expected) => {
    expect(mapImportFailure(code, mode)).toBe(expected);
  });
});
