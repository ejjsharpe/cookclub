import type { ParseDiagnostics, ParseMetadata, ParseResult } from "../types";

export type ParseSource = ParseMetadata["source"];

const MAX_STAGE_TIMINGS = 32;

export function elapsedMs(startTime: number): number {
  return Math.max(0, Date.now() - startTime);
}

export function appendDiagnosticsStage(
  diagnostics: ParseDiagnostics | undefined,
  stage: NonNullable<ParseDiagnostics["stageTimings"]>[number],
): ParseDiagnostics {
  return {
    ...(diagnostics ?? {}),
    stageTimings: [...(diagnostics?.stageTimings ?? []), stage].slice(
      -MAX_STAGE_TIMINGS,
    ),
  };
}

export function recordDiagnosticsStage(
  diagnostics: ParseDiagnostics | undefined,
  name: string,
  startTime: number,
  status: NonNullable<
    ParseDiagnostics["stageTimings"]
  >[number]["status"] = "success",
  detail?: string,
): ParseDiagnostics {
  return appendDiagnosticsStage(diagnostics, {
    name,
    status,
    elapsedMs: elapsedMs(startTime),
    ...(detail ? { detail } : {}),
  });
}

export function appendFallbackPath(
  diagnostics: ParseDiagnostics | undefined,
  path: string,
): ParseDiagnostics {
  const fallbackPath = diagnostics?.fallbackPath ?? [];
  return {
    ...(diagnostics ?? {}),
    fallbackPath: fallbackPath.includes(path)
      ? fallbackPath
      : [...fallbackPath, path],
  };
}

export function metadataFromResult(
  result: ParseResult,
  source: ParseSource,
): ParseMetadata {
  return result.success
    ? result.metadata
    : (result.metadata ?? { source, confidence: "low" });
}

export function withDiagnostics(
  result: ParseResult,
  source: ParseSource,
  diagnostics: ParseDiagnostics,
): ParseResult {
  if (result.success) {
    return {
      ...result,
      metadata: {
        ...result.metadata,
        diagnostics,
      },
    };
  }

  return {
    ...result,
    metadata: {
      ...(result.metadata ?? { source, confidence: "low" }),
      diagnostics,
    },
  };
}

export function mergeResultDiagnostics(
  result: ParseResult,
  source: ParseSource,
  update: (
    diagnostics: ParseDiagnostics | undefined,
    metadata: ParseMetadata,
  ) => ParseDiagnostics,
): ParseResult {
  const metadata = metadataFromResult(result, source);
  return withDiagnostics(
    result,
    source,
    update(metadata.diagnostics, metadata),
  );
}

export function finalizeParseDiagnostics(
  result: ParseResult,
  source: ParseSource,
  startTime: number,
): ParseResult {
  return mergeResultDiagnostics(result, source, (diagnostics, metadata) => ({
    ...(diagnostics ?? {}),
    totalElapsedMs: elapsedMs(startTime),
    platform: diagnostics?.platform,
    selectedAttempt: diagnostics?.selectedAttempt,
    qualityScore: diagnostics?.qualityScore,
    fallbackPath: diagnostics?.fallbackPath,
    attempts: diagnostics?.attempts,
    canonicalUrl: diagnostics?.canonicalUrl ?? metadata.canonicalUrl,
    originalUrl: diagnostics?.originalUrl,
    stageTimings: diagnostics?.stageTimings,
  }));
}
