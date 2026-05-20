import {
  cookingReviewImages,
  cookingReviews,
  instructionSections,
  recipeImages,
  recipeInstructions,
  recipes,
  user,
} from "@repo/db/schemas";
import { TRPCError } from "@trpc/server";
import { type } from "arktype";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";

import type { Context } from "../context";
import { router, authedProcedure } from "../trpc";

const RESERVED_USERNAMES = [
  "admin",
  "support",
  "help",
  "cookclub",
  "cook_club",
  "system",
  "mod",
  "moderator",
  "official",
  "null",
  "undefined",
  "settings",
  "profile",
  "api",
];

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

const UpdateProfileValidator = type({
  "name?": "string",
  "username?": "string",
  "bio?": "string | null",
  "image?": "string | null",
  "measurementPreference?": "string",
});

const UploadAvatarValidator = type({
  imageKey: "string",
});

const CheckUsernameValidator = type({
  username: "string",
});

const CompleteOnboardingValidator = type({
  username: "string",
  "name?": "string",
  "bio?": "string | null",
  "image?": "string | null",
  "measurementPreference?": "string",
});

function validateUsername(username: string): {
  valid: boolean;
  reason: string | null;
} {
  if (!USERNAME_REGEX.test(username)) {
    if (username.length < 3) {
      return { valid: false, reason: "Username must be at least 3 characters" };
    }
    if (username.length > 20) {
      return { valid: false, reason: "Username must be 20 characters or less" };
    }
    return {
      valid: false,
      reason: "Only lowercase letters, numbers, and underscores",
    };
  }

  if (RESERVED_USERNAMES.includes(username)) {
    return { valid: false, reason: "This username is reserved" };
  }

  return { valid: true, reason: null };
}

