import type {
  NutritionResponse,
  ParsedRecipe,
  PersonalizationGoal,
} from "@repo/contracts";
import type { PublicImageAsset } from "@repo/contracts/images";
import {
  recipes,
  recipeCollections,
  collections,
  tags,
  recipeTags,
  activityEvents,
} from "@repo/db/schemas";
import {
  queryPopularRecipesThisWeek,
  createRecipeInTransaction,
  updateRecipe,
  getRecipeDetail,
  getStoredRecipeNutrition,
  importRecipe,
  queryUserRecipes,
  queryUserRecipesByOwner,
  searchUserRecipes,
  upsertRecipeNutrition,
} from "@repo/db/services";
import { parseIngredients } from "@repo/shared";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import { eq, desc, and, count } from "drizzle-orm";

import { PublicTRPCError } from "../public-errors";
import { enforceRateLimit } from "../rate-limit";
import { propagateActivityToFollowersInBackground } from "../services/activity";
import {
  cleanupMovedRecipeImages,
  prepareRecipeImages,
} from "../services/recipe-image.service";
import {
  getCurrentSubscriptionStatus,
  requirePro,
} from "../services/subscription.service";
import { router, authedProcedure, mergeRouters } from "../trpc";
import { mapServiceError } from "../utils";

const ImageUrlRecord = type({
  url: "string.url",
});

const ImageAssetRecord = type({
  url: "string.url",
  storageKey: "string",
  width: "number",
  height: "number",
  contentType: "'image/jpeg' | 'image/png' | 'image/webp'",
  byteSize: "number",
  thumbhash: "string",
});

const ImageRecord = type.or(ImageAssetRecord, ImageUrlRecord);

// Support both unparsed and parsed ingredient formats for flexibility
const IngredientRecordUnparsed = type({
  index: "number",
  ingredient: "string", // Unparsed text like "2 cups flour"
});

const IngredientRecordParsed = type({
  index: "number",
  quantity: "string | null",
  unit: "string | null",
  name: "string",
  "preparation?": "string | null",
});

// Accept either format - UI can send unparsed, API will parse
const IngredientRecord = type.or(
  IngredientRecordParsed,
  IngredientRecordUnparsed,
);

const InstructionRecord = type({
  index: "number",
  instruction: "string",
  "imageUrl?": "string | null",
});

// Section wrappers for nested structure
const IngredientSectionRecord = type({
  name: "string | null",
  ingredients: IngredientRecord.array(),
});

const InstructionSectionRecord = type({
  name: "string | null",
  instructions: InstructionRecord.array(),
});

const SourceTypeValidator = type(
  "'url' | 'image' | 'text' | 'ai' | 'manual' | 'user'",
);

const PersonalizationGoalValidator = type(
  "'vegetarian' | 'vegan' | 'gluten_free' | 'dairy_free' | 'low_carb' | 'high_protein' | 'budget' | 'healthier' | 'kid_friendly' | 'batch_cook' | 'meal_prep'",
);

const RecipePostValidator = type({
  name: "string",
  ingredientSections: IngredientSectionRecord.array().atLeastLength(1),
  instructionSections: InstructionSectionRecord.array(),
  // Either images (direct URLs) or imageUploadIds (temp keys from upload)
  "images?": ImageRecord.array(),
  "imageUploadIds?": "string[]",

  "sourceUrl?": "string",
  "sourceType?": SourceTypeValidator,
  "tagNames?": "string[]",

  "description?": "string",
  "prepTime?": "number", // minutes
  "cookTime?": "number", // minutes
  "totalTime?": "number", // minutes
  servings: "number > 0",
  "nutrition?": "object | null",
});

