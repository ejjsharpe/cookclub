import { Image } from "expo-image";
import { memo, useCallback, useMemo, useState } from "react";
import { View, TouchableOpacity, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./Text";

import { Ionicons } from "@/components/Ionicons";
import { getImageUrl } from "@/utils/imageUrl";

const GRID_GAP = 20;
const EMPTY_PREVIEW_IMAGES: string[] = [];

// Proportional ratios relative to card width
const ICON_SIZE_RATIO = 0.25;
const BORDER_RADIUS_RATIO = 0.12; // ~14px at 156px width

interface Collection {
  id: number;
  name: string;
  recipeCount?: number;
  previewImages?: string[];
}

interface Props {
  collection: Collection;
  onPress?: () => void;
  onPressCollection?: (collectionId: number) => void;
  width?: number;
}

const ImageGrid = memo(function ImageGrid({
  images,
  width,
}: {
  images: string[];
  width?: number;
}) {
  const count = Math.min(images.length, 4);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const imageSources = useMemo(
    () =>
      images
        .slice(0, 4)
        .map((image) => ({ uri: getImageUrl(image, "recipe-thumb") })),
    [images],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: layoutWidth } = event.nativeEvent.layout;
    setMeasuredWidth((currentWidth) =>
      currentWidth === layoutWidth ? currentWidth : layoutWidth,
    );
  }, []);

  // Use explicit width prop if provided, otherwise use measured width
  const effectiveWidth = width ?? measuredWidth;
  const layoutProps = width == null ? { onLayout: handleLayout } : undefined;

  // Calculate proportional values based on width
  const iconSize =
    effectiveWidth != null ? effectiveWidth * ICON_SIZE_RATIO : 40;
  const borderRadius =
    effectiveWidth != null ? effectiveWidth * BORDER_RADIUS_RATIO : 14;

  const containerStyle = [
    gridStyles.container,
    effectiveWidth != null && { width: effectiveWidth, height: effectiveWidth },
    { borderRadius },
  ];

  if (count === 0) {
    return (
      <View style={containerStyle} {...layoutProps}>
        <View style={gridStyles.placeholder}>
          <Ionicons
            name="albums-outline"
            size={iconSize}
            style={gridStyles.placeholderIcon}
          />
        </View>
      </View>
    );
  }

  if (count === 1) {
    return (
      <View style={containerStyle} {...layoutProps}>
        <Image
          source={imageSources[0]}
          style={gridStyles.fullImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          decodeFormat="rgb"
        />
      </View>
    );
  }

  if (count === 2) {
    return (
      <View style={containerStyle} {...layoutProps}>
        <View style={gridStyles.row}>
          <View style={gridStyles.imageWrapper}>
            <Image
              source={imageSources[0]}
              style={gridStyles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              decodeFormat="rgb"
            />
          </View>
          <View style={gridStyles.imageWrapper}>
            <Image
              source={imageSources[1]}
              style={gridStyles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              decodeFormat="rgb"
            />
          </View>
        </View>
      </View>
    );
  }

  if (count === 3) {
    return (
      <View style={containerStyle} {...layoutProps}>
        <View style={gridStyles.threeImageLayout}>
          <View style={gridStyles.largeImageWrapper}>
            <Image
              source={imageSources[0]}
              style={gridStyles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              decodeFormat="rgb"
            />
          </View>
          <View style={gridStyles.smallImagesColumn}>
            <View style={gridStyles.imageWrapper}>
              <Image
                source={imageSources[1]}
                style={gridStyles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                decodeFormat="rgb"
              />
            </View>
            <View style={gridStyles.imageWrapper}>
              <Image
                source={imageSources[2]}
                style={gridStyles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                decodeFormat="rgb"
              />
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={containerStyle} {...layoutProps}>
      <View style={gridStyles.row}>
        <View style={gridStyles.imageWrapper}>
          <Image
            source={imageSources[0]}
            style={gridStyles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            decodeFormat="rgb"
          />
        </View>
        <View style={gridStyles.imageWrapper}>
          <Image
            source={imageSources[1]}
            style={gridStyles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            decodeFormat="rgb"
          />
        </View>
      </View>
      <View style={gridStyles.row}>
        <View style={gridStyles.imageWrapper}>
          <Image
            source={imageSources[2]}
            style={gridStyles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            decodeFormat="rgb"
          />
        </View>
        <View style={gridStyles.imageWrapper}>
          <Image
            source={imageSources[3]}
            style={gridStyles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            decodeFormat="rgb"
          />
        </View>
      </View>
    </View>
  );
});

const gridStyles = StyleSheet.create((theme) => ({
  container: {
    aspectRatio: 1,
    overflow: "hidden",
  },
  row: {
    flex: 1,
    flexDirection: "row",
    gap: 2,
  },
  imageWrapper: {
    flex: 1,
  },
  largeImageWrapper: {
    flex: 1,
  },
  smallImagesColumn: {
    flex: 1,
    gap: 2,
  },
  threeImageLayout: {
    flex: 1,
    flexDirection: "row",
    gap: 2,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  fullImage: {
    width: "100%",
    height: "100%",
  },
  placeholder: {
    width: "100%",
    height: "100%",
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderIcon: {
    color: theme.colors.textTertiary,
  },
}));

export const CollectionGridCard = memo(function CollectionGridCard({
  collection,
  onPress,
  onPressCollection,
  width,
}: Props) {
  const previewImages = collection.previewImages || EMPTY_PREVIEW_IMAGES;
  const recipeCount = collection.recipeCount ?? 0;
  const handlePress = useCallback(() => {
    if (onPressCollection) {
      onPressCollection(collection.id);
      return;
    }
    onPress?.();
  }, [collection.id, onPress, onPressCollection]);
  const pressHandler = onPress || onPressCollection ? handlePress : undefined;

  return (
    <TouchableOpacity
      style={[styles.card, width != null && { flex: undefined, width }]}
      onPress={pressHandler}
      activeOpacity={0.7}
    >
      <ImageGrid images={previewImages} width={width} />
      <View style={styles.content}>
        <Text type="headline" numberOfLines={1}>
          {collection.name}
        </Text>
        <Text type="caption" style={styles.recipeCount}>
          {recipeCount} {recipeCount === 1 ? "recipe" : "recipes"}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

export { GRID_GAP, ImageGrid };

const styles = StyleSheet.create((theme) => ({
  card: {
    flex: 1,
  },
  content: {
    paddingTop: 8,
    gap: 2,
  },
  recipeCount: {
    color: theme.colors.textSecondary,
  },
}));
