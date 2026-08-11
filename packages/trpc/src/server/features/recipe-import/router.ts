import type { ParsedRecipeNutrition } from "@repo/contracts/recipe";
import { activityEvents, recipeImportJobs } from "@repo/db/schemas";
import {
  createRecipeInTransaction,
  getRecipeDetail,
  type CreateRecipeInput,
} from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import { and, eq } from "drizzle-orm";

import { cleanupRecipeImportImagesBestEffort } from "./cleanup";
import {
  assertReadyImportJob,
  createRecipeImportJob,
  dismissRecipeImportJob,
  fingerprintRecipeImportRequest,
  getRecipeImportJob,
  listRecipeImportJobs,
} from "./service";
import {
  filterOptionalPublicText,
  filterPublicText,
} from "../../moderation/text-filter";
import { PublicTRPCError } from "../../public-errors";
import { enforceRateLimit } from "../../rate-limit";
import { propagateActivityToFollowersInBackground } from "../../services/activity";
import {
  cleanupMovedRecipeImages,
  prepareRecipeImages,
} from "../../services/recipe-image.service";
import { getCurrentSubscriptionStatus } from "../../services/subscription.service";
import { authedProcedure, publicUgcProcedure, router } from "../../trpc";
import { mapServiceError } from "../../utils";

const UrlSource = type({ type: "'url'", value: "string" });
const TextSource = type({ type: "'text'", value: "string" });
const ImageSource = type({ type: "'image'", uploadKeys: "string[]" });
const SmartSource = type.or(UrlSource, TextSource, ImageSource);
const CreateImport = type.or(
  type({ id: "string", importType: "'basic'", source: UrlSource }),
  type({ id: "string", importType: "'smart'", source: SmartSource }),
);
const ImportId = type({ id: "string" });

const ImageUrlRecord = type({ url: "string.url" });
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
const IngredientRecord = type.or(
  type({ index: "number", ingredient: "string" }),
  type({
    index: "number",
    quantity: "string | null",
    unit: "string | null",
    name: "string",
    "preparation?": "string | null",
  }),
);
const InstructionRecord = type({
  index: "number",
  instruction: "string",
  "imageUrl?": "string | null",
});
const NutritionRecord = type({
  "calories?": "number | null",
  "protein?": "number | null",
  "carbohydrates?": "number | null",
  "fat?": "number | null",
  "saturatedFat?": "number | null",
  "fiber?": "number | null",
  "sugar?": "number | null",
  "sodium?": "number | null",
  "cholesterol?": "number | null",
  "potassium?": "number | null",
  "vitaminA?": "number | null",
  "vitaminC?": "number | null",
  "calcium?": "number | null",
  "iron?": "number | null",
  "source?": "'extracted' | 'ai_estimated' | 'manual' | 'imported'",
  "confidence?": "'high' | 'medium' | 'low' | null",
});
const RecipeDraft = type({
  name: "string",
  ingredientSections: type({
    name: "string | null",
    ingredients: IngredientRecord.array(),
  })
    .array()
    .atLeastLength(1),
  instructionSections: type({
    name: "string | null",
    instructions: InstructionRecord.array(),
  }).array(),
  "images?": ImageRecord.array(),
  "imageUploadIds?": "string[]",
  "sourceUrl?": "string",
  "sourceType?": "'url' | 'image' | 'text' | 'ai' | 'manual' | 'user'",
  "tagNames?": "string[]",
  "description?": "string",
  "prepTime?": "number",
  "cookTime?": "number",
  "totalTime?": "number",
  servings: "number > 0",
  "nutrition?": NutritionRecord.or("null"),
});
const CompleteImport = type({ id: "string", recipe: RecipeDraft });

function assertValid<T>(
  value: T | type.errors,
): asserts value is Exclude<T, type.errors> {
  if (value instanceof type.errors) {
    throw new TRPCError({ code: "BAD_REQUEST", message: value.summary });
  }
}