const RecipeUpdateValidator = type({
  recipeId: "number",
  name: "string",
  ingredientSections: IngredientSectionRecord.array().atLeastLength(1),
  instructionSections: InstructionSectionRecord.array(),
  // Either images (direct URLs) or imageUploadIds (temp keys from upload)
  "images?": ImageRecord.array(),
  "imageUploadIds?": "string[]",

  "sourceUrl?": "string",
  "sourceType?": SourceTypeValidator,
  "tagNames?": "string[]",

  "description?": "string",
  "prepTime?": "number", // minutes
  "cookTime?": "number", // minutes
  "totalTime?": "number", // minutes
  servings: "number > 0",
  "nutrition?": "object | null",
});

const MAX_CHAT_MESSAGES = 30;
const MAX_CHAT_MESSAGE_LENGTH = 4_000;
const MAX_CONVERSATION_STATE_FIELD_LENGTH = 1_000;
const MAX_CONVERSATION_INGREDIENTS = 100;
const MAX_RECIPE_IMAGE_NAME_LENGTH = 200;
const MAX_RECIPE_IMAGE_DESCRIPTION_LENGTH = 2_000;
const MAX_RECIPE_IMAGE_ITEMS = 100;
const MAX_RECIPE_IMAGE_ITEM_LENGTH = 1_000;
const MAX_PERSONALIZATION_GOALS = 10;
const MAX_PERSONALIZATION_NOTES_LENGTH = 2_000;

// Chat types for AI recipe generation
const ChatMessageValidator = type({
  role: "'user' | 'assistant'",
  content: "string",
});

const ConversationStateValidator = type({
  ingredients: "string[] | null",
  cuisinePreference: "string | null",
  willingToShop: "boolean | null",
  maxCookingTime: "string | null",
});

const ChatInputValidator = type({
  messages: ChatMessageValidator.array(),
  conversationState: ConversationStateValidator,
});

const PersonalizeRecipeValidator = type({
  recipeId: "number",
  goals: PersonalizationGoalValidator.array(),
  "allergyNotes?": "string | null",
  "customNotes?": "string | null",
});

const GenerateRecipeImageValidator = type({
  name: "string",
  "description?": "string | null",
  "ingredients?": "string[]",
  "instructions?": "string[]",
});

const GetNutritionValidator = type({
  recipeId: "number",
});

interface RecipePayloadInput {
  name: string;
  images?: ({ url: string } | PublicImageAsset)[];
  imageUploadIds?: string[];
  ingredientSections: {
    ingredients: (
      | { ingredient: string; index: number }
      | { name: string; index: number }
    )[];
  }[];
  instructionSections: {
    instructions: {
      instruction: string;
      index: number;
      imageUrl?: string | null;
    }[];
  }[];
}

function toParserSourceType(
  sourceType: string | null | undefined,
): NonNullable<ParsedRecipe["sourceType"]> {
  if (
    sourceType === "url" ||
    sourceType === "image" ||
    sourceType === "text" ||
    sourceType === "ai" ||
    sourceType === "manual"
  ) {
    return sourceType;
  }

  return "manual";
}

function recipeDetailToParsedRecipe(
  recipe: Awaited<ReturnType<typeof getRecipeDetail>>,
): ParsedRecipe {
  return {
    name: recipe.name,
    description: recipe.description,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    totalTime: recipe.totalTime,
    servings: recipe.servings,
    sourceUrl: recipe.sourceUrl,
    sourceType: toParserSourceType(recipe.sourceType),
    images: recipe.images.map((image) => image.url),
    ingredientSections: recipe.ingredientSections.map((section) => ({
      name: section.name,
      ingredients: section.ingredients.map((ingredient, index) => ({
        index,
        quantity: ingredient.quantity ? Number(ingredient.quantity) : null,
        unit: ingredient.unit,
        name: ingredient.preparation
          ? `${ingredient.name}, ${ingredient.preparation}`
          : ingredient.name,
      })),
    })),
    instructionSections: recipe.instructionSections.map((section) => ({
      name: section.name,
      instructions: section.instructions.map((instruction, index) => ({
        index,
        instruction: instruction.instruction,
        imageUrl: instruction.imageUrl,
      })),
    })),
    suggestedTags: recipe.tags.map((tag) => tag.name),
    nutrition: recipe.nutrition,
  };
}

