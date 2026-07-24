import type { PublicErrorCode } from "@repo/contracts";
import { recipeImportJobs } from "@repo/db/schemas";
import {
  refundSmartImportUsageForPeriod,
  type DbClient,
} from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

import type { RecipeImportJobMessage, TRPCEnv } from "../env";
import { getPublicErrorMessage, PublicTRPCError } from "../public-errors";
import { cleanupRecipeImportImagesBestEffort } from "./recipe-import-image-cleanup.service";

export type ImportJobMode = "url" | "text" | "image";
export type ImportJobType = "basic" | "smart";

export type ImportJobRecord = {
  id: string;
  userId: string;
  importType: ImportJobType;
  mode: ImportJobMode;
  title: string;
  inputData: string;
  mimeType: string | null;
  status: string;
  processingStartedAt: Date | null;
  usagePeriodStart: Date | null;
  usageConsumedAt: Date | null;
  refundedAt: Date | null;
};

export type RecipeImportJobContext = {
  db: DbClient;
  env: TRPCEnv;
  reportFailure?: (failure: RecipeImportFailureEvent) => void;
};

export type RecipeImportFailureEvent = {
  jobId: string;
  userId: string;
  importType: ImportJobType;
  mode: ImportJobMode;
  errorCode: PersistedImportErrorCode;
  upstreamCode?: string;
  sourceHost?: string;
};

export type ProcessRecipeImportJobResult = "processed" | "skipped" | "busy";

export const RECIPE_IMPORT_PROCESSING_LEASE_MS = 5 * 60 * 1000;
export const RECIPE_IMPORT_PENDING_STALE_MS = 10 * 60 * 1000;
export const RECIPE_IMPORT_PROCESSING_STALE_MS =
  RECIPE_IMPORT_PROCESSING_LEASE_MS + 60 * 1000;
export const RECIPE_IMPORT_JOB_STALE_ERROR =
  getPublicErrorMessage("IMPORT_TIMED_OUT");
const MAX_PARSE_DIAGNOSTIC_STAGES = 32;

function sourceHostForJob(job: ImportJobRecord) {
  if (job.mode !== "url") return undefined;

  try {
    return new URL(job.inputData).hostname;
  } catch {
    return undefined;
  }
}

export type StaleRecipeImportJobCandidate = {
  id: string;
  status: string;
  updatedAt: Date;
  processingStartedAt: Date | null;
};

function processingStartedAtMatches(processingStartedAt: Date | null) {
  return processingStartedAt
    ? eq(recipeImportJobs.processingStartedAt, processingStartedAt)
    : isNull(recipeImportJobs.processingStartedAt);
}

export type PersistedImportErrorCode = Extract<
  PublicErrorCode,
  | "IMPORT_INVALID_URL"
  | "IMPORT_UNSUPPORTED_SOURCE"
  | "IMPORT_SOURCE_UNAVAILABLE"
  | "IMPORT_RECIPE_NOT_FOUND"
  | "IMPORT_IMAGE_INVALID"
  | "PAYLOAD_TOO_LARGE"
  | "IMPORT_TIMED_OUT"
  | "IMPORT_FAILED"
  | "SERVICE_UNAVAILABLE"
>;

const IMPORT_ERROR_CODES = new Set<PersistedImportErrorCode>([
  "IMPORT_INVALID_URL",
  "IMPORT_UNSUPPORTED_SOURCE",
  "IMPORT_SOURCE_UNAVAILABLE",
  "IMPORT_RECIPE_NOT_FOUND",
  "IMPORT_IMAGE_INVALID",
  "PAYLOAD_TOO_LARGE",
  "IMPORT_TIMED_OUT",
  "IMPORT_FAILED",
  "SERVICE_UNAVAILABLE",
]);

export function mapImportFailure(
  upstreamCode: string | undefined,
  mode: ImportJobMode,
): PersistedImportErrorCode {
  switch (upstreamCode) {
    case "INVALID_URL":
      return "IMPORT_INVALID_URL";
    case "UNSUPPORTED_URL":
      return "IMPORT_UNSUPPORTED_SOURCE";
    case "FETCH_FAILED":
      return "IMPORT_SOURCE_UNAVAILABLE";
    case "NO_STRUCTURED_DATA":
    case "NO_CONTENT":
    case "NO_RECIPE":
      return "IMPORT_RECIPE_NOT_FOUND";
    case "INVALID_MIME_TYPE":
    case "INVALID_BASE64":
      return "IMPORT_IMAGE_INVALID";
    case "INPUT_TOO_LONG":
    case "IMAGE_TOO_LARGE":
      return "PAYLOAD_TOO_LARGE";
    case "VALIDATION_FAILED":
      return mode === "url" ? "IMPORT_RECIPE_NOT_FOUND" : "IMPORT_FAILED";
    default:
      return "IMPORT_FAILED";
  }
}

