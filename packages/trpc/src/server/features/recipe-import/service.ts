import type {
  ParseDiagnostics,
  RecipeImportParseResponse,
} from "@repo/contracts/recipe-ai";
import type {
  CreateRecipeImportRequest,
  RecipeImportErrorCode,
  RecipeImportMode,
  RecipeImportSource,
  RecipeImportStatus,
  RecipeImportType,
} from "@repo/contracts/recipe-import";
import {
  RECIPE_IMPORT_LIMITS,
  isBasicImportUnsupportedUrl,
  normalizeRecipeImportUrl,
  recipeImportPlaceholderTitle,
  recipeImportStrategyForType,
} from "@repo/contracts/recipe-import";
import { recipeImportJobs, user } from "@repo/db/schemas";
import {
  refundSmartImportUsageForPeriod,
  type DbClient,
} from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { cleanupRecipeImportImagesBestEffort } from "./cleanup";
import type { RecipeImportJobMessage, TRPCEnv } from "../../env";
import { getPublicErrorMessage, PublicTRPCError } from "../../public-errors";
import { consumeSmartImportAllowance } from "../../services/subscription.service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DIAGNOSTIC_STAGES = 32;
const STALE_SWEEP_BATCH_SIZE = 100;

const ACTIVE_STATUSES = [
  "pending",
  "processing",
] as const satisfies readonly RecipeImportStatus[];

type ImportJobRow = typeof recipeImportJobs.$inferSelect;

export type ImportJobSummary = Pick<
  ImportJobRow,
  | "id"
  | "importType"
  | "mode"
  | "title"
  | "status"
  | "error"
  | "errorCode"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
>;

export type RecipeImportFailureEvent = {
  event:
    | "recipe_import_terminal_failure"
    | "recipe_import_retry_scheduled"
    | "recipe_import_retry_exhausted"
    | "recipe_import_stale_recovery"
    | "recipe_import_idempotent_replay"
    | "recipe_import_cache_policy_rejection"
    | "recipe_import_image_staging_failure";
  jobId: string;
  userId: string;
  importType?: RecipeImportType;
  mode?: RecipeImportMode;
  errorCode?: RecipeImportErrorCode;
  retryAfterSeconds?: number;
  sourceHost?: string;
  sourceUrl?: string;
};

export type RecipeImportJobContext = {
  db: DbClient;
  env: TRPCEnv;
  reportFailure?: (failure: RecipeImportFailureEvent) => void;
};

export type ProcessRecipeImportJobResult =
  | { outcome: "ready" | "skipped" | "busy" }
  | {
      outcome: "retry";
      errorCode: RecipeImportErrorCode;
      retryAfterSeconds?: number;
    };

export const RECIPE_IMPORT_PROCESSING_LEASE_MS =
  RECIPE_IMPORT_LIMITS.processingLeaseMs;

