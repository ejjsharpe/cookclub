import { memo } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type {
  ActivityFeedListItem,
  CookingReviewFeedItem,
  RecipeImportFeedItem,
} from "@/api/activity";
import { OptimizedImage } from "@/components/OptimizedImage";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { FeedSaveButton } from "@/components/feed/FeedCardParts";

export const COOKED_CARD_WIDTH = 168;
const COOKED_IMAGE_HEIGHT = 126;
const SAVED_IMAGE_SIZE = 52;

type Cooked = CookingReviewFeedItem & ActivityFeedListItem;
type Saved = RecipeImportFeedItem & ActivityFeedListItem;

/** A dish someone cooked: their photo (or the recipe's), name and rating. */
export const CookedCard = memo(function CookedCard({
  item,
  onPress,
}: {
  item: Cooked;
  onPress: (item: Cooked) => void;
}) {
  const { theme } = useUnistyles();
  const image = item.review.images[0] ?? item.recipe.image;
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.recipe.name}, rated ${item.review.rating} out of 5, ${item._display.timeAgo}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {image ? (
        <OptimizedImage
          image={image}
          preset="recipe-card"
          style={styles.cardImage}
          accessible={false}
        />
      ) : (
        <View style={[styles.cardImage, styles.placeholder]}>
          <SystemIcon
            sf="fork.knife"
            android="restaurant"
            size={26}
            color={theme.colors.textTertiary}
          />
        </View>
      )}
      <View style={styles.cardText}>
        <Text type="subheadline" style={styles.bold} numberOfLines={1}>
          {item.recipe.name}
        </Text>
        <View style={styles.cardMeta}>
          <SystemIcon
            sf="star.fill"
            android="star"
            size={11}
            color={theme.colors.text}
          />
          <Text type="footnote" style={styles.muted}>
            {item.review.rating} · {item._display.timeAgo}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

/** A recipe someone saved, with the feed's add button. */
export const SavedRow = memo(function SavedRow({
  item,
  onPress,
  onOpenPost,
  saved = false,
  onSave,
}: {
  item: Saved;
  onPress: (item: Saved) => void;
  /** Opens the post, where it can be liked, commented on or reported. */
  onOpenPost: (item: Saved) => void;
  /** Already in your recipes: shows a tick and opens it. */
  saved?: boolean;
  /** Omit to hide the button, e.g. on your own profile. */
  onSave?: (item: Saved) => void;
}) {
  const { theme } = useUnistyles();
  const subtitle = item._display.sourceDescription ?? item._display.timeAgo;
  const isExternal = item.recipe.sourceType === "url";
  return (
    <View style={styles.saved}>
      <Pressable
        onPress={() => onPress(item)}
        onLongPress={() => onOpenPost(item)}
        accessibilityActions={[{ name: "openPost", label: "Open post" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "openPost") onOpenPost(item);
        }}
        accessibilityRole={isExternal ? "link" : "button"}
        accessibilityLabel={`${item.recipe.name}, ${subtitle}`}
        accessibilityHint={
          isExternal ? "Opens the recipe website" : "Opens the recipe"
        }
        style={({ pressed }) => [styles.savedMain, pressed && styles.pressed]}
      >
        {item.recipe.image ? (
          <OptimizedImage
            image={item.recipe.image}
            preset="recipe-thumb"
            style={styles.savedImage}
            accessible={false}
          />
        ) : (
          <View style={[styles.savedImage, styles.placeholder]}>
            <SystemIcon
              sf="fork.knife"
              android="restaurant"
              size={20}
              color={theme.colors.textTertiary}
            />
          </View>
        )}
        <View style={styles.savedText}>
          <Text type="callout" style={styles.bold} numberOfLines={1}>
            {item.recipe.name}
          </Text>
          <Text type="subheadline" style={styles.muted} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </Pressable>
      {onSave ? (
        <FeedSaveButton
          saved={saved}
          recipeName={item.recipe.name}
          onPress={() => onSave(item)}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  pressed: {
    opacity: 0.6,
  },
  bold: {
    fontFamily: theme.fonts.bold,
  },
  muted: {
    color: theme.colors.textSecondary,
  },
  placeholder: {
    backgroundColor: theme.colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: COOKED_CARD_WIDTH,
    gap: 8,
  },
  cardImage: {
    width: COOKED_CARD_WIDTH,
    height: COOKED_IMAGE_HEIGHT,
    borderRadius: 18,
    overflow: "hidden",
  },
  cardText: {
    paddingHorizontal: 2,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  saved: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 12,
  },
  savedMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 7,
  },
  savedImage: {
    width: SAVED_IMAGE_SIZE,
    height: SAVED_IMAGE_SIZE,
    borderRadius: 13,
    overflow: "hidden",
  },
  savedText: {
    flex: 1,
    minWidth: 0,
  },
}));
