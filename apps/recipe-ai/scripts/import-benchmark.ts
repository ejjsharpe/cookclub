import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ImportMode = "url" | "text" | "image";

interface BenchmarkCase {
  id: string;
  type: string;
  mode: ImportMode;
  platform: string;
  input: string;
  cache: "cold" | "warm" | "none";
  expectedCoverImage: boolean;
  mockStages?: Record<string, number>;
}

interface BenchmarkResult {
  id: string;
  type: string;
  mode: ImportMode;
  platform: string;
  cache: BenchmarkCase["cache"];
  success: boolean;
  completeRecipe: boolean;
  imageRehostSuccess: boolean;
  durationMs: number;
  stageTimings: { name: string; elapsedMs: number; status: string }[];
  errorCode?: string;
}

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const useEndpoint = args.has("--real");
const sleepInMockMode = args.has("--mock-delay");
const root = dirname(fileURLToPath(import.meta.url));

function readArg(name: string): string | null {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = rawArgs.indexOf(name);
  if (index === -1) return null;

  const next = rawArgs[index + 1];
  return next && !next.startsWith("--") ? next : null;
}

const corpusPath = readArg("--corpus")
  ? resolve(process.cwd(), readArg("--corpus")!)
  : resolve(root, "../benchmarks/import-corpus.json");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as BenchmarkCase[];

function benchmarkEndpoint(): string {
  const endpoint =
    readArg("--endpoint") ?? process.env.RECIPE_AI_BENCHMARK_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      "Set RECIPE_AI_BENCHMARK_ENDPOINT to a full parse endpoint URL, or pass --endpoint https://example.com/parse when running with --real.",
    );
  }

  try {
    return new URL(endpoint).toString();
  } catch {
    throw new Error(
      `Invalid benchmark endpoint URL: ${JSON.stringify(endpoint)}. Use a full URL such as http://127.0.0.1:8787/parse.`,
    );
  }
}

function percentile(values: number[], percent: number): number {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[index] ?? 0);
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function sumStageTimings(stages: { elapsedMs: number }[]): number {
  return stages.reduce((sum, stage) => sum + stage.elapsedMs, 0);
}

function hasCompleteRecipe(response: any): boolean {
  if (!response?.success) return false;

  const ingredientCount =
    response.data?.ingredientSections?.reduce(
      (sum: number, section: any) => sum + (section.ingredients?.length ?? 0),
      0,
    ) ?? 0;

  return ingredientCount > 0;
}

async function runMockCase(item: BenchmarkCase): Promise<BenchmarkResult> {
  if (!item.mockStages) {
    throw new Error(
      `${item.id} does not define mockStages. Run with --real or use a mocked corpus.`,
    );
  }

  const stageTimings = Object.entries(item.mockStages).map(
    ([name, elapsedMs]) => ({
      name,
      elapsedMs,
      status: elapsedMs === 0 ? "skipped" : "success",
    }),
  );

  if (sleepInMockMode) {
    for (const stage of stageTimings) {
      if (stage.elapsedMs > 0) await sleep(stage.elapsedMs);
    }
  }

  return {
    id: item.id,
    type: item.type,
    mode: item.mode,
    platform: item.platform,
    cache: item.cache,
    success: true,
    completeRecipe: true,
    imageRehostSuccess:
      !item.expectedCoverImage ||
      stageTimings.some(
        (stage) =>
          stage.name === "image_rehosting" && stage.status === "success",
      ),
    durationMs: sumStageTimings(stageTimings),
    stageTimings,
  };
}

async function runEndpointCase(item: BenchmarkCase): Promise<BenchmarkResult> {
  const endpoint = benchmarkEndpoint();

  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: item.mode, data: item.input }),
  });
  const payload = (await response.json()) as any;
  const diagnostics = payload.success
    ? payload.metadata?.diagnostics
    : payload.metadata?.diagnostics;
  const stageTimings = diagnostics?.stageTimings ?? [];

  return {
    id: item.id,
    type: item.type,
    mode: item.mode,
    platform: item.platform,
    cache: item.cache,
    success: Boolean(payload.success),
    completeRecipe: hasCompleteRecipe(payload),
    imageRehostSuccess:
      !item.expectedCoverImage || Boolean(payload.data?.images?.length),
    durationMs: Math.round(
      diagnostics?.totalElapsedMs ?? Date.now() - startedAt,
    ),
    stageTimings,
    errorCode: payload.success ? undefined : payload.error?.code,
  };
}

function groupKey(result: BenchmarkResult): string {
  return `${result.type}:${result.platform}:${result.cache}`;
}

function summarize(results: BenchmarkResult[]) {
  const groups = new Map<string, BenchmarkResult[]>();
  for (const result of results) {
    const key = groupKey(result);
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const durations = items.map((item) => item.durationMs);
    const stageTotals = new Map<string, number>();

    for (const item of items) {
      for (const stage of item.stageTimings) {
        stageTotals.set(
          stage.name,
          (stageTotals.get(stage.name) ?? 0) + stage.elapsedMs,
        );
      }
    }

    return {
      key,
      count: items.length,
      successRate:
        items.filter((item) => item.success).length / Math.max(1, items.length),
      completeRecipeRate:
        items.filter((item) => item.completeRecipe).length /
        Math.max(1, items.length),
      imageRehostSuccessRate:
        items.filter((item) => item.imageRehostSuccess).length /
        Math.max(1, items.length),
      p50Ms: percentile(durations, 50),
      p75Ms: percentile(durations, 75),
      p95Ms: percentile(durations, 95),
      expensiveStages: Array.from(stageTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, elapsedMs]) => ({ name, elapsedMs })),
    };
  });
}

const results = [];
for (const item of corpus) {
  results.push(
    useEndpoint ? await runEndpointCase(item) : await runMockCase(item),
  );
}

console.log(
  JSON.stringify(
    {
      mode: useEndpoint ? "real" : "mock",
      generatedAt: new Date().toISOString(),
      corpusSize: corpus.length,
      summary: summarize(results),
      results,
    },
    null,
    2,
  ),
);
