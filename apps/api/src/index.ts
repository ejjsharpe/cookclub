import type { RecipeImportJobMessage } from "@repo/trpc/server/env";
import { withSentry } from "@sentry/hono/cloudflare";

import { createApp } from "./app";
import { FeedDO } from "./durable-objects/FeedDO";
import { getSentryOptions } from "./observability/sentry";
import { queue } from "./queue";
import { scheduled } from "./scheduled";
import type { Env } from "./types";

export { FeedDO };

const app = createApp();

const handler = {
  fetch: app.fetch,
  queue,
  scheduled,
} satisfies ExportedHandler<Env, RecipeImportJobMessage>;

export default withSentry<Env, RecipeImportJobMessage>(
  getSentryOptions,
  handler,
);
