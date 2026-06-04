import { describe, expect, it, vi } from "vitest";

import { userRouter } from "./user-router";
import { createMockEnv } from "../__mocks__/env";

vi.mock("@repo/db/schemas", () => ({
  cookingReviewImages: {
    reviewId: "cooking_review_images.review_id",
    url: "cooking_review_images.url",
  },
  cookingReviews: {
    id: "cooking_reviews.id",
    userId: "cooking_reviews.user_id",
  },
  instructionSections: {
    id: "instruction_sections.id",
    recipeId: "instruction_sections.recipe_id",
  },
  recipeImages: {
    recipeId: "recipe_images.recipe_id",
    url: "recipe_images.url",
  },
  recipeInstructions: {
    imageUrl: "recipe_instructions.image_url",
    sectionId: "recipe_instructions.section_id",
  },
  recipes: {
    id: "recipes.id",
    ownerId: "recipes.owner_id",
  },
  user: {
    id: "user.id",
    image: "user.image",
    username: "user.username",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ type: "and", conditions })),
  eq: vi.fn((field, value) => ({ type: "eq", field, value })),
  inArray: vi.fn((field, values) => ({ type: "inArray", field, values })),
  isNotNull: vi.fn((field) => ({ type: "isNotNull", field })),
  ne: vi.fn((field, value) => ({ type: "ne", field, value })),
}));

vi.mock("arktype", () => {
  const createValidator = (): any => {
    const validator: any = (input: unknown) => input;
    validator.errors = null;
    return validator;
  };

  return { type: () => createValidator() };
});

function createSelectBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    where: vi.fn(() => builder),
    then: vi.fn((resolve, reject) =>
      Promise.resolve(result).then(resolve, reject),
    ),
  };

  return builder;
}

function createMockDb(
  selectResults: unknown[][],
  deleteReturning: unknown[] = [{ id: "user-1" }],
  updateReturning: unknown[] = [{ id: "user-1" }],
) {
  const queuedSelectResults = [...selectResults];
  const deleteBuilder = {
    returning: vi.fn().mockResolvedValue(deleteReturning),
    where: vi.fn(() => deleteBuilder),
  };
  let updateSet: unknown = null;
  const updateBuilder = {
    set: vi.fn((values: unknown) => {
      updateSet = values;
      return updateBuilder;
    }),
    where: vi.fn(() => updateBuilder),
    returning: vi.fn().mockResolvedValue(updateReturning),
  };

  return {
    delete: vi.fn(() => deleteBuilder),
    select: vi.fn(() => createSelectBuilder(queuedSelectResults.shift() ?? [])),
    update: vi.fn(() => updateBuilder),
    _getUpdateSet: () => updateSet,
  };
}

function createMockContext(
  db: ReturnType<typeof createMockDb>,
  env = createMockEnv(),
) {
  return {
    db,
    env,
    req: new Request("https://api.cookclub.app/trpc"),
    resHeaders: new Headers(),
    user: {
      id: "user-1",
      image: null,
      name: "Test User",
    },
    waitUntil: vi.fn(),
  };
}

describe("userRouter.getUser", () => {
  it("rehosts external OAuth avatars through the image service", async () => {
    const env = createMockEnv();
    env.IMAGE_SERVICE.uploadFromUrl = vi.fn().mockResolvedValue({
      success: true,
      publicUrl: "https://images.example.com/avatars/user-1.jpg",
      key: "avatars/user-1.jpg",
    });
    const updatedUser = {
      id: "user-1",
      name: "Test User",
      image: "https://images.example.com/avatars/user-1.jpg",
    };
    const db = createMockDb(
      [
        [
          {
            id: "user-1",
            name: "Test User",
            image: "https://lh3.googleusercontent.com/avatar.jpg",
          },
        ],
      ],
      [{ id: "user-1" }],
      [updatedUser],
    );
    const ctx = createMockContext(db, env);
    const caller = userRouter.createCaller(ctx as any);

    await expect(caller.getUser()).resolves.toEqual({ user: updatedUser });
    expect(env.IMAGE_SERVICE.uploadFromUrl).toHaveBeenCalledWith(
      "https://lh3.googleusercontent.com/avatar.jpg",
      "avatars/user-1.jpg",
    );
    expect(db._getUpdateSet()).toEqual(
      expect.objectContaining({
        image: "https://images.example.com/avatars/user-1.jpg",
      }),
    );
  });

  it("clears external OAuth avatars when rehosting fails", async () => {
    const env = createMockEnv();
    env.IMAGE_SERVICE.uploadFromUrl = vi.fn().mockResolvedValue({
      success: false,
      error: "Avatar unavailable",
    });
    const db = createMockDb([
      [
        {
          id: "user-1",
          name: "Test User",
          image: "https://lh3.googleusercontent.com/avatar.jpg",
        },
      ],
    ]);
    const ctx = createMockContext(db, env);
    const caller = userRouter.createCaller(ctx as any);

    await caller.getUser();

    expect(db._getUpdateSet()).toEqual(
      expect.objectContaining({
        image: null,
      }),
    );
  });
});

