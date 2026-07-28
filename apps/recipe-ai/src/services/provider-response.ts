const MAX_ERROR_BYTES = 16 * 1024;

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly timedOut: boolean;

  constructor(
    message: string,
    options: {
      provider: string;
      status?: number;
      retryAfterSeconds?: number;
      requestId?: string;
      retryable: boolean;
      timedOut?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderRequestError";
    this.provider = options.provider;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.requestId = options.requestId;
    this.retryable = options.retryable;
    this.timedOut = options.timedOut ?? false;
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1_000));
}

function requestId(response: Response): string | undefined {
  return (
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    undefined
  );
}

export function providerTransportError(
  error: unknown,
  providerName: string,
): ProviderRequestError {
  if (error instanceof ProviderRequestError) return error;
  const timedOut =
    error instanceof Error &&
    (error.name === "AbortError" || /timed? ?out|timeout/i.test(error.message));
  return new ProviderRequestError(
    timedOut
      ? `${providerName} request timed out.`
      : `${providerName} network request failed.`,
    {
      provider: providerName,
      retryable: true,
      timedOut,
      cause: error,
    },
  );
}

export function providerFailureFields(error: unknown): {
  disposition: "terminal" | "retry";
  retryAfterSeconds?: number;
} {
  if (error instanceof ProviderRequestError && !error.retryable) {
    return { disposition: "terminal" };
  }
  return {
    disposition: "retry",
    ...(error instanceof ProviderRequestError &&
    error.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: error.retryAfterSeconds }
      : {}),
  };
}

export async function readBoundedBody(
  response: Response,
  maxBytes: number,
  providerName: string,
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`${providerName} response exceeded ${maxBytes} bytes.`);
  }
  if (!response.body) {
    throw new Error(`${providerName} returned an empty response body.`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new Error(`${providerName} response exceeded ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

export async function readBoundedText(
  response: Response,
  maxBytes: number,
  providerName: string,
): Promise<string> {
  return new TextDecoder().decode(
    await readBoundedBody(response, maxBytes, providerName),
  );
}

export async function readBoundedJson(
  response: Response,
  maxBytes: number,
  providerName: string,
): Promise<unknown> {
  const text = await readBoundedText(response, maxBytes, providerName);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${providerName} returned an invalid JSON response.`);
  }
}

function errorDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (typeof record.message === "string") return record.message;
  if (record.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === "string") return error.message;
  }
  if (Array.isArray(record.detail)) {
    const first = record.detail[0];
    if (first && typeof first === "object") {
      const message = (first as Record<string, unknown>).msg;
      if (typeof message === "string") return message;
    }
  }
  if (typeof record.detail === "string") return record.detail;
  return null;
}

export async function providerResponseError(
  response: Response,
  providerName: string,
): Promise<ProviderRequestError> {
  let detail: string | null = null;
  try {
    const text = await readBoundedText(response, MAX_ERROR_BYTES, providerName);
    try {
      detail = errorDetail(JSON.parse(text)) ?? (text.trim() || null);
    } catch {
      detail = text.trim() || null;
    }
  } catch {
    // Status and request ID still provide bounded diagnostics.
  }

  const id = requestId(response);
  return new ProviderRequestError(
    [
      `${providerName} request failed with status ${response.status}`,
      detail,
      id ? `request ${id}` : null,
    ]
      .filter(Boolean)
      .join(": "),
    {
      provider: providerName,
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response),
      requestId: id,
      retryable: response.status === 429 || response.status >= 500,
    },
  );
}
