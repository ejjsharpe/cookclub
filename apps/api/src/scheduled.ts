import { getDb } from "@repo/db";
import {
  cleanupOrphanedRecipeImportImages,
  processPushNotificationReceipts,
} from "@repo/trpc/server";

import type { Env } from "./types";

export const scheduled: ExportedHandlerScheduledHandler<Env> = async (
  _event,
  env,
  _ctx,
) => {
  const db = getDb(env);
  const [receiptResult, importImageResult] = await Promise.all([
    processPushNotificationReceipts(db, env),
    cleanupOrphanedRecipeImportImages(db, env.IMAGE_SERVICE),
  ]);
  console.log(
    JSON.stringify({
      task: "push-notification-receipts",
      checked: receiptResult.checked,
      disabledTokens: receiptResult.disabledTokens,
    }),
  );
  console.log(
    JSON.stringify({
      task: "recipe-import-image-cleanup",
      checked: importImageResult.checked,
      deletedJobs: importImageResult.deletedJobs,
      expiredJobs: importImageResult.expiredJobs,
    }),
  );
};