function recipeForEntitlement<T extends { nutrition?: unknown }>(
  recipe: T,
  isPro: boolean,
): T {
  return (isPro ? recipe : { ...recipe, nutrition: null }) as T;
}

function hasCompleteNutritionCore(
  nutrition: {
    calories?: number | null;
    protein?: number | null;
    carbohydrates?: number | null;
    fat?: number | null;
  } | null,
) {
  if (!nutrition) return false;

  return [
    nutrition.calories,
    nutrition.protein,
    nutrition.carbohydrates,
    nutrition.fat,
  ].every((value) => typeof value === "number" && Number.isFinite(value));
}

function assertMaxLength(value: string, label: string, maxLength: number) {
  if (value.length <= maxLength) return;

  throw new TRPCError({
    code: "PAYLOAD_TOO_LARGE",
    message: `${label} is too large.`,
  });
}

function assertRecipeTagFilterLimit(tagIds?: number[]) {
  if (tagIds && tagIds.length > 50) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Too many recipe tags selected.",
    });
  }
}

function assertMaxArrayLength(
  value: unknown[],
  label: string,
  maxLength: number,
) {
  if (value.length <= maxLength) return;

  throw new TRPCError({
    code: "PAYLOAD_TOO_LARGE",
    message: `${label} has too many items.`,
  });
}

function validateChatInput(input: typeof ChatInputValidator.infer) {
  assertMaxArrayLength(input.messages, "Chat history", MAX_CHAT_MESSAGES);

  for (const message of input.messages) {
    assertMaxLength(message.content, "Chat message", MAX_CHAT_MESSAGE_LENGTH);
  }

  const { conversationState } = input;
  if (conversationState.ingredients) {
    assertMaxArrayLength(
      conversationState.ingredients,
      "Conversation ingredients",
      MAX_CONVERSATION_INGREDIENTS,
    );
    for (const ingredient of conversationState.ingredients) {
      assertMaxLength(
        ingredient,
        "Conversation ingredient",
        MAX_CONVERSATION_STATE_FIELD_LENGTH,
      );
    }
  }

  for (const field of [
    conversationState.cuisinePreference,
    conversationState.maxCookingTime,
  ]) {
    if (field) {
      assertMaxLength(
        field,
        "Conversation state",
        MAX_CONVERSATION_STATE_FIELD_LENGTH,
      );
    }
  }
}

function validateGenerateRecipeImageInput(
  input: typeof GenerateRecipeImageValidator.infer,
) {
  assertMaxLength(input.name, "Recipe name", MAX_RECIPE_IMAGE_NAME_LENGTH);
  if (input.description) {
    assertMaxLength(
      input.description,
      "Recipe description",
      MAX_RECIPE_IMAGE_DESCRIPTION_LENGTH,
    );
  }

  for (const [label, items] of [
    ["Recipe ingredients", input.ingredients ?? []],
    ["Recipe instructions", input.instructions ?? []],
  ] as const) {
    assertMaxArrayLength(items, label, MAX_RECIPE_IMAGE_ITEMS);
    for (const item of items) {
      assertMaxLength(item, label, MAX_RECIPE_IMAGE_ITEM_LENGTH);
    }
  }
}

function validatePersonalizeRecipeInput(
  input: typeof PersonalizeRecipeValidator.infer,
) {
  assertMaxArrayLength(
    input.goals,
    "Personalization goals",
    MAX_PERSONALIZATION_GOALS,
  );
  if (input.allergyNotes) {
    assertMaxLength(
      input.allergyNotes,
      "Allergy notes",
      MAX_PERSONALIZATION_NOTES_LENGTH,
    );
  }
  if (input.customNotes) {
    assertMaxLength(
      input.customNotes,
      "Custom notes",
      MAX_PERSONALIZATION_NOTES_LENGTH,
    );
  }
}

