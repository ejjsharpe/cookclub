import { CURRENT_TERMS_VERSION, LEGAL_URLS } from "@repo/contracts";
import { legalAcceptances } from "@repo/db/schemas";
import { type } from "arktype";
import { and, eq } from "drizzle-orm";

import { hasAcceptedCurrentTerms } from "../legal";
import { PublicTRPCError } from "../public-errors";
import { authedProcedure, router } from "../trpc";

export const legalRouter = router({
  getStatus: authedProcedure.query(async ({ ctx }) => ({
    currentTermsVersion: CURRENT_TERMS_VERSION,
    hasAcceptedCurrentTerms: await hasAcceptedCurrentTerms(ctx.db, ctx.user.id),
    urls: LEGAL_URLS,
  })),

  acceptTerms: authedProcedure
    .input(type({ termsVersion: "string" }))
    .mutation(async ({ ctx, input }) => {
      if (input.termsVersion !== CURRENT_TERMS_VERSION) {
        throw new PublicTRPCError({
          code: "CONFLICT",
          appCode: "TERMS_ACCEPTANCE_REQUIRED",
        });
      }

      await ctx.db
        .insert(legalAcceptances)
        .values({
          userId: ctx.user.id,
          termsVersion: CURRENT_TERMS_VERSION,
          acceptedAt: new Date(),
          ipAddress:
            ctx.req.headers.get("cf-connecting-ip") ??
            ctx.req.headers.get("x-forwarded-for"),
          userAgent: ctx.req.headers.get("user-agent"),
        })
        .onConflictDoNothing({
          target: [legalAcceptances.userId, legalAcceptances.termsVersion],
        });

      const [acceptance] = await ctx.db
        .select({ acceptedAt: legalAcceptances.acceptedAt })
        .from(legalAcceptances)
        .where(
          and(
            eq(legalAcceptances.userId, ctx.user.id),
            eq(legalAcceptances.termsVersion, CURRENT_TERMS_VERSION),
          ),
        )
        .limit(1);

      return {
        currentTermsVersion: CURRENT_TERMS_VERSION,
        hasAcceptedCurrentTerms: true,
        acceptedAt: acceptance?.acceptedAt ?? new Date(),
      };
    }),
});