function imageKeyFromPublicUrl(
  url: string | null | undefined,
  publicUrl: string,
) {
  if (!url) return null;

  const baseUrl = `${publicUrl.replace(/\/+$/, "")}/`;
  if (!url.startsWith(baseUrl)) return null;

  const encodedKey = url.slice(baseUrl.length).split(/[?#]/)[0] ?? "";
  let key: string;

  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    return null;
  }

  if (!key || key.startsWith("/") || key.split("/").includes("..")) {
    return null;
  }

  return key;
}

function imageReferenceFromPublicUrl(
  url: string | null | undefined,
  publicUrl: string,
) {
  if (!url) return null;

  const baseUrl = `${publicUrl.replace(/\/+$/, "")}/`;
  if (!url.startsWith(baseUrl)) return null;

  const encodedKey = url.slice(baseUrl.length).split(/[?#]/)[0] ?? "";
  const key = imageKeyFromPublicUrl(url, publicUrl);
  if (!key) return null;

  return {
    key,
    urls: [url, `${baseUrl}${encodedKey}`],
  };
}

async function getCandidateImageReferencesForAccountDeletion(
  ctx: Pick<Context, "db" | "env"> & {
    user: NonNullable<Context["user"]>;
  },
) {
  const publicUrl = ctx.env.IMAGE_PUBLIC_URL;
  const userId = ctx.user.id;
  const keys = new Set<string>();
  const urls = new Set<string>();
  const addReference = (url: string | null | undefined) => {
    const reference = imageReferenceFromPublicUrl(url, publicUrl);
    if (!reference) return;

    keys.add(reference.key);
    reference.urls.forEach((candidateUrl) => urls.add(candidateUrl));
  };

  const [dbUser] = await ctx.db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  addReference(dbUser?.image);

  const ownedRecipeImages = await ctx.db
    .select({ url: recipeImages.url })
    .from(recipeImages)
    .innerJoin(recipes, eq(recipeImages.recipeId, recipes.id))
    .where(eq(recipes.ownerId, userId));
  ownedRecipeImages.forEach((row) => addReference(row.url));

  const ownedInstructionImages = await ctx.db
    .select({ url: recipeInstructions.imageUrl })
    .from(recipeInstructions)
    .innerJoin(
      instructionSections,
      eq(recipeInstructions.sectionId, instructionSections.id),
    )
    .innerJoin(recipes, eq(instructionSections.recipeId, recipes.id))
    .where(
      and(eq(recipes.ownerId, userId), isNotNull(recipeInstructions.imageUrl)),
    );
  ownedInstructionImages.forEach((row) => addReference(row.url));

  const ownedReviewImages = await ctx.db
    .select({ url: cookingReviewImages.url })
    .from(cookingReviewImages)
    .innerJoin(
      cookingReviews,
      eq(cookingReviewImages.reviewId, cookingReviews.id),
    )
    .where(eq(cookingReviews.userId, userId));
  ownedReviewImages.forEach((row) => addReference(row.url));

  return {
    keys,
    urls,
  };
}

async function getRemainingReferencedImageKeys(
  ctx: Pick<Context, "db" | "env">,
  candidates: { keys: Set<string>; urls: Set<string> },
) {
  if (candidates.keys.size === 0 || candidates.urls.size === 0) {
    return new Set<string>();
  }

  const candidateUrls = Array.from(candidates.urls);
  const referencedKeys = new Set<string>();
  const addIfCandidate = (url: string | null | undefined) => {
    const key = imageKeyFromPublicUrl(url, ctx.env.IMAGE_PUBLIC_URL);
    if (key && candidates.keys.has(key)) {
      referencedKeys.add(key);
    }
  };

  const [
    remainingUserImages,
    remainingRecipeImages,
    remainingInstructionImages,
    remainingReviewImages,
  ] = await Promise.all([
    ctx.db
      .select({ url: user.image })
      .from(user)
      .where(inArray(user.image, candidateUrls)),
    ctx.db
      .select({ url: recipeImages.url })
      .from(recipeImages)
      .where(inArray(recipeImages.url, candidateUrls)),
    ctx.db
      .select({ url: recipeInstructions.imageUrl })
      .from(recipeInstructions)
      .where(inArray(recipeInstructions.imageUrl, candidateUrls)),
    ctx.db
      .select({ url: cookingReviewImages.url })
      .from(cookingReviewImages)
      .where(inArray(cookingReviewImages.url, candidateUrls)),
  ]);

  [
    remainingUserImages,
    remainingRecipeImages,
    remainingInstructionImages,
    remainingReviewImages,
  ].forEach((rows) => rows.forEach((row) => addIfCandidate(row.url)));

  return referencedKeys;
}

export const userRouter = router({
  getUser: authedProcedure.query(async ({ ctx }) => {
    // Fetch full user from database to get all fields including onboardingCompleted
    const [dbUser] = await ctx.db
      .select()
      .from(user)
      .where(eq(user.id, ctx.user.id))
      .limit(1);

    return {
      user: dbUser ?? null,
    };
  }),

  checkUsername: authedProcedure
    .input(CheckUsernameValidator)
    .query(async ({ ctx, input }) => {
      const { username } = input;

      const validation = validateUsername(username);
      if (!validation.valid) {
        return { available: false, reason: validation.reason };
      }

      // Check DB uniqueness (exclude current user in case they already own it)
      const [existing] = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.username, username), ne(user.id, ctx.user.id)))
        .limit(1);

      if (existing) {
        return { available: false, reason: "Username is already taken" };
      }

      return { available: true, reason: null };
    }),

  updateProfile: authedProcedure
    .input(UpdateProfileValidator)
    .mutation(async ({ ctx, input }) => {
      // Validate username if provided
      if (input.username !== undefined) {
        const validation = validateUsername(input.username);
        if (!validation.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: validation.reason ?? "Invalid username",
          });
        }

        const [existing] = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(
            and(eq(user.username, input.username), ne(user.id, ctx.user.id)),
          )
          .limit(1);

        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Username is already taken",
          });
        }
      }

      const [updatedUser] = await ctx.db
        .update(user)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.username !== undefined && { username: input.username }),
          ...(input.bio !== undefined && { bio: input.bio }),
          ...(input.image !== undefined && { image: input.image }),
          ...(input.measurementPreference !== undefined && {
            measurementPreference: input.measurementPreference,
          }),
          updatedAt: new Date(),
        })
        .where(eq(user.id, ctx.user.id))
        .returning();

      return { user: updatedUser };
    }),

  completeOnboarding: authedProcedure
    .input(CompleteOnboardingValidator)
    .mutation(async ({ ctx, input }) => {
      // Validate username
      const validation = validateUsername(input.username);
      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: validation.reason ?? "Invalid username",
        });
      }

      // Check uniqueness
      const [existing] = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.username, input.username), ne(user.id, ctx.user.id)))
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Username is already taken",
        });
      }

      const [updatedUser] = await ctx.db
        .update(user)
        .set({
          username: input.username,
          ...(input.name !== undefined && { name: input.name }),
          ...(input.bio !== undefined && { bio: input.bio }),
          ...(input.image !== undefined && { image: input.image }),
          ...(input.measurementPreference !== undefined && {
            measurementPreference: input.measurementPreference,
          }),
          onboardingCompleted: true,
          updatedAt: new Date(),
        })
        .where(eq(user.id, ctx.user.id))
        .returning();

      return { user: updatedUser };
    }),

  /**
   * Upload a new avatar image.
   * Moves the image from temp storage to permanent avatar location.
   */
  uploadAvatar: authedProcedure
    .input(UploadAvatarValidator)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const ext = input.imageKey.split(".").pop() || "jpg";
      const destinationKey = `avatars/${userId}.${ext}`;

      // Move from temp to permanent location
      const moveResult = await ctx.env.IMAGE_SERVICE.move(
        [
          {
            from: input.imageKey,
            to: destinationKey,
          },
        ],
        userId,
      );

      if (!moveResult.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            moveResult.results[0]?.error || "Failed to store avatar image",
        });
      }

      // Construct public URL
      const imageUrl = `${ctx.env.IMAGE_PUBLIC_URL}/${destinationKey}`;

      // Update user record
      const [updatedUser] = await ctx.db
        .update(user)
        .set({ image: imageUrl, updatedAt: new Date() })
        .where(eq(user.id, userId))
        .returning();

      return { user: updatedUser };
    }),

  deleteAccount: authedProcedure.mutation(async ({ ctx }) => {
    const imageCandidates =
      await getCandidateImageReferencesForAccountDeletion(ctx);

    const [deletedUser] = await ctx.db
      .delete(user)
      .where(eq(user.id, ctx.user.id))
      .returning({ id: user.id });

    if (!deletedUser) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Account not found",
      });
    }

    const referencedImageKeys = await getRemainingReferencedImageKeys(
      ctx,
      imageCandidates,
    );
    const imageKeys = Array.from(imageCandidates.keys).filter(
      (key) => !referencedImageKeys.has(key),
    );

    if (imageKeys.length > 0) {
      ctx.waitUntil(
        ctx.env.IMAGE_SERVICE.delete(imageKeys).catch((error) => {
          console.error("Failed to delete account images:", error);
        }),
      );
    }

    return {
      success: true,
      deletedImageCount: imageKeys.length,
    };
  }),
});
