import { describe, expect, it } from "vitest";

import { arrayBufferToStream, readBoundedResponseBody } from "./image-data";

describe("image response data", () => {
  it("reads a response without changing its bytes", async () => {
    const original = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    const response = new Response(original, {
      headers: { "Content-Length": String(original.byteLength) },
    });

    const result = await readBoundedResponseBody(response, 100);

    expect(new Uint8Array(result)).toEqual(original);
  });

  it("rejects a declared body that exceeds the byte limit", async () => {
    const response = new Response(Uint8Array.from([1]), {
      headers: { "Content-Length": "101" },
    });

    await expect(readBoundedResponseBody(response, 100)).rejects.toThrow(
      "Image too large: 101 bytes (max 100)",
    );
  });

  it("rejects a streamed body that exceeds the byte limit", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2, 3]));
          controller.enqueue(Uint8Array.from([4, 5, 6]));
          controller.close();
        },
      }),
    );

    await expect(readBoundedResponseBody(response, 5)).rejects.toThrow(
      "Image too large: 6 bytes (max 5)",
    );
  });

  it("creates a fresh stream over an ArrayBuffer", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);

    const result = await new Response(
      arrayBufferToStream(bytes.buffer),
    ).arrayBuffer();

    expect(new Uint8Array(result)).toEqual(bytes);
  });
});
