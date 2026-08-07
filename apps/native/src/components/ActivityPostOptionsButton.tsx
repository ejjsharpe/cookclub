import { memo, useCallback } from "react";
import {
  ActionSheetIOS,
  Alert,
  type AlertButton,
  TouchableOpacity,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";

interface Props {
  activityId: number;
  onReportPress?: (activityEventId: number) => void;
  blockUserId?: string;
  onBlockPress?: (userId: string) => void;
}

export const ActivityPostOptionsButton = memo(
  ({ activityId, onReportPress, blockUserId, onBlockPress }: Props) => {
    const handleReport = useCallback(() => {
      onReportPress?.(activityId);
    }, [activityId, onReportPress]);

    const handleBlock = useCallback(() => {
      if (blockUserId) onBlockPress?.(blockUserId);
    }, [blockUserId, onBlockPress]);

    const hasReportOption = Boolean(onReportPress);
    const hasBlockOption = Boolean(blockUserId && onBlockPress);

    const handlePostOptions = useCallback(() => {
      if (process.env.EXPO_OS === "ios") {
        const options: string[] = [];
        const actions: (() => void)[] = [];

        if (hasReportOption) {
          options.push("Report post");
          actions.push(handleReport);
        }

        const blockOptionIndex = hasBlockOption ? options.length : undefined;
        if (hasBlockOption) {
          options.push("Block author");
          actions.push(handleBlock);
        }

        const cancelButtonIndex = options.length;
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: "Post options",
            options: [...options, "Cancel"],
            cancelButtonIndex,
            destructiveButtonIndex: blockOptionIndex,
          },
          (buttonIndex) => actions[buttonIndex]?.(),
        );
        return;
      }

      const buttons: AlertButton[] = [];
      if (hasReportOption) {
        buttons.push({ text: "Report post", onPress: handleReport });
      }
      if (hasBlockOption) {
        buttons.push({
          text: "Block author",
          style: "destructive",
          onPress: handleBlock,
        });
      }
      buttons.push({ text: "Cancel", style: "cancel" });

      Alert.alert("Post options", undefined, buttons, { cancelable: true });
    }, [handleBlock, handleReport, hasBlockOption, hasReportOption]);

    if (!hasReportOption && !hasBlockOption) return null;

    return (
      <TouchableOpacity
        accessibilityHint="Report this post or block its author"
        accessibilityLabel="More post options"
        accessibilityRole="button"
        activeOpacity={0.6}
        hitSlop={6}
        onPress={handlePostOptions}
        style={styles.button}
      >
        <Ionicons name="ellipsis-horizontal" size={20} style={styles.icon} />
      </TouchableOpacity>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  button: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: theme.borderRadius.full,
  },
  icon: {
    color: theme.colors.textSecondary,
  },
}));
