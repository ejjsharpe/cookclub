import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertInteractionAllowed: vi.fn(),
}));

vi.mock("@repo/db/schemas", () => ({
  activityEvents: {
    id: "activity_events.id",
    userId: "activity_events.user_id",
    moderationState: "activity_events.moderation_state",
  },
  comments: {
    id: "comments.id",
    userId: "comments.user_id",
    activityEventId: "comments.activity_event_id",
    parentCommentId: "comments.parent_comment_id",
    content: "comments.content",
    moderationState: "comments.moderation_state",
    createdAt: "comments.created_at",
  },
  user: {
    id: "user.id",
    name: "user.name",
    image: "user.image",
  },
}));

vi.mock("@repo/db/services", () => ({
  getBlockedUserIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  notInArray: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("../legal", () => ({
  requireCurrentTerms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/push-notification.service", () => ({
  createAndSendNotificationInBackground: vi.fn(),
}));

vi.mock("./moderation-router", () => ({
  assertInteractionAllowed: mocks.assertInteractionAllowed,
}));

// Import after mocks.
// eslint-disable-next-line import/first
import { commentRouter } from "./comment-router";

function createContext() {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    then: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.then.mockImplementation((resolve) =>
    Promise.resolve(
      resolve([
        {
          userId: "activity-owner",
          moderationState: "visible",
        },
      ]),
    ),
  );

  return {
    db: { select: vi.fn().mockReturnValue(query) },
    env: {},
    user: { id: "commenter", name: "Commenter", image: null },
    req: new Request("https://api.cookclub.app/trpc"),
    resHeaders: new Headers(),
  };
}

describe("commentRouter.createComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the typed interaction error when either user has blocked the other", async () => {
    mocks.assertInteractionAllowed.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "Interaction blocked" }),
    );
    const caller = commentRouter.createCaller(createContext() as never);

    await expect(
      caller.createComment({ activityEventId: 42, content: "Looks great" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
