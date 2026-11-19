import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import {
  useRecipeImport,
  type RecipeImportItem,
} from "@/features/recipe-import/RecipeImportProvider";
import { navigationRef } from "@/navigation/navigationRef";
import {
  getRecipeImportSocialPlatform,
  getRecipeImportSocialPlatformInfo,
  getRecipeImportSourceTitle,
} from "@/utils/socialPlatforms";

const IMPORT_PROGRESS_TRACK_WIDTH = 160;
const IMPORT_PROGRESS_BAR_WIDTH = 56;

const getImportIcon = (
  mode: RecipeImportItem["mode"],
): keyof typeof Ionicons.glyphMap => {
  switch (mode) {
    case "url":
      return "link-outline";
    case "text":
      return "document-text-outline";
    case "image":
      return "image-outline";
  }
};

const getImportStatusCopy = (importItem: RecipeImportItem) => {
  if (importItem.status === "ready") return "Recipe ready";
  if (importItem.status === "failed")
    return importItem.error || "Import failed";
  if (importItem.status === "processing") return "Import is processing";
  return "Import is running";
};

const ImportProgressBar = ({ active }: { active: boolean }) => {
  const [trackWidth, setTrackWidth] = useState(IMPORT_PROGRESS_TRACK_WIDTH);
  const positionProgress = useSharedValue(0);
  const completionProgress = useSharedValue(active ? 0 : 1);

  useEffect(() => {
    if (active) {
      cancelAnimation(positionProgress);
      completionProgress.set(0);
      positionProgress.set(0);
      positionProgress.set(
        withRepeat(
          withTiming(1, {
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
          }),
          -1,
          true,
        ),
      );
    } else {
      cancelAnimation(positionProgress);
      completionProgress.set(
        withTiming(1, {
          duration: 260,
          easing: Easing.out(Easing.cubic),
        }),
      );
    }

    return () => {
      cancelAnimation(positionProgress);
      cancelAnimation(completionProgress);
    };
  }, [active, completionProgress, positionProgress]);

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    const measuredWidth = event.nativeEvent.layout.width;
    if (measuredWidth > 0) {
      setTrackWidth(measuredWidth);
    }
  }, []);

  const segmentWidth = Math.min(IMPORT_PROGRESS_BAR_WIDTH, trackWidth);
  const travelWidth = Math.max(0, trackWidth - segmentWidth);

  const indicatorStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: positionProgress.get() * travelWidth }],
    };
  }, [travelWidth]);

  const completionStyle = useAnimatedStyle(() => ({
    opacity: completionProgress.get(),
  }));

  return (
    <View style={styles.importProgressTrack} onLayout={handleTrackLayout}>
      <Animated.View
        style={[
          styles.importProgressIndicator,
          { width: segmentWidth },
          indicatorStyle,
        ]}
      />
      <Animated.View
        style={[styles.importProgressCompletion, completionStyle]}
      />
    </View>
  );
};

const ImportQueueSummary = ({
  pendingCount,
  readyCount,
}: {
  pendingCount: number;
  readyCount: number;
}) => {
  const active = pendingCount > 0;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      layout={LinearTransition.duration(180)}
      style={styles.importSummary}
    >
      <View style={styles.importSummaryTopRow}>
        <View style={styles.importSummaryTitleRow}>
          <Ionicons
            name={active ? "sparkles" : "checkmark"}
            size={18}
            style={styles.importSummaryIconGlyph}
          />
          <Text type="headline">
            {active ? "Import is working" : "Import ready"}
          </Text>
        </View>
        <Text type="caption" style={styles.importProgressLabel}>
          {active ? "Analyzing" : "Complete"}
        </Text>
      </View>
      <View style={styles.importSummaryText}>
        <Text type="subheadline" style={styles.importSummarySubtitle}>
          {active
            ? "You can keep using cookclub. Your recipe will appear here when it is ready."
            : `${readyCount} recipe${readyCount === 1 ? "" : "s"} ready to review.`}
        </Text>
      </View>
      <ImportProgressBar active={active} />
    </Animated.View>
  );
};

