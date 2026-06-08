import { TRPCError } from "@trpc/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { recipeRouter } from "./recipe-router";
import { createMockEnv } from "../__mocks__/env";

const mocks = vi.hoisted(() => ({
  propagateActivityToFollowersInBackground: vi.fn(),
}));

function createAsset(key: string) {
  return {
    url: `https://images.example.com/${key}`,
    storageKey: key,
    width: 1200,
    height: 900,
    contentType: "image/jpeg" as const,
    byteSize: 1234,
    thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j2w",
    key,
    publicUrl: `https://images.example.com/${key}`,
  };
}

vi.mock("../services/activity", () => ({
  propagateActivityToFollowersInBackground:
    mocks.propagateActivityToFollowersInBackground,
}));

// Mock the recipe service
const mockCreateRecipe = vi.fn();
const mockUpdateRecipe = vi.fn();
const mockGetRecipeDetail = vi.fn();
const mockGetStoredRecipeNutrition = vi.fn();
const mockUpsertRecipeNutrition = vi.fn();
const mockImportRecipe = vi.fn();
const mockGetSubscriptionStatus = vi.fn();

vi.mock("@repo/db/services", () => ({
  createRecipe: (...args: unknown[]) => mockCreateRecipe(...args),
  updateRecipe: (...args: unknown[]) => mockUpdateRecipe(...args),
  getRecipeDetail: (...args: unknown[]) => mockGetRecipeDetail(...args),
  getStoredRecipeNutrition: (...args: unknown[]) =>
    mockGetStoredRecipeNutrition(...args),
  upsertRecipeNutrition: (...args: unknown[]) =>
    mockUpsertRecipeNutrition(...args),
  importRecipe: (...args: unknown[]) => mockImportRecipe(...args),
  queryPopularRecipesThisWeek: vi.fn(),
  DEFAULT_PRO_ACCESS_LEVEL_ID: "pro",
  getSubscriptionStatus: (...args: unknown[]) =>
    mockGetSubscriptionStatus(...args),
  consumeSmartImportUsage: vi.fn().mockResolvedValue({
    isPro: true,
    accessLevelId: "pro",
    expiresAt: null,
    willRenew: true,
    smartImports: {
      used: 0,
      limit: null,
      remaining: null,
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
    },
  }),
  refundSmartImportUsageForPeriod: vi.fn(),
  upsertSubscriptionEntitlement: vi.fn(),
  recordAdaptyWebhookEvent: vi.fn(),
  ServiceError: class ServiceError extends Error {
    code = "INTERNAL_ERROR";
  },
}));

// Mock @repo/db/schemas
vi.mock("@repo/db/schemas", () => ({
  activityEvents: { _name: "activity_events" },
  recipes: { _name: "recipes" },
  recipeImages: { _name: "recipe_images" },
  recipeIngredients: { _name: "recipe_ingredients" },
  recipeInstructions: { _name: "recipe_instructions" },
  recipeCollections: { _name: "recipe_collections" },
  recipeImportJobs: {
    id: "recipe_import_jobs.id",
    userId: "recipe_import_jobs.user_id",
    importType: "recipe_import_jobs.import_type",
    mode: "recipe_import_jobs.mode",
    title: "recipe_import_jobs.title",
    inputData: "recipe_import_jobs.input_data",
    mimeType: "recipe_import_jobs.mime_type",
    status: "recipe_import_jobs.status",
    recipe: "recipe_import_jobs.recipe",
    error: "recipe_import_jobs.error",
    createdAt: "recipe_import_jobs.created_at",
    updatedAt: "recipe_import_jobs.updated_at",
    completedAt: "recipe_import_jobs.completed_at",
    dismissedAt: "recipe_import_jobs.dismissed_at",
    processingStartedAt: "recipe_import_jobs.processing_started_at",
    usagePeriodStart: "recipe_import_jobs.usage_period_start",
    usageConsumedAt: "recipe_import_jobs.usage_consumed_at",
    refundedAt: "recipe_import_jobs.refunded_at",
  },
  recipeNutrition: { _name: "recipe_nutrition" },
  collections: { _name: "collections" },
  recipeTags: {
    _name: "recipe_tags",
    recipeId: "recipe_tags.recipe_id",
    tagId: "recipe_tags.tag_id",
  },
  tags: {
    _name: "tags",
    id: "tags.id",
    name: "tags.name",
    userId: "tags.user_id",
  },
  user: { _name: "user" },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ type: "eq", field: a, value: b })),
  lt: vi.fn((a, b) => ({ type: "lt", field: a, value: b })),
  desc: vi.fn((a) => ({ type: "desc", field: a })),
  asc: vi.fn((a) => ({ type: "asc", field: a })),
  and: vi.fn((...args) => ({ type: "and", conditions: args })),
  or: vi.fn((...args) => ({ type: "or", conditions: args })),
  isNull: vi.fn((a) => ({ type: "isNull", field: a })),
  ne: vi.fn((a, b) => ({ type: "ne", field: a, value: b })),
  gt: vi.fn((a, b) => ({ type: "gt", field: a, value: b })),
  ilike: vi.fn((a, b) => ({ type: "ilike", field: a, pattern: b })),
  inArray: vi.fn((a, b) => ({ type: "inArray", field: a, values: b })),
  count: vi.fn((a) => ({ type: "count", field: a })),
  min: vi.fn((a) => ({ type: "min", field: a })),
  like: vi.fn((a, b) => ({ type: "like", field: a, pattern: b })),
  sql: vi.fn(),
}));

