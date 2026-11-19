import type { TrueSheet } from "@lodev09/react-native-true-sheet";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, Modal, Platform, Pressable, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import {
  StyleSheet,
  UnistylesRuntime,
  useUnistyles,
} from "react-native-unistyles";

import { ImportQueueList } from "./ImportQueue";

import {
  usePersonalizeRecipe,
  type ParsedRecipe,
  type PersonalizationGoal,
} from "@/api/recipe";
import { AppSheet } from "@/components/AppSheet";
import { Ionicons } from "@/components/Ionicons";
import {
  PersonaliseRecipeSheet,
  type PersonaliseRecipeSheetRef,
} from "@/components/PersonaliseRecipeSheet";
import {
  RecipeBrowserSheet,
  type RecipeBrowserSheetRef,
} from "@/components/RecipeBrowserSheet";
import { Text } from "@/components/Text";
import { GlassSurface } from "@/components/glass/Glass";
import { SignatureIcon } from "@/components/icons/SignatureIcon";
import type { SignatureIconName } from "@/components/icons/signatureIcons";
import {
  BasicImportSheet,
  type BasicImportSheetRef,
} from "@/features/recipe-import/BasicImportSheet";
import { useRecipeImport } from "@/features/recipe-import/RecipeImportProvider";
import {
  SmartImportSheet,
  type SmartImportSheetRef,
} from "@/features/recipe-import/SmartImportSheet";
import { alertApiError } from "@/lib/apiErrorAlert";
import { useSubscription } from "@/lib/subscription";
import { navigationRef } from "@/navigation/navigationRef";

// The iOS 26 tab bar floats ~62pt tall above the home indicator inset; the
// menu sits just above it, aligned with the separate + button on the right.
const MENU_BOTTOM_OFFSET = 74;
const TOAST_DURATION_MS = 4000;

export interface AddRecipeActions {
  basicImport: () => void;
  smartImport: () => Promise<void>;
  aiChef: () => Promise<void>;
  personalise: () => Promise<void>;
  createFromScratch: () => void;
}

interface AddRecipeContextValue {
  actions: AddRecipeActions;
  /** Opens the glass add menu (iOS + button). */
  openAddMenu: () => void;
  /** Opens the sheet listing imports in progress / ready to review. */
  openImportQueue: () => void;
  /** Shows a short "Importing…" toast with a shortcut to the queue. */
  notifyImportStarted: () => void;
}

const AddRecipeContext = createContext<AddRecipeContextValue | null>(null);

export const useAddRecipe = () => {
  const context = useContext(AddRecipeContext);
  if (!context) {
    throw new Error("useAddRecipe must be used within AddRecipeProvider");
  }
  return context;
};

type MenuIcon =
  keyof typeof Ionicons.glyphMap | { signature: SignatureIconName };

type MenuRowProps = {
  icon: MenuIcon;
  label: string;
  badge?: string;
  onPress: () => void;
  showSeparator: boolean;
};

const MenuRow = ({
  icon,
  label,
  badge,
  onPress,
  showSeparator,
}: MenuRowProps) => (
  <Pressable
    accessibilityRole="menuitem"
    accessibilityLabel={badge ? `${label}, ${badge}` : label}
    onPress={onPress}
    style={({ pressed }) => [
      styles.menuRow,
      showSeparator && styles.menuRowSeparator,
      pressed && styles.menuRowPressed,
    ]}
  >
    <Text type="body" style={styles.menuRowLabel}>
      {label}
    </Text>
    {badge ? (
      <View style={styles.menuBadge}>
        <Text type="caption" style={styles.menuBadgeText}>
          {badge}
        </Text>
      </View>
    ) : null}
    {typeof icon === "string" ? (
      <Ionicons name={icon} size={20} style={styles.menuRowIcon} />
    ) : (
      <MenuSignatureIcon name={icon.signature} />
    )}
  </Pressable>
);

const MenuSignatureIcon = ({ name }: { name: SignatureIconName }) => {
  const { theme } = useUnistyles();
  return <SignatureIcon name={name} size={22} color={theme.colors.text} />;
};