function getImportErrorCode(
  error: unknown,
  mode: ImportJobMode,
): PersistedImportErrorCode {
  if (
    error instanceof PublicTRPCError &&
    IMPORT_ERROR_CODES.has(error.appCode as PersistedImportErrorCode)
  ) {
    return error.appCode as PersistedImportErrorCode;
  }
  if (error instanceof TRPCError && error.code === "PAYLOAD_TOO_LARGE") {
    return "PAYLOAD_TOO_LARGE";
  }
  return mode === "image" && error instanceof TRPCError
    ? "IMPORT_IMAGE_INVALID"
    : "IMPORT_FAILED";
}

export function isRecipeImportJobStale(
  job: StaleRecipeImportJobCandidate,
  now = new Date(),
) {
  if (job.status === "pending") {
    return (
      job.updatedAt < new Date(now.getTime() - RECIPE_IMPORT_PENDING_STALE_MS)
    );
  }

  if (job.status === "processing") {
    return (
      (job.processingStartedAt ?? job.updatedAt) <
      new Date(now.getTime() - RECIPE_IMPORT_PROCESSING_STALE_MS)
    );
  }

  return false;
}

export async function failStaleRecipeImportJobs(
  ctx: RecipeImportJobContext,
  userId: string,
  jobs: StaleRecipeImportJobCandidate[],
  now = new Date(),
) {
  const failedJobIds = new Set<string>();

  for (const job of jobs) {
    if (!isRecipeImportJobStale(job, now)) continue;

    const didFailJob = await failRecipeImportJob(
      ctx,
      { jobId: job.id, userId },
      "IMPORT_TIMED_OUT",
      job.status === "processing"
        ? {
            expectedStatus: "processing",
            processingStartedAt: job.processingStartedAt,
          }
        : { expectedStatus: "pending" },
    );
    if (didFailJob) failedJobIds.add(job.id);
  }

  return failedJobIds;
}

export async function enqueueRecipeImportJob(
  env: TRPCEnv,
  job: Pick<ImportJobRecord, "id" | "userId" | "importType" | "mode">,
) {
  const message: RecipeImportJobMessage = {
    jobId: job.id,
    userId: job.userId,
  };

  if (job.importType === "basic") {
    await env.RECIPE_IMPORT_BASIC_QUEUE.send(message);
    return;
  }

  switch (job.mode) {
    case "url":
      await env.RECIPE_IMPORT_URL_QUEUE.send(message);
      break;
    case "text":
      await env.RECIPE_IMPORT_TEXT_QUEUE.send(message);
      break;
    case "image":
      await env.RECIPE_IMPORT_IMAGE_QUEUE.send(message);
      break;
  }
}

function appendJobUpdateDiagnostics<
  T extends { success: true; metadata: { diagnostics?: any } },
>(result: T, startTime: number): T {
  const diagnostics = result.metadata.diagnostics ?? {};
  const stageTimings = [
    ...(diagnostics.stageTimings ?? []),
    {
      name: "job_update",
      status: "success",
      elapsedMs: Math.max(0, Date.now() - startTime),
      detail: "recipe_import_jobs",
    },
  ].slice(-MAX_PARSE_DIAGNOSTIC_STAGES);

  return {
    ...result,
    metadata: {
      ...result.metadata,
      diagnostics: {
        ...diagnostics,
        stageTimings,
      },
    },
  };
}

async function loadRecipeImportJobStatus(
  ctx: RecipeImportJobContext,
  message: RecipeImportJobMessage,
) {
  return await ctx.db
    .select({
      status: recipeImportJobs.status,
    })
    .from(recipeImportJobs)
    .where(
      and(
        eq(recipeImportJobs.id, message.jobId),
        eq(recipeImportJobs.userId, message.userId),
      ),
    )
    .then((rows) => rows[0] ?? null);
}

