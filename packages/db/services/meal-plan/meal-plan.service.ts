import { eq, and, or, between, inArray, gt } from "drizzle-orm";

import {
  mealPlans,
  mealPlanEntries,
  mealPlanInvitations,
  recipes,
  recipeImages,
  follows,
  user,
} from "../../schemas";
import { ServiceError } from "../errors";
import type { DbClient, TransactionClient } from "../types";
import {
  createMealTime,
  resolveMealTimes,
  applyMealTimeChange,
  type MealTime,
  type MealTimeChange,
} from "./meal-times";

// ─── Types ─────────────────────────────────────────────────────────────────

// Key of one of the plan's meal times: "breakfast", "lunch", "dinner" or a custom one.
export type MealType = string;

export interface MealPlanWithMeta {
  id: number;
  name: string;
  isDefault: boolean;
  isOwner: boolean;
  owner: {
    id: string;
    name: string;
    image: string | null;
  };
  mealTimes: MealTime[];
  createdAt: Date;
}

export interface MealPlanEntry {
  id: number;
  date: string;
  mealType: MealType;
  recipeId: number;
  recipeName: string;
  recipeImageUrl: string | null;
}

// ─── Meal Plan Operations ─────────────────────────────────────────────────

/**
 * Get or create the default meal plan for a user.
 * Handles race conditions gracefully using onConflictDoNothing.
 */
export async function getOrCreateDefaultMealPlan(db: DbClient, userId: string) {
  // Look for default meal plan
  const defaultPlan = await db
    .select()
    .from(mealPlans)
    .where(and(eq(mealPlans.userId, userId), eq(mealPlans.isDefault, true)))
    .then((rows) => rows[0]);

  if (defaultPlan) {
    return defaultPlan;
  }

  // Try to create default meal plan with conflict handling for race conditions
  await db
    .insert(mealPlans)
    .values({
      userId,
      name: "My Meal Plan",
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  // Re-fetch to get final state (handles race condition where another request inserted)
  const finalPlan = await db
    .select()
    .from(mealPlans)
    .where(and(eq(mealPlans.userId, userId), eq(mealPlans.isDefault, true)))
    .then((rows) => rows[0]);

  return finalPlan!;
}

/**
 * Get all meal plans the user has access to (owned + shared with them)
 */
export async function getMealPlans(
  db: DbClient,
  userId: string,
): Promise<MealPlanWithMeta[]> {
  // Get user's own plans
  const ownPlans = await db
    .select({
      id: mealPlans.id,
      name: mealPlans.name,
      isDefault: mealPlans.isDefault,
      mealTimes: mealPlans.mealTimes,
      createdAt: mealPlans.createdAt,
      ownerId: mealPlans.userId,
      ownerName: user.name,
      ownerImage: user.image,
    })
    .from(mealPlans)
    .innerJoin(user, eq(mealPlans.userId, user.id))
    .where(eq(mealPlans.userId, userId));

  // Get plans shared with the user (accepted invitations only)
  const sharedPlans = await db
    .select({
      id: mealPlans.id,
      name: mealPlans.name,
      isDefault: mealPlans.isDefault,
      mealTimes: mealPlans.mealTimes,
      createdAt: mealPlans.createdAt,
      ownerId: mealPlanInvitations.invitedByUserId,
      ownerName: mealPlanInvitations.inviterName,
      ownerImage: mealPlanInvitations.inviterImage,
    })
    .from(mealPlanInvitations)
    .innerJoin(mealPlans, eq(mealPlanInvitations.mealPlanId, mealPlans.id))
    .where(
      and(
        eq(mealPlanInvitations.invitedUserId, userId),
        eq(mealPlanInvitations.status, "accepted"),
      ),
    );

  // Combine and format
  const result: MealPlanWithMeta[] = [
    ...ownPlans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      isDefault: plan.isDefault,
      isOwner: true,
      owner: {
        id: plan.ownerId,
        name: plan.ownerName,
        image: plan.ownerImage,
      },
      mealTimes: resolveMealTimes(plan.mealTimes),
      createdAt: plan.createdAt,
    })),
    ...sharedPlans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      isDefault: plan.isDefault,
      isOwner: false,
      owner: {
        id: plan.ownerId,
        name: plan.ownerName,
        image: plan.ownerImage,
      },
      mealTimes: resolveMealTimes(plan.mealTimes),
      createdAt: plan.createdAt,
    })),
  ];

  // Sort: default plan first, then by name
  result.sort((a, b) => {
    if (a.isDefault && a.isOwner) return -1;
    if (b.isDefault && b.isOwner) return 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

/**
 * Create a new meal plan
 */
export async function createMealPlan(
  db: DbClient,
  params: { userId: string; name: string },
): Promise<typeof mealPlans.$inferSelect> {
  const { userId, name } = params;

  const newPlan = await db
    .insert(mealPlans)
    .values({
      userId,
      name,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .then((rows) => rows[0]);

  return newPlan!;
}

/**
 * Delete a meal plan (owner only, not default)
 */
export async function deleteMealPlan(
  db: DbClient,
  params: { userId: string; mealPlanId: number },
): Promise<{ success: boolean }> {
  const { userId, mealPlanId } = params;

  // Verify plan exists and belongs to user
  const plan = await db
    .select()
    .from(mealPlans)
    .where(and(eq(mealPlans.id, mealPlanId), eq(mealPlans.userId, userId)))
    .then((rows) => rows[0]);

  if (!plan) {
    throw new ServiceError("NOT_FOUND", "Meal plan not found");
  }

  if (plan.isDefault) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Cannot delete your default meal plan",
    );
  }

  await db.delete(mealPlans).where(eq(mealPlans.id, mealPlanId));

  return { success: true };
}

// ─── Access Control ─────────────────────────────────────────────────────────

/**
 * Check if user can access a meal plan (owner or shared with them)
 */
export async function canUserAccessMealPlan(
  db: DbClient,
  userId: string,
  mealPlanId: number,
): Promise<boolean> {
  // Check if owner
  const ownPlan = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.id, mealPlanId), eq(mealPlans.userId, userId)))
    .then((rows) => rows[0]);

  if (ownPlan) return true;

  // Check if member (accepted invitation)
  const member = await db
    .select({ id: mealPlanInvitations.id })
    .from(mealPlanInvitations)
    .where(
      and(
        eq(mealPlanInvitations.mealPlanId, mealPlanId),
        eq(mealPlanInvitations.invitedUserId, userId),
        eq(mealPlanInvitations.status, "accepted"),
      ),
    )
    .then((rows) => rows[0]);

  return !!member;
}

