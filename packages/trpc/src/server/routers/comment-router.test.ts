import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertInteractionAllowed: vi.fn(),
  createAndSendNotificationInBackground: vi.fn(),
  getBlockedUserIds: vi.fn().mockResolvedValue([]),
  notInArray: vi.fn(),
}));

vi.mock("@repo/db/schemas", () => ({
  activityEvents: {
    id: "activity_events.id",
    userId: "activity_events.user_id",
    moderationState: "activity_events.moderation_state",
  },
  comments: {
    _name: "comments",
    id: "comments.id",
    userId: "comments.user_id",
    activityEventId: "comments.activity_event_id",
    parentCommentId: "comments.parent_comment_id",
    content: "comments.content",
    moderationState: "comments.moderation_state",
    createdAt: "comments.created_at",
  },
  commentMentions: {
    _name: "comment_mentions",
    commentId: "comment_mentions.comment_id",
    userId: "comment_mentions.user_id",
    username: "comment_mentions.username",
  },
  user: {
    id: "user.id",
    name: "user.name",
    username: "user.username",
    image: "user.image",
    emailVerified: "user.email_verified",
    onboardingCompleted: "user.onboarding_completed",
  },
}));

vi.mock("@repo/db/services", () => ({
  getBlockedUserIds: mocks.getBlockedUserIds,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNotNull: vi.fn(),
  notInArray: mocks.notInArray,
  or: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("../legal", () => ({
  requireCurrentTerms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/push-notification.service", () => ({
  createAndSendNotificationInBackground:
    mocks.createAndSendNotificationInBackground,
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

function createSelectQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.then.mockImplementation((resolve) => Promise.resolve(resolve(rows)));
  return query;
}

function createMentionMutationDb(parentAuthorId?: string) {
  const parentCommentId = parentAuthorId ? 51 : null;
  const insertedMentionValues: unknown[] = [];
  const newComment = {
    id: 73,
    userId: "commenter",
    activityEventId: 42,
    parentCommentId,
    content: "Nice one @jamie",
    moderationState: "visible",
    createdAt: new Date("2026-08-16T10:00:00Z"),
    updatedAt: new Date("2026-08-16T10:00:00Z"),
  };
  const insert = vi
    .fn()
    .mockReturnValueOnce({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([newComment]),
      })),
    })
    .mockReturnValueOnce({
      values: vi.fn((values: unknown[]) => {
        insertedMentionValues.push(...values);
        return Promise.resolve();
      }),
    });
  const updateQuery = {
    set: vi.fn(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  updateQuery.set.mockReturnValue(updateQuery);
  const tx = { insert, update: vi.fn().mockReturnValue(updateQuery) };
  const selectedRows = [
    [{ userId: "activity-owner", moderationState: "visible" }],
    ...(parentAuthorId
      ? [
          [
            {
              userId: parentAuthorId,
              activityEventId: 42,
              parentCommentId: null,
              moderationState: "visible",
            },
          ],
        ]
      : []),
    [{ id: "mentioned-user", username: "jamie" }],
  ];
  const select = vi.fn();
  for (const rows of selectedRows) {
    select.mockReturnValueOnce(createSelectQuery(rows));
  }

  return {
    db: {
      select,
      transaction: vi.fn((callback) => callback(tx)),
    },
    insertedMentionValues,
  };
}

describe("commentRouter.getComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertInteractionAllowed.mockResolvedValue(undefined);
    mocks.getBlockedUserIds.mockResolvedValue([]);
  });

  it("includes a focused thread outside the base comment window", async () => {
    const parent = {
      id: 501,
      content: "Focused parent",
      parentCommentId: null,
      createdAt: new Date("2026-01-02T00:00:00Z"),
      user: { id: "parent-author", name: "Parent", image: null },
    };
    const reply = {
      id: 502,
      content: "Focused reply",
      parentCommentId: 501,
      createdAt: new Date("2026-01-02T00:01:00Z"),
      user: { id: "reply-author", name: "Reply", image: null },
    };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(
          createSelectQuery([
            { userId: "activity-owner", moderationState: "visible" },
          ]),
        )
        .mockReturnValueOnce(createSelectQuery([]))
        .mockReturnValueOnce(createSelectQuery([reply]))
        .mockReturnValueOnce(createSelectQuery([parent, reply]))
        .mockReturnValueOnce(
          createSelectQuery([
            { commentId: 502, userId: "mentioned-user", username: "jamie" },
          ]),
        ),
    };
    const caller = commentRouter.createCaller({
      ...createContext(),
      db,
    } as never);

    const result = await caller.getComments({
      activityEventId: 42,
      focusedCommentId: 502,
    });

    expect(result.focusedCommentStatus).toBe("found");
    expect(result.comments).toEqual([
      expect.objectContaining({
        id: 501,
        replies: [
          expect.objectContaining({
            id: 502,
            mentions: [{ userId: "mentioned-user", username: "jamie" }],
          }),
        ],
      }),
    ]);
  });

  it("filters mention links for users blocked by the viewer", async () => {
    mocks.getBlockedUserIds.mockResolvedValue(["blocked-mentioned-user"]);
    const comment = {
      id: 1,
      content: "Hello @blocked_user",
      parentCommentId: null,
      createdAt: new Date("2026-01-02T00:00:00Z"),
      user: { id: "comment-author", name: "Commenter", image: null },
    };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(
          createSelectQuery([
            { userId: "activity-owner", moderationState: "visible" },
          ]),
        )
        .mockReturnValueOnce(createSelectQuery([comment]))
        .mockReturnValueOnce(createSelectQuery([])),
    };
    const caller = commentRouter.createCaller({
      ...createContext(),
      db,
    } as never);

    await caller.getComments({ activityEventId: 42 });

    expect(mocks.notInArray).toHaveBeenCalledWith("comment_mentions.user_id", [
      "blocked-mentioned-user",
    ]);
  });
});

