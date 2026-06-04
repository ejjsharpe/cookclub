import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendImageVersion,
  getImageUrl,
  selectAvatarImagePreset,
  selectDetailImagePreset,
  selectFeedImagePreset,
  type ImageSourceAsset,
} from "./imageUrl";

vi.mock("react-native", () => ({
  PixelRatio: {
    get: vi.fn(() => 2),
  },
}));

describe("image URL transforms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds named presets only for exact transformable hosts", () => {
    expect(
      getImageUrl("https://images.cookclub.app/recipes/a.jpg", "feed_720"),
    ).toBe("https://images.cookclub.app/recipes/a.jpg?preset=feed_720");
    expect(
      getImageUrl("https://cdn.example.com/recipes/a.jpg", "feed_720"),
    ).toBe("https://cdn.example.com/recipes/a.jpg");
    expect(
      getImageUrl(
        "https://images.cookclub.app.evil.test/recipes/a.jpg",
        "feed_720",
      ),
    ).toBe("https://images.cookclub.app.evil.test/recipes/a.jpg");
  });

  it("supports localhost image Worker URLs", () => {
    expect(getImageUrl("http://localhost:8789/temp/a.jpg", "thumb_200")).toBe(
      "http://localhost:8789/temp/a.jpg?preset=thumb_200",
    );
    expect(getImageUrl("http://localhost:8790/temp/a.jpg", "thumb_200")).toBe(
      "http://localhost:8790/temp/a.jpg",
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