/**
 * Check if user can edit a meal plan (owner or accepted member)
 */
export async function canUserEditMealPlan(
  db: DbClient,
  userId: string,
  mealPlanId: number,
): Promise<boolean> {
  return canUserAccessMealPlan(db, userId, mealPlanId);
}

// ─── Meal Times ─────────────────────────────────────────────────────────────

/**
 * A plan's meal times, read with a row lock so they can't change underneath
 * the caller's transaction: "update" for edits to the list, "share" when
 * planning a meal (so a meal time can't be removed while one is added to it).
 */
async function getPlanMealTimes(
  tx: TransactionClient,
  mealPlanId: number,
  lock: "update" | "share",
) {
  const plan = await tx
    .select({ mealTimes: mealPlans.mealTimes })
    .from(mealPlans)
    .where(eq(mealPlans.id, mealPlanId))
    .for(lock)
    .then((rows) => rows[0]);
  if (!plan) {
    throw new ServiceError("NOT_FOUND", "Meal plan not found");
  }
  return resolveMealTimes(plan.mealTimes);
}

async function assertMealTimeExists(
  tx: TransactionClient,
  mealPlanId: number,
  mealType: string,
) {
  const mealTimes = await getPlanMealTimes(tx, mealPlanId, "share");
  if (!mealTimes.some((t) => t.key === mealType)) {
    throw new ServiceError(
      "BAD_REQUEST",
      "That meal time isn't on this plan any more",
    );
  }
}

async function assertCanEdit(db: DbClient, userId: string, mealPlanId: number) {
  const canEdit = await canUserEditMealPlan(db, userId, mealPlanId);
  if (!canEdit) {
    throw new ServiceError(
      "FORBIDDEN",
      "You do not have permission to edit this meal plan",
    );
  }
}

/**
 * Add a custom meal time (e.g. "Supper") to the end of a plan's meal times.
 * Returns the plan's updated meal times and the new one.
 */
