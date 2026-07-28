import type { RecipeImportStrategy } from "@repo/contracts/recipe-import";

import { cacheRecipe } from "./cache";
import type { ParsedRecipe } from "../../schema";
import { ParsedRecipeSchema } from "../../schema";
import {
  parseRecipeFromHtml,
  type AiExtractionProfile,
} from "../../services/ai-client";
import { aiResultToRecipe } from "../../services/recipe-mapper";
import type { Env, ParseMetadata, ParseResult } from "../../types";
import type { AiClient } from "../../utils/ai-response-parser";
import {
  evaluateRecipeQuality,
  normalizeRecipeForImport,
  type RecipeQuality,
  type RecipeQualitySource,
} from "../../utils/recipe-quality";

export type UrlParseMethod = NonNullable<ParseMetadata["parseMethod"]>;

interface CandidateOptions {
  parseMethod?: UrlParseMethod;
  cache?: boolean;
  metadataSource?: ParseMetadata["source"];
  canonicalUrl?: string;
  diagnostics?: ParseMetadata["diagnostics"];
  strategy?: RecipeImportStrategy;
}

interface AiCandidateOptions {
  cache?: boolean;
  aiClient: AiClient;
  extractionProfile?: AiExtractionProfile;
}

export interface RecipeCandidate {
  id?: string;
  recipe: ParsedRecipe | null;
  source: RecipeQualitySource;
  parseMethod?: UrlParseMethod;
  cache?: boolean;
  elapsedMs?: number;
  evidence?: {
    imageCount?: number;
    textLength?: number;
    sourceUrl?: string;
  };
  error?: unknown;
}

export interface EvaluatedRecipeCandidate {
  id: string;
  recipe: ParsedRecipe;
  quality: RecipeQuality;
  source: RecipeQualitySource;
  parseMethod?: UrlParseMethod;
  cache?: boolean;
  elapsedMs?: number;
  evidence?: RecipeCandidate["evidence"];
}

export interface RejectedRecipeCandidate {
  id: string;
  source: RecipeQualitySource;
  parseMethod?: UrlParseMethod;
  reasons: string[];
  score?: number;
  confidence?: RecipeQuality["confidence"];
  ingredientCount?: number;
  instructionCount?: number;
  elapsedMs?: number;
  evidence?: RecipeCandidate["evidence"];
}

export interface AiRecipeAttempt {
  result: ParseResult | null;
  error: unknown;
  elapsedMs?: number;
}

function candidateParseMethod(
  source: RecipeQualitySource,
): UrlParseMethod | undefined {
  if (source === "ai" || source === "social_ai") return "ai_only";
  if (source === "structured") return "schema_org";
  if (source === "visible") return "visible_card";
  if (source === "reader") return "reader";
  return undefined;
}

function candidateId(candidate: RecipeCandidate, index: number): string {
  return (
    candidate.id ??
    `${candidate.parseMethod ?? candidateParseMethod(candidate.source) ?? candidate.source}-${index + 1}`
  );
}

function evaluateRecipeCandidate(
  candidate: RecipeCandidate,
  index = 0,
): EvaluatedRecipeCandidate | RejectedRecipeCandidate {
  const id = candidateId(candidate, index);
  const parseMethod =
    candidate.parseMethod ?? candidateParseMethod(candidate.source);

  if (candidate.error) {
    return {
      id,
      source: candidate.source,
      parseMethod,
      reasons: [
        candidate.error instanceof Error
          ? candidate.error.message
          : "candidate_error",
      ],
      elapsedMs: candidate.elapsedMs,
      evidence: candidate.evidence,
    };
  }

  if (!candidate.recipe) {
    return {
      id,
      source: candidate.source,
      parseMethod,
      reasons: ["no_recipe"],
      elapsedMs: candidate.elapsedMs,
      evidence: candidate.evidence,
    };
  }

  const recipe = candidate.recipe;
  const normalizedRecipe = normalizeRecipeForImport(recipe);
  const validation = ParsedRecipeSchema(normalizedRecipe);
  if (validation instanceof Error) {
    return {
      id,
      source: candidate.source,
      parseMethod,
      reasons: ["schema_validation_failed"],
      elapsedMs: candidate.elapsedMs,
      evidence: candidate.evidence,
    };
  }

  const quality = evaluateRecipeQuality(normalizedRecipe, candidate.source);
  if (!quality.usable) {
    console.log("Recipe candidate rejected:", {
      source: candidate.source,
      score: quality.score,
      reasons: quality.reasons,
      ingredientCount: quality.ingredientCount,
      instructionCount: quality.instructionCount,
    });
    return {
      id,
      source: candidate.source,
      parseMethod,
      reasons: quality.reasons.length ? quality.reasons : ["low_quality"],
      score: quality.score,
      confidence: quality.confidence,
      ingredientCount: quality.ingredientCount,
      instructionCount: quality.instructionCount,
      elapsedMs: candidate.elapsedMs,
      evidence: candidate.evidence,
    };
  }

  return {
    id,
    recipe: normalizedRecipe,
    quality,
    source: candidate.source,
    parseMethod,
    cache: candidate.cache,
    elapsedMs: candidate.elapsedMs,
    evidence: candidate.evidence,
  };
}

function isAcceptedCandidate(
  candidate: EvaluatedRecipeCandidate | RejectedRecipeCandidate,
): candidate is EvaluatedRecipeCandidate {
  return "recipe" in candidate;
}

