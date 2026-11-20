import { useNavigation } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  View,
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import {
  usePersonalizeRecipe,
  type ParsedRecipe,
  type PersonalizationGoal,
} from "@/api/recipe";
import { Ionicons } from "@/components/Ionicons";
import {
  PersonaliseRecipeSheet,
  type PersonaliseRecipeSheetRef,
} from "@/components/PersonaliseRecipeSheet";
import {
  RecipeBrowserSheet,
  type RecipeBrowserSheetRef,
} from "@/components/RecipeBrowserSheet";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { RecipeImportBox } from "@/features/recipe-import/RecipeImportBox";
import { RecipeImportList } from "@/features/recipe-import/RecipeImportList";
import { useRecipeImport } from "@/features/recipe-import/RecipeImportProvider";
import { alertApiError } from "@/lib/apiErrorAlert";
import { useSubscription } from "@/lib/subscription";

const HEADER_HEIGHT = 52;

const ActionRow = ({
  icon,
  label,
  subtitle,
  isPro,
  showSeparator,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle: string;
  isPro?: boolean;
  showSeparator?: boolean;
  onPress: () => void;
}) => (
  <>
    {showSeparator && <View style={styles.separator} />}
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={isPro ? "Needs cookclub Pro" : undefined}
    >
      <View style={styles.iconContainer}>
        <Ionicons name={icon} size={21} style={styles.icon} />
      </View>
      <View style={styles.textContainer}>
        <View style={styles.labelRow}>
          <Text type="body" style={styles.actionLabel}>
            {label}
          </Text>
          {isPro && (
            <View style={styles.badge}>
              <Text type="caption" style={styles.badgeText}>
                Pro
              </Text>
            </View>
          )}
        </View>
        <Text type="subheadline" style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} style={styles.chevron} />
    </Pressable>
  </>
);

export const AddRecipeScreen = () => {
  const { navigate } = useNavigation();
  const insets = UnistylesRuntime.insets;

  // Sheet refs
  const recipeBrowserSheetRef = useRef<RecipeBrowserSheetRef>(null);
  const personaliseRecipeSheetRef = useRef<PersonaliseRecipeSheetRef>(null);
  const [selectedPersonaliseRecipeId, setSelectedPersonaliseRecipeId] =
    useState<number | null>(null);
  const { imports: backgroundImports, dismissImport } = useRecipeImport();
  const personalizeRecipeMutation = usePersonalizeRecipe();
  const { isPro, requireProFeature } = useSubscription();

  // Scroll tracking for header fade
  const titleOpacity = useSharedValue(1);

  const titleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.get(),
  }));

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const titleShouldHide = y > 5;
      titleOpacity.set(
        withTiming(titleShouldHide ? 0 : 1, {
          duration: 150,
        }),
      );
    },
    [titleOpacity],
  );

  const handleReviewImport = useCallback(
    (id: string) => {
      const importItem = backgroundImports.find((item) => item.id === id);
      if (importItem?.status !== "ready") return;

      navigate("RecipeDetail", {
        importJobId: importItem.id,
        mode: "edit",
      });
    },
    [backgroundImports, navigate],
  );

  const handleDismissImport = useCallback(
    (id: string) => {
      dismissImport(id).catch(() => {});
    },
    [dismissImport],
  );

  const onPressCreate = () => {
    navigate("RecipeDetail", { draft: true, mode: "edit" });
  };

  const onPressAIChef = async () => {
    const allowed = await requireProFeature("AI Chef");
    if (!allowed) return;
    navigate("GenerateRecipe");
  };

  const onPressPersonalise = async () => {
    const allowed = await requireProFeature("Personalise recipe");
    if (!allowed) return;
    recipeBrowserSheetRef.current?.present();
  };

  const handleSelectRecipeToPersonalise = async (recipeId: number) => {
    setSelectedPersonaliseRecipeId(recipeId);
    setTimeout(() => {
      personaliseRecipeSheetRef.current?.present();
    }, 350);
  };

  const handlePersonaliseRecipe = async (input: {
    goals: PersonalizationGoal[];
    allergyNotes?: string;
    customNotes?: string;
  }) => {
    if (!selectedPersonaliseRecipeId) {
      Alert.alert("Choose a recipe", "Select a recipe to personalise first.");
      return;
    }

    try {
      const result = await personalizeRecipeMutation.mutateAsync({
        recipeId: selectedPersonaliseRecipeId,
        goals: input.goals,
        allergyNotes: input.allergyNotes,
        customNotes: input.customNotes,
      });

      personaliseRecipeSheetRef.current?.dismiss();
      setSelectedPersonaliseRecipeId(null);
      navigate("RecipeDetail", {
        parsedRecipe: result as ParsedRecipe,
        mode: "edit",
      });
    } catch (error: unknown) {
      alertApiError("Personalisation Failed", error, {
        operation: "recipe.personalize",
        fallback: "Something went wrong while personalising the recipe.",
      });
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <VSpace size={insets.top + HEADER_HEIGHT + 8} />

        <RecipeImportBox />

        <RecipeImportList
          imports={backgroundImports}
          onReview={handleReviewImport}
          onDismiss={handleDismissImport}
        />

        <Text type="subheadline" style={styles.sectionTitle}>
          Or start another way
        </Text>
        <View style={styles.section}>
          <ActionRow
            icon="create-outline"
            label="Write it yourself"
            subtitle="Start from a blank recipe"
            onPress={onPressCreate}
          />
          <ActionRow
            icon="restaurant-outline"
            label="Ask the AI chef"
            subtitle="Describe a dish and get a recipe"
            isPro={!isPro}
            showSeparator
            onPress={onPressAIChef}
          />
          <ActionRow
            icon="color-wand-outline"
            label="Change a recipe"
            subtitle="Make one vegan, cheaper or quicker"
            isPro={!isPro}
            showSeparator
            onPress={onPressPersonalise}
          />
        </View>
      </ScrollView>

      {/* Fixed Header */}
      <View style={styles.fixedHeader}>
        <Animated.View style={titleAnimatedStyle}>
          <Text type="screenTitle">Add recipe</Text>
        </Animated.View>
      </View>

      {/* Sheets */}
      <RecipeBrowserSheet
        ref={recipeBrowserSheetRef}
        title="Choose a recipe"
        rowAccessibilityHint="Opens it to personalise"
        showAddButton={false}
        onSelectRecipe={handleSelectRecipeToPersonalise}
      />
      <PersonaliseRecipeSheet
        ref={personaliseRecipeSheetRef}
        isSubmitting={personalizeRecipeMutation.isPending}
        onSubmit={handlePersonaliseRecipe}
      />
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  container: {
    paddingBottom: rt.insets.bottom + 72,
  },
  fixedHeader: {
    position: "absolute",
    top: rt.insets.top,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    marginTop: 30,
    marginBottom: 2,
    marginHorizontal: 20,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.bold,
  },
  section: {
    marginHorizontal: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 16,
  },
  rowPressed: {
    opacity: 0.6,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.colors.primarySoft,
    justifyContent: "center",
    alignItems: "center",
  },
  icon: {
    color: theme.colors.primary,
  },
  textContainer: {
    flex: 1,
    gap: 1,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionLabel: {
    fontFamily: theme.fonts.bold,
  },
  badge: {
    backgroundColor: theme.colors.primarySoft,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 7,
  },
  badgeText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
  },
  subtitle: {
    color: theme.colors.textSecondary,
  },
  chevron: {
    color: theme.colors.textTertiary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: 56,
  },
}));
