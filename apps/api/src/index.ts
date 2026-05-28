import { createApp } from "./app";
import { FeedDO } from "./durable-objects/FeedDO";
import { queue } from "./queue";
import { scheduled } from "./scheduled";

export { FeedDO };

const app = createApp();

export default {
  fetch: app.fetch,
  queue,
  scheduled,
};
