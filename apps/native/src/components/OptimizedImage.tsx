import { Image, type ImageProps } from "expo-image";
import { memo, useMemo } from "react";

import {
  getImageUrl,
  IMAGE_REQUEST_HEADERS,
  isPublicImageAsset,
  type ImagePreset,
  type ImageSourceAsset,
} from "@/utils/imageUrl";

type OptimizedImageProps = Omit<ImageProps, "source" | "placeholder"> & {
  image: ImageSourceAsset;
  preset: ImagePreset;
};

export const OptimizedImage = memo(function OptimizedImage({
  image,
  preset,
  cachePolicy = "memory-disk",
  contentFit = "cover",
  placeholderContentFit = "cover",
  transition = 120,
  recyclingKey,
  ...props
}: OptimizedImageProps) {
  const uri = getImageUrl(image, preset);
  const placeholder =
    isPublicImageAsset(image) && image.previewDataUrl
      ? { uri: image.previewDataUrl }
      : undefined;
  const resolvedRecyclingKey = useMemo(() => {
    if (recyclingKey) return recyclingKey;
    if (isPublicImageAsset(image)) {
      return `${image.storageKey}:${preset}`;
    }
    return uri ? `${uri}:${preset}` : null;
  }, [image, preset, recyclingKey, uri]);

  if (!uri) return null;

  return (
    <Image
      {...props}
      source={{ uri, headers: IMAGE_REQUEST_HEADERS }}
      placeholder={placeholder}
      placeholderContentFit={placeholderContentFit}
      transition={transition}
      recyclingKey={resolvedRecyclingKey}
      cachePolicy={cachePolicy}
      contentFit={contentFit}
    />
  );
});