export async function addMealTime(
  db: DbClient,
  params: { userId: string; mealPlanId: number; name: string },
): Promise<{ mealTimes: MealTime[]; mealTime: MealTime }> {
  const { userId, mealPlanId, name } = params;
  await assertCanEdit(db, userId, mealPlanId);

  const adder = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .then((rows) => rows[0]);

  return await db.transaction(async (tx) => {
    const current = await getPlanMealTimes(tx, mealPlanId, "update");
    const mealTime = createMealTime(current, name, {
      id: userId,
      name: adder?.name ?? "",
    });
    const mealTimes = [...current, mealTime];
    await tx
      .update(mealPlans)
      .set({ mealTimes, updatedAt: new Date() })
      .where(eq(mealPlans.id, mealPlanId));
    return { mealTimes, mealTime };
  });
}

/**
 * Hide, show, move or remove one of a plan's meal times. Meal times with
 * planned meals can be hidden but not removed. Returns the updated list.
 */
export async function changeMealTime(
  db: DbClient,
  params: { userId: string; mealPlanId: number; change: MealTimeChange },
): Promise<MealTime[]> {
  const { userId, mealPlanId, change } = params;
  await assertCanEdit(db, userId, mealPlanId);

  return await db.transaction(async (tx) => {
    const current = await getPlanMealTimes(tx, mealPlanId, "update");

    // Meals are added under a share lock on the plan row, so none can be
    // added to this meal time between this check and the write below.
    let hasMeals = false;
    if (change.type === "remove") {
      const planned = await tx
        .select({ id: mealPlanEntries.id })
        .from(mealPlanEntries)
        .where(
          and(
            eq(mealPlanEntries.mealPlanId, mealPlanId),
            eq(mealPlanEntries.mealType, change.key),
          ),
        )
        .limit(1);
      hasMeals = planned.length > 0;
    }

    const mealTimes = applyMealTimeChange(current, change, hasMeals);
    await tx
      .update(mealPlans)
      .set({ mealTimes, updatedAt: new Date() })
      .where(eq(mealPlans.id, mealPlanId));
    return mealTimes;
  });
}

// ─── Entry Operations ─────────────────────────────────────────────────────

/**
 * Get entries for a meal plan within a date range
 */
export async function getMealPlanEntries(
  db: DbClient,
  params: {
    userId: string;
    mealPlanId: number;
    startDate: string;
    endDate: string;
  },
): Promise<MealPlanEntry[]> {
  const { userId, mealPlanId, startDate, endDate } = params;

  // Verify access
  const hasAccess = await canUserAccessMealPlan(db, userId, mealPlanId);
  if (!hasAccess) {
    throw new ServiceError(
      "FORBIDDEN",
      "You do not have access to this meal plan",
    );
  }

  const entries = await db
    .select({
      id: mealPlanEntries.id,
      date: mealPlanEntries.date,
      mealType: mealPlanEntries.mealType,
      recipeId: mealPlanEntries.recipeId,
      recipeName: mealPlanEntries.recipeName,
      recipeImageUrl: mealPlanEntries.recipeImageUrl,
    })
    .from(mealPlanEntries)
    .where(
      and(
        eq(mealPlanEntries.mealPlanId, mealPlanId),
        between(mealPlanEntries.date, startDate, endDate),
      ),
    );

  return entries;
}

/**
 * Add a recipe to a meal slot
 */
