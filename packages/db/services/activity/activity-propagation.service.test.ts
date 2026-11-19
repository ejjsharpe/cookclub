import type { FeedSourceType } from "@repo/contracts/feed";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hydrateActivityIds } from "./activity-propagation.service";

const mocks = vi.hoisted(() => ({
  getBlockedUserIds: vi.fn(),
}));

vi.mock("../../schemas", () => ({
  activityEvents: {
    _name: "activity_events",
    id: "activity_events.id",
    moderationState: "activity_events.moderation_state",
  },
  activityLikes: {
    _name: "activity_likes",
    activityEventId: "activity_likes.activity_event_id",
    userId: "activity_likes.user_id",
  },
  cookingReviews: {
    _name: "cooking_reviews",
    activityEventId: "cooking_reviews.activity_event_id",
    moderationState: "cooking_reviews.moderation_state",
  },
  cookingReviewImages: {
    _name: "cooking_review_images",
    reviewId: "cooking_review_images.review_id",
    index: "cooking_review_images.index",
  },
  user: {
    _name: "user",
    id: "user.id",
  },
  recipes: {
    _name: "recipes",
    id: "recipes.id",
    moderationState: "recipes.moderation_state",
  },
  recipeImages: {
    _name: "recipe_images",
    recipeId: "recipe_images.recipe_id",
    index: "recipe_images.index",
  },
  recipeTags: {
    _name: "recipe_tags",
    id: "recipe_tags.id",
    recipeId: "recipe_tags.recipe_id",
    tagId: "recipe_tags.tag_id",
  },
  tags: {
    _name: "tags",
    id: "tags.id",
    name: "tags.name",
  },
}));

vi.mock("../moderation", () => ({
  getBlockedUserIds: mocks.getBlockedUserIds,
}));

vi.mock("../subscription", () => ({
  publicSubscriptionTierSqlForUserTable: vi.fn(() => "subscription_tier"),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
}));

type Table = { _name?: string };

function createMockDb(results: Record<string, unknown[]>) {
  return {
    select: vi.fn(() => {
      let rows: unknown[] = [];
      const query = {
        from: vi.fn((table: Table) => {
          rows = results[table._name ?? ""] ?? [];
          return query;
        }),
        innerJoin: vi.fn(() => query),
        where: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        then: (
          resolve?: (value: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    }),
  };
}

const sourceTypes = [
  "url",
  "image",
  "text",
  "ai",
  "manual",
  "user",
] as const satisfies readonly FeedSourceType[];

describe("hydrateActivityIds", () => {
  beforeEach(() => {
    mocks.getBlockedUserIds.mockResolvedValue([]);
  });

  it("hydrates recipe-import activities for every supported source type", async () => {
    const createdAt = new Date("2026-08-20T12:00:00.000Z");
    const db = createMockDb({
      activity_events: sourceTypes.map((_, index) => ({
        id: index + 1,
        type: "recipe_import",
        userId: "owner-1",
        recipeId: index + 1,
        likeCount: 0,
        commentCount: 0,
        createdAt,
      })),
      recipes: sourceTypes.map((sourceType, index) => ({
        id: index + 1,
        ownerId: "owner-1",
        name: `${sourceType} recipe`,
        sourceUrl: sourceType === "url" ? "https://example.com/recipe" : null,
        sourceType,
        originalOwnerId: null,
      })),
      user: [
        {
          id: "owner-1",
          name: "Recipe Owner",
          username: "owner",
          image: null,
          banned: false,
          subscriptionTier: "free",
        },
      ],
      recipe_images: [],
      activity_likes: [],
    });

    const items = await hydrateActivityIds(
      db as never,
      sourceTypes.map((_, index) => index + 1),
      "viewer-1",
    );

    expect(items).toHaveLength(sourceTypes.length);
    expect(items.map((item) => item.recipe.sourceType)).toEqual(sourceTypes);
    expect(items.every((item) => item.type === "recipe_import")).toBe(true);
  });

  it("adds total time and up to two tags to feed recipes", async () => {
    const createdAt = new Date("2026-08-20T12:00:00.000Z");
    const db = createMockDb({
      activity_events: [1, 2].map((id) => ({
        id,
        type: "recipe_import",
        userId: "owner-1",
        recipeId: id,
        likeCount: 0,
        commentCount: 0,
        createdAt,
      })),
      recipes: [
        {
          id: 1,
          ownerId: "owner-1",
          name: "Pad thai",
          sourceUrl: "https://example.com/pad-thai",
          sourceType: "url",
          originalOwnerId: null,
          prepTime: 10,
          cookTime: 15,
          totalTime: null,
        },
        {
          id: 2,
          ownerId: "owner-1",
          name: "Toast",
          sourceUrl: null,
          sourceType: "manual",
          originalOwnerId: null,
          prepTime: null,
          cookTime: null,
          totalTime: null,
        },
      ],
      recipe_tags: [
        { recipeId: 1, name: "Noodles" },
        { recipeId: 1, name: "Thai" },
        { recipeId: 1, name: "Quick" },
      ],
      user: [
        {
          id: "owner-1",
          name: "Recipe Owner",
          username: "owner",
          image: null,
          banned: false,
          subscriptionTier: "free",
        },
      ],
      recipe_images: [],
      activity_likes: [],
    });

    const items = await hydrateActivityIds(db as never, [1, 2], "viewer-1");

    expect(items[0]?.recipe).toMatchObject({
      totalTime: 25,
      tags: ["Noodles", "Thai"],
    });
    expect(items[1]?.recipe).toMatchObject({ totalTime: null, tags: [] });
  });
});
