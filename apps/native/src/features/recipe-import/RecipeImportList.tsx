import { useEffect, useState, type ComponentProps } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { RecipeImportItem } from "./RecipeImportProvider";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import {
  getRecipeImportSocialPlatform,
  getRecipeImportSocialPlatformInfo,
} from "@/utils/socialPlatforms";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const BAR_FRACTION = 0.35;

/** A thin bar that slides back and forth while an import runs. */
const WorkingBar = () => {
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(
      withRepeat(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  const segment = width * BAR_FRACTION;
  const barStyle = useAnimatedStyle(
    () => ({
      width: segment,
      transform: [{ translateX: progress.get() * (width - segment) }],
    }),
    [segment, width],
  );

  return (
    <View
      style={styles.track}
      onLayout={(event: LayoutChangeEvent) =>
        setWidth(event.nativeEvent.layout.width)
      }
    >
      <Animated.View style={[styles.bar, barStyle]} />
    </View>
  );
};

const describe = (item: RecipeImportItem) => {
  const platform =
    item.mode === "url" ? getRecipeImportSocialPlatform(item.title) : null;
  const social = platform ? getRecipeImportSocialPlatformInfo(platform) : null;
  const isReady = item.status === "ready";

  const title = social && !isReady ? `${social.displayName} post` : item.title;
  const reading =
    item.mode === "text"
      ? "reading your text"
      : item.mode === "image"
        ? "reading your photos"
        : social
          ? "reading the post"
          : "reading the page";
  const method = item.importType === "smart" ? "Smart import" : "Quick import";
  const icon: IoniconName =
    social?.icon ??
    (item.mode === "text"
      ? "document-text-outline"
      : item.mode === "image"
        ? "images-outline"
        : "globe-outline");

  return { title, reading, method, icon, social };
};

const ImportRow = ({
  item,
  showSeparator,
  onReview,
  onDismiss,
}: {
  item: RecipeImportItem;
  showSeparator: boolean;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
}) => {
  const { theme } = useUnistyles();
  const { title, reading, method, icon, social } = describe(item);
  const isReady = item.status === "ready";
  const isFailed = item.status === "failed";
  const isWorking = !isReady && !isFailed;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(150)}
      layout={LinearTransition.duration(180)}
    >
      {showSeparator && <View style={styles.separator} />}
      <View style={styles.row}>
        <View
          style={[
            styles.icon,
            social && !isFailed && { backgroundColor: `${social.color}1A` },
            isReady && styles.iconReady,
            isFailed && styles.iconFailed,
          ]}
        >
          <Ionicons
            name={
              isReady ? "checkmark" : isFailed ? "alert-circle-outline" : icon
            }
            size={21}
            color={
              isFailed
                ? theme.colors.destructive
                : isReady
                  ? theme.colors.primary
                  : (social?.color ?? theme.colors.text)
            }
          />
        </View>
        <View style={styles.text}>
          <Text type="subheadline" style={styles.title} numberOfLines={1}>
            {isFailed && social
              ? `Couldn't import the ${social.displayName} post`
              : title}
          </Text>
          <Text
            type="caption"
            numberOfLines={2}
            style={[styles.subtitle, isFailed && styles.subtitleFailed]}
          >
            {isReady
              ? "Ready to look over"
              : isFailed
                ? (item.error ?? "Something went wrong while importing.")
                : `${method} · ${reading}`}
          </Text>
          {isWorking && <WorkingBar />}
        </View>
        {isReady ? (
          <Pressable
            onPress={() => onReview(item.id)}
            style={({ pressed }) => [styles.review, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Review ${title}`}
          >
            <Text type="subheadline" style={styles.reviewLabel}>
              Review
            </Text>
          </Pressable>
        ) : isFailed ? (
          <Pressable
            onPress={() => onDismiss(item.id)}
            hitSlop={8}
            style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Dismiss failed import"
          >
            <Ionicons name="close" size={15} style={styles.dismissIcon} />
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
};

/**
 * Imports in progress, ready or failed, in one card under the import box.
 */
export const RecipeImportList = ({
  imports,
  onReview,
  onDismiss,
}: {
  imports: RecipeImportItem[];
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
}) => {
  if (imports.length === 0) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      layout={LinearTransition.duration(180)}
    >
      <View style={styles.card}>
        {imports.map((item, index) => (
          <ImportRow
            key={item.id}
            item={item}
            showSeparator={index > 0}
            onReview={onReview}
            onDismiss={onDismiss}
          />
        ))}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create((theme) => ({
  card: {
    marginTop: 14,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 22,
    backgroundColor: theme.colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.05)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: 56,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  iconReady: {
    backgroundColor: theme.colors.primarySoft,
  },
  iconFailed: {
    backgroundColor: `${theme.colors.destructive}1A`,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  subtitle: {
    color: theme.colors.textSecondary,
  },
  subtitleFailed: {
    color: theme.colors.destructive,
  },
  track: {
    height: 4,
    marginTop: 7,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: theme.colors.pressHighlight,
  },
  bar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.primary,
  },
  review: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    justifyContent: "center",
    backgroundImage: theme.colors.primaryGradient,
  },
  reviewLabel: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.buttonText,
  },
  dismiss: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  dismissIcon: {
    color: theme.colors.textSecondary,
  },
  pressed: {
    opacity: 0.6,
  },
}));
