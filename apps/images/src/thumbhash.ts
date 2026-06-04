import { decode as decodeJpeg } from "jpeg-js";
import { rgbaToThumbHash } from "thumbhash";

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function bytesToBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = toUint8Array(data);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

export function createThumbhashFromJpegBytes(
  data: ArrayBuffer | Uint8Array,
): string {
  const {
    width,
    height,
    data: rgba,
  } = decodeJpeg(toUint8Array(data), {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: true,
    maxResolutionInMP: 1,
    maxMemoryUsageInMB: 16,
  });

  return bytesToBase64(rgbaToThumbHash(width, height, rgba));
}
