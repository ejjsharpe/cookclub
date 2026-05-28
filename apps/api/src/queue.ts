import { getDb } from "@repo/db";
import {
  failRecipeImportJob,
  processRecipeImportJob,
  RECIPE_IMPORT_PROCESSING_LEASE_MS,
} from "@repo/trpc/server";
import type { RecipeImportJobMessage } from "@repo/trpc/server/env";

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
      const result = await processRecipeImportJob({ db, env }, message.body);
      if (result === "busy") {
        message.retry({ delaySeconds: BUSY_RETRY_DELAY_SECONDS });
        continue;
      }

      message.ack();
    } catch (error) {
      if (message.attempts >= 3) {
        await failRecipeImportJob(
          { db, env },
          message.body,
          "Import failed after multiple attempts. Please try again.",
        );
        message.ack();
        continue;
      }

      console.error(
        JSON.stringify({
          task: "recipe-import-job",
          queue: batch.queue,
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      message.retry({ delaySeconds: Math.min(60, 5 * message.attempts) });
    }
  }
};