describe("commentRouter.createComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertInteractionAllowed.mockResolvedValue(undefined);
    mocks.getBlockedUserIds.mockResolvedValue([]);
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

  it("persists resolved mentions and notifies the tagged user", async () => {
    const { db, insertedMentionValues } = createMentionMutationDb();
    const caller = commentRouter.createCaller({
      ...createContext(),
      db,
    } as never);

    const result = await caller.createComment({
      activityEventId: 42,
      content: "Nice one @jamie",
    });

    expect(insertedMentionValues).toEqual([
      { commentId: 73, userId: "mentioned-user", username: "jamie" },
    ]);
    expect(result.mentions).toEqual([
      { userId: "mentioned-user", username: "jamie" },
    ]);
    expect(mocks.createAndSendNotificationInBackground).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipientId: "mentioned-user",
        type: "comment_mention",
        activityEventId: 42,
        commentId: 73,
      }),
      "Error creating comment mention notification:",
    );
  });

  it.each([
    {
      inaccessibleAuthorId: "activity-owner",
      parentAuthorId: undefined,
      target: "activity",
    },
    {
      inaccessibleAuthorId: "root-author",
      parentAuthorId: "root-author",
      target: "focused thread",
    },
  ])(
    "does not notify a mention recipient who cannot access the $target",
    async ({ inaccessibleAuthorId, parentAuthorId }) => {
      mocks.getBlockedUserIds.mockImplementation(async (_db, userId) =>
        userId === inaccessibleAuthorId ? ["mentioned-user"] : [],
      );
      const { db, insertedMentionValues } =
        createMentionMutationDb(parentAuthorId);
      const caller = commentRouter.createCaller({
        ...createContext(),
        db,
      } as never);

      await caller.createComment({
        activityEventId: 42,
        ...(parentAuthorId ? { parentCommentId: 51 } : {}),
        content: "Nice one @jamie",
      });

      expect(insertedMentionValues).toEqual([
        { commentId: 73, userId: "mentioned-user", username: "jamie" },
      ]);
      expect(
        mocks.createAndSendNotificationInBackground,
      ).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          recipientId: "mentioned-user",
          type: "comment_mention",
        }),
        expect.anything(),
      );
    },
  );
});
