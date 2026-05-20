import { createApp } from "./app";
import { FeedDO } from "./durable-objects/FeedDO";
import { scheduled } from "./scheduled";

export { FeedDO };

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled,
};