export async function addRecipeToMealPlan(
  db: DbClient,
  params: {
    userId: string;
    mealPlanId: number;
    recipeId: number;
    date: string;
    mealType: MealType;
  },
) {
  const { userId, mealPlanId, recipeId, date, mealType } = params;

  // Verify edit access
  const canEdit = await canUserEditMealPlan(db, userId, mealPlanId);
  if (!canEdit) {
    throw new ServiceError(
      "FORBIDDEN",
      "You do not have permission to edit this meal plan",
    );
  }

  // Verify recipe exists and belongs to user's library
  const recipe = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      ownerId: recipes.ownerId,
    })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .then((rows) => rows[0]);

  if (!recipe) {
    throw new ServiceError("NOT_FOUND", "Recipe not found");
  }

  if (recipe.ownerId !== userId) {
    throw new ServiceError(
      "FORBIDDEN",
      "You can only add recipes from your own library",
    );
  }

  // Get first image for caching
  const firstImage = await db
    .select({ url: recipeImages.url })
    .from(recipeImages)
    .where(eq(recipeImages.recipeId, recipeId))
    .orderBy(recipeImages.index)
    .limit(1)
    .then((rows) => rows[0]);

  return await db.transaction(async (tx) => {
    await assertMealTimeExists(tx, mealPlanId, mealType);

    // Delete existing entry for this slot if any (replace behavior)
    await tx
      .delete(mealPlanEntries)
      .where(
        and(
          eq(mealPlanEntries.mealPlanId, mealPlanId),
          eq(mealPlanEntries.date, date),
          eq(mealPlanEntries.mealType, mealType),
        ),
      );

    const entry = await tx
      .insert(mealPlanEntries)
      .values({
        mealPlanId,
        date,
        mealType,
        recipeId,
        recipeName: recipe.name,
        recipeImageUrl: firstImage?.url ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .then((rows) => rows[0]);

    return entry!;
  });
}

/**
 * Remove an entry from meal plan
 */
export async function removeFromMealPlan(
  db: DbClient,
  params: { userId: string; entryId: number },
): Promise<{ success: boolean }> {
  const { userId, entryId } = params;

  // Get entry and verify access
  const entry = await db
    .select({
      id: mealPlanEntries.id,
      mealPlanId: mealPlanEntries.mealPlanId,
    })
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.id, entryId))
    .then((rows) => rows[0]);

  if (!entry) {
    throw new ServiceError("NOT_FOUND", "Entry not found");
  }

  const canEdit = await canUserEditMealPlan(db, userId, entry.mealPlanId);
  if (!canEdit) {
    throw new ServiceError(
      "FORBIDDEN",
      "You do not have permission to edit this meal plan",
    );
  }

  await db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, entryId));

  return { success: true };
}

/**
 * Move an entry to a different slot
 */
export async function moveEntry(
  db: DbClient,
  params: {
    userId: string;
    entryId: number;
    newDate: string;
    newMealType: MealType;
  },
): Promise<typeof mealPlanEntries.$inferSelect> {
  const { userId, entryId, newDate, newMealType } = params;

  // Get entry and verify access
  const entry = await db
    .select()
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.id, entryId))
    .then((rows) => rows[0]);

  if (!entry) {
    throw new ServiceError("NOT_FOUND", "Entry not found");
  }

  const canEdit = await canUserEditMealPlan(db, userId, entry.mealPlanId);
  if (!canEdit) {
    throw new ServiceError(
      "FORBIDDEN",
      "You do not have permission to edit this meal plan",
    );
  }

  return await db.transaction(async (tx) => {
    await assertMealTimeExists(tx, entry.mealPlanId, newMealType);

    // Delete any existing entry at the target slot
    await tx
      .delete(mealPlanEntries)
      .where(
        and(
          eq(mealPlanEntries.mealPlanId, entry.mealPlanId),
          eq(mealPlanEntries.date, newDate),
          eq(mealPlanEntries.mealType, newMealType),
        ),
      );

    const updated = await tx
      .update(mealPlanEntries)
      .set({
        date: newDate,
        mealType: newMealType,
        updatedAt: new Date(),
      })
      .where(eq(mealPlanEntries.id, entryId))
      .returning()
      .then((rows) => rows[0]);

    return updated!;
  });
}

// ─── Sharing & Invitation Operations ─────────────────────────────────────────

const INVITATION_EXPIRY_DAYS = 7;

/**
 * Get users the current user can share with (friends only)
 */
export async function getShareableUsers(db: DbClient, userId: string) {
  // Get users with any follow relationship (either direction)
  const friendIds = await db
    .select({
      userId: follows.followingId,
    })
    .from(follows)
    .where(eq(follows.followerId, userId))
    .union(
      db
        .select({
          userId: follows.followerId,
        })
        .from(follows)
        .where(eq(follows.followingId, userId)),
    );

  const uniqueFriendIds = Array.from(new Set(friendIds.map((f) => f.userId)));

  if (uniqueFriendIds.length === 0) {
    return [];
  }

  // Get user details
  const friends = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
    })
    .from(user)
    .where(inArray(user.id, uniqueFriendIds));

  return friends;
}

/**
 * Invite a friend to a meal plan
 */