describe("userRouter profile inputs", () => {
  it("ignores raw image input on profile updates", async () => {
    const db = createMockDb([[], []]);
    const ctx = createMockContext(db);
    const caller = userRouter.createCaller(ctx as any);

    await caller.updateProfile({
      name: "Updated User",
      image: "https://example.com/raw-avatar.jpg",
    } as any);

    expect(db._getUpdateSet()).toEqual(
      expect.not.objectContaining({
        image: "https://example.com/raw-avatar.jpg",
      }),
    );
  });

  it("ignores raw image input when completing onboarding", async () => {
    const db = createMockDb([[]]);
    const ctx = createMockContext(db);
    const caller = userRouter.createCaller(ctx as any);

    await caller.completeOnboarding({
      username: "cook_user",
      name: "Cook User",
      image: "file:///tmp/avatar.jpg",
    } as any);

    expect(db._getUpdateSet()).toEqual(
      expect.not.objectContaining({
        image: "file:///tmp/avatar.jpg",
      }),
    );
  });
});

describe("userRouter.deleteAccount", () => {
  it("deletes the account and schedules cleanup for unreferenced account image keys", async () => {
    const env = createMockEnv();
    env.IMAGE_SERVICE.delete = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb([
      [{ image: "https://images.example.com/avatars/user-1.jpg" }],
      [
        { url: "https://images.example.com/recipes/covers/soup.jpg" },
        { url: "https://cdn.example.com/external.jpg" },
      ],
      [
        { url: "https://images.example.com/recipes/steps/step%201.jpg" },
        { url: "https://images.example.com/recipes/%2e%2e/private.jpg" },
      ],
      [
        { url: "https://images.example.com/reviews/review.jpg?version=1" },
        { url: "https://images.example.com/recipes/covers/soup.jpg" },
      ],
      [],
      [],
      [],
      [],
    ]);
    const ctx = createMockContext(db, env);
    const caller = userRouter.createCaller(ctx as any);

    const result = await caller.deleteAccount();

    expect(result).toEqual({ success: true, deletedImageCount: 4 });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(env.IMAGE_SERVICE.delete).toHaveBeenCalledWith([
      "avatars/user-1.jpg",
      "recipes/covers/soup.jpg",
      "recipes/steps/step 1.jpg",
      "reviews/review.jpg",
    ]);
    expect(ctx.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("does not delete image keys still referenced after the account is removed", async () => {
    const env = createMockEnv();
    env.IMAGE_SERVICE.delete = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb([
      [{ image: null }],
      [
        { url: "https://images.example.com/recipes/covers/shared.jpg" },
        { url: "https://images.example.com/recipes/covers/unique.jpg" },
      ],
      [],
      [],
      [],
      [{ url: "https://images.example.com/recipes/covers/shared.jpg" }],
      [],
      [],
    ]);
    const ctx = createMockContext(db, env);
    const caller = userRouter.createCaller(ctx as any);

    const result = await caller.deleteAccount();

    expect(result).toEqual({ success: true, deletedImageCount: 1 });
    expect(env.IMAGE_SERVICE.delete).toHaveBeenCalledWith([
      "recipes/covers/unique.jpg",
    ]);
    expect(ctx.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("does not delete images when the account row is missing", async () => {
    const env = createMockEnv();
    env.IMAGE_SERVICE.delete = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb(
      [
        [{ image: "https://images.example.com/avatars/user-1.jpg" }],
        [],
        [],
        [],
      ],
      [],
    );
    const ctx = createMockContext(db, env);
    const caller = userRouter.createCaller(ctx as any);

    await expect(caller.deleteAccount()).rejects.toHaveProperty(
      "code",
      "NOT_FOUND",
    );
    expect(env.IMAGE_SERVICE.delete).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
});
