import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
  getDb: vi.fn(),
  processRecipeImportJob: vi.fn(),
  failRecipeImportJob: vi.fn(),
  captureImportFailure: vi.fn(),
  captureQueueException: vi.fn(),
}));

vi.mock("@repo/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@repo/trpc/server", () => ({
  processRecipeImportJob: mocks.processRecipeImportJob,
  failRecipeImportJob: mocks.failRecipeImportJob,
  RECIPE_IMPORT_PROCESSING_LEASE_MS: 5 * 60 * 1000,
}));

vi.mock("./observability/sentry", () => ({
  captureImportFailure: mocks.captureImportFailure,
  captureQueueException: mocks.captureQueueException,
}));

// eslint-disable-next-line import/first
import { queue } from "./queue";

function createMessage(attempts = 1) {
  return {
    id: "message-1",
    attempts,
    body: {
      jobId: "job-1",
      userId: "user-1",
    },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function createBatch(message: ReturnType<typeof createMessage>) {
  return {
    queue: "cookclub-recipe-import-url-development",
    messages: [message],
  };
}

describe("recipe import queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(mocks.db);
  });

  it("acknowledges processed jobs", async () => {
    const message = createMessage();
    mocks.processRecipeImportJob.mockResolvedValue("processed");

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(mocks.processRecipeImportJob).toHaveBeenCalledWith(
      {
        db: mocks.db,
        env: {},
        reportFailure: expect.any(Function),
      },
      message.body,
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("forwards handled import failures to observability", async () => {
    const message = createMessage();
    const failure = {
      jobId: "job-1",
      userId: "user-1",
      importType: "smart" as const,
      mode: "url" as const,
      errorCode: "IMPORT_SOURCE_UNAVAILABLE" as const,
      upstreamCode: "FETCH_FAILED",
      sourceHost: "instagram.com",
    };
    mocks.processRecipeImportJob.mockImplementation(async (context) => {
      context.reportFailure(failure);
      return "processed";
    });

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(mocks.captureImportFailure).toHaveBeenCalledWith(
      failure,
      "cookclub-recipe-import-url-development",
    );
  });

  it("retries busy jobs without acknowledging them", async () => {
    const message = createMessage(2);
    mocks.processRecipeImportJob.mockResolvedValue("busy");

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 310 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(mocks.failRecipeImportJob).not.toHaveBeenCalled();
    expect(mocks.captureQueueException).not.toHaveBeenCalled();
  });

  it("retries retryable errors before the final attempt", async () => {
    const message = createMessage(2);
    mocks.processRecipeImportJob.mockRejectedValue(new Error("temporary"));

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 10 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(mocks.failRecipeImportJob).not.toHaveBeenCalled();
    expect(mocks.captureQueueException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ attempts: 2, terminal: false }),
    );
  });

  it("marks the job failed and acknowledges after repeated errors", async () => {
    const message = createMessage(3);
    mocks.processRecipeImportJob.mockRejectedValue(new Error("temporary"));

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(mocks.failRecipeImportJob).toHaveBeenCalledWith(
      { db: mocks.db, env: {} },
      message.body,
      "IMPORT_FAILED",
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(mocks.captureQueueException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ attempts: 3, terminal: true }),
    );
  });
});