function validateRecipePayload(input: RecipePayloadInput) {
  if (!input.name.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Recipe name is required",
    });
  }

  const hasImages = input.images && input.images.length > 0;
  const hasUploadIds = input.imageUploadIds && input.imageUploadIds.length > 0;
  if (!hasImages && !hasUploadIds) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one image is required",
    });
  }

  const hasIngredients = input.ingredientSections.some((section) =>
    section.ingredients.some((ingredient) => {
      if ("ingredient" in ingredient) {
        return ingredient.ingredient.trim().length > 0;
      }
      return ingredient.name.trim().length > 0;
    }),
  );
  if (!hasIngredients) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one ingredient is required",
    });
  }
}

// AI procedures live on their own root router even though they share the
// recipe validation and transformation helpers in this module.
const generateRecipeChat = authedProcedure
  .input(ChatInputValidator)
  .mutation(async ({ ctx, input }) => {
    validateChatInput(input);
    await requirePro(ctx);
    await enforceRateLimit(ctx, "recipe_chat");
    const result = await ctx.env.RECIPE_AI.chat({
      messages: input.messages,
      conversationState: input.conversationState,
    });

    if (result.type === "error") {
      throw new PublicTRPCError({
        code: "BAD_GATEWAY",
        appCode: "SERVICE_UNAVAILABLE",
      });
    }

    return result;
  });

const personalizeRecipe = authedProcedure
  .input(PersonalizeRecipeValidator)
  .mutation(async ({ ctx, input }) => {
    if (input instanceof type.errors) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: input.summary,
      });
    }
    validatePersonalizeRecipeInput(input);

    const hasGoal = input.goals.length > 0;
    const hasNotes =
      Boolean(input.allergyNotes?.trim()) || Boolean(input.customNotes?.trim());

    if (!hasGoal && !hasNotes) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose at least one personalisation option or add notes.",
      });
    }

    try {
      await requirePro(ctx);
      await enforceRateLimit(ctx, "recipe_personalize");
      const recipe = await getRecipeDetail(ctx.db, input.recipeId, ctx.user.id);
      const result = await ctx.env.RECIPE_AI.personalize({
        recipe: recipeDetailToParsedRecipe(recipe),
        goals: input.goals as PersonalizationGoal[],
        allergyNotes: input.allergyNotes ?? null,
        customNotes: input.customNotes ?? null,
      });

      if (!result.success) {
        throw new PublicTRPCError({
          code: "BAD_GATEWAY",
          appCode: "SERVICE_UNAVAILABLE",
        });
      }

      return result;
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      console.error("Error personalising recipe:", err);
      throw mapServiceError(err);
    }
  });

const generateRecipeImage = authedProcedure
  .input(GenerateRecipeImageValidator)
  .mutation(async ({ ctx, input }) => {
    if (input instanceof type.errors) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: input.summary,
      });
    }
    validateGenerateRecipeImageInput(input);

    await requirePro(ctx);
    await enforceRateLimit(ctx, "recipe_generate_image");
    const result = await ctx.env.RECIPE_AI.generateImage({
      name: input.name,
      description: input.description ?? null,
      ingredients: input.ingredients ?? [],
      instructions: input.instructions ?? [],
      ownerId: ctx.user.id,
    });

    if (!result.success) {
      throw new PublicTRPCError({
        code: "BAD_GATEWAY",
        appCode: "SERVICE_UNAVAILABLE",
      });
    }

    return result;
  });

