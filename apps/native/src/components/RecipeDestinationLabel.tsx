import { memo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import {
  getRecipeImportSocialPlatform,
  getRecipeImportSocialPlatformInfo,
} from "@/utils/socialPlatforms";

type LabelVariant = "image" | "surface";

interface Props {
  isExternal: boolean;
  sourceLabel?: string;
  sourceUrl?: string;
  variant?: LabelVariant;
}

export const RecipeDestinationLabel = memo(function RecipeDestinationLabel({
  isExternal,
  sourceLabel,
  sourceUrl,
  variant = "surface",
}: Props) {
  styles.useVariants({ variant });
  const socialPlatform = isExternal
    ? getRecipeImportSocialPlatform(sourceUrl ?? sourceLabel ?? "")
    : null;
  const socialPlatformInfo = socialPlatform
    ? getRecipeImportSocialPlatformInfo(socialPlatform)
    : null;
  const iconName =
    socialPlatformInfo?.icon ?? (isExternal ? "open-outline" : "book-outline");
  const label =
    socialPlatformInfo?.displayName ??
    (isExternal ? (sourceLabel ?? "Source") : "In app");

  return (
    <View style={styles.row}>
      <Ionicons
        name={iconName}
        size={variant === "image" ? 13 : 14}
        style={[
          styles.icon,
          socialPlatformInfo ? { color: socialPlatformInfo.color } : null,
        ]}
      />
      <Text
        type={variant === "image" ? "caption" : "footnote"}
        numberOfLines={1}
        style={styles.label}
      >
        {label}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  icon: {
    variants: {
      variant: {
        image: {
          color: "rgba(255,255,255,0.82)",
        },
        surface: {
          color: theme.colors.textSecondary,
        },
      },
    },
  },
  label: {
    flexShrink: 1,
    letterSpacing: 0,
    variants: {
      variant: {
        image: {
          color: "rgba(255,255,255,0.82)",
        },
        surface: {
          color: theme.colors.textSecondary,
        },
      },
    },
  },
}));