// Mock arktype with full API
vi.mock("arktype", () => {
  const createValidator = (): any => {
    const validator: any = (input: unknown) => input;
    validator.errors = null;
    // Chain methods that arktype supports
    validator.array = () => createValidator();
    validator.atLeastLength = () => createValidator();
    validator.optional = () => createValidator();
    return validator;
  };

  const mockType: any = (schema: unknown) => createValidator();
  mockType.or = (...validators: unknown[]) => createValidator();
  mockType.errors = class extends Array {
    summary = "Validation error";
  };

  return { type: mockType };
});

// Create a mock db
function createMockDb() {
  let insertReturning: unknown[] = [];
  let insertError: unknown = null;
  let selectResult: unknown[] = [];

  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    then: vi.fn(
      (
        resolve?: (rows: unknown[]) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve(selectResult).then(resolve, reject),
    ),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnThis(),
      returning: vi
        .fn()
        .mockImplementation(() =>
          insertError
            ? Promise.reject(insertError)
            : Promise.resolve(insertReturning),
        ),
    })),
    _setInsertReturning: (result: unknown[]) => {
      insertReturning = result;
    },
    _setInsertError: (error: unknown) => {
      insertError = error;
    },
    _setSelectResult: (result: unknown[]) => {
      selectResult = result;
    },
  } as any;
}

// Helper to create mock context
function createMockContext(
  db: ReturnType<typeof createMockDb>,
  overrides: Partial<{
    user: { id: string; name: string; image: string | null };
    env: ReturnType<typeof createMockEnv>;
    waitUntil: (promise: Promise<unknown>) => void;
  }> = {},
) {
  return {
    db: db as any,
    env: overrides.env ?? (createMockEnv() as any),
    user: overrides.user ?? {
      id: "test-user-id",
      name: "Test User",
      image: null,
    },
    req: new Request("http://localhost"),
    resHeaders: new Headers(),
    waitUntil: overrides.waitUntil ?? vi.fn(),
  };
}

