import { memo, type ComponentProps } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { OptimizedImage } from "@/components/OptimizedImage";
import { Text } from "@/components/Text";
import type { RecentRecipeSearch } from "@/lib/recentRecipeSearches";
import { formatMinutes } from "@/utils/timeUtils";

const ICONS = {
  query: "search",
  tag: "pricetag-outline",
  collection: "albums-outline",
  recipe: "image-outline",
} as const;

function describe(item: RecentRecipeSearch): { title: string; meta: string } {
  switch (item.type) {
    case "query":
      return { title: item.text, meta: "Search" };
    case "tag":
      return { title: item.name, meta: "Tag" };
    case "collection":
      return {
        title: item.name,
        meta: `Collection · ${item.recipeCount} ${item.recipeCount === 1 ? "recipe" : "recipes"}`,
      };
    case "recipe": {
      const time = formatMinutes(item.totalTime);
      return { title: item.name, meta: time ? `Recipe · ${time}` : "Recipe" };
    }
  }
}

interface RecentSearchRowProps {
  item: RecentRecipeSearch;
  onPress: (item: RecentRecipeSearch) => void;
  onRemove: (item: RecentRecipeSearch) => void;
}

interface SearchRowTileProps {
  icon: ComponentProps<typeof Ionicons>["name"];
  /** Brand-tinted, for tags. */
  tinted?: boolean;
}

/** The square icon tile at the start of a search row. */
export const SearchRowTile = ({ icon, tinted = false }: SearchRowTileProps) => (
  <View style={[styles.tile, tinted && styles.tileTinted]}>
    <Ionicons
      name={icon}
      size={22}
      style={tinted ? styles.tintedIcon : styles.icon}
    />
  </View>
);

export const RecentSearchRow = memo(function RecentSearchRow({
  item,
  onPress,
  onRemove,
}: RecentSearchRowProps) {
  const { title, meta } = describe(item);
  const image = item.type === "recipe" ? item.coverImage : null;

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta}`}
      // The nested remove button isn't reachable by VoiceOver inside an
      // accessible row, so it's offered as an action too.
      accessibilityActions={[{ name: "delete", label: "Remove" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "delete") onRemove(item);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {image ? (
        <OptimizedImage
          image={image}
          preset="thumb_200"
          style={styles.tile}
          contentFit="cover"
        />
      ) : (
        <SearchRowTile icon={ICONS[item.type]} tinted={item.type === "tag"} />
      )}
      <View style={styles.text}>
        <Text type="headline" numberOfLines={1}>
          {title}
        </Text>
        <Text type="footnote" style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Pressable
        onPress={() => onRemove(item)}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${title} from recent searches`}
        hitSlop={10}
        style={styles.remove}
      >
        <Ionicons name="close" size={18} style={styles.removeIcon} />
      </Pressable>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  pressed: {
    backgroundColor: theme.colors.pressHighlight,
  },
  tile: {
    width: 52,
    height: 52,
    borderRadius: theme.borderRadius.medium,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  icon: {
    color: theme.colors.textSecondary,
  },
  tileTinted: {
    backgroundColor: theme.colors.primarySoft,
  },
  tintedIcon: {
    color: theme.colors.onPrimarySoft,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  meta: {
    color: theme.colors.textSecondary,
  },
  remove: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  removeIcon: {
    color: theme.colors.textSecondary,
  },
}));
