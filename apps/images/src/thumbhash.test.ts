import { encode as encodeJpeg } from "jpeg-js";
import { describe, expect, it } from "vitest";

import { createThumbhashFromJpegBytes } from "./thumbhash";

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

describe("thumbhash generation", () => {
  it("encodes a small JPEG into raw base64 thumbhash bytes", () => {
    const rgba = Uint8Array.from([
      255, 80, 40, 255, 60, 160, 90, 255, 80, 120, 255, 255, 245, 220, 120, 255,
    ]);
    const jpeg = encodeJpeg({ width: 2, height: 2, data: rgba }, 90);

    const thumbhash = createThumbhashFromJpegBytes(jpeg.data);

    expect(thumbhash).not.toContain("data:");
    expect(base64ToBytes(thumbhash).byteLength).toBeGreaterThan(0);
  });
});
