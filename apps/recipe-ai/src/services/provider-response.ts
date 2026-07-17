const MAX_ERROR_BYTES = 16 * 1024;

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
): Promise<Error> {
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

  const requestId =
    response.headers.get("x-request-id") ?? response.headers.get("request-id");
  return new Error(
    [
      `${providerName} request failed with status ${response.status}`,
      detail,
      requestId ? `request ${requestId}` : null,
    ]
      .filter(Boolean)
      .join(": "),
  );
}