export async function inviteToMealPlan(
  db: DbClient,
  params: {
    userId: string;
    mealPlanId: number;
    invitedUserId: string;
  },
) {
  const { userId, mealPlanId, invitedUserId } = params;

  // Verify ownership
  const plan = await db
    .select({
      id: mealPlans.id,
      name: mealPlans.name,
      isDefault: mealPlans.isDefault,
    })
    .from(mealPlans)
    .where(and(eq(mealPlans.id, mealPlanId), eq(mealPlans.userId, userId)))
    .then((rows) => rows[0]);

  if (!plan) {
    throw new ServiceError(
      "NOT_FOUND",
      "Meal plan not found or you are not the owner",
    );
  }

  if (plan.isDefault) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Cannot share your default meal plan",
    );
  }

  if (invitedUserId === userId) {
    throw new ServiceError("BAD_REQUEST", "Cannot invite yourself");
  }

  // Verify target user is a friend
  const isFriend = await db
    .select({ id: follows.id })
    .from(follows)
    .where(
      or(
        and(
          eq(follows.followerId, userId),
          eq(follows.followingId, invitedUserId),
        ),
        and(
          eq(follows.followerId, invitedUserId),
          eq(follows.followingId, userId),
        ),
      ),
    )
    .then((rows) => rows[0]);

  if (!isFriend) {
    throw new ServiceError("BAD_REQUEST", "You can only invite friends");
  }

  // Check for existing invitation
  const existing = await db
    .select()
    .from(mealPlanInvitations)
    .where(
      and(
        eq(mealPlanInvitations.mealPlanId, mealPlanId),
        eq(mealPlanInvitations.invitedUserId, invitedUserId),
      ),
    )
    .then((rows) => rows[0]);

  if (existing) {
    if (existing.status === "accepted") {
      throw new ServiceError(
        "CONFLICT",
        "User already has access to this meal plan",
      );
    }
    // Existing pending — check if expired
    const expiresAt = new Date(existing.createdAt);
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);
    if (expiresAt > new Date()) {
      throw new ServiceError("CONFLICT", "An invitation is already pending");
    }
    // Expired — delete to allow re-invite
    await db
      .delete(mealPlanInvitations)
      .where(eq(mealPlanInvitations.id, existing.id));
  }

  // Get inviter info for denormalization
  const inviter = await db
    .select({ name: user.name, image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .then((rows) => rows[0]);

  const invitation = await db
    .insert(mealPlanInvitations)
    .values({
      mealPlanId,
      invitedUserId,
      invitedByUserId: userId,
      status: "pending",
      inviterName: inviter!.name,
      inviterImage: inviter!.image,
      mealPlanName: plan.name,
      createdAt: new Date(),
    })
    .returning()
    .then((rows) => rows[0]);

  return invitation!;
}

/**
 * Cancel a pending invitation (owner only)
 */
export async function cancelMealPlanInvitation(
  db: DbClient,
  params: {
    userId: string;
    mealPlanId: number;
    invitedUserId: string;
  },
): Promise<{ success: boolean }> {
  const { userId, mealPlanId, invitedUserId } = params;

  // Verify ownership
  const plan = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.id, mealPlanId), eq(mealPlans.userId, userId)))
    .then((rows) => rows[0]);

  if (!plan) {
    throw new ServiceError(
      "NOT_FOUND",
      "Meal plan not found or you are not the owner",
    );
  }

  await db
    .delete(mealPlanInvitations)
    .where(
      and(
        eq(mealPlanInvitations.mealPlanId, mealPlanId),
        eq(mealPlanInvitations.invitedUserId, invitedUserId),
        eq(mealPlanInvitations.status, "pending"),
      ),
    );

  return { success: true };
}

/**
 * Accept a meal plan invitation
 */
export async function acceptMealPlanInvitation(
  db: DbClient,
  params: { userId: string; invitationId: number },
): Promise<{ success: boolean }> {
  const { userId, invitationId } = params;

  const invitation = await db
    .select()
    .from(mealPlanInvitations)
    .where(
      and(
        eq(mealPlanInvitations.id, invitationId),
        eq(mealPlanInvitations.invitedUserId, userId),
        eq(mealPlanInvitations.status, "pending"),
      ),
    )
    .then((rows) => rows[0]);

  if (!invitation) {
    throw new ServiceError("NOT_FOUND", "Invitation not found");
  }

  // Check expiration
  const expiresAt = new Date(invitation.createdAt);
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);
  if (expiresAt <= new Date()) {
    await db
      .delete(mealPlanInvitations)
      .where(eq(mealPlanInvitations.id, invitationId));
    throw new ServiceError("BAD_REQUEST", "This invitation has expired");
  }

  await db
    .update(mealPlanInvitations)
    .set({ status: "accepted" })
    .where(eq(mealPlanInvitations.id, invitationId));

  return { success: true };
}

/**
 * Decline a meal plan invitation
 */
