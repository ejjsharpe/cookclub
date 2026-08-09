import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("acknowledges processed jobs", async () => {
    const message = createMessage();
    mocks.processRecipeImportJob.mockResolvedValue({ outcome: "ready" });

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
      event: "recipe_import_terminal_failure" as const,
      sourceHost: "instagram.com",
    };
    mocks.processRecipeImportJob.mockImplementation(async (context) => {
      context.reportFailure(failure);
      return { outcome: "ready" };
    });

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(mocks.captureImportFailure).toHaveBeenCalledWith(
      failure,
      "cookclub-recipe-import-url-development",
    );
  });

  it("retries busy jobs without acknowledging them", async () => {
    const message = createMessage(2);
    mocks.processRecipeImportJob.mockResolvedValue({ outcome: "busy" });

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 310 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(mocks.failRecipeImportJob).not.toHaveBeenCalled();
    expect(mocks.captureQueueException).not.toHaveBeenCalled();
  });

  it("retries retryable errors before the final attempt", async () => {
    const message = createMessage(2);
    mocks.processRecipeImportJob.mockResolvedValue({
      outcome: "retry",
      errorCode: "IMPORT_SOURCE_UNAVAILABLE",
    });

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 15 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(mocks.failRecipeImportJob).not.toHaveBeenCalled();
    expect(mocks.captureQueueException).not.toHaveBeenCalled();
  });

  it("fails once and routes the fourth retryable attempt to the DLQ", async () => {
    const message = createMessage(4);
    mocks.processRecipeImportJob.mockResolvedValue({
      outcome: "retry",
      errorCode: "IMPORT_SOURCE_UNAVAILABLE",
    });

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(mocks.failRecipeImportJob).toHaveBeenCalledWith(
      { db: mocks.db, env: {} },
      message.body,
      "SERVICE_UNAVAILABLE",
      { expectedStatus: "pending" },
    );
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith();
    expect(mocks.captureQueueException).not.toHaveBeenCalled();
  });

  it("honours provider Retry-After delays", async () => {
    const message = createMessage(1);
    mocks.processRecipeImportJob.mockResolvedValue({
      outcome: "retry",
      errorCode: "SERVICE_UNAVAILABLE",
      retryAfterSeconds: 120,
    });

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
  });

  it("keeps the configured backoff when Retry-After is shorter or invalid", async () => {
    const shortDelayMessage = createMessage(2);
    const invalidDelayMessage = createMessage(3);
    mocks.processRecipeImportJob
      .mockResolvedValueOnce({
        outcome: "retry",
        errorCode: "SERVICE_UNAVAILABLE",
        retryAfterSeconds: 1,
      })
      .mockResolvedValueOnce({
        outcome: "retry",
        errorCode: "SERVICE_UNAVAILABLE",
        retryAfterSeconds: Number.NaN,
      });

    await queue(createBatch(shortDelayMessage) as any, {} as any, {} as any);
    await queue(createBatch(invalidDelayMessage) as any, {} as any, {} as any);

    expect(shortDelayMessage.retry).toHaveBeenCalledWith({ delaySeconds: 15 });
    expect(invalidDelayMessage.retry).toHaveBeenCalledWith({
      delaySeconds: 40,
    });
  });

  it("caps provider Retry-After delays to the queue maximum", async () => {
    const message = createMessage(1);
    mocks.processRecipeImportJob.mockResolvedValue({
      outcome: "retry",
      errorCode: "SERVICE_UNAVAILABLE",
      retryAfterSeconds: 7 * 24 * 60 * 60,
    });

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 24 * 60 * 60 });
  });

  it("captures thrown failures and retries non-terminal attempts", async () => {
    const message = createMessage(3);
    const error = new Error("provider connection failed");
    mocks.processRecipeImportJob.mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(mocks.captureQueueException).toHaveBeenCalledWith(error, {
      queue: "cookclub-recipe-import-url-development",
      messageId: "message-1",
      attempts: 3,
      terminal: false,
      jobId: "job-1",
      userId: "user-1",
    });
    expect(mocks.failRecipeImportJob).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 40 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"task":"recipe-import-job"'),
    );
  });

  it("persists terminal thrown failures before routing them to the DLQ", async () => {
    const message = createMessage(4);
    const error = new Error("provider permanently unavailable");
    mocks.processRecipeImportJob.mockRejectedValue(error);

    await queue(createBatch(message) as any, {} as any, {} as any);

    expect(mocks.captureQueueException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ terminal: true, attempts: 4 }),
    );
    expect(mocks.failRecipeImportJob).toHaveBeenCalledWith(
      { db: mocks.db, env: {} },
      message.body,
      "SERVICE_UNAVAILABLE",
    );
    expect(message.retry).toHaveBeenCalledWith();
    expect(message.ack).not.toHaveBeenCalled();
  });
});