async function claimRecipeImportJob(
  ctx: RecipeImportJobContext,
  message: RecipeImportJobMessage,
  now = new Date(),
): Promise<ImportJobRecord | null> {
  const staleBefore = new Date(
    now.getTime() - RECIPE_IMPORT_PROCESSING_LEASE_MS,
  );
  const [row] = await ctx.db
    .update(recipeImportJobs)
    .set({
      status: "processing",
      processingStartedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(recipeImportJobs.id, message.jobId),
        eq(recipeImportJobs.userId, message.userId),
        or(
          eq(recipeImportJobs.status, "pending"),
          and(
            eq(recipeImportJobs.status, "processing"),
            or(
              isNull(recipeImportJobs.processingStartedAt),
              lt(recipeImportJobs.processingStartedAt, staleBefore),
            ),
          ),
        ),
      ),
    )
    .returning({
      id: recipeImportJobs.id,
      userId: recipeImportJobs.userId,
      importType: recipeImportJobs.importType,
      mode: recipeImportJobs.mode,
      title: recipeImportJobs.title,
      inputData: recipeImportJobs.inputData,
      mimeType: recipeImportJobs.mimeType,
      status: recipeImportJobs.status,
      processingStartedAt: recipeImportJobs.processingStartedAt,
      usagePeriodStart: recipeImportJobs.usagePeriodStart,
      usageConsumedAt: recipeImportJobs.usageConsumedAt,
      refundedAt: recipeImportJobs.refundedAt,
    });

  if (!row) return null;

  return {
    ...row,
    importType: row.importType as ImportJobType,
    mode: row.mode as ImportJobMode,
  };
}

async function resetRecipeImportJobForRetry(
  ctx: RecipeImportJobContext,
  job: Pick<ImportJobRecord, "id" | "userId" | "processingStartedAt">,
) {
  const [resetJob] = await ctx.db
    .update(recipeImportJobs)
    .set({
      status: "pending",
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(recipeImportJobs.id, job.id),
        eq(recipeImportJobs.userId, job.userId),
        eq(recipeImportJobs.status, "processing"),
        processingStartedAtMatches(job.processingStartedAt),
      ),
    )
    .returning({ id: recipeImportJobs.id });

  return Boolean(resetJob);
}

async function parseRecipeImportJob(
  ctx: RecipeImportJobContext,
  job: ImportJobRecord,
) {
  if (job.importType === "basic") {
    if (job.mode !== "url") {
      throw new PublicTRPCError({
        code: "BAD_REQUEST",
        appCode: "IMPORT_INVALID_URL",
      });
    }

    return await ctx.env.RECIPE_AI.parse({
      type: "url",
      data: job.inputData,
      structuredOnly: true,
      imageStagingId: job.id,
    });
  }

  if (job.mode === "url") {
    return await ctx.env.RECIPE_AI.parse({
      type: "url",
      data: job.inputData,
      imageStagingId: job.id,
    });
  }

  if (job.mode === "text") {
    return await ctx.env.RECIPE_AI.parse({
      type: "text",
      data: job.inputData,
      imageStagingId: job.id,
    });
  }

  if (
    job.mimeType !== "image/jpeg" &&
    job.mimeType !== "image/png" &&
    job.mimeType !== "image/webp"
  ) {
    throw new PublicTRPCError({
      code: "BAD_REQUEST",
      appCode: "IMPORT_IMAGE_INVALID",
    });
  }

  return await ctx.env.RECIPE_AI.parse({
    type: "image",
    data: job.inputData,
    mimeType: job.mimeType,
    imageStagingId: job.id,
  });
}