function validateRecipeDraft(recipe: typeof RecipeDraft.infer) {
  if (!recipe.name.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Recipe name is required.",
    });
  }
  const hasImage =
    (recipe.images?.length ?? 0) > 0 ||
    (recipe.imageUploadIds?.length ?? 0) > 0;
  if (!hasImage) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one image is required.",
    });
  }
  const hasIngredient = recipe.ingredientSections.some((section) =>
    section.ingredients.some((ingredient) =>
      "ingredient" in ingredient
        ? ingredient.ingredient.trim().length > 0
        : ingredient.name.trim().length > 0,
    ),
  );
  if (!hasIngredient) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one ingredient is required.",
    });
  }
}

function rateLimitKey(source: "url" | "text" | "image", basic: boolean) {
  if (basic) return "recipe_parse_url_basic";
  return source === "url"
    ? "recipe_parse_url"
    : source === "text"
      ? "recipe_parse_text"
      : "recipe_parse_image";
}

export const recipeImportRouter = router({
  create: authedProcedure
    .input(CreateImport)
    .mutation(async ({ ctx, input }) => {
      assertValid(input);
      await enforceRateLimit(
        ctx,
        rateLimitKey(input.source.type, input.importType === "basic"),
      );
      return await createRecipeImportJob(
        { db: ctx.db, env: ctx.env },
        ctx.user.id,
        input,
      );
    }),

  list: authedProcedure.query(async ({ ctx }) => {
    return await listRecipeImportJobs(ctx.db, ctx.user.id);
  }),

  get: authedProcedure.input(ImportId).query(async ({ ctx, input }) => {
    assertValid(input);
    const [job, subscription] = await Promise.all([
      getRecipeImportJob(ctx.db, ctx.user.id, input.id),
      getCurrentSubscriptionStatus(ctx),
    ]);
    if (subscription.isPro || !job.recipe?.success) return job;

    return {
      ...job,
      recipe: {
        ...job.recipe,
        data: {
          ...job.recipe.data,
          nutrition: null,
        },
      },
    };
  }),

  complete: publicUgcProcedure
    .input(CompleteImport)
    .mutation(async ({ ctx, input }) => {
      assertValid(input);
      validateRecipeDraft(input.recipe);
      const normalizedRecipe = {
        ...input.recipe,
        name: filterPublicText(input.recipe.name, "Recipe name"),
        ...(input.recipe.description !== undefined
          ? {
              description: filterPublicText(
                input.recipe.description,
                "Recipe description",
              ),
            }
          : {}),
        ...(input.recipe.tagNames !== undefined
          ? {
              tagNames: input.recipe.tagNames.map((tag) =>
                filterPublicText(tag, "Tag"),
              ),
            }
          : {}),
        ingredientSections: input.recipe.ingredientSections.map((section) => ({
          ...section,
          name: filterOptionalPublicText(section.name, "Ingredient section"),
          ingredients: section.ingredients.map((ingredient) =>
            "ingredient" in ingredient
              ? {
                  ...ingredient,
                  ingredient: filterPublicText(
                    ingredient.ingredient,
                    "Ingredient",
                  ),
                }
              : {
                  ...ingredient,
                  name: filterPublicText(ingredient.name, "Ingredient"),
                  ...(ingredient.preparation !== undefined
                    ? {
                        preparation: filterOptionalPublicText(
                          ingredient.preparation,
                          "Ingredient preparation",
                        ),
                      }
                    : {}),
                },
          ),
        })),
        instructionSections: input.recipe.instructionSections.map(
          (section) => ({
            ...section,
            name: filterOptionalPublicText(section.name, "Instruction section"),
            instructions: section.instructions.map((instruction) => ({
              ...instruction,
              instruction: filterPublicText(
                instruction.instruction,
                "Instruction",
              ),
            })),
          }),
        ),
      };
      const completionFingerprint = await fingerprintRecipeImportRequest({
        version: 2,
        recipe: normalizedRecipe,
      });
      const existing = await ctx.db
        .select({
          status: recipeImportJobs.status,
          completionFingerprint: recipeImportJobs.completionFingerprint,
          recipeId: recipeImportJobs.recipeId,
        })
        .from(recipeImportJobs)
        .where(
          and(
            eq(recipeImportJobs.id, input.id),
            eq(recipeImportJobs.userId, ctx.user.id),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (existing?.status === "consumed") {
        if (
          existing.completionFingerprint !== completionFingerprint ||
          !existing.recipeId
        ) {
          throw new PublicTRPCError({
            code: "CONFLICT",
            appCode: "CONFLICT",
            message: "Import was completed with different recipe data.",
          });
        }
        return await getRecipeDetail(ctx.db, existing.recipeId, ctx.user.id);
      }
      assertReadyImportJob(existing);

      const subscription = await getCurrentSubscriptionStatus(ctx);
      let movedKeys: string[] = [];
      try {
        const prepared = await prepareRecipeImages(normalizedRecipe, {
          imageService: ctx.env.IMAGE_SERVICE,
          imagePublicUrl: ctx.env.IMAGE_PUBLIC_URL,
          ownerId: ctx.user.id,
        });
        movedKeys = prepared.movedKeys;
        const {
          images: _images,
          imageUploadIds: _imageUploadIds,
          nutrition,
          ...draft
        } = normalizedRecipe;

        const transactionResult = await ctx.db.transaction(async (tx) => {
          const locked = await tx
            .select({
              status: recipeImportJobs.status,
              completionFingerprint: recipeImportJobs.completionFingerprint,
              recipeId: recipeImportJobs.recipeId,
            })
            .from(recipeImportJobs)
            .where(
              and(
                eq(recipeImportJobs.id, input.id),
                eq(recipeImportJobs.userId, ctx.user.id),
              ),
            )
            .for("update")
            .then((rows) => rows[0] ?? null);

          if (locked?.status === "consumed") {
            if (
              locked.completionFingerprint !== completionFingerprint ||
              !locked.recipeId
            ) {
              throw new PublicTRPCError({
                code: "CONFLICT",
                appCode: "CONFLICT",
                message: "Import was completed with different recipe data.",
              });
            }
            return {
              created: false as const,
              recipeId: locked.recipeId,
              activityEvent: null,
            };
          }
          assertReadyImportJob(locked);

          const recipeInput: CreateRecipeInput = {
            ...draft,
            sourceType: draft.sourceType ?? "manual",
            images: prepared.images,
            instructionSections: prepared.instructionSections,
            ...(subscription.isPro && nutrition
              ? { nutrition: nutrition as ParsedRecipeNutrition }
              : {}),
          };
          const recipe = await createRecipeInTransaction(
            tx,
            ctx.user.id,
            recipeInput,
          );
          const activityEvent = await tx
            .insert(activityEvents)
            .values({
              userId: ctx.user.id,
              type: "recipe_import",
              recipeId: recipe.id,
              createdAt: new Date(),
            })
            .returning()
            .then((rows) => rows[0]!);
          const consumedAt = new Date();
          await tx
            .update(recipeImportJobs)
            .set({
              status: "consumed",
              recipeId: recipe.id,
              completionFingerprint,
              consumedAt,
              sourceData: null,
              recipe: null,
              error: null,
              errorCode: null,
              updatedAt: consumedAt,
            })
            .where(
              and(
                eq(recipeImportJobs.id, input.id),
                eq(recipeImportJobs.userId, ctx.user.id),
                eq(recipeImportJobs.status, "ready"),
              ),
            );
          return {
            created: true as const,
            recipeId: recipe.id,
            activityEvent,
          };
        });

        if (transactionResult.created) {
          movedKeys = [];
          // Update the owner's feed before responding; followers fan out in the background.
          await propagateActivityToFollowersInBackground(
            ctx,
            transactionResult.activityEvent.id,
            ctx.user.id,
            transactionResult.activityEvent.createdAt,
            "Error propagating recipe import activity:",
          );
          await cleanupRecipeImportImagesBestEffort(
            ctx.env.IMAGE_SERVICE,
            input.id,
          );
        } else {
          await cleanupMovedRecipeImages(ctx.env.IMAGE_SERVICE, movedKeys);
          movedKeys = [];
        }

        return await getRecipeDetail(
          ctx.db,
          transactionResult.recipeId,
          ctx.user.id,
        );
      } catch (error) {
        await cleanupMovedRecipeImages(ctx.env.IMAGE_SERVICE, movedKeys);
        throw mapServiceError(error);
      }
    }),

  dismiss: authedProcedure.input(ImportId).mutation(async ({ ctx, input }) => {
    assertValid(input);
    return await dismissRecipeImportJob(
      { db: ctx.db, env: ctx.env },
      ctx.user.id,
      input.id,
    );
  }),
});
