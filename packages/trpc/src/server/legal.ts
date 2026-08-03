import { CURRENT_TERMS_VERSION } from "@repo/contracts";
import { legalAcceptances } from "@repo/db/schemas";
import { and, eq } from "drizzle-orm";

import type { Context } from "./context";
import { PublicTRPCError } from "./public-errors";

export async function hasAcceptedCurrentTerms(
  db: Context["db"],
  userId: string,
): Promise<boolean> {
  const [acceptance] = await db
    .select({ id: legalAcceptances.id })
    .from(legalAcceptances)
    .where(
      and(
        eq(legalAcceptances.userId, userId),
        eq(legalAcceptances.termsVersion, CURRENT_TERMS_VERSION),
      ),
    )
    .limit(1);

  return Boolean(acceptance);
}

export async function requireCurrentTerms(
  db: Context["db"],
  userId: string,
): Promise<void> {
  if (await hasAcceptedCurrentTerms(db, userId)) return;
  throw new PublicTRPCError({
    code: "FORBIDDEN",
    appCode: "TERMS_ACCEPTANCE_REQUIRED",
  });
}