export async function processRecipeImportJob(
  ctx: RecipeImportJobContext,
  message: RecipeImportJobMessage,
): Promise<ProcessRecipeImportJobResult> {
  const job = await claimRecipeImportJob(ctx, message);
  if (!job) {
    const existingJob = await loadRecipeImportJobStatus(ctx, message);
    return existingJob?.status === "processing" ? "busy" : "skipped";
  }

  try {
    const result = await parseRecipeImportJob(ctx, job);

    if (!result.success) {
      const errorCode = mapImportFailure(result.error.code, job.mode);
      const sourceHost = sourceHostForJob(job);
      ctx.reportFailure?.({
        jobId: job.id,
        userId: job.userId,
        importType: job.importType,
        mode: job.mode,
        errorCode,
        upstreamCode: result.error.code,
        ...(sourceHost && { sourceHost }),
      });
      throw new PublicTRPCError({
        code: "BAD_REQUEST",
        appCode: errorCode,
      });
    }

    const completedAt = new Date();
    const jobUpdateStart = Date.now();
    const resultForStorage = appendJobUpdateDiagnostics(result, jobUpdateStart);

    const [completedJob] = await ctx.db
      .update(recipeImportJobs)
      .set({
        status: "ready",
        title: resultForStorage.data.name,
        inputData: "",
        mimeType: null,
        recipe: resultForStorage,
        error: null,
        errorCode: null,
        completedAt,
        processingStartedAt: null,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(recipeImportJobs.id, job.id),
          eq(recipeImportJobs.userId, job.userId),
          eq(recipeImportJobs.status, "processing"),
          processingStartedAtMatches(job.processingStartedAt),
        ),
      )
      .returning({ id: recipeImportJobs.id });

    if (completedJob) return "processed";

    const existingJob = await loadRecipeImportJobStatus(ctx, message);
    if (!existingJob) {
      await cleanupRecipeImportImagesBestEffort(ctx.env.IMAGE_SERVICE, job.id);
      return "skipped";
    }

    return "busy";
  } catch (error) {
    if (!(error instanceof TRPCError)) {
      const resetJob = await resetRecipeImportJobForRetry(ctx, job);
      if (!resetJob) return "busy";
      throw error;
    }

    const failedJob = await failRecipeImportJob(
      ctx,
      message,
      getImportErrorCode(error, job.mode),
      {
        expectedStatus: "processing",
        processingStartedAt: job.processingStartedAt,
      },
    );
    return failedJob ? "processed" : "busy";
  }
}

interface FailRecipeImportJobOptions {
  expectedStatus?: "pending" | "processing";
  processingStartedAt?: Date | null;
}

export async function failRecipeImportJob(
  ctx: RecipeImportJobContext,
  message: RecipeImportJobMessage,
  errorCode: PersistedImportErrorCode,
  options?: FailRecipeImportJobOptions,
) {
  const completedAt = new Date();
  let didFailJob = false;
  await ctx.db.transaction(async (tx) => {
    const conditions = [
      eq(recipeImportJobs.id, message.jobId),
      eq(recipeImportJobs.userId, message.userId),
      ne(recipeImportJobs.status, "ready"),
    ];

    if (options?.expectedStatus) {
      conditions.push(eq(recipeImportJobs.status, options.expectedStatus));
    }
    if (options?.expectedStatus === "processing") {
      conditions.push(
        processingStartedAtMatches(options.processingStartedAt ?? null),
      );
    }

    const [failedJob] = await tx
      .update(recipeImportJobs)
      .set({
        status: "failed",
        inputData: "",
        mimeType: null,
        errorCode,
        error: getPublicErrorMessage(errorCode),
        completedAt,
        processingStartedAt: null,
        updatedAt: completedAt,
      })
      .where(and(...conditions))
      .returning({
        id: recipeImportJobs.id,
        importType: recipeImportJobs.importType,
        userId: recipeImportJobs.userId,
        usagePeriodStart: recipeImportJobs.usagePeriodStart,
        refundedAt: recipeImportJobs.refundedAt,
      });

    if (!failedJob) return;
    didFailJob = true;

    if (
      failedJob.importType !== "smart" ||
      !failedJob.usagePeriodStart ||
      failedJob.refundedAt
    )
      return;

    const [markedForRefund] = await tx
      .update(recipeImportJobs)
      .set({
        refundedAt: completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(recipeImportJobs.id, failedJob.id),
          eq(recipeImportJobs.userId, failedJob.userId),
          isNull(recipeImportJobs.refundedAt),
        ),
      )
      .returning({ id: recipeImportJobs.id });

    if (!markedForRefund) return;

    await refundSmartImportUsageForPeriod(
      tx,
      failedJob.userId,
      failedJob.usagePeriodStart,
      completedAt,
    );
  });

  if (didFailJob) {
    await cleanupRecipeImportImagesBestEffort(
      ctx.env.IMAGE_SERVICE,
      message.jobId,
    );
  }

  return didFailJob;
}
