import { describe, expect, it } from "vitest";

import {
  buildCfImageOptions,
  getTransformPreset,
  hasTransformPreset,
  hasUnsupportedTransformParams,
  parseTransformPreset,
} from "./transform";

describe("image transform presets", () => {
  it("does not upscale feed images and uses gentler delivery quality", () => {
    expect(getTransformPreset("feed_720")).toMatchObject({
      fit: "crop",
      quality: 85,
    });
    expect(getTransformPreset("feed_960")).toMatchObject({
      fit: "crop",
      quality: 86,
    });
    expect(getTransformPreset("feed_1080")).toMatchObject({
      fit: "crop",
      quality: 88,
    });
  });

  it("accepts only named presets", () => {
    const params = new URLSearchParams("preset=feed_720&v=123");

    expect(hasTransformPreset(params)).toBe(true);
    expect(hasUnsupportedTransformParams(params)).toBe(false);
    expect(parseTransformPreset(params)).toBe("feed_720");
  });

  it("rejects unsupported presets and query parameters", () => {
    expect(parseTransformPreset(new URLSearchParams("preset=freeform"))).toBe(
      null,
    );
    expect(
      hasUnsupportedTransformParams(
        new URLSearchParams("preset=feed_720&w=720"),
      ),
    ).toBe(true);
  });

  it("builds strict Cloudflare options for cropped feed images", () => {
    const options = buildCfImageOptions(
      {
        width: 960,
        height: 720,
        fit: "crop",
        quality: 78,
        sharpen: 1,
        format: "auto",
        metadata: "none",
        anim: false,
      },
      "image/webp,image/*,*/*",
    );

    expect(options).toEqual({
      width: 960,
      height: 720,
      fit: "crop",
      quality: 78,
      sharpen: 1,
      format: "webp",
      metadata: "none",
      anim: false,
    });
  });

  it("prefers avif, falls back to webp, and omits explicit format otherwise", () => {
    const baseOptions = {
      width: 1600,
      fit: "scale-down",
      quality: 82,
      format: "auto",
      metadata: "none",
      anim: false,
    } as const;

    expect(
      buildCfImageOptions(baseOptions, "image/avif,image/webp,image/*,*/*")
        .format,
    ).toBe("avif");
    expect(
      buildCfImageOptions(baseOptions, "image/webp,image/*,*/*").format,
    ).toBe("webp");
    expect(
      buildCfImageOptions(baseOptions, "image/jpeg,image/*,*/*").format,
    ).toBeUndefined();
  });
});
