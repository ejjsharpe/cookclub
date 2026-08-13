import { describe, expect, it, vi } from "vitest";

import {
  cleanupMovedRecipeImages,
  prepareRecipeImages,
} from "./recipe-image.service";

const createImageService = () => ({
  presign: vi.fn(),
  verify: vi.fn(),
  move: vi.fn(),
  delete: vi.fn(),
  deleteImportImages: vi.fn(),
  deleteImportImageStagingIds: vi.fn(),
  listImportImageStagingIds: vi.fn(),
  uploadFromUrl: vi.fn(),
  uploadImage: vi.fn(),
  normalizeImage: vi.fn(),
  stageImportSource: vi.fn(),
  getImportSource: vi.fn(),
});

function createAsset(key: string) {
  return {
    url: `https://images.example.com/${key}`,
    storageKey: key,
    width: 1200,
    height: 900,
    contentType: "image/jpeg" as const,
    byteSize: 1234,
    thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j2w",
    key,
    publicUrl: `https://images.example.com/${key}`,
  };
}

describe("recipe image service", () => {
  it("rehosts direct image URLs as permanent assets", async () => {
    const imageService = createImageService();
    imageService.uploadFromUrl.mockImplementation(
      async (_url: string, key: string) => ({
        success: true,
        key,
        publicUrl: `https://images.example.com/${key}`,
        asset: createAsset(key),
      }),
    );

    const result = await prepareRecipeImages(
      { images: [{ url: "https://example.com/image.jpg" }] },
      {
        imageService,
        imagePublicUrl: "https://images.example.com",
        ownerId: "user-id",
      },
    );

    expect(imageService.uploadFromUrl).toHaveBeenCalledWith(
      "https://example.com/image.jpg",
      expect.stringMatching(/^recipes\/covers\/.+\/.+\.jpg$/),
    );
    expect(imageService.move).not.toHaveBeenCalled();
    expect(result.images[0]).toMatchObject({
      url: expect.stringMatching(
        /^https:\/\/images\.example\.com\/recipes\/covers\/.+\/.+\.jpg$/,
      ),
      width: 1200,
      height: 900,
      thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j2w",
    });
    expect(result.movedKeys[0]).toMatch(/^recipes\/covers\/.+\/.+\.jpg$/);
  });

  it("moves upload IDs and returns permanent public URLs", async () => {
    const imageService = createImageService();
    imageService.move.mockResolvedValue({
      success: true,
      results: [
        {
          from: "temp/abc.jpg",
          to: "recipes/covers/group/img.jpg",
          success: true,
          asset: createAsset("recipes/covers/group/img.jpg"),
        },
      ],
    });

    const result = await prepareRecipeImages(
      { imageUploadIds: ["temp/abc.jpg"] },
      {
        imageService,
        imagePublicUrl: "https://images.example.com/",
        ownerId: "user-id",
      },
    );

    expect(imageService.move).toHaveBeenCalledWith(
      [
        {
          from: "temp/abc.jpg",
          to: expect.stringMatching(/^recipes\/covers\/.+\/.+\.jpg$/),
        },
      ],
      "user-id",
    );
    expect(result.images[0]?.url).toMatch(
      /^https:\/\/images\.example\.com\/recipes\/covers\/.+\/.+\.jpg$/,
    );
    expect(result.images[0]?.thumbhash).toBe("3OcRJYB4d3h/iIeHeEh3eIhw+j2w");
    expect(result.movedKeys[0]).toMatch(/^recipes\/covers\/.+\/.+\.jpg$/);
  });

  it("rehosts direct image URLs when moving uploaded images", async () => {
    const imageService = createImageService();
    imageService.uploadFromUrl.mockImplementation(
      async (_url: string, key: string) => ({
        success: true,
        key,
        publicUrl: `https://images.example.com/${key}`,
        asset: createAsset(key),
      }),
    );
    imageService.move.mockResolvedValue({
      success: true,
      results: [
        {
          from: "temp/abc.webp",
          to: "recipes/covers/group/img.webp",
          success: true,
          asset: createAsset("recipes/covers/group/img.webp"),
        },
      ],
    });

    const result = await prepareRecipeImages(
      {
        images: [{ url: "https://example.com/existing.jpg" }],
        imageUploadIds: ["temp/abc.webp"],
      },
      {
        imageService,
        imagePublicUrl: "https://images.example.com",
        ownerId: "user-id",
      },
    );

    expect(result.images).toHaveLength(2);
    expect(result.images[0]?.storageKey).toMatch(
      /^recipes\/covers\/.+\/.+\.jpg$/,
    );
    expect(result.images[1]?.url).toMatch(
      /^https:\/\/images\.example\.com\/recipes\/covers\/.+\/.+\.webp$/,
    );
  });

  it("preserves an explicit order across existing and uploaded images", async () => {
    const imageService = createImageService();
    const existingImage = createAsset("recipes/covers/existing/image.jpg");
    imageService.move.mockResolvedValue({
      success: true,
      results: [
        {
          from: "temp/new.webp",
          to: "recipes/covers/group/new.webp",
          success: true,
          asset: createAsset("recipes/covers/group/new.webp"),
        },
      ],
    });

    const result = await prepareRecipeImages(
      {
        images: [existingImage],
        imageUploadIds: ["temp/new.webp"],
        imageOrder: [
          { source: "upload", index: 0 },
          { source: "image", index: 0 },
        ],
      },
      {
        imageService,
        imagePublicUrl: "https://images.example.com",
        ownerId: "user-id",
      },
    );

    expect(result.images.map((image) => image.storageKey)).toEqual([
      "recipes/covers/group/new.webp",
      "recipes/covers/existing/image.jpg",
    ]);
  });

  it("rejects an image order that does not reference every image once", async () => {
    const imageService = createImageService();
    const existingImage = createAsset("recipes/covers/existing/image.jpg");

    await expect(
      prepareRecipeImages(
        {
          images: [existingImage],
          imageOrder: [{ source: "image", index: 1 }],
        },
        {
          imageService,
          imagePublicUrl: "https://images.example.com",
          ownerId: "user-id",
        },
      ),
    ).rejects.toThrow("Image order contains an invalid image reference");
  });

  it("validates image order before moving uploaded images", async () => {
    const imageService = createImageService();

    await expect(
      prepareRecipeImages(
        {
          imageUploadIds: ["temp/new.webp"],
          imageOrder: [{ source: "upload", index: 1 }],
        },
        {
          imageService,
          imagePublicUrl: "https://images.example.com",
          ownerId: "user-id",
        },
      ),
    ).rejects.toThrow("Image order contains an invalid image reference");

    expect(imageService.move).not.toHaveBeenCalled();
    expect(imageService.delete).not.toHaveBeenCalled();
  });

  it("throws when an image move fails", async () => {
    const imageService = createImageService();
    imageService.move.mockResolvedValue({
      success: false,
      results: [
        {
          from: "temp/abc.jpg",
          to: "recipes/covers/group/img.jpg",
          success: false,
          error: "Source not found",
        },
      ],
    });

    await expect(
      prepareRecipeImages(
        { imageUploadIds: ["temp/abc.jpg"] },
        {
          imageService,
          imagePublicUrl: "https://images.example.com",
          ownerId: "user-id",
        },
      ),
    ).rejects.toThrow("Failed to move uploaded images");
  });

  it("cleans up successful moves when a later move fails", async () => {
    const imageService = createImageService();
    imageService.move.mockResolvedValue({
      success: false,
      results: [
        {
          from: "temp/abc.jpg",
          to: "recipes/covers/group/img-1.jpg",
          success: true,
        },
        {
          from: "temp/def.jpg",
          to: "recipes/covers/group/img-2.jpg",
          success: false,
          error: "Source not found",
        },
      ],
    });

    await expect(
      prepareRecipeImages(
        { imageUploadIds: ["temp/abc.jpg", "temp/def.jpg"] },
        {
          imageService,
          imagePublicUrl: "https://images.example.com",
          ownerId: "user-id",
        },
      ),
    ).rejects.toThrow("Failed to move uploaded images");

    expect(imageService.delete).toHaveBeenCalledWith([
      "recipes/covers/group/img-1.jpg",
    ]);
  });

  it("cleans up moved upload IDs when metadata is missing", async () => {
    const imageService = createImageService();
    imageService.move.mockResolvedValue({
      success: true,
      results: [
        {
          from: "temp/abc.jpg",
          to: "recipes/covers/group/img.jpg",
          success: true,
        },
      ],
    });

    await expect(
      prepareRecipeImages(
        { imageUploadIds: ["temp/abc.jpg"] },
        {
          imageService,
          imagePublicUrl: "https://images.example.com",
          ownerId: "user-id",
        },
      ),
    ).rejects.toThrow("Image move did not return asset metadata");

    expect(imageService.delete).toHaveBeenCalledWith([
      "recipes/covers/group/img.jpg",
    ]);
  });

  it("cleans up direct temp image moves when metadata is missing", async () => {
    const imageService = createImageService();
    imageService.move.mockImplementation(async (moves: { to: string }[]) => ({
      success: true,
      results: [
        {
          from: "temp/user/photo.jpg",
          to: moves[0]!.to,
          success: true,
        },
      ],
    }));

    await expect(
      prepareRecipeImages(
        { images: [{ url: "https://images.example.com/temp/user/photo.jpg" }] },
        {
          imageService,
          imagePublicUrl: "https://images.example.com",
          ownerId: "user-id",
        },
      ),
    ).rejects.toThrow("Moved image did not return asset metadata");

    expect(imageService.delete).toHaveBeenCalledWith([
      expect.stringMatching(/^recipes\/covers\/.+\/.+\.jpg$/),
    ]);
  });

  it("copies legacy generated temp covers so saving can be retried", async () => {
    const imageService = createImageService();
    imageService.uploadFromUrl.mockImplementation(
      async (_url: string, key: string) => ({
        success: true,
        key,
        publicUrl: `https://images.example.com/${key}`,
        asset: createAsset(key),
      }),
    );

    const result = await prepareRecipeImages(
      {
        images: [
          {
            url: "https://images.example.com/temp/generated/cover.jpg",
          },
        ],
      },
      {
        imageService,
        imagePublicUrl: "https://images.example.com",
        ownerId: "user-id",
      },
    );

    expect(imageService.uploadFromUrl).toHaveBeenCalledWith(
      "https://images.example.com/temp/generated/cover.jpg",
      expect.stringMatching(/^recipes\/covers\/.+\/.+\.jpg$/),
    );
    expect(imageService.move).not.toHaveBeenCalled();
    expect(result.images).toHaveLength(1);
  });

  it("copies staged import assets into permanent recipe keys", async () => {
    const imageService = createImageService();
    imageService.uploadFromUrl.mockImplementation(
      async (_url: string, key: string) => ({
        success: true,
        key,
        publicUrl: `https://images.example.com/${key}`,
        asset: createAsset(key),
      }),
    );
    const stagedAsset = createAsset("imports/job-1/cover.jpg");

    const result = await prepareRecipeImages(
      { images: [stagedAsset] },
      {
        imageService,
        imagePublicUrl: "https://images.example.com",
        ownerId: "user-id",
      },
    );

    expect(imageService.uploadFromUrl).toHaveBeenCalledWith(
      stagedAsset.url,
      expect.stringMatching(/^recipes\/covers\/.+\/.+\.jpg$/),
    );
    expect(result.images[0]?.storageKey).toMatch(
      /^recipes\/covers\/.+\/.+\.jpg$/,
    );
    expect(result.movedKeys).toEqual([
      expect.stringMatching(/^recipes\/covers\/.+\/.+\.jpg$/),
    ]);
  });

  it("cleans up rehosted images when metadata is missing", async () => {
    const imageService = createImageService();
    imageService.uploadFromUrl.mockResolvedValue({
      success: true,
      key: "recipes/covers/group/img.jpg",
      publicUrl: "https://images.example.com/recipes/covers/group/img.jpg",
    });

    await expect(
      prepareRecipeImages(
        { images: [{ url: "https://example.com/image.jpg" }] },
        {
          imageService,
          imagePublicUrl: "https://images.example.com",
          ownerId: "user-id",
        },
      ),
    ).rejects.toThrow("Stored remote image did not return asset metadata");

    expect(imageService.delete).toHaveBeenCalledWith([
      expect.stringMatching(/^recipes\/covers\/.+\/.+\.jpg$/),
    ]);
  });

  it("copies legacy generated instruction images into recipe-owned step keys", async () => {
    const imageService = createImageService();
    imageService.uploadFromUrl.mockImplementation(
      async (_url: string, key: string) => ({
        success: true,
        key,
        publicUrl: `https://images.example.com/${key}`,
        asset: createAsset(key),
      }),
    );

    const result = await prepareRecipeImages(
      {
        images: [createAsset("recipes/covers/existing/img.jpg")],
        instructionSections: [
          {
            name: null,
            instructions: [
              {
                index: 0,
                instruction: "Stir.",
                imageUrl:
                  "https://images.example.com/temp/generated/step-image.jpg",
              },
            ],
          },
        ],
      },
      {
        imageService,
        imagePublicUrl: "https://images.example.com",
        ownerId: "user-id",
      },
    );

    expect(imageService.uploadFromUrl).toHaveBeenCalledWith(
      "https://images.example.com/temp/generated/step-image.jpg",
      expect.stringMatching(/^recipes\/instructions\/.+\/0\/.+\.jpg$/),
    );
    expect(imageService.move).not.toHaveBeenCalled();
    expect(result.instructionSections[0]?.instructions[0]?.imageUrl).toMatch(
      /^https:\/\/images\.example\.com\/recipes\/instructions\/.+\/0\/.+\.jpg$/,
    );
  });

  it("copies hosted non-temp instruction images into recipe-owned step keys", async () => {
    const imageService = createImageService();
    imageService.uploadFromUrl.mockImplementation(
      async (_url: string, key: string) => ({
        success: true,
        key,
        publicUrl: `https://images.example.com/${key}`,
        asset: createAsset(key),
      }),
    );

    const result = await prepareRecipeImages(
      {
        images: [createAsset("recipes/covers/existing/img.jpg")],
        instructionSections: [
          {
            name: null,
            instructions: [
              {
                index: 0,
                instruction: "Serve.",
                imageUrl: "https://images.example.com/social/youtube/step.jpg",
              },
            ],
          },
        ],
      },
      {
        imageService,
        imagePublicUrl: "https://images.example.com",
        ownerId: "user-id",
      },
    );

    expect(imageService.uploadFromUrl).toHaveBeenCalledWith(
      "https://images.example.com/social/youtube/step.jpg",
      expect.stringMatching(/^recipes\/instructions\/.+\/0\/.+\.jpg$/),
    );
    expect(result.instructionSections[0]?.instructions[0]?.imageUrl).toMatch(
      /^https:\/\/images\.example\.com\/recipes\/instructions\/.+\/0\/.+\.jpg$/,
    );
  });

  it("drops external instruction images when upload fails", async () => {
    const imageService = createImageService();
    imageService.uploadFromUrl.mockResolvedValue({
      success: false,
      error: "Remote image unavailable",
    });

    const result = await prepareRecipeImages(
      {
        images: [createAsset("recipes/covers/existing/img.jpg")],
        instructionSections: [
          {
            name: null,
            instructions: [
              {
                index: 0,
                instruction: "Garnish.",
                imageUrl: "https://example.com/step.jpg",
              },
            ],
          },
        ],
      },
      {
        imageService,
        imagePublicUrl: "https://images.example.com",
        ownerId: "user-id",
      },
    );

    expect(result.instructionSections[0]?.instructions[0]?.imageUrl).toBeNull();
  });

  it("deletes moved objects during compensation cleanup", async () => {
    const imageService = createImageService();

    await cleanupMovedRecipeImages(imageService, ["recipes/covers/a/b.jpg"]);

    expect(imageService.delete).toHaveBeenCalledWith([
      "recipes/covers/a/b.jpg",
    ]);
  });
});
