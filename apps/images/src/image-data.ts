export function arrayBufferToStream(
  data: ArrayBuffer,
): ReadableStream<Uint8Array> {
  return new Blob([data]).stream();
}

export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error(
      `Image too large: ${contentLength} bytes (max ${maxBytes})`,
    );
  }

  if (!response.body) {
    throw new Error("Image response body is empty");
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
        throw new Error(
          `Image too large: ${byteLength} bytes (max ${maxBytes})`,
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return data.buffer;
}