const recipeHeadRouter = router({
  postRecipe: authedProcedure
    .input(RecipePostValidator)
    .mutation(async ({ input, ctx }) => {
      if (input instanceof type.errors) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: input.summary,
        });
      }

      validateRecipePayload(input);

      const subscriptionStatus = await getCurrentSubscriptionStatus(ctx);

      let movedKeys: string[] = [];

      try {
        const preparedImages = await prepareRecipeImages(input, {
          imageService: ctx.env.IMAGE_SERVICE,
          imagePublicUrl: ctx.env.IMAGE_PUBLIC_URL,
          ownerId: ctx.user.id,
        });
        movedKeys = preparedImages.movedKeys;
        const { imageUploadIds: _imageUploadIds, ...recipeInput } = input;

        const { recipe, activityEvent } = await ctx.db.transaction(
          async (tx) => {
            const recipe = await createRecipeInTransaction(tx, ctx.user.id, {
              ...recipeInput,
              images: preparedImages.images,
              instructionSections: preparedImages.instructionSections,
              nutrition: subscriptionStatus.isPro
                ? (input.nutrition as any)
                : undefined,
            });
            const [activityEvent] = await tx
              .insert(activityEvents)
              .values({
                userId: ctx.user.id,
                type: "recipe_import",
                recipeId: recipe.id,
                createdAt: new Date(),
              })
              .returning();

            return { recipe, activityEvent };
          },
        );
        movedKeys = [];

        // Schedule propagation without blocking the response.
        if (activityEvent) {
          propagateActivityToFollowersInBackground(
            ctx,
            activityEvent.id,
            ctx.user.id,
            activityEvent.createdAt,
            "Error propagating activity to followers:",
          );
        }

        return recipe;
      } catch (err) {
        await cleanupMovedRecipeImages(ctx.env.IMAGE_SERVICE, movedKeys);
        console.error("Error saving recipe:", err);
        throw mapServiceError(err);
      }
    }),

  updateRecipe: authedProcedure
    .input(RecipeUpdateValidator)
    .mutation(async ({ input, ctx }) => {
      if (input instanceof type.errors) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: input.summary,
        });
      }

      validateRecipePayload(input);
      const subscriptionStatus = await getCurrentSubscriptionStatus(ctx);

      let movedKeys: string[] = [];

      try {
        const preparedImages = await prepareRecipeImages(input, {
          imageService: ctx.env.IMAGE_SERVICE,
          imagePublicUrl: ctx.env.IMAGE_PUBLIC_URL,
          ownerId: ctx.user.id,
        });
        movedKeys = preparedImages.movedKeys;

        const recipe = await updateRecipe(ctx.db, ctx.user.id, {
          ...input,
          images: preparedImages.images,
          instructionSections: preparedImages.instructionSections,
          nutrition: subscriptionStatus.isPro
            ? (input.nutrition as any)
            : undefined,
        });
        movedKeys = [];

        return recipe;
      } catch (err) {
        await cleanupMovedRecipeImages(ctx.env.IMAGE_SERVICE, movedKeys);
        console.error("Error updating recipe:", err);
        throw mapServiceError(err);
      }
    }),

  getUserRecipes: authedProcedure
    .input(
      type({
        limit: "number = 20",
        cursor: "number?",
        tagIds: "number[]?",
        maxTotalTime: "number?", // in minutes
      }),
    )
    .query(async ({ ctx, input }) => {
      assertRecipeTagFilterLimit(input.tagIds);

      try {
        return await queryUserRecipes(ctx.db, {
          ownerId: ctx.user.id,
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.tagIds ? { tagIds: input.tagIds } : {}),
          ...(input.maxTotalTime !== undefined
            ? { maxTotalTime: input.maxTotalTime }
            : {}),
        });
      } catch (error) {
        throw mapServiceError(error);
      }
    }),

  searchUserRecipes: authedProcedure
    .input(
      type({
        query: "string",
        limit: "number = 20",
        "cursor?": "string",
        "tagIds?": "number[]",
        "maxTotalTime?": "number",
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input instanceof type.errors) {
        throw new TRPCError({ code: "BAD_REQUEST", message: input.summary });
      }

      assertRecipeTagFilterLimit(input.tagIds);

      try {
        const startedAt = Date.now();
        const result = await searchUserRecipes(ctx.db, {
          ownerId: ctx.user.id,
          query: input.query,
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.tagIds ? { tagIds: input.tagIds } : {}),
          ...(input.maxTotalTime !== undefined
            ? { maxTotalTime: input.maxTotalTime }
            : {}),
        });
        console.log(
          JSON.stringify({
            requestId: ctx.requestId,
            procedure: "recipe.searchUserRecipes",
            durationMs: Date.now() - startedAt,
            resultCount: result.items.length,
            hasNextPage: Boolean(result.nextCursor),
          }),
        );
        return result;
      } catch (error) {
        throw mapServiceError(error);
      }
    }),

  // Get recipes uploaded by a specific user
  getUserRecipesById: authedProcedure
    .input(
      type({
        userId: "string",
        limit: "number = 20",
        cursor: "number?",
        search: "string?",
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await queryUserRecipesByOwner(ctx.db, {
          ownerId: input.userId,
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.search ? { search: input.search } : {}),
        });
      } catch (error) {
        throw mapServiceError(error);
      }
    }),
});

