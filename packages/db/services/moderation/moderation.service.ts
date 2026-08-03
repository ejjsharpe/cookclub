import { and, eq, or } from "drizzle-orm";

import { userBlocks } from "../../schemas";
import type { DbClient, TransactionClient } from "../types";

type QueryClient = DbClient | TransactionClient;

export async function areUsersBlocked(
  db: QueryClient,
  firstUserId: string,
  secondUserId: string,
): Promise<boolean> {
  if (firstUserId === secondUserId) return false;

  const [block] = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(
      or(
        and(
          eq(userBlocks.blockerUserId, firstUserId),
          eq(userBlocks.blockedUserId, secondUserId),
        ),
        and(
          eq(userBlocks.blockerUserId, secondUserId),
          eq(userBlocks.blockedUserId, firstUserId),
        ),
      ),
    )
    .limit(1);

  return Boolean(block);
}

export async function getBlockedUserIds(
  db: QueryClient,
  userId: string,
): Promise<string[]> {
  const blocks = await db
    .select({
      blockerUserId: userBlocks.blockerUserId,
      blockedUserId: userBlocks.blockedUserId,
    })
    .from(userBlocks)
    .where(
      or(
        eq(userBlocks.blockerUserId, userId),
        eq(userBlocks.blockedUserId, userId),
      ),
    );

  return blocks.map((block) =>
    block.blockerUserId === userId ? block.blockedUserId : block.blockerUserId,
  );
}
