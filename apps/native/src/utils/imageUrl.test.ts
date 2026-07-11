import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendImageVersion,
  getImageAcceptHeader,
  getImageUrl,
  selectAvatarImagePreset,
  selectDetailImagePreset,
  selectFeedImagePreset,
  type ImageSourceAsset,
} from "./imageUrl";

import { getImagePublicUrl } from "@/lib/runtimeConfig";

vi.mock("react-native", () => ({
  PixelRatio: {
    get: vi.fn(() => 2),
  },
}));

vi.mock("@/lib/runtimeConfig", () => ({
  getImagePublicUrl: vi.fn(() => "https://images.cookclub.app"),
}));

describe("image URL transforms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getImagePublicUrl).mockReturnValue("https://images.cookclub.app");
  });

  it("adds named presets only for the configured image service host", () => {
    expect(
      getImageUrl("https://images.cookclub.app/recipes/a.jpg", "feed_720"),
    ).toBe("https://images.cookclub.app/recipes/a.jpg?preset=feed_720");
    expect(
      getImageUrl("https://cdn.example.com/recipes/a.jpg", "feed_720"),
    ).toBeUndefined();
    expect(
      getImageUrl(
        "https://images.cookclub.app.evil.test/recipes/a.jpg",
        "feed_720",
      ),
    ).toBeUndefined();
  });

  it("supports localhost image Worker URLs", () => {
    vi.mocked(getImagePublicUrl).mockReturnValue("http://localhost:8789");

    expect(getImageUrl("http://localhost:8789/temp/a.jpg", "thumb_200")).toBe(
      "http://localhost:8789/temp/a.jpg?preset=thumb_200",
    );
    expect(getImageUrl("http://localhost:8790/temp/a.jpg", "thumb_200")).toBe(
      undefined,
    );
  });

  it("preserves version keys and drops unsupported transform query params", () => {
    expect(
      getImageUrl(
        "https://images.cookclub.app/recipes/a.jpg?v=42&w=100",
        "feed_960",
      ),
    ).toBe("https://images.cookclub.app/recipes/a.jpg?preset=feed_960&v=42");
  });

  it("maps legacy aliases to shared named presets", () => {
    expect(
      getImageUrl("https://images.cookclub.app/recipes/a.jpg", "recipe-card"),
    ).toBe("https://images.cookclub.app/recipes/a.jpg?preset=feed_960");
    expect(
      getImageUrl("https://images.cookclub.app/avatars/a.jpg", "avatar-lg"),
    ).toBe("https://images.cookclub.app/avatars/a.jpg?preset=avatar_192");
  });

  it("returns raw full-size URLs without adding a preset", () => {
    expect(
      getImageUrl("https://images.cookclub.app/recipes/a.jpg?v=42", "full"),
    ).toBe("https://images.cookclub.app/recipes/a.jpg?v=42");
    expect(getImageUrl("https://example.com/recipes/a.jpg", "full")).toBe(
      undefined,
    );
  });

  it("allows local file previews", () => {
    expect(getImageUrl("file:///tmp/photo.jpg", "recipe-thumb")).toBe(
      "file:///tmp/photo.jpg",
    );
  });

  it("accepts PublicImageAsset values", () => {
    const asset: ImageSourceAsset = {
      url: "https://images.cookclub.app/recipes/a.jpg",
      storageKey: "recipes/a.jpg",
      width: 1200,
      height: 900,
      contentType: "image/jpeg",
      byteSize: 1234,
      thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j2w",
    };

    expect(getImageUrl(asset, "feed_720")).toBe(
      "https://images.cookclub.app/recipes/a.jpg?preset=feed_720",
    );
  });
});

describe("native image format negotiation", () => {
  it("builds distinct Accept headers for each benchmark format", () => {
    expect(getImageAcceptHeader("avif")).toBe(
      "image/avif,image/webp,image/*,*/*",
    );
    expect(getImageAcceptHeader("webp")).toBe("image/webp,image/*,*/*");
    expect(getImageAcceptHeader("jpeg")).toBe("image/jpeg,image/*,*/*");
  });
});

describe("image preset selection", () => {
  it("chooses the smallest feed preset at or above layout width times pixel ratio", () => {
    expect(selectFeedImagePreset(360, 2)).toBe("feed_720");
    expect(selectFeedImagePreset(384, 2.5)).toBe("feed_960");
    expect(selectFeedImagePreset(430, 3)).toBe("feed_1080");
  });

  it("caps detail presets at detail_2560 for wide tablet layouts", () => {
    expect(selectDetailImagePreset(768, 2)).toBe("detail_1600");
    expect(selectDetailImagePreset(900, 2)).toBe("detail_2048");
    expect(selectDetailImagePreset(1024, 2.5)).toBe("detail_2560");
    expect(selectDetailImagePreset(1366, 2)).toBe("detail_2560");
  });

  it("selects avatar presets from measured size and pixel ratio", () => {
    expect(selectAvatarImagePreset(44, 2)).toBe("avatar_96");
    expect(selectAvatarImagePreset(96, 2)).toBe("avatar_192");
  });
});

describe("appendImageVersion", () => {
  it("sets stable cache version parameters", () => {
    expect(
      appendImageVersion("https://images.cookclub.app/avatars/a.jpg", 123),
    ).toBe("https://images.cookclub.app/avatars/a.jpg?v=123");
  });
});