describe("recipeRouter - activity integration", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEnv: ReturnType<typeof createMockEnv>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSubscriptionStatus.mockResolvedValue({
      isPro: true,
      accessLevelId: "pro",
      expiresAt: null,
      willRenew: true,
      smartImports: {
        used: 0,
        limit: null,
        remaining: null,
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
      },
    });
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.propagateActivityToFollowersInBackground.mockReturnValue(undefined);
    mockDb = createMockDb();
    mockEnv = createMockEnv();
    mockEnv.IMAGE_SERVICE.uploadFromUrl.mockImplementation(
      async (_url: string, key: string) => ({
        success: true,
        key,
        publicUrl: `https://images.example.com/${key}`,
        asset: createAsset(key),
      }),
    );
    mockEnv.IMAGE_SERVICE.move.mockImplementation(
      async (moves: { from: string; to: string }[]) => ({
        success: true,
        results: moves.map((move) => ({
          ...move,
          success: true,
          asset: createAsset(move.to),
        })),
      }),
    );
    mockCreateRecipe.mockResolvedValue({ id: 1, name: "Test Recipe" });
    mockUpdateRecipe.mockResolvedValue({ id: 1 });
    mockImportRecipe.mockResolvedValue({ id: 2 });
    mockGetRecipeDetail.mockResolvedValue({
      id: 1,
      name: "Creamy Pasta",
      description: "A weeknight pasta.",
      prepTime: 10,
      cookTime: 20,
      totalTime: 30,
      servings: 4,
      sourceUrl: null,
      sourceType: "manual",
      images: [{ id: 1, url: "https://example.com/pasta.jpg" }],
      ingredientSections: [
        {
          id: 1,
          name: null,
          index: 0,
          ingredients: [
            {
              id: 1,
              index: 0,
              quantity: "1",
              unit: "cup",
              name: "cream",
              preparation: null,
            },
          ],
        },
      ],
      instructionSections: [
        {
          id: 1,
          name: null,
          index: 0,
          instructions: [
            {
              id: 1,
              index: 0,
              instruction: "Cook pasta.",
              imageUrl: null,
            },
          ],
        },
      ],
      tags: [],
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("import jobs", () => {
    const readyImportJob = {
      id: "job-1",
      importType: "smart",
      mode: "url",
      title: "Tomato Pasta",
      status: "ready",
      recipe: {
        success: true,
        data: {
          name: "Tomato Pasta",
          nutrition: { calories: 500 },
        },
        metadata: {
          source: "url",
          parseMethod: "ai_only",
          confidence: "high",
        },
      },
      error: null,
      createdAt: new Date("2026-06-02T10:00:00.000Z"),
      updatedAt: new Date("2026-06-02T10:00:00.000Z"),
      completedAt: new Date("2026-06-02T10:00:00.000Z"),
    };

    it("redacts completed import nutrition for non-Pro users at read time", async () => {
      mockDb._setSelectResult([readyImportJob]);
      mockGetSubscriptionStatus.mockResolvedValue({
        isPro: false,
        accessLevelId: null,
        expiresAt: null,
        willRenew: null,
        smartImports: {
          used: 1,
          limit: 5,
          remaining: 4,
          periodStart: new Date("2026-06-01T00:00:00.000Z"),
        },
      });

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      const [job] = await caller.listImportJobs();

      expect(job?.recipe).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({ nutrition: null }),
        }),
      );
    });

    it("returns stored completed import nutrition for Pro users", async () => {
      mockDb._setSelectResult([readyImportJob]);

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      const [job] = await caller.listImportJobs();

      expect(job?.recipe).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({ nutrition: { calories: 500 } }),
        }),
      );
    });

    it("rejects URL import jobs with invalid URLs before queueing", async () => {
      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await expect(
        caller.createImportJob({
          id: "job-1",
          importType: "smart",
          mode: "url",
          title: "not a url",
          data: "not a url",
        }),
      ).rejects.toThrow("Recipe URL is invalid.");

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockEnv.RECIPE_IMPORT_URL_QUEUE.send).not.toHaveBeenCalled();
    });

    it("hard-deletes dismissed import jobs", async () => {
      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await expect(caller.dismissImportJob({ id: "job-1" })).resolves.toEqual({
        success: true,
      });

      expect(mockDb.delete).toHaveBeenCalledWith(expect.anything());
      expect(mockDb.where).toHaveBeenCalledWith(
        expect.objectContaining({ type: "and" }),
      );
    });
  });

  describe("importRecipe", () => {
    it("checks recipe detail visibility before importing", async () => {
      mockGetRecipeDetail.mockRejectedValueOnce(
        new TRPCError({
          code: "FORBIDDEN",
          message: "Recipe is restricted",
        }),
      );

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await expect(
        caller.importRecipe({ recipeId: 123 }),
      ).rejects.toHaveProperty("code", "FORBIDDEN");

      expect(mockGetRecipeDetail).toHaveBeenCalledWith(
        mockDb,
        123,
        "test-user-id",
      );
      expect(mockImportRecipe).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("imports visible recipes through the recipe service", async () => {
      const createdAt = new Date();
      mockDb._setInsertReturning([{ id: 200, createdAt }]);

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await expect(caller.importRecipe({ recipeId: 123 })).resolves.toEqual({
        id: 2,
      });

      expect(mockGetRecipeDetail).toHaveBeenCalledWith(
        mockDb,
        123,
        "test-user-id",
      );
      expect(mockImportRecipe).toHaveBeenCalledWith(
        mockDb,
        "test-user-id",
        123,
      );
      expect(
        mocks.propagateActivityToFollowersInBackground,
      ).toHaveBeenCalledWith(
        ctx,
        200,
        "test-user-id",
        createdAt,
        "Failed to propagate activity to followers:",
      );
    });
  });

  describe("direct AI payload limits", () => {
    it("rejects oversized recipe text before calling the parser", async () => {
      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await expect(
        caller.parseRecipeFromText({ text: "x".repeat(100_001) }),
      ).rejects.toHaveProperty("code", "PAYLOAD_TOO_LARGE");

      expect(mockEnv.RECIPE_AI.parse).not.toHaveBeenCalled();
    });

    it("rejects oversized chat messages before calling the parser", async () => {
      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await expect(
        caller.generateRecipeChat({
          messages: [{ role: "user", content: "x".repeat(4_001) }],
          conversationState: {
            ingredients: null,
            cuisinePreference: null,
            willingToShop: null,
            maxCookingTime: null,
          },
        }),
      ).rejects.toHaveProperty("code", "PAYLOAD_TOO_LARGE");

      expect(mockEnv.RECIPE_AI.chat).not.toHaveBeenCalled();
    });
  });

  describe("postRecipe - activity integration", () => {
    const validRecipeInput = {
      name: "Test Recipe",
      prepTime: 15,
      cookTime: 30,
      servings: 4,
      ingredientSections: [
        {
          name: null,
          ingredients: [{ ingredient: "1 cup flour", index: 0 }],
        },
      ],
      instructionSections: [
        {
          name: null,
          instructions: [{ instruction: "Mix ingredients", index: 0 }],
        },
      ],
      images: [{ url: "https://example.com/image.jpg" }],
      tagNames: [],
    };

    it("creates activity event on recipe import", async () => {
      mockDb._setInsertReturning([{ id: 100, createdAt: new Date() }]);

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await caller.postRecipe(validRecipeInput);

      // Verify insert was called for activity event
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("schedules propagation to followers", async () => {
      mockDb._setInsertReturning([{ id: 100, createdAt: new Date() }]);

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await caller.postRecipe(validRecipeInput);

      expect(
        mocks.propagateActivityToFollowersInBackground,
      ).toHaveBeenCalledWith(
        ctx,
        100,
        "test-user-id",
        expect.any(Date),
        "Error propagating activity to followers:",
      );
    });

    it("recipe creation succeeds after scheduling propagation", async () => {
      mockDb._setInsertReturning([{ id: 100, createdAt: new Date() }]);

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      const result = await caller.postRecipe(validRecipeInput);

      expect(result.id).toBe(1);
      expect(result.name).toBe("Test Recipe");
    });

    it("creates recipes with ingredients and no method steps", async () => {
      mockDb._setInsertReturning([{ id: 100, createdAt: new Date() }]);

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await caller.postRecipe({
        ...validRecipeInput,
        instructionSections: [],
      });

      expect(mockCreateRecipe).toHaveBeenCalledWith(
        mockDb,
        "test-user-id",
        expect.objectContaining({
          instructionSections: [],
        }),
      );
    });

    it("does not propagate when activity event creation fails", async () => {
      // Empty array means no activity event was created
      mockDb._setInsertReturning([]);

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await caller.postRecipe(validRecipeInput);

      // Propagation should not be called since no activity event was created
      expect(
        mocks.propagateActivityToFollowersInBackground,
      ).not.toHaveBeenCalled();
    });

    it("cleans up moved images when recipe creation fails", async () => {
      mockEnv.IMAGE_SERVICE.move.mockResolvedValue({
        success: true,
        results: [
          {
            from: "temp/abc.jpg",
            to: "recipes/covers/group/img.jpg",
            success: true,
            asset: createAsset("recipes/covers/group/img.jpg"),
          },
        ],
      });
      mockCreateRecipe.mockRejectedValueOnce(new Error("Recipe insert failed"));

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);
      const { images: _images, ...uploadRecipeInput } = validRecipeInput;

      await expect(
        caller.postRecipe({
          ...uploadRecipeInput,
          imageUploadIds: ["temp/abc.jpg"],
        }),
      ).rejects.toThrow();

      expect(mockEnv.IMAGE_SERVICE.delete).toHaveBeenCalledWith([
        expect.stringMatching(/^recipes\/covers\/.+\/.+\.jpg$/),
      ]);
    });

    it("does not clean up moved images after recipe creation succeeds", async () => {
      mockEnv.IMAGE_SERVICE.move.mockResolvedValue({
        success: true,
        results: [
          {
            from: "temp/abc.jpg",
            to: "recipes/covers/group/img.jpg",
            success: true,
            asset: createAsset("recipes/covers/group/img.jpg"),
          },
        ],
      });
      mockDb._setInsertError(new Error("Activity insert failed"));

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);
      const { images: _images, ...uploadRecipeInput } = validRecipeInput;

      await expect(
        caller.postRecipe({
          ...uploadRecipeInput,
          imageUploadIds: ["temp/abc.jpg"],
        }),
      ).rejects.toThrow();

      expect(mockEnv.IMAGE_SERVICE.delete).not.toHaveBeenCalled();
    });

    it("promotes instruction image URLs before creating a recipe", async () => {
      mockDb._setInsertReturning([{ id: 100, createdAt: new Date() }]);

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await caller.postRecipe({
        ...validRecipeInput,
        instructionSections: [
          {
            name: null,
            instructions: [
              {
                instruction: "Mix ingredients",
                index: 0,
                imageUrl: "https://images.example.com/temp/generated/step.jpg",
              },
            ],
          },
        ],
      });

      expect(mockCreateRecipe).toHaveBeenCalledWith(
        mockDb,
        "test-user-id",
        expect.objectContaining({
          instructionSections: [
            {
              name: null,
              instructions: [
                expect.objectContaining({
                  imageUrl: expect.stringMatching(
                    /^https:\/\/images\.example\.com\/recipes\/instructions\/.+\/0\/.+\.jpg$/,
                  ),
                }),
              ],
            },
          ],
        }),
      );
    });

    it("rejects recipe creation when required cover image preparation fails", async () => {
      mockEnv.IMAGE_SERVICE.uploadFromUrl.mockResolvedValueOnce({
        success: false,
        error: "Remote cover unavailable",
      });

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await expect(caller.postRecipe(validRecipeInput)).rejects.toThrow(
        "Failed to prepare image: Remote cover unavailable",
      );

      expect(mockCreateRecipe).not.toHaveBeenCalled();
    });
  });

  describe("updateRecipe", () => {
    const validRecipeInput = {
      recipeId: 1,
      name: "Updated Recipe",
      prepTime: 10,
      cookTime: 25,
      servings: 4,
      ingredientSections: [
        {
          name: null,
          ingredients: [{ ingredient: "1 cup flour", index: 0 }],
        },
      ],
      instructionSections: [
        {
          name: null,
          instructions: [{ instruction: "Mix ingredients", index: 0 }],
        },
      ],
      images: [{ url: "https://example.com/image.jpg" }],
      tagNames: [],
    };

    it("updates a recipe through the recipe service", async () => {
      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      const result = await caller.updateRecipe(validRecipeInput);

      expect(result.id).toBe(1);
      expect(mockUpdateRecipe).toHaveBeenCalledWith(
        mockDb,
        "test-user-id",
        expect.objectContaining({
          recipeId: 1,
          name: "Updated Recipe",
          images: [
            expect.objectContaining({
              url: expect.stringMatching(
                /^https:\/\/images\.example\.com\/recipes\/covers\/.+\/.+\.jpg$/,
              ),
              storageKey: expect.stringMatching(
                /^recipes\/covers\/.+\/.+\.jpg$/,
              ),
              thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j2w",
            }),
          ],
          tagNames: [],
        }),
      );
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("updates recipes with ingredients and no method steps", async () => {
      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await caller.updateRecipe({
        ...validRecipeInput,
        instructionSections: [],
      });

      expect(mockUpdateRecipe).toHaveBeenCalledWith(
        mockDb,
        "test-user-id",
        expect.objectContaining({
          instructionSections: [],
        }),
      );
    });

    it("rejects updates without a non-empty ingredient", async () => {
      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await expect(
        caller.updateRecipe({
          ...validRecipeInput,
          ingredientSections: [
            {
              name: null,
              ingredients: [{ ingredient: "   ", index: 0 }],
            },
          ],
        }),
      ).rejects.toThrow("At least one ingredient is required");

      expect(mockUpdateRecipe).not.toHaveBeenCalled();
    });

    it("cleans up moved images when recipe update fails", async () => {
      mockEnv.IMAGE_SERVICE.move.mockResolvedValue({
        success: true,
        results: [
          {
            from: "temp/abc.jpg",
            to: "recipes/covers/group/img.jpg",
            success: true,
            asset: createAsset("recipes/covers/group/img.jpg"),
          },
        ],
      });
      mockUpdateRecipe.mockRejectedValueOnce(new Error("Recipe update failed"));

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);
      const { images: _images, ...uploadRecipeInput } = validRecipeInput;

      await expect(
        caller.updateRecipe({
          ...uploadRecipeInput,
          imageUploadIds: ["temp/abc.jpg"],
        }),
      ).rejects.toThrow();

      expect(mockEnv.IMAGE_SERVICE.delete).toHaveBeenCalledWith([
        expect.stringMatching(/^recipes\/covers\/.+\/.+\.jpg$/),
      ]);
    });

    it("drops failed external instruction images before updating a recipe", async () => {
      mockEnv.IMAGE_SERVICE.uploadFromUrl
        .mockResolvedValueOnce({
          success: true,
          key: "recipes/covers/group/img.jpg",
          publicUrl: "https://images.example.com/recipes/covers/group/img.jpg",
          asset: createAsset("recipes/covers/group/img.jpg"),
        })
        .mockResolvedValueOnce({
          success: false,
          error: "Step image unavailable",
        });

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await caller.updateRecipe({
        ...validRecipeInput,
        instructionSections: [
          {
            name: null,
            instructions: [
              {
                instruction: "Mix ingredients",
                index: 0,
                imageUrl: "https://example.com/step.jpg",
              },
            ],
          },
        ],
      });

      expect(mockUpdateRecipe).toHaveBeenCalledWith(
        mockDb,
        "test-user-id",
        expect.objectContaining({
          instructionSections: [
            {
              name: null,
              instructions: [
                expect.objectContaining({
                  imageUrl: null,
                }),
              ],
            },
          ],
        }),
      );
    });
  });

  describe("personalizeRecipe", () => {
    it("calls the recipe parser with the current user's recipe detail", async () => {
      mockEnv.RECIPE_AI.personalize.mockResolvedValue({
        success: true,
        data: {
          name: "Vegan Pasta",
          ingredientSections: [
            {
              name: null,
              ingredients: [
                { index: 0, quantity: 1, unit: "cup", name: "cashews" },
              ],
            },
          ],
          instructionSections: [
            {
              name: null,
              instructions: [{ index: 0, instruction: "Cook pasta." }],
            },
          ],
          images: ["https://example.com/pasta.jpg"],
          sourceType: "ai",
        },
        metadata: {
          source: "text",
          parseMethod: "ai_only",
          confidence: "medium",
        },
      });

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      const result = await caller.personalizeRecipe({
        recipeId: 1,
        goals: ["vegan"],
        allergyNotes: "avoid dairy",
        customNotes: "keep it quick",
      });

      expect(result.success).toBe(true);
      expect(mockGetRecipeDetail).toHaveBeenCalledWith(
        mockDb,
        1,
        "test-user-id",
      );
      expect(mockEnv.RECIPE_AI.personalize).toHaveBeenCalledWith(
        expect.objectContaining({
          goals: ["vegan"],
          allergyNotes: "avoid dairy",
          customNotes: "keep it quick",
          recipe: expect.objectContaining({
            name: "Creamy Pasta",
            images: ["https://example.com/pasta.jpg"],
          }),
        }),
      );
    });

    it("maps parser failures to a bad request", async () => {
      mockEnv.RECIPE_AI.personalize.mockResolvedValue({
        success: false,
        error: {
          code: "PERSONALIZATION_ERROR",
          message: "Failed to personalise recipe",
        },
      });

      const ctx = createMockContext(mockDb, { env: mockEnv });
      const caller = recipeRouter.createCaller(ctx as any);

      await expect(
        caller.personalizeRecipe({
          recipeId: 1,
          goals: ["meal_prep"],
        }),
      ).rejects.toThrow("Failed to personalise recipe");
    });
  });
});
