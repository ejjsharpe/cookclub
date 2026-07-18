import { getDb } from "@repo/db";
import {
  failRecipeImportJob,
  processRecipeImportJob,
  RECIPE_IMPORT_PROCESSING_LEASE_MS,
} from "@repo/trpc/server";
import type { RecipeImportJobMessage } from "@repo/trpc/server/env";

import {
  captureImportFailure,
  captureQueueException,
} from "./observability/sentry";
import type { Env } from "./types";

const BUSY_RETRY_DELAY_SECONDS =
  Math.ceil(RECIPE_IMPORT_PROCESSING_LEASE_MS / 1000) + 10;

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
      if (result === "busy") {
        message.retry({ delaySeconds: BUSY_RETRY_DELAY_SECONDS });
        continue;
      }

      message.ack();
    } catch (error) {
      const terminal = message.attempts >= 3;
      captureQueueException(error, {
        queue: batch.queue,
        messageId: message.id,
        attempts: message.attempts,
        terminal,
        jobId: message.body.jobId,
        userId: message.body.userId,
      });

      if (terminal) {
        await failRecipeImportJob({ db, env }, message.body, "IMPORT_FAILED");
        message.ack();
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
      message.retry({ delaySeconds: Math.min(60, 5 * message.attempts) });
    }
  }
};