const getNutrition = authedProcedure
  .input(GetNutritionValidator)
  .mutation(async ({ ctx, input }) => {
    if (input instanceof type.errors) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: input.summary,
      });
    }

    try {
      await requirePro(ctx);
      await enforceRateLimit(ctx, "recipe_nutrition");

      const recipe = await getRecipeDetail(ctx.db, input.recipeId, ctx.user.id);
      const stored = await getStoredRecipeNutrition(ctx.db, input.recipeId);
      if (hasCompleteNutritionCore(stored)) return stored;

      let result: NutritionResponse;
      try {
        result = await ctx.env.RECIPE_AI.nutrition({
          recipe: recipeDetailToParsedRecipe(recipe),
          sourceUrl: recipe.sourceUrl,
        });
      } catch (nutritionError) {
        console.error("Nutrition service call failed:", nutritionError);
        throw new PublicTRPCError({
          code: "BAD_GATEWAY",
          appCode: "SERVICE_UNAVAILABLE",
          cause: nutritionError,
        });
      }

      if (!result.success) {
        throw new PublicTRPCError({
          code: "BAD_GATEWAY",
          appCode: "SERVICE_UNAVAILABLE",
        });
      }

      const generatedNutrition = result.data;
      const hasNutritionValues = [
        generatedNutrition.calories,
        generatedNutrition.protein,
        generatedNutrition.carbohydrates,
        generatedNutrition.fat,
        generatedNutrition.saturatedFat,
        generatedNutrition.fiber,
        generatedNutrition.sugar,
        generatedNutrition.sodium,
        generatedNutrition.cholesterol,
        generatedNutrition.potassium,
        generatedNutrition.vitaminA,
        generatedNutrition.vitaminC,
        generatedNutrition.calcium,
        generatedNutrition.iron,
      ].some((value) => typeof value === "number" && Number.isFinite(value));

      if (!hasNutritionValues) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not generate nutrition for this recipe.",
        });
      }

      const generatedAt = new Date();
      try {
        return await upsertRecipeNutrition(ctx.db, input.recipeId, {
          ...generatedNutrition,
          generatedAt,
        });
      } catch (storageError) {
        console.error("Failed to store recipe nutrition:", storageError);
        return { ...generatedNutrition, generatedAt };
      }
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      console.error("Error fetching recipe nutrition:", err);
      throw mapServiceError(err);
    }
  });

