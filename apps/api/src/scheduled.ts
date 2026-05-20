import { getDb } from "@repo/db";
import { processPushNotificationReceipts } from "@repo/trpc/server";

import type { Env } from "./types";

export const scheduled: ExportedHandlerScheduledHandler<Env> = async (
  _event,
  env,
  _ctx,
) => {
  const result = await processPushNotificationReceipts(getDb(env), env);
  console.log(
    JSON.stringify({
      task: "push-notification-receipts",
      checked: result.checked,
      disabledTokens: result.disabledTokens,
    }),
  );
};
