import { getDb } from "@repo/db";
import {
  cleanupOrphanedRecipeImportImages,
  processPushNotificationReceipts,
  recoverStaleRecipeImportJobs,
} from "@repo/trpc/server";

import type { Env } from "./types";

const TRANSIENT_INFRASTRUCTURE_ERROR_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "57P01",
  "57P02",
  "57P03",
  "58000",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

const TRANSIENT_INFRASTRUCTURE_ERROR_MESSAGES = [
  "failed to acquire a connection from the pool",
  "client has encountered a connection error",
  "connect timeout",
  "connection refused",
  "connection reset",
  "connection terminated",
  "connection timeout",
  "network socket disconnected",
  "socket hang up",
];

type ErrorDetails = {
  name: string;
  message: string;
  code?: string;
};

function findTransientInfrastructureError(error: unknown): ErrorDetails | null {
  const seen = new Set<unknown>();
  let current = error;

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);

    if (typeof current === "string") {
      const stringError = current;
      const isTransient = TRANSIENT_INFRASTRUCTURE_ERROR_MESSAGES.some(
        (fragment) => stringError.toLowerCase().includes(fragment),
      );
      return isTransient ? { name: "Error", message: stringError } : null;
    }

    if (typeof current !== "object") {
      return null;
    }

    const candidate = current as {
      cause?: unknown;
      code?: unknown;
      message?: unknown;
      name?: unknown;
    };
    const code =
      typeof candidate.code === "string" ? candidate.code : undefined;
    const message =
      typeof candidate.message === "string" ? candidate.message : "";
    const isTransient =
      (code !== undefined && TRANSIENT_INFRASTRUCTURE_ERROR_CODES.has(code)) ||
      TRANSIENT_INFRASTRUCTURE_ERROR_MESSAGES.some((fragment) =>
        message.toLowerCase().includes(fragment),
      );

    if (isTransient) {
      return {
        name: typeof candidate.name === "string" ? candidate.name : "Error",
        message,
        ...(code ? { code } : {}),
      };
    }

    current = candidate.cause;
  }

  return null;
}

function deferTransientScheduledTaskFailure(
  task: string,
  error: unknown,
): boolean {
  const transientError = findTransientInfrastructureError(error);

  if (!transientError) {
    return false;
  }

  console.warn(
    JSON.stringify({
      task,
      status: "deferred",
      reason: "transient-infrastructure-error",
      error: transientError,
    }),
  );

  return true;
}

export const scheduled: ExportedHandlerScheduledHandler<Env> = async (
  _event,
  env,
  _ctx,
) => {
  const db = getDb(env);
  const [receiptOutcome, importImageOutcome, staleImportOutcome] =
    await Promise.allSettled([
      processPushNotificationReceipts(db, env),
      cleanupOrphanedRecipeImportImages(db, env.IMAGE_SERVICE),
      recoverStaleRecipeImportJobs({ db, env }),
    ]);
  const unexpectedErrors: unknown[] = [];

  if (receiptOutcome.status === "fulfilled") {
    console.log(
      JSON.stringify({
        task: "push-notification-receipts",
        checked: receiptOutcome.value.checked,
        disabledTokens: receiptOutcome.value.disabledTokens,
      }),
    );
  } else if (
    !deferTransientScheduledTaskFailure(
      "push-notification-receipts",
      receiptOutcome.reason,
    )
  ) {
    unexpectedErrors.push(receiptOutcome.reason);
  }

  if (importImageOutcome.status === "fulfilled") {
    console.log(
      JSON.stringify({
        task: "recipe-import-image-cleanup",
        checked: importImageOutcome.value.checked,
        deletedJobs: importImageOutcome.value.deletedJobs,
        expiredJobs: importImageOutcome.value.expiredJobs,
      }),
    );
  } else if (
    !deferTransientScheduledTaskFailure(
      "recipe-import-image-cleanup",
      importImageOutcome.reason,
    )
  ) {
    unexpectedErrors.push(importImageOutcome.reason);
  }

  if (staleImportOutcome.status === "fulfilled") {
    console.log(
      JSON.stringify({
        task: "recipe-import-stale-recovery",
        checked: staleImportOutcome.value.checked,
        recovered: staleImportOutcome.value.recovered,
      }),
    );
  } else if (
    !deferTransientScheduledTaskFailure(
      "recipe-import-stale-recovery",
      staleImportOutcome.reason,
    )
  ) {
    unexpectedErrors.push(staleImportOutcome.reason);
  }

  if (unexpectedErrors.length > 0) {
    throw unexpectedErrors[0];
  }
};
