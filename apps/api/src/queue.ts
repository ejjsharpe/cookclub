import { getDb } from "@repo/db";
import {
  failRecipeImportJob,
  processRecipeImportJob,
  RECIPE_IMPORT_PROCESSING_LEASE_MS,
} from "@repo/trpc/server";
import type { RecipeImportJobMessage } from "@repo/trpc/server/env";
import { exhaustedImportErrorCode } from "@repo/trpc/server/features/recipe-import/errors";

import {
  captureImportFailure,
  captureQueueException,
} from "./observability/sentry";
import type { Env } from "./types";

const BUSY_RETRY_DELAY_SECONDS =
  Math.ceil(RECIPE_IMPORT_PROCESSING_LEASE_MS / 1000) + 10;
const FAST_RETRY_DELAYS_SECONDS = [5, 15, 40] as const;
const MAX_RETRY_DELAY_SECONDS = 24 * 60 * 60;
const FINAL_ATTEMPT = 4;

function retryDelay(attempts: number, retryAfterSeconds?: number) {
  const configured =
    FAST_RETRY_DELAYS_SECONDS[
      Math.min(attempts - 1, FAST_RETRY_DELAYS_SECONDS.length - 1)
    ] ?? 40;
  if (
    retryAfterSeconds === undefined ||
    !Number.isFinite(retryAfterSeconds)
  ) {
    return configured;
  }
  return Math.min(
    MAX_RETRY_DELAY_SECONDS,
    Math.max(configured, Math.ceil(retryAfterSeconds)),
  );
}

export const queue: ExportedHandlerQueueHandler<
  Env,
  RecipeImportJobMessage
> = async (batch, env) => {
  const db = getDb(env);

  for (const message of batch.messages) {
    try {
      const result = await processRecipeImportJob(
        {
          db,
          env,
          reportFailure: (failure) =>
            captureImportFailure(failure, batch.queue),
        },
        message.body,
      );
      if (result.outcome === "busy") {
        message.retry({ delaySeconds: BUSY_RETRY_DELAY_SECONDS });
        continue;
      }
      if (result.outcome === "retry") {
        const terminal = message.attempts >= FINAL_ATTEMPT;
        if (terminal) {
          const errorCode = exhaustedImportErrorCode(result.errorCode);
          await failRecipeImportJob({ db, env }, message.body, errorCode, {
            expectedStatus: "pending",
          });
          console.error(
            JSON.stringify({
              event: "recipe_import_retry_exhausted",
              queue: batch.queue,
              jobId: message.body.jobId,
              userId: message.body.userId,
              attempts: message.attempts,
              errorCode,
            }),
          );
          message.retry();
          continue;
        }

        const delaySeconds = retryDelay(
          message.attempts,
          result.retryAfterSeconds,
        );
        console.log(
          JSON.stringify({
            event: "recipe_import_retry_scheduled",
            queue: batch.queue,
            jobId: message.body.jobId,
            userId: message.body.userId,
            attempts: message.attempts,
            errorCode: result.errorCode,
            delaySeconds,
          }),
        );
        message.retry({ delaySeconds });
        continue;
      }

      message.ack();
    } catch (error) {
      const terminal = message.attempts >= FINAL_ATTEMPT;
      captureQueueException(error, {
        queue: batch.queue,
        messageId: message.id,
        attempts: message.attempts,
        terminal,
        jobId: message.body.jobId,
        userId: message.body.userId,
      });

      if (terminal) {
        await failRecipeImportJob(
          { db, env },
          message.body,
          "SERVICE_UNAVAILABLE",
        );
        message.retry();
        continue;
      }

      console.error(
        JSON.stringify({
          task: "recipe-import-job",
          queue: batch.queue,
          messageId: message.id,
          errorStack:
            error instanceof Error ? error.stack : "Non-Error queue failure",
        }),
      );
      message.retry({ delaySeconds: retryDelay(message.attempts) });
    }
  }
};
