import { recipeImportJobs } from "@repo/db/schemas";
import {
  refundSmartImportUsageForPeriod,
  type DbClient,
} from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

import type { RecipeImportJobMessage, TRPCEnv } from "../env";

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
};

export type ProcessRecipeImportJobResult = "processed" | "skipped" | "busy";

export const RECIPE_IMPORT_PROCESSING_LEASE_MS = 5 * 60 * 1000;

function processingStartedAtMatches(processingStartedAt: Date | null) {
  return processingStartedAt
    ? eq(recipeImportJobs.processingStartedAt, processingStartedAt)
    : isNull(recipeImportJobs.processingStartedAt);
}

export function getImportErrorMessage(error: unknown) {
  if (error instanceof TRPCError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong while importing.";
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
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Basic Import only supports recipe URLs.",
      });
    }

    return await ctx.env.RECIPE_AI.parse({
      type: "url",
      data: job.inputData,
      structuredOnly: true,
    });
  }

  if (job.mode === "url") {
    return await ctx.env.RECIPE_AI.parse({
      type: "url",
      data: job.inputData,
    });
  }

  if (job.mode === "text") {
    return await ctx.env.RECIPE_AI.parse({
      type: "text",
      data: job.inputData,
    });
  }

  if (
    job.mimeType !== "image/jpeg" &&
    job.mimeType !== "image/png" &&
    job.mimeType !== "image/webp"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unsupported image type.",
    });
  }

  return await ctx.env.RECIPE_AI.parse({
    type: "image",
    data: job.inputData,
    mimeType: job.mimeType,
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
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: result.error.message,
      });
    }

    const completedAt = new Date();

    const [completedJob] = await ctx.db
      .update(recipeImportJobs)
      .set({
        status: "ready",
        title: result.data.name,
        inputData: "",
        mimeType: null,
        recipe: result,
        error: null,
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

    return completedJob ? "processed" : "busy";
  } catch (error) {
    if (!(error instanceof TRPCError)) {
      const resetJob = await resetRecipeImportJobForRetry(ctx, job);
      if (!resetJob) return "busy";
      throw error;
    }

    const failedJob = await failRecipeImportJob(
      ctx,
      message,
      getImportErrorMessage(error),
      { processingStartedAt: job.processingStartedAt },
    );
    return failedJob ? "processed" : "busy";
  }
}

interface FailRecipeImportJobOptions {
  processingStartedAt?: Date | null;
}

export async function failRecipeImportJob(
  ctx: RecipeImportJobContext,
  message: RecipeImportJobMessage,
  error: string,
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

    if (options && "processingStartedAt" in options) {
      conditions.push(
        eq(recipeImportJobs.status, "processing"),
        processingStartedAtMatches(options.processingStartedAt ?? null),
      );
    }

    const [failedJob] = await tx
      .update(recipeImportJobs)
      .set({
        status: "failed",
        inputData: "",
        mimeType: null,
        error,
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

  return didFailJob;
}