function jobSummary(row: ImportJobRow): ImportJobSummary {
  return {
    id: row.id,
    importType: row.importType,
    mode: row.mode,
    title: row.title,
    status: row.status,
    error: row.error,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export async function fingerprintRecipeImportRequest(
  value: unknown,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(value)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateJobId(id: string) {
  if (!UUID_PATTERN.test(id)) {
    throw new PublicTRPCError({
      code: "BAD_REQUEST",
      appCode: "INVALID_INPUT",
      message: "Import job id must be a UUID.",
    });
  }
}

function normalizeSource(
  importType: RecipeImportType,
  source: RecipeImportSource,
): RecipeImportSource {
  if (importType === "basic" && source.type !== "url") {
    throw new PublicTRPCError({
      code: "BAD_REQUEST",
      appCode: "IMPORT_INVALID_URL",
    });
  }

  if (source.type === "url") {
    let value: string;
    try {
      value = normalizeRecipeImportUrl(source.value);
    } catch {
      throw new PublicTRPCError({
        code: "BAD_REQUEST",
        appCode: "IMPORT_INVALID_URL",
      });
    }
    if (value.length > RECIPE_IMPORT_LIMITS.urlCharacters) {
      throw new PublicTRPCError({
        code: "PAYLOAD_TOO_LARGE",
        appCode: "PAYLOAD_TOO_LARGE",
      });
    }
    if (importType === "basic" && isBasicImportUnsupportedUrl(value)) {
      throw new PublicTRPCError({
        code: "BAD_REQUEST",
        appCode: "IMPORT_UNSUPPORTED_SOURCE",
      });
    }
    return { type: "url", value };
  }

  if (source.type === "text") {
    const value = source.value.trim();
    if (!value) {
      throw new PublicTRPCError({
        code: "BAD_REQUEST",
        appCode: "INVALID_INPUT",
      });
    }
    if (value.length > RECIPE_IMPORT_LIMITS.textCharacters) {
      throw new PublicTRPCError({
        code: "PAYLOAD_TOO_LARGE",
        appCode: "PAYLOAD_TOO_LARGE",
      });
    }
    return { type: "text", value };
  }

  const { uploadKeys } = source;
  if (uploadKeys.length === 0) {
    throw new PublicTRPCError({
      code: "BAD_REQUEST",
      appCode: "IMPORT_IMAGE_INVALID",
    });
  }
  if (uploadKeys.length > RECIPE_IMPORT_LIMITS.sourceImages) {
    throw new PublicTRPCError({
      code: "PAYLOAD_TOO_LARGE",
      appCode: "PAYLOAD_TOO_LARGE",
    });
  }
  if (
    new Set(uploadKeys).size !== uploadKeys.length ||
    uploadKeys.some((uploadKey) => !uploadKey.startsWith("temp/"))
  ) {
    throw new PublicTRPCError({
      code: "BAD_REQUEST",
      appCode: "IMPORT_IMAGE_INVALID",
    });
  }
  return { type: "image", uploadKeys: [...uploadKeys] };
}

export async function enqueueRecipeImportJob(
  env: TRPCEnv,
  job: Pick<ImportJobRow, "id" | "userId" | "importType" | "mode">,
) {
  const message = { jobId: job.id, userId: job.userId };
  if (job.importType === "basic") {
    await env.RECIPE_IMPORT_BASIC_QUEUE.send(message);
    return;
  }
  if (job.mode === "url") {
    await env.RECIPE_IMPORT_URL_QUEUE.send(message);
  } else if (job.mode === "text") {
    await env.RECIPE_IMPORT_TEXT_QUEUE.send(message);
  } else {
    await env.RECIPE_IMPORT_IMAGE_QUEUE.send(message);
  }
}

export async function createRecipeImportJob(
  ctx: RecipeImportJobContext,
  userId: string,
  request: CreateRecipeImportRequest,
): Promise<ImportJobSummary> {
  validateJobId(request.id);
  const source = normalizeSource(request.importType, request.source);
  const fingerprint = await fingerprintRecipeImportRequest({
    version: 3,
    importType: request.importType,
    source,
  });

  if (source.type === "image") {
    try {
      const stagingResults = await Promise.allSettled(
        source.uploadKeys.map((uploadKey, sourceIndex) =>
          ctx.env.IMAGE_SERVICE.stageImportSource(
            uploadKey,
            userId,
            request.id,
            sourceIndex,
            source.uploadKeys.length,
          ),
        ),
      );
      const failedStaging = stagingResults.find(
        (result) => result.status === "rejected",
      );
      if (failedStaging?.status === "rejected") {
        throw failedStaging.reason;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown staging error";
      const terminal =
        /invalid|does not belong|not found|too large|content type/i.test(
          message,
        );
      const errorCode = terminal
        ? "IMPORT_IMAGE_INVALID"
        : "SERVICE_UNAVAILABLE";
      ctx.reportFailure?.({
        event: "recipe_import_image_staging_failure",
        jobId: request.id,
        userId,
        importType: request.importType,
        mode: "image",
        errorCode,
      });
      console.error(
        JSON.stringify({
          event: "recipe_import_image_staging_failure",
          jobId: request.id,
          userId,
          message,
        }),
      );
      throw new PublicTRPCError({
        code: terminal ? "BAD_REQUEST" : "SERVICE_UNAVAILABLE",
        appCode: errorCode,
        cause: error,
      });
    }
  }

  const now = new Date();
  let replayed = false;
  const row = await ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT ${user.id} FROM ${user} WHERE ${user.id} = ${userId} FOR UPDATE`,
    );

    const existing = await tx
      .select()
      .from(recipeImportJobs)
      .where(eq(recipeImportJobs.id, request.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.requestFingerprint !== fingerprint
      ) {
        throw new PublicTRPCError({
          code: "CONFLICT",
          appCode: "CONFLICT",
          message: "Import job id is already in use.",
        });
      }
      replayed = true;
      return existing;
    }

    const activeCount = await tx
      .select({ value: count() })
      .from(recipeImportJobs)
      .where(
        and(
          eq(recipeImportJobs.userId, userId),
          inArray(recipeImportJobs.status, [...ACTIVE_STATUSES]),
        ),
      )
      .then((rows) => Number(rows[0]?.value ?? 0));
    if (activeCount >= RECIPE_IMPORT_LIMITS.activeJobsPerUser) {
      throw new PublicTRPCError({
        code: "TOO_MANY_REQUESTS",
        appCode: "IMPORT_ACTIVE_LIMIT_REACHED",
      });
    }

    let usagePeriodStart: Date | null = null;
    if (request.importType === "smart") {
      const allowance = await consumeSmartImportAllowance({
        db: tx,
        env: ctx.env,
        user: { id: userId },
      });
      if (!allowance.isPro && allowance.consumedSmartImport) {
        usagePeriodStart = allowance.smartImports.periodStart;
      }
    }

    return await tx
      .insert(recipeImportJobs)
      .values({
        id: request.id,
        userId,
        importType: request.importType,
        mode: source.type,
        title: recipeImportPlaceholderTitle(source),
        sourceData:
          source.type === "image"
            ? source.uploadKeys.length > 1
              ? String(source.uploadKeys.length)
              : null
            : source.value,
        requestFingerprint: fingerprint,
        status: "pending",
        usagePeriodStart,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .then((rows) => rows[0]!);
  });

  if (replayed) {
    ctx.reportFailure?.({
      event: "recipe_import_idempotent_replay",
      jobId: row.id,
      userId,
      importType: row.importType as RecipeImportType,
      mode: row.mode as RecipeImportMode,
    });
  }

  if (row.status === "pending") {
    try {
      await enqueueRecipeImportJob(ctx.env, row);
    } catch (error) {
      throw new PublicTRPCError({
        code: "SERVICE_UNAVAILABLE",
        appCode: "SERVICE_UNAVAILABLE",
        cause: error,
      });
    }
  }

  return jobSummary(row);
}

export async function listRecipeImportJobs(
  db: DbClient,
  userId: string,
): Promise<ImportJobSummary[]> {
  const fields = {
    id: recipeImportJobs.id,
    importType: recipeImportJobs.importType,
    mode: recipeImportJobs.mode,
    title: recipeImportJobs.title,
    status: recipeImportJobs.status,
    error: recipeImportJobs.error,
    errorCode: recipeImportJobs.errorCode,
    createdAt: recipeImportJobs.createdAt,
    updatedAt: recipeImportJobs.updatedAt,
    completedAt: recipeImportJobs.completedAt,
  };
  const [active, terminal] = await Promise.all([
    db
      .select(fields)
      .from(recipeImportJobs)
      .where(
        and(
          eq(recipeImportJobs.userId, userId),
          inArray(recipeImportJobs.status, [...ACTIVE_STATUSES]),
        ),
      )
      .orderBy(desc(recipeImportJobs.createdAt)),
    db
      .select(fields)
      .from(recipeImportJobs)
      .where(
        and(
          eq(recipeImportJobs.userId, userId),
          inArray(recipeImportJobs.status, ["ready", "failed"]),
        ),
      )
      .orderBy(desc(recipeImportJobs.createdAt))
      .limit(15),
  ]);
  return [...active, ...terminal] as ImportJobSummary[];
}

export async function getRecipeImportJob(
  db: DbClient,
  userId: string,
  id: string,
) {
  validateJobId(id);
  const job = await db
    .select({
      id: recipeImportJobs.id,
      importType: recipeImportJobs.importType,
      mode: recipeImportJobs.mode,
      title: recipeImportJobs.title,
      status: recipeImportJobs.status,
      recipe: recipeImportJobs.recipe,
      error: recipeImportJobs.error,
      errorCode: recipeImportJobs.errorCode,
      createdAt: recipeImportJobs.createdAt,
      updatedAt: recipeImportJobs.updatedAt,
      completedAt: recipeImportJobs.completedAt,
    })
    .from(recipeImportJobs)
    .where(
      and(
        eq(recipeImportJobs.id, id),
        eq(recipeImportJobs.userId, userId),
        inArray(recipeImportJobs.status, [
          "pending",
          "processing",
          "ready",
          "failed",
        ]),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!job) {
    throw new PublicTRPCError({ code: "NOT_FOUND", appCode: "NOT_FOUND" });
  }
  return job;
}

export async function dismissRecipeImportJob(
  ctx: RecipeImportJobContext,
  userId: string,
  id: string,
) {
  validateJobId(id);
  const deleted = await ctx.db
    .delete(recipeImportJobs)
    .where(
      and(
        eq(recipeImportJobs.id, id),
        eq(recipeImportJobs.userId, userId),
        inArray(recipeImportJobs.status, [
          "pending",
          "processing",
          "ready",
          "failed",
        ]),
      ),
    )
    .returning({ id: recipeImportJobs.id });
  if (deleted[0]) {
    await cleanupRecipeImportImagesBestEffort(ctx.env.IMAGE_SERVICE, id);
  }
  return { success: true as const };
}

function processingLeaseMatches(value: Date | null) {
  return value
    ? eq(recipeImportJobs.processingStartedAt, value)
    : isNull(recipeImportJobs.processingStartedAt);
}

async function claimRecipeImportJob(
  ctx: RecipeImportJobContext,
  message: RecipeImportJobMessage,
  now = new Date(),
): Promise<ImportJobRow | null> {
  const staleBefore = new Date(
    now.getTime() - RECIPE_IMPORT_LIMITS.processingLeaseMs,
  );
  return await ctx.db
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
    .returning()
    .then((rows) => rows[0] ?? null);
}

async function resetRecipeImportJobForRetry(
  ctx: RecipeImportJobContext,
  job: ImportJobRow,
) {
  return await ctx.db
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
        processingLeaseMatches(job.processingStartedAt),
      ),
    )
    .returning({ id: recipeImportJobs.id })
    .then((rows) => Boolean(rows[0]));
}

function sourceHost(job: ImportJobRow) {
  if (job.mode !== "url" || !job.sourceData) return undefined;
  try {
    return new URL(job.sourceData).hostname;
  } catch {
    return undefined;
  }
}

async function parseRecipeImportJob(
  ctx: RecipeImportJobContext,
  job: ImportJobRow,
): Promise<RecipeImportParseResponse> {
  const strategy = recipeImportStrategyForType(
    job.importType as RecipeImportType,
  );
  if (job.mode === "url" && job.sourceData) {
    return await ctx.env.RECIPE_AI.parse({
      type: "url",
      data: job.sourceData,
      strategy,
      imageStagingId: job.id,
    });
  }
  if (job.mode === "text" && job.sourceData && strategy === "ai-assisted") {
    return await ctx.env.RECIPE_AI.parse({
      type: "text",
      data: job.sourceData,
      strategy,
      imageStagingId: job.id,
    });
  }
  if (job.mode === "image" && strategy === "ai-assisted") {
    const storedImageCount = Number(job.sourceData ?? 1);
    const imageCount =
      Number.isInteger(storedImageCount) &&
      storedImageCount > 1 &&
      storedImageCount <= RECIPE_IMPORT_LIMITS.sourceImages
        ? storedImageCount
        : 1;
    return await ctx.env.RECIPE_AI.parse({
      type: "image",
      jobId: job.id,
      strategy,
      imageStagingId: job.id,
      ...(imageCount > 1 ? { imageCount } : {}),
    });
  }
  return {
    success: false,
    error: {
      code: job.mode === "url" ? "IMPORT_INVALID_URL" : "IMPORT_IMAGE_INVALID",
      message: "Import source is invalid.",
      disposition: "terminal",
    },
  };
}

function appendJobUpdateDiagnostics(
  result: Extract<RecipeImportParseResponse, { success: true }>,
  startTime: number,
): Extract<RecipeImportParseResponse, { success: true }> {
  const diagnostics: ParseDiagnostics = result.metadata.diagnostics ?? {};
  return {
    ...result,
    metadata: {
      ...result.metadata,
      diagnostics: {
        ...diagnostics,
        stageTimings: [
          ...(diagnostics.stageTimings ?? []),
          {
            name: "job_update",
            status: "success" as const,
            elapsedMs: Math.max(0, Date.now() - startTime),
            detail: "recipe_import_jobs",
          },
        ].slice(-MAX_DIAGNOSTIC_STAGES),
      },
    },
  };
}

export async function processRecipeImportJob(
  ctx: RecipeImportJobContext,
  message: RecipeImportJobMessage,
): Promise<ProcessRecipeImportJobResult> {
  const job = await claimRecipeImportJob(ctx, message);
  if (!job) {
    const existing = await ctx.db
      .select({ status: recipeImportJobs.status })
      .from(recipeImportJobs)
      .where(
        and(
          eq(recipeImportJobs.id, message.jobId),
          eq(recipeImportJobs.userId, message.userId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return {
      outcome: existing?.status === "processing" ? "busy" : "skipped",
    };
  }

  try {
    const result = await parseRecipeImportJob(ctx, job);
    if (!result.success) {
      const host = sourceHost(job);
      ctx.reportFailure?.({
        event:
          result.error.disposition === "retry"
            ? "recipe_import_retry_scheduled"
            : "recipe_import_terminal_failure",
        jobId: job.id,
        userId: job.userId,
        importType: job.importType as RecipeImportType,
        mode: job.mode as RecipeImportMode,
        errorCode: result.error.code,
        ...(result.error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: result.error.retryAfterSeconds }
          : {}),
        ...(host && job.sourceData
          ? { sourceHost: host, sourceUrl: job.sourceData }
          : {}),
      });

      if (result.error.disposition === "retry") {
        const reset = await resetRecipeImportJobForRetry(ctx, job);
        return reset
          ? {
              outcome: "retry",
              errorCode: result.error.code,
              ...(result.error.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: result.error.retryAfterSeconds }
                : {}),
            }
          : { outcome: "busy" };
      }

      const failed = await failRecipeImportJob(
        ctx,
        message,
        result.error.code,
        {
          expectedStatus: "processing",
          processingStartedAt: job.processingStartedAt,
        },
      );
      return { outcome: failed ? "ready" : "busy" };
    }

    const completedAt = new Date();
    const storedResult = appendJobUpdateDiagnostics(result, Date.now());
    const updated = await ctx.db
      .update(recipeImportJobs)
      .set({
        status: "ready",
        title: storedResult.data.name.slice(
          0,
          RECIPE_IMPORT_LIMITS.placeholderTitleCharacters,
        ),
        sourceData: null,
        recipe: storedResult,
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
          processingLeaseMatches(job.processingStartedAt),
        ),
      )
      .returning({ id: recipeImportJobs.id });
    return { outcome: updated[0] ? "ready" : "busy" };
  } catch (error) {
    const reset = await resetRecipeImportJobForRetry(ctx, job);
    console.error(
      JSON.stringify({
        event: "recipe_import_unexpected_retry",
        jobId: job.id,
        userId: job.userId,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return reset
      ? { outcome: "retry", errorCode: "SERVICE_UNAVAILABLE" }
      : { outcome: "busy" };
  }
}

interface FailOptions {
  expectedStatus?: "pending" | "processing";
  processingStartedAt?: Date | null;
}

export async function failRecipeImportJob(
  ctx: RecipeImportJobContext,
  message: RecipeImportJobMessage,
  errorCode: RecipeImportErrorCode,
  options?: FailOptions,
) {
  const completedAt = new Date();
  let didFail = false;
  await ctx.db.transaction(async (tx) => {
    const conditions = [
      eq(recipeImportJobs.id, message.jobId),
      eq(recipeImportJobs.userId, message.userId),
      inArray(recipeImportJobs.status, [...ACTIVE_STATUSES]),
    ];
    if (options?.expectedStatus) {
      conditions.push(eq(recipeImportJobs.status, options.expectedStatus));
    }
    if (options?.expectedStatus === "processing") {
      conditions.push(
        processingLeaseMatches(options.processingStartedAt ?? null),
      );
    }

    const failed = await tx
      .update(recipeImportJobs)
      .set({
        status: "failed",
        sourceData: null,
        recipe: null,
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
      })
      .then((rows) => rows[0] ?? null);
    if (!failed) return;
    didFail = true;

    if (
      failed.importType !== "smart" ||
      !failed.usagePeriodStart ||
      failed.refundedAt
    ) {
      return;
    }
    const marked = await tx
      .update(recipeImportJobs)
      .set({ refundedAt: completedAt, updatedAt: completedAt })
      .where(
        and(
          eq(recipeImportJobs.id, failed.id),
          isNull(recipeImportJobs.refundedAt),
        ),
      )
      .returning({ id: recipeImportJobs.id });
    if (marked[0]) {
      await refundSmartImportUsageForPeriod(
        tx,
        failed.userId,
        failed.usagePeriodStart,
        completedAt,
      );
    }
  });

  if (didFail) {
    await cleanupRecipeImportImagesBestEffort(
      ctx.env.IMAGE_SERVICE,
      message.jobId,
    );
  }
  return didFail;
}

export async function recoverStaleRecipeImportJobs(
  ctx: RecipeImportJobContext,
  now = new Date(),
) {
  const pendingBefore = new Date(
    now.getTime() - RECIPE_IMPORT_LIMITS.pendingTimeoutMs,
  );
  const processingBefore = new Date(
    now.getTime() - RECIPE_IMPORT_LIMITS.processingTimeoutMs,
  );
  const candidates = await ctx.db
    .select({
      id: recipeImportJobs.id,
      userId: recipeImportJobs.userId,
      status: recipeImportJobs.status,
      updatedAt: recipeImportJobs.updatedAt,
      processingStartedAt: recipeImportJobs.processingStartedAt,
    })
    .from(recipeImportJobs)
    .where(
      or(
        and(
          eq(recipeImportJobs.status, "pending"),
          lt(recipeImportJobs.updatedAt, pendingBefore),
        ),
        and(
          eq(recipeImportJobs.status, "processing"),
          or(
            and(
              isNull(recipeImportJobs.processingStartedAt),
              lt(recipeImportJobs.updatedAt, processingBefore),
            ),
            lt(recipeImportJobs.processingStartedAt, processingBefore),
          ),
        ),
      ),
    )
    .orderBy(recipeImportJobs.updatedAt)
    .limit(STALE_SWEEP_BATCH_SIZE);

  let recovered = 0;
  for (const job of candidates) {
    const failed = await failRecipeImportJob(
      ctx,
      { jobId: job.id, userId: job.userId },
      "IMPORT_TIMED_OUT",
      job.status === "processing"
        ? {
            expectedStatus: "processing",
            processingStartedAt: job.processingStartedAt,
          }
        : { expectedStatus: "pending" },
    );
    if (failed) {
      recovered++;
      ctx.reportFailure?.({
        event: "recipe_import_stale_recovery",
        jobId: job.id,
        userId: job.userId,
        errorCode: "IMPORT_TIMED_OUT",
      });
    }
  }
  return { checked: candidates.length, recovered };
}

export function assertReadyImportJob(job: Pick<ImportJobRow, "status"> | null) {
  if (!job) {
    throw new PublicTRPCError({ code: "NOT_FOUND", appCode: "NOT_FOUND" });
  }
  if (job.status !== "ready") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Import job is not ready.",
    });
  }
}