function attemptDiagnostics(
  candidates: (EvaluatedRecipeCandidate | RejectedRecipeCandidate)[],
): NonNullable<ParseMetadata["diagnostics"]>["attempts"] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    method:
      candidate.parseMethod ??
      candidateParseMethod(candidate.source) ??
      candidate.source,
    source: candidate.source,
    status: isAcceptedCandidate(candidate)
      ? ("accepted" as const)
      : ("rejected" as const),
    score: isAcceptedCandidate(candidate)
      ? candidate.quality.score
      : candidate.score,
    confidence: isAcceptedCandidate(candidate)
      ? candidate.quality.confidence
      : candidate.confidence,
    reasons: isAcceptedCandidate(candidate)
      ? candidate.quality.reasons
      : candidate.reasons,
    ingredientCount: isAcceptedCandidate(candidate)
      ? candidate.quality.ingredientCount
      : candidate.ingredientCount,
    instructionCount: isAcceptedCandidate(candidate)
      ? candidate.quality.instructionCount
      : candidate.instructionCount,
    elapsedMs: candidate.elapsedMs,
    evidence: candidate.evidence,
  }));
}

export function evaluateRecipeCandidates(candidates: RecipeCandidate[]) {
  const evaluated = candidates.map((candidate, index) =>
    evaluateRecipeCandidate(candidate, index),
  );
  const accepted = evaluated
    .filter(isAcceptedCandidate)
    .sort((a, b) => b.quality.score - a.quality.score);
  const rejected = evaluated.filter(
    (candidate): candidate is RejectedRecipeCandidate =>
      !isAcceptedCandidate(candidate),
  );

  return {
    accepted,
    rejected,
    diagnostics: attemptDiagnostics(evaluated),
  };
}

async function resultFromEvaluatedCandidate(
  env: Env,
  cacheUrl: string,
  candidate: EvaluatedRecipeCandidate,
  options: CandidateOptions = {},
): Promise<ParseResult> {
  const diagnostics = options.diagnostics;
  const recipe = candidate.recipe;
  const shouldCache = options.cache ?? candidate.cache ?? true;

  if (shouldCache) {
    try {
      const strategy =
        options.strategy ??
        (candidate.source === "ai" || candidate.source === "social_ai"
          ? "ai-assisted"
          : "deterministic");
      await cacheRecipe(env.RECIPE_CACHE, cacheUrl, recipe, {
        parseMethod:
          candidate.parseMethod ??
          candidateParseMethod(candidate.source) ??
          "schema_org",
        strategy,
      });
    } catch (error) {
      console.log(
        "Recipe cache write failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const metadata: ParseMetadata = {
    source: options.metadataSource ?? "url",
    confidence: candidate.quality.confidence,
    cached: false,
    strategy:
      options.strategy ??
      (candidate.source === "ai" || candidate.source === "social_ai"
        ? "ai-assisted"
        : "deterministic"),
    provenance:
      candidate.source === "ai" || candidate.source === "social_ai"
        ? "ai-assisted"
        : "deterministic",
  };
  if (candidate.parseMethod) {
    metadata.parseMethod = candidate.parseMethod;
  }
  if (options.canonicalUrl) {
    metadata.canonicalUrl = options.canonicalUrl;
  }
  if (options.diagnostics) {
    metadata.diagnostics = {
      ...diagnostics,
      selectedAttempt: candidate.id,
      qualityScore: candidate.quality.score,
    };
  }

  return {
    success: true,
    data: recipe,
    metadata,
  };
}

export async function acceptedCandidate(
  env: Env,
  cacheUrl: string,
  recipe: ParsedRecipe | null,
  source: RecipeQualitySource,
  options: CandidateOptions = {},
): Promise<ParseResult | null> {
  return selectBestRecipeCandidate(
    env,
    cacheUrl,
    [
      {
        recipe,
        source,
        parseMethod: options.parseMethod,
        cache: options.cache,
      },
    ],
    options,
  );
}

export async function selectBestRecipeCandidate(
  env: Env,
  cacheUrl: string,
  candidates: RecipeCandidate[],
  options: CandidateOptions = {},
): Promise<ParseResult | null> {
  const evaluatedCandidates = evaluateRecipeCandidates(candidates);
  const bestCandidate = evaluatedCandidates.accepted[0];
  const diagnostics = options.diagnostics
    ? {
        ...options.diagnostics,
        attempts: [
          ...(options.diagnostics.attempts ?? []),
          ...(evaluatedCandidates.diagnostics ?? []),
        ].slice(-12),
      }
    : undefined;

  return bestCandidate
    ? resultFromEvaluatedCandidate(env, cacheUrl, bestCandidate, {
        ...options,
        diagnostics,
      })
    : null;
}

export async function tryAiRecipeCandidate(
  env: Env,
  url: string,
  content: string | null,
  images: string[],
  source: RecipeQualitySource,
  parseMethod: UrlParseMethod,
  logPrefix: string,
  options: AiCandidateOptions,
): Promise<AiRecipeAttempt> {
  if (!content || content.trim().length < 50) {
    return { result: null, error: null };
  }

  const startTime = Date.now();
  try {
    const aiResult = await parseRecipeFromHtml(
      options.aiClient,
      content,
      options.extractionProfile,
    );
    const recipe = aiResultToRecipe(aiResult, {
      sourceType: "url",
      sourceUrl: url,
      images,
    });

    return {
      result: await acceptedCandidate(env, url, recipe, source, {
        parseMethod,
        cache: options.cache,
      }),
      error: null,
      elapsedMs: Date.now() - startTime,
    };
  } catch (error) {
    console.log(
      `${logPrefix} AI parsing failed:`,
      error instanceof Error ? error.message : error,
    );
    return { result: null, error, elapsedMs: Date.now() - startTime };
  }
}