const recipeTailRouter = router({
  getRecipeDetail: authedProcedure
    .input(
      type({
        recipeId: "number",
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const recipe = await getRecipeDetail(
          ctx.db,
          input.recipeId,
          ctx.user.id,
        );
        const subscriptionStatus = await getCurrentSubscriptionStatus(ctx);
        return recipeForEntitlement(recipe, subscriptionStatus.isPro);
      } catch (err) {
        console.error("Error fetching recipe detail:", err);
        throw mapServiceError(err);
      }
    }),

  importRecipe: authedProcedure
    .input(
      type({
        recipeId: "number",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await getRecipeDetail(ctx.db, input.recipeId, ctx.user.id);

        // Import the recipe (creates a copy for the current user)
        const newRecipe = await importRecipe(
          ctx.db,
          ctx.user.id,
          input.recipeId,
        );

        // Create activity event for the import
        const [activityEvent] = await ctx.db
          .insert(activityEvents)
          .values({
            userId: ctx.user.id,
            type: "recipe_import",
            recipeId: newRecipe.id,
            createdAt: new Date(),
          })
          .returning();

        // Schedule propagation without blocking the response.
        if (activityEvent) {
          propagateActivityToFollowersInBackground(
            ctx,
            activityEvent.id,
            ctx.user.id,
            activityEvent.createdAt,
            "Failed to propagate activity to followers:",
          );
        }

        return newRecipe;
      } catch (err) {
        console.error("Error importing recipe:", err);
        throw mapServiceError(err);
      }
    }),

  deleteRecipe: authedProcedure
    .input(
      type({
        recipeId: "number",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the recipe exists and is owned by the current user
      const recipe = await ctx.db.query.recipes.findFirst({
        where: eq(recipes.id, input.recipeId),
      });

      if (!recipe) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recipe not found",
        });
      }

      if (recipe.ownerId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own recipes",
        });
      }

      // Delete the recipe (cascading deletes handle related tables)
      await ctx.db.delete(recipes).where(eq(recipes.id, input.recipeId));

      return { success: true };
    }),

  getUserPreferences: authedProcedure.query(async ({ ctx }) => {
    try {
      // Analyze user's saved recipes to find most frequent tags
      const userTagPreferences = await ctx.db
        .select({
          tag: {
            id: tags.id,
            name: tags.name,
          },
          count: count(recipeTags.id),
        })
        .from(recipeCollections)
        .innerJoin(
          collections,
          eq(recipeCollections.collectionId, collections.id),
        )
        .innerJoin(
          recipeTags,
          eq(recipeCollections.recipeId, recipeTags.recipeId),
        )
        .innerJoin(tags, eq(recipeTags.tagId, tags.id))
        .where(
          and(
            eq(collections.userId, ctx.user.id),
            eq(tags.userId, ctx.user.id),
          ),
        )
        .groupBy(tags.id)
        .orderBy(desc(count(recipeTags.id)))
        .limit(15);

      return userTagPreferences.map((item) => ({
        ...item.tag,
        count: item.count,
      }));
    } catch (err) {
      console.error("Error fetching user preferences:", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch user preferences",
      });
    }
  }),

  getUserTags: authedProcedure.query(async ({ ctx }) => {
    try {
      return await ctx.db
        .select({
          id: tags.id,
          name: tags.name,
        })
        .from(tags)
        .where(eq(tags.userId, ctx.user.id))
        .orderBy(tags.name);
    } catch (err) {
      console.error("Error fetching user tags:", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch tags",
      });
    }
  }),

  getUserRecipeTags: authedProcedure.query(async ({ ctx }) => {
    const userTags = await ctx.db
      .selectDistinct({
        id: tags.id,
        name: tags.name,
      })
      .from(tags)
      .innerJoin(recipeTags, eq(tags.id, recipeTags.tagId))
      .innerJoin(recipes, eq(recipeTags.recipeId, recipes.id))
      .where(
        and(eq(recipes.ownerId, ctx.user.id), eq(tags.userId, ctx.user.id)),
      )
      .orderBy(tags.name);

    return userTags;
  }),

  /**
   * Parse ingredient text into structured format for preview
   * Used by the UI to show users how their ingredients will be parsed before saving
   */
  parseIngredients: authedProcedure
    .input(
      type({
        ingredients: "string[]",
      }),
    )
    .query(({ input }) => {
      return parseIngredients(input.ingredients);
    }),

  getPopularThisWeek: authedProcedure
    .input(
      type({
        limit: "number = 10",
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await queryPopularRecipesThisWeek(
          ctx.db,
          ctx.user.id,
          input.limit,
        );
      } catch (err) {
        console.error("Error fetching popular recipes:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch popular recipes",
        });
      }
    }),
});

export const recipeRouter = mergeRouters(recipeHeadRouter, recipeTailRouter);

export const recipeAiRouter = router({
  generateRecipeChat,
  personalizeRecipe,
  generateRecipeImage,
  getNutrition,
});
