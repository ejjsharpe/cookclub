import { collections, recipeCollections } from "@repo/db/schemas";
import {
  getUserCollectionsWithMetadata as getUserCollectionsWithMetadataService,
  getCollectionDetail as getCollectionDetailService,
  deleteCollection as deleteCollectionService,
  addRecipeToCollection as addRecipeToCollectionService,
  updateRecipeCollections as updateRecipeCollectionsService,
  getOrCreateDefaultCollections,
} from "@repo/db/services";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import { desc, eq } from "drizzle-orm";

import { router, authedProcedure } from "../trpc";
import { mapServiceError } from "../utils";

export const collectionRouter = router({
  getUserCollections: authedProcedure
    .input(
      type({
        "recipeId?": "number",
        "includeMetadata?": "boolean",
        "search?": "string",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { recipeId, includeMetadata, search } = input;

      // Ensure default collections exist (lazy creation on first access)
      await getOrCreateDefaultCollections(ctx.db, ctx.user.id);

      // If includeMetadata is requested AND no recipeId, return with metadata
      if (includeMetadata && recipeId === undefined) {
        return await getUserCollectionsWithMetadataService(ctx.db, {
          userId: ctx.user.id,
          ...(search && { search }),
        });
      }

      try {
        // Get all user's collections, newest first.
        const userCollections = await ctx.db
          .select({
            id: collections.id,
            name: collections.name,
            defaultType: collections.defaultType,
            createdAt: collections.createdAt,
          })
          .from(collections)
          .where(eq(collections.userId, ctx.user.id))
          .orderBy(desc(collections.createdAt), desc(collections.id));

        // If recipeId provided, also check which collections contain this recipe
        if (recipeId !== undefined) {
          const recipeInCollections = await ctx.db
            .select({ collectionId: recipeCollections.collectionId })
            .from(recipeCollections)
            .where(eq(recipeCollections.recipeId, recipeId));

          const collectionIdsWithRecipe = new Set(
            recipeInCollections.map((rc) => rc.collectionId),
          );

          return userCollections.map((collection) => ({
            ...collection,
            hasRecipe: collectionIdsWithRecipe.has(collection.id),
          }));
        }

        return userCollections.map((collection) => ({
          ...collection,
          hasRecipe: false,
        }));
      } catch (err) {
        console.error("Error fetching user collections:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch collections",
        });
      }
    }),

  createCollection: authedProcedure
    .input(
      type({
        name: "string",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { name } = input;

      try {
        // Prevent users from creating collections with reserved default names
        const reservedNames = ["want to cook", "cooked"];
        if (reservedNames.includes(name.trim().toLowerCase())) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `The name "${name}" is reserved for default collections`,
          });
        }

        // Create the collection (all user-created collections are non-default)
        const [newCollection] = await ctx.db
          .insert(collections)
          .values({
            userId: ctx.user.id,
            name,
            defaultType: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        return newCollection;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        console.error("Error creating collection:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create collection",
        });
      }
    }),

  getCollectionDetail: authedProcedure
    .input(
      type({
        collectionId: "number",
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getCollectionDetailService(ctx.db, {
          userId: ctx.user.id,
          collectionId: input.collectionId,
        });
      } catch (err) {
        console.error("Error fetching collection detail:", err);
        throw mapServiceError(err);
      }
    }),

  deleteCollection: authedProcedure
    .input(
      type({
        collectionId: "number",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteCollectionService(ctx.db, {
          userId: ctx.user.id,
          collectionId: input.collectionId,
        });
      } catch (err) {
        console.error("Error deleting collection:", err);
        throw mapServiceError(err);
      }
    }),

  addRecipeToCollection: authedProcedure
    .input(
      type({
        recipeId: "number",
        collectionId: "number",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await addRecipeToCollectionService(ctx.db, {
          userId: ctx.user.id,
          recipeId: input.recipeId,
          collectionId: input.collectionId,
        });
      } catch (err) {
        console.error("Error adding recipe to collection:", err);
        throw mapServiceError(err);
      }
    }),

  // Get collections for a specific user (with metadata)
  getUserCollectionsById: authedProcedure
    .input(
      type({
        userId: "string",
        "search?": "string",
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId, search } = input;

      try {
        return await getUserCollectionsWithMetadataService(ctx.db, {
          userId,
          ...(search && { search }),
        });
      } catch (err) {
        console.error("Error fetching user collections:", err);
        throw mapServiceError(err);
      }
    }),

  // Batch update recipe collections (replace all memberships)
  updateRecipeCollections: authedProcedure
    .input(
      type({
        recipeId: "number",
        collectionIds: "number[]",
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateRecipeCollectionsService(ctx.db, {
          userId: ctx.user.id,
          recipeId: input.recipeId,
          collectionIds: input.collectionIds,
        });
      } catch (err) {
        console.error("Error updating recipe collections:", err);
        throw mapServiceError(err);
      }
    }),
});