export async function declineMealPlanInvitation(
  db: DbClient,
  params: { userId: string; invitationId: number },
): Promise<{ success: boolean }> {
  const { userId, invitationId } = params;

  await db
    .delete(mealPlanInvitations)
    .where(
      and(
        eq(mealPlanInvitations.id, invitationId),
        eq(mealPlanInvitations.invitedUserId, userId),
        eq(mealPlanInvitations.status, "pending"),
      ),
    );

  return { success: true };
}

/**
 * Remove an accepted member from a meal plan (owner only)
 */
export async function removeMealPlanMember(
  db: DbClient,
  params: {
    userId: string;
    mealPlanId: number;
    memberId: string;
  },
): Promise<{ success: boolean }> {
  const { userId, mealPlanId, memberId } = params;

  // Verify ownership
  const plan = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.id, mealPlanId), eq(mealPlans.userId, userId)))
    .then((rows) => rows[0]);

  if (!plan) {
    throw new ServiceError(
      "NOT_FOUND",
      "Meal plan not found or you are not the owner",
    );
  }

  await db
    .delete(mealPlanInvitations)
    .where(
      and(
        eq(mealPlanInvitations.mealPlanId, mealPlanId),
        eq(mealPlanInvitations.invitedUserId, memberId),
      ),
    );

  return { success: true };
}

/**
 * Get pending invitations for a user (non-expired only)
 */
export async function getPendingMealPlanInvitations(
  db: DbClient,
  userId: string,
) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() - INVITATION_EXPIRY_DAYS);

  const invitations = await db
    .select({
      id: mealPlanInvitations.id,
      mealPlanId: mealPlanInvitations.mealPlanId,
      mealPlanName: mealPlanInvitations.mealPlanName,
      inviterName: mealPlanInvitations.inviterName,
      inviterImage: mealPlanInvitations.inviterImage,
      createdAt: mealPlanInvitations.createdAt,
    })
    .from(mealPlanInvitations)
    .where(
      and(
        eq(mealPlanInvitations.invitedUserId, userId),
        eq(mealPlanInvitations.status, "pending"),
        gt(mealPlanInvitations.createdAt, expiryDate),
      ),
    );

  return invitations;
}

/**
 * Get invitation status for a specific meal plan (for share sheet)
 */
export async function getMealPlanInvitationStatus(
  db: DbClient,
  params: { userId: string; mealPlanId: number },
) {
  const { userId, mealPlanId } = params;

  // Verify ownership
  const plan = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.id, mealPlanId), eq(mealPlans.userId, userId)))
    .then((rows) => rows[0]);

  if (!plan) {
    throw new ServiceError(
      "NOT_FOUND",
      "Meal plan not found or you are not the owner",
    );
  }

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() - INVITATION_EXPIRY_DAYS);

  // Get all non-expired pending invitations for this plan
  const pendingInvitations = await db
    .select({
      id: mealPlanInvitations.id,
      userId: mealPlanInvitations.invitedUserId,
      userName: user.name,
      userImage: user.image,
      createdAt: mealPlanInvitations.createdAt,
    })
    .from(mealPlanInvitations)
    .innerJoin(user, eq(mealPlanInvitations.invitedUserId, user.id))
    .where(
      and(
        eq(mealPlanInvitations.mealPlanId, mealPlanId),
        eq(mealPlanInvitations.status, "pending"),
        gt(mealPlanInvitations.createdAt, expiryDate),
      ),
    );

  return pendingInvitations;
}

/**
 * Get share status for a meal plan (accepted members)
 */
export async function getShareStatus(
  db: DbClient,
  params: { userId: string; mealPlanId: number },
) {
  const { userId, mealPlanId } = params;

  // Verify ownership
  const plan = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.id, mealPlanId), eq(mealPlans.userId, userId)))
    .then((rows) => rows[0]);

  if (!plan) {
    throw new ServiceError(
      "NOT_FOUND",
      "Meal plan not found or you are not the owner",
    );
  }

  // Get accepted members
  const members = await db
    .select({
      id: mealPlanInvitations.id,
      userId: mealPlanInvitations.invitedUserId,
      userName: user.name,
      userImage: user.image,
      createdAt: mealPlanInvitations.createdAt,
    })
    .from(mealPlanInvitations)
    .innerJoin(user, eq(mealPlanInvitations.invitedUserId, user.id))
    .where(
      and(
        eq(mealPlanInvitations.mealPlanId, mealPlanId),
        eq(mealPlanInvitations.status, "accepted"),
      ),
    );

  return members;
}