export const AddRecipeProvider = ({ children }: { children: ReactNode }) => {
  const insets = UnistylesRuntime.insets;

  const smartImportSheetRef = useRef<SmartImportSheetRef>(null);
  const basicImportSheetRef = useRef<BasicImportSheetRef>(null);
  const recipeBrowserSheetRef = useRef<RecipeBrowserSheetRef>(null);
  const personaliseRecipeSheetRef = useRef<PersonaliseRecipeSheetRef>(null);
  const importQueueSheetRef = useRef<TrueSheet>(null);

  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [selectedPersonaliseRecipeId, setSelectedPersonaliseRecipeId] =
    useState<number | null>(null);
  const pendingMenuActionRef = useRef<(() => void) | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { imports, pendingCount, readyCount } = useRecipeImport();
  const personalizeRecipeMutation = usePersonalizeRecipe();
  const {
    isPro,
    smartImportsRemaining,
    smartImportsLimit,
    requireSmartImport,
    requireProFeature,
  } = useSubscription();

  const actions = useMemo<AddRecipeActions>(
    () => ({
      basicImport: () => basicImportSheetRef.current?.present(),
      smartImport: async () => {
        const allowed = await requireSmartImport();
        if (!allowed) return;
        smartImportSheetRef.current?.present();
      },
      aiChef: async () => {
        const allowed = await requireProFeature("AI Chef");
        if (!allowed || !navigationRef.isReady()) return;
        navigationRef.navigate("GenerateRecipe");
      },
      personalise: async () => {
        const allowed = await requireProFeature("Personalise recipe");
        if (!allowed) return;
        recipeBrowserSheetRef.current?.present();
      },
      createFromScratch: () => {
        if (!navigationRef.isReady()) return;
        navigationRef.navigate("RecipeDetail", { draft: true, mode: "edit" });
      },
    }),
    [requireProFeature, requireSmartImport],
  );

  const openImportQueue = useCallback(() => {
    importQueueSheetRef.current?.present();
  }, []);

  const openAddMenu = useCallback(() => setIsMenuVisible(true), []);

  // Sheets can't present while the menu's modal is still dismissing, so menu
  // actions run once it has gone (onDismiss on iOS; Android has no such event).
  const runAfterMenuCloses = useCallback((action: () => void) => {
    pendingMenuActionRef.current = action;
    setIsMenuVisible(false);
    if (Platform.OS !== "ios") {
      setTimeout(() => {
        const pending = pendingMenuActionRef.current;
        pendingMenuActionRef.current = null;
        pending?.();
      }, 250);
    }
  }, []);

  const handleMenuDismissed = useCallback(() => {
    const pending = pendingMenuActionRef.current;
    pendingMenuActionRef.current = null;
    pending?.();
  }, []);

  const notifyImportStarted = useCallback(() => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setIsToastVisible(true);
    toastTimeoutRef.current = setTimeout(() => {
      setIsToastVisible(false);
      toastTimeoutRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    },
    [],
  );

  const handleToastPress = useCallback(() => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = null;
    setIsToastVisible(false);
    openImportQueue();
  }, [openImportQueue]);

  const handleSelectRecipeToPersonalise = useCallback((recipeId: number) => {
    setSelectedPersonaliseRecipeId(recipeId);
    setTimeout(() => {
      personaliseRecipeSheetRef.current?.present();
    }, 350);
  }, []);

  const handlePersonaliseRecipe = useCallback(
    async (input: {
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
        if (navigationRef.isReady()) {
          navigationRef.navigate("RecipeDetail", {
            parsedRecipe: result as ParsedRecipe,
            mode: "edit",
          });
        }
      } catch (error: unknown) {
        alertApiError("Personalisation Failed", error, {
          operation: "recipe.personalize",
          fallback: "Something went wrong while personalising the recipe.",
        });
      }
    },
    [personalizeRecipeMutation, selectedPersonaliseRecipeId],
  );

  const contextValue = useMemo<AddRecipeContextValue>(
    () => ({ actions, openAddMenu, openImportQueue, notifyImportStarted }),
    [actions, openAddMenu, openImportQueue, notifyImportStarted],
  );

  const smartImportBadge = isPro
    ? undefined
    : `${smartImportsRemaining ?? 0}/${smartImportsLimit ?? 5} left`;
  const importsBadge =
    readyCount > 0 ? `${readyCount} ready` : pendingCount > 0 ? "Working" : "";

  const menuRows: Omit<MenuRowProps, "showSeparator">[] = [
    ...(imports.length > 0
      ? [
          {
            icon: "time-outline" as const,
            label: "Imports",
            badge: importsBadge,
            onPress: () => runAfterMenuCloses(openImportQueue),
          },
        ]
      : []),
    {
      icon: "link-outline",
      label: "Import from link",
      onPress: () => runAfterMenuCloses(actions.basicImport),
    },
    {
      icon: { signature: "smartImport" },
      label: "Smart import",
      badge: smartImportBadge,
      onPress: () => runAfterMenuCloses(actions.smartImport),
    },
    {
      icon: "restaurant-outline",
      label: "AI Chef",
      badge: isPro ? undefined : "Pro",
      onPress: () => runAfterMenuCloses(actions.aiChef),
    },
    {
      icon: "color-wand-outline",
      label: "Personalise a recipe",
      badge: isPro ? undefined : "Pro",
      onPress: () => runAfterMenuCloses(actions.personalise),
    },
    {
      icon: "create-outline",
      label: "Write it yourself",
      onPress: () => runAfterMenuCloses(actions.createFromScratch),
    },
  ];

  return (
    <AddRecipeContext.Provider value={contextValue}>
      <View style={styles.root}>
        {children}

        {isToastVisible ? (
          <Animated.View
            entering={FadeInUp.duration(220)}
            exiting={FadeOutUp.duration(180)}
            style={[styles.toastContainer, { top: insets.top + 8 }]}
            pointerEvents="box-none"
          >
            <GlassSurface interactive style={styles.toast}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Importing your recipe. View imports"
                onPress={handleToastPress}
                style={styles.toastContent}
              >
                <Ionicons name="sparkles" size={18} style={styles.toastIcon} />
                <Text type="subheadline" style={styles.toastText}>
                  Importing your recipe…
                </Text>
                <Text type="subheadline" style={styles.toastAction}>
                  View
                </Text>
              </Pressable>
            </GlassSurface>
          </Animated.View>
        ) : null}
      </View>

      <Modal
        visible={isMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsMenuVisible(false)}
        onDismiss={handleMenuDismissed}
      >
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => setIsMenuVisible(false)}
          accessibilityLabel="Close add menu"
        />
        <View
          style={[
            styles.menuAnchor,
            { bottom: insets.bottom + MENU_BOTTOM_OFFSET },
          ]}
          pointerEvents="box-none"
        >
          <GlassSurface style={styles.menu}>
            <View accessibilityRole="menu" accessibilityLabel="Add a recipe">
              {menuRows.map((row, index) => (
                <MenuRow key={row.label} {...row} showSeparator={index > 0} />
              ))}
            </View>
          </GlassSurface>
        </View>
      </Modal>

      <SmartImportSheet ref={smartImportSheetRef} />
      <BasicImportSheet ref={basicImportSheetRef} />
      <RecipeBrowserSheet
        ref={recipeBrowserSheetRef}
        title="Choose Recipe"
        onSelectRecipe={handleSelectRecipeToPersonalise}
      />
      <PersonaliseRecipeSheet
        ref={personaliseRecipeSheetRef}
        isSubmitting={personalizeRecipeMutation.isPending}
        onSubmit={handlePersonaliseRecipe}
      />
      <AppSheet ref={importQueueSheetRef} title="Imports" detents={["auto"]}>
        <View style={styles.queueSheetContent}>
          {imports.length > 0 ? (
            <ImportQueueList
              onReview={() => importQueueSheetRef.current?.dismiss()}
            />
          ) : (
            <Text type="bodyFaded" style={styles.queueEmpty}>
              No imports right now.
            </Text>
          )}
        </View>
      </AppSheet>
    </AddRecipeContext.Provider>
  );
};

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.12)",
  },
  menuAnchor: {
    position: "absolute",
    right: 16,
    width: 280,
  },
  menu: {
    borderRadius: 28,
    overflow: "hidden",
  },
  menuRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
  },
  menuRowSeparator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  menuRowPressed: {
    backgroundColor: theme.colors.pressHighlight,
  },
  menuRowLabel: {
    flex: 1,
  },
  menuRowIcon: {
    color: theme.colors.text,
  },
  menuBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary + "1F",
  },
  menuBadgeText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.semiBold,
    fontVariant: ["tabular-nums"],
  },
  toastContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toast: {
    borderRadius: 24,
    overflow: "hidden",
  },
  toastContent: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  toastIcon: {
    color: theme.colors.primary,
  },
  toastText: {
    color: theme.colors.text,
  },
  toastAction: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.semiBold,
    marginLeft: 6,
  },
  queueSheetContent: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  queueEmpty: {
    textAlign: "center",
    paddingVertical: 24,
  },
}));
