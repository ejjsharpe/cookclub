import {
  providerResponseError,
  readBoundedBody,
  readBoundedJson,
} from "./provider-response";

const REPLICATE_IMAGE_GENERATION_URL =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-2-klein-4b/predictions";
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 500;
const GENERATION_TIMEOUT_MS = 90_000;

interface ImageGenerationOptions {
  apiToken: string;
  prompt: string;
  seed: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trustedReplicateUrl(
  value: unknown,
  purpose: "api" | "delivery",
): string {
  if (typeof value !== "string") {
    throw new Error(`Replicate returned an invalid ${purpose} URL.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Replicate returned an invalid ${purpose} URL.`);
  }

  const trustedHost =
    purpose === "api"
      ? url.hostname === "api.replicate.com"
      : url.hostname === "replicate.delivery" ||
        url.hostname.endsWith(".replicate.delivery");
  if (url.protocol !== "https:" || !trustedHost) {
    throw new Error(`Replicate returned an untrusted ${purpose} URL.`);
  }
  return url.toString();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function failureDetail(payload: Record<string, unknown>): string | null {
  if (typeof payload.error === "string") return payload.error;
  const error = asRecord(payload.error);
  if (typeof error?.message === "string") return error.message;
  return null;
}

function predictionImageUrl(payload: Record<string, unknown>): string | null {
  const status = payload.status;
  if (status === "failed" || status === "canceled" || status === "aborted") {
    const detail = failureDetail(payload);
    throw new Error(
      ["Replicate image generation failed", detail].filter(Boolean).join(": "),
    );
  }
  if (
    status !== "starting" &&
    status !== "processing" &&
    status !== "succeeded"
  ) {
    throw new Error("Replicate returned an unknown generation status.");
  }

  if (Array.isArray(payload.output) && payload.output.length > 0) {
    return trustedReplicateUrl(payload.output[0], "delivery");
  }
  if (status === "succeeded") {
    throw new Error("Replicate completed without returning an image.");
  }
  return null;
}

async function readPrediction(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok) throw await providerResponseError(response, "Replicate");
  const payload = asRecord(
    await readBoundedJson(response, MAX_JSON_BYTES, "Replicate"),
  );
  if (!payload)
    throw new Error("Replicate returned an invalid prediction response.");
  return payload;
}

async function pollForImageUrl(
  apiToken: string,
  pollingUrl: string,
): Promise<string> {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await wait(POLL_INTERVAL_MS);
    const response = await fetch(pollingUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await readPrediction(response);
    const imageUrl = predictionImageUrl(payload);
    if (imageUrl) return imageUrl;
  }

  throw new Error("Replicate image generation timed out.");
}

async function downloadImage(
  apiToken: string,
  imageUrl: string,
): Promise<ArrayBuffer> {
  const response = await fetch(imageUrl, {
    headers: {
      Accept: "image/jpeg",
      Authorization: `Bearer ${apiToken}`,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw await providerResponseError(response, "Replicate image download");
  }
  if (response.headers.get("content-type")?.split(";", 1)[0] !== "image/jpeg") {
    throw new Error("Replicate returned an unexpected image format.");
  }

  return readBoundedBody(
    response,
    MAX_GENERATED_IMAGE_BYTES,
    "Replicate image",
  );
}

export async function generateReplicateImage({
  apiToken,
  prompt,
  seed,
}: ImageGenerationOptions): Promise<ArrayBuffer> {
  if (!apiToken) {
    throw new Error(
      "REPLICATE_API_TOKEN is required for Replicate image generation.",
    );
  }

  const response = await fetch(REPLICATE_IMAGE_GENERATION_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      input: {
        prompt,
        seed,
        aspect_ratio: "1:1",
        output_megapixels: "1",
        go_fast: true,
        output_format: "jpg",
        output_quality: 95,
      },
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(65_000),
  });
  const payload = await readPrediction(response);
  let imageUrl = predictionImageUrl(payload);

  if (!imageUrl) {
    const pollingUrl = trustedReplicateUrl(asRecord(payload.urls)?.get, "api");
    imageUrl = await pollForImageUrl(apiToken, pollingUrl);
  }

  return downloadImage(apiToken, imageUrl);
}