const BackgroundImportCard = ({
  importItem,
  showSeparator,
  onReview,
  onDismiss,
}: {
  importItem: RecipeImportItem;
  showSeparator: boolean;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
}) => {
  const theme = UnistylesRuntime.getTheme();
  const isReady = importItem.status === "ready";
  const isFailed = importItem.status === "failed";
  const isPending =
    importItem.status === "pending" || importItem.status === "processing";
  const shouldEmphasizeTitle = isPending || isReady || isFailed;
  const socialPlatform =
    importItem.mode === "url" && !isReady
      ? getRecipeImportSocialPlatform(importItem.title)
      : null;
  const socialPlatformInfo = socialPlatform
    ? getRecipeImportSocialPlatformInfo(socialPlatform)
    : null;
  const displayTitle =
    isFailed && socialPlatformInfo
      ? `Import from ${socialPlatformInfo.displayName} failed`
      : importItem.mode === "url" && !isReady
        ? getRecipeImportSourceTitle(importItem.title)
        : importItem.title;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      layout={LinearTransition.duration(180)}
      style={[
        styles.importCard,
        showSeparator && styles.importCardWithSeparator,
      ]}
    >
      <View
        style={[
          styles.importIconContainer,
          isFailed && styles.importIconContainerFailed,
          isReady && styles.importIconContainerReady,
          socialPlatformInfo &&
            !isFailed && {
              backgroundColor: `${socialPlatformInfo.color}18`,
            },
        ]}
      >
        {socialPlatformInfo && !isFailed ? (
          <Ionicons
            name={socialPlatformInfo.icon}
            size={23}
            color={socialPlatformInfo.color}
          />
        ) : importItem.status === "pending" ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Ionicons
            name={
              isFailed ? "alert-circle-outline" : getImportIcon(importItem.mode)
            }
            size={22}
            color={isFailed ? theme.colors.destructive : theme.colors.primary}
          />
        )}
      </View>

      <View style={styles.importTextContainer}>
        <Text
          type="body"
          numberOfLines={1}
          style={[
            styles.importTitle,
            shouldEmphasizeTitle && styles.importTitleEmphasized,
          ]}
        >
          {displayTitle}
        </Text>
        <Text
          type="subheadline"
          numberOfLines={2}
          style={[
            styles.importSubtitle,
            isFailed && styles.importSubtitleFailed,
          ]}
        >
          {getImportStatusCopy(importItem)}
        </Text>
      </View>

      {isReady ? (
        <Pressable
          style={styles.importReviewButton}
          onPress={() => onReview(importItem.id)}
        >
          <Text type="caption" style={styles.importReviewButtonText}>
            Review
          </Text>
        </Pressable>
      ) : isFailed ? (
        <Pressable
          style={styles.importDismissButton}
          onPress={() => onDismiss(importItem.id)}
          accessibilityLabel="Dismiss failed import"
        >
          <Ionicons name="close" size={18} style={styles.importDismissIcon} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
};

interface ImportQueueListProps {
  /** Called after navigating to review a ready import (e.g. to close a sheet). */
  onReview?: () => void;
}

/**
 * The background import queue: imports in progress, ready to review, or failed.
 * Renders nothing when there are no imports.
 */
export const ImportQueueList = ({ onReview }: ImportQueueListProps) => {
  const { imports, pendingCount, readyCount, dismissImport } =
    useRecipeImport();

  const handleReview = useCallback(
    (id: string) => {
      const importItem = imports.find((item) => item.id === id);
      if (importItem?.status !== "ready" || !navigationRef.isReady()) return;

      onReview?.();
      navigationRef.navigate("RecipeDetail", {
        importJobId: importItem.id,
        mode: "edit",
      });
    },
    [imports, onReview],
  );

  const handleDismiss = useCallback(
    (id: string) => {
      dismissImport(id).catch(() => {});
    },
    [dismissImport],
  );

  if (imports.length === 0) return null;

  return (
    <View style={styles.importQueue}>
      <ImportQueueSummary pendingCount={pendingCount} readyCount={readyCount} />
      {imports.map((importItem, index) => (
        <BackgroundImportCard
          key={importItem.id}
          importItem={importItem}
          showSeparator={index < imports.length - 1}
          onReview={handleReview}
          onDismiss={handleDismiss}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  importQueue: {
    marginHorizontal: 20,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: theme.borderRadius.large,
    overflow: "hidden",
  },
  importSummary: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 10,
    backgroundColor: theme.colors.inputBackground,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  importSummaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  importSummaryTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  importSummaryIconGlyph: {
    color: theme.colors.primary,
  },
  importSummaryText: {
    gap: 4,
  },
  importSummarySubtitle: {
    color: theme.colors.textSecondary,
  },
  importProgressTrack: {
    width: "100%",
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.background,
    overflow: "hidden",
  },
  importProgressIndicator: {
    width: IMPORT_PROGRESS_BAR_WIDTH,
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  importProgressCompletion: {
    position: "absolute",
    inset: 0,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  importProgressLabel: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.medium,
    fontVariant: ["tabular-nums"],
  },
  importCard: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    backgroundColor: theme.colors.inputBackground,
    overflow: "hidden",
  },
  importCardWithSeparator: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  importIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: theme.colors.primary + "18",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  importIconContainerReady: {
    backgroundColor: theme.colors.primary + "22",
  },
  importIconContainerFailed: {
    backgroundColor: theme.colors.destructive + "16",
  },
  importTextContainer: {
    flex: 1,
    gap: 2,
  },
  importTitle: {
    position: "relative",
  },
  importTitleEmphasized: {
    fontFamily: theme.fonts.medium,
  },
  importSubtitle: {
    color: theme.colors.textSecondary,
  },
  importSubtitleFailed: {
    color: theme.colors.destructive,
  },
  importReviewButton: {
    minWidth: 72,
    height: 34,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  importReviewButtonText: {
    color: theme.colors.buttonText,
    fontFamily: theme.fonts.medium,
  },
  importDismissButton: {
    width: 34,
    height: 34,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.pressHighlight,
  },
  importDismissIcon: {
    color: theme.colors.textSecondary,
  },
}));
