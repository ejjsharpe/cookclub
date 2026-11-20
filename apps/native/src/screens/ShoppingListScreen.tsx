import { useIsFocused, useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import {
  useMemo,
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  memo,
  useRef,
} from "react";
import {
  View,
  Pressable,
  TextInput,
  AccessibilityInfo,
  Alert,
  FlatList,
  Platform,
  type ListRenderItemInfo,
} from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useAnimatedReaction,
  interpolate,
  interpolateColor,
  Extrapolation,
  LinearTransition,
  type SharedValue,
} from "react-native-reanimated";
import {
  useUnistyles,
  StyleSheet,
  UnistylesRuntime,
} from "react-native-unistyles";

import {
  useGetShoppingList,
  useGetUserShoppingLists,
  useGetShoppingListShareStatus,
  useToggleItemChecked,
  useRemoveItem,
  useClearCheckedItems,
  useRemoveRecipeFromList,
  useAddManualItem,
  useGetPendingShoppingListInvitations,
  useAcceptShoppingListInvitation,
  useDeclineShoppingListInvitation,
} from "@/api/shopping";
import { InvitationBanner } from "@/components/InvitationBanner";
import { Ionicons } from "@/components/Ionicons";
import { ShoppingListSkeleton, SkeletonContainer } from "@/components/Skeleton";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { GlassSurface } from "@/components/glass/Glass";
import {
  AddRecipeToShoppingListSheet,
  type AddRecipeToShoppingListSheetRef,
} from "@/components/shopping/AddRecipeToShoppingListSheet";
import {
  ShoppingListExportSheet,
  type ShoppingListExportSheetRef,
} from "@/components/shopping/ShoppingListExportSheet";
import { ShoppingListMenu } from "@/components/shopping/ShoppingListMenu";
import {
  ShoppingListPickerSheet,
  type ShoppingListPickerSheetRef,
} from "@/components/shopping/ShoppingListPickerSheet";
import { ShoppingListRecipeStrip } from "@/components/shopping/ShoppingListRecipeStrip";
import { ShoppingListSectionHeader } from "@/components/shopping/ShoppingListSectionHeader";
import {
  ShoppingListShareSheet,
  type ShoppingListShareSheetRef,
} from "@/components/shopping/ShoppingListShareSheet";
import {
  useShoppingListData,
  type ShoppingListItem,
  type ShoppingListRow,
} from "@/hooks/useShoppingListData";
import {
  itemName,
  itemQuantity,
  tickedRowIds,
  type ShoppingListRecipe,
} from "@/lib/shoppingListGroups";
import {
  useSelectedShoppingList,
  useShoppingListView,
} from "@/lib/shoppingListPreferences";
import { TAB_BAR_HEIGHT } from "@/navigation/tabBar";

const INPUT_SECTION_HEIGHT = 66;
// On iOS the title and the ••• sit in the tab's native navigation bar, as on
// the recipe screen. Android draws the same row itself.
const IS_IOS = Platform.OS === "ios";
const NAV_BAR_HEIGHT = IS_IOS ? 44 : 8;
const TITLE_ROW_HEIGHT = IS_IOS ? 0 : 48;
const ROUND_BUTTON_SIZE = 44;
const CHECK_SIZE = 22;
const ROW_PADDING = 20;
// How far the rounded swipe highlight reaches past the row's content
const ROW_INSET = 8;
const ReanimatedFlatList = Animated.createAnimatedComponent(
  FlatList<ShoppingListRow>,
);

interface SwipeableItemProps {
  item: ShoppingListItem;
  showSeparator: boolean;
  onToggle: (item: ShoppingListItem) => void;
  onRemove: (item: ShoppingListItem) => void;
}

const DeleteAction = ({
  swipeProgress,
  onRemove,
}: {
  swipeProgress: SharedValue<number>;
  onRemove: () => void;
}) => {
  const deleteButtonStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      swipeProgress.get(),
      [0.5, 0.7, 1, 1.2],
      [0, 0.5, 1, 1.05],
      Extrapolation.CLAMP,
    );
    const overSwipeScale = interpolate(
      swipeProgress.get(),
      [1.15, 1.4],
      [1, 1.08],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ scale: scale * overSwipeScale }],
      opacity: interpolate(
        swipeProgress.get(),
        [0.5, 0.6],
        [0, 1],
        Extrapolation.CLAMP,
      ),
    };
  });

  // The pill stretches on over-swipe
  const pillStyle = useAnimatedStyle(() => ({
    width: interpolate(swipeProgress.get(), [1, 1.3], [60, 83], {
      extrapolateLeft: Extrapolation.CLAMP,
      extrapolateRight: Extrapolation.EXTEND,
    }),
  }));

  return (
    <View style={styles.deleteActionContainer}>
      <Animated.View style={deleteButtonStyle}>
        <Animated.View style={[styles.deleteActionPill, pillStyle]}>
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel="Delete"
            hitSlop={8}
          >
            <Ionicons name="trash" size={20} color="#fff" />
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const ItemContent = ({
  item,
  showSeparator,
  swipeProgress,
  onToggle,
  onRemove,
}: {
  item: ShoppingListItem;
  showSeparator: boolean;
  swipeProgress: SharedValue<number>;
  onToggle: () => void;
  onRemove: () => void;
}) => {
  const { theme } = useUnistyles();
  const name = itemName(item);
  const quantity = itemQuantity(item);

  const backgroundStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      swipeProgress.get(),
      [0, 1],
      [theme.colors.background, theme.colors.inputBackground],
    ),
  }));

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.isChecked }}
      accessibilityLabel={quantity ? `${name}, ${quantity}` : name}
      // Swipe-to-delete for screen readers
      accessibilityActions={[{ name: "delete", label: "Delete" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "delete") onRemove();
      }}
    >
      {({ pressed }) => (
        <View style={styles.itemRow}>
          {showSeparator && <View style={styles.separator} />}
          {/* Inset and rounded, so the swipe highlight stands clear of the
              delete button that slides in beside it */}
          <Animated.View
            style={[
              styles.itemInner,
              backgroundStyle,
              pressed && styles.itemPressed,
            ]}
          >
            <View style={styles.checkbox(item.isChecked)}>
              {item.isChecked && (
                <Ionicons name="checkmark" size={15} style={styles.checkIcon} />
              )}
            </View>
            <Text style={styles.itemText(item.isChecked)} numberOfLines={2}>
              {name}
              {quantity ? (
                <Text style={styles.itemQuantity(item.isChecked)}>
                  {`  ${quantity}`}
                </Text>
              ) : null}
            </Text>
          </Animated.View>
        </View>
      )}
    </Pressable>
  );
};

const ProgressSyncer = ({
  source,
  target,
}: {
  source: SharedValue<number>;
  target: SharedValue<number>;
}) => {
  useAnimatedReaction(
    () => source.get(),
    (value) => {
      target.set(value);
    },
  );
  return null;
};

const SwipeableItem = memo(
  ({ item, showSeparator, onToggle, onRemove }: SwipeableItemProps) => {
    const swipeProgress = useSharedValue(0);

    const renderRightActions = useCallback(
      (progress: SharedValue<number>) => (
        <>
          <ProgressSyncer source={progress} target={swipeProgress} />
          <DeleteAction
            swipeProgress={progress}
            onRemove={() => onRemove(item)}
          />
        </>
      ),
      [item, onRemove, swipeProgress],
    );

    return (
      <Swipeable
        renderRightActions={renderRightActions}
        overshootRight
        overshootLeft
        friction={2}
      >
        <ItemContent
          item={item}
          showSeparator={showSeparator}
          swipeProgress={swipeProgress}
          onToggle={() => onToggle(item)}
          onRemove={() => onRemove(item)}
        />
      </Swipeable>
    );
  },
);

SwipeableItem.displayName = "SwipeableItem";

const LIST_BOTTOM_CLEARANCE = 200;
const KEYBOARD_OPEN_INPUT_GAP = 4;

export const ShoppingListScreen = () => {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = UnistylesRuntime.insets;
  const { theme } = useUnistyles();
  const addRecipeSheetRef = useRef<AddRecipeToShoppingListSheetRef>(null);
  const shareSheetRef = useRef<ShoppingListShareSheetRef>(null);
  const exportSheetRef = useRef<ShoppingListExportSheetRef>(null);
  const listPickerSheetRef = useRef<ShoppingListPickerSheetRef>(null);
  const [manualItemText, setManualItemText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTicked, setShowTicked] = useState(false);
  const [view, setView] = useShoppingListView();

  // Multi-list selection
  const {
    selectedList: storedList,
    setSelectedList,
    clearSelectedList,
  } = useSelectedShoppingList();
  const { data: allLists } = useGetUserShoppingLists();
  const { height: keyboardHeight, progress: keyboardSwipeProgress } =
    useReanimatedKeyboardAnimation();
  const listRef = useRef<FlatList<ShoppingListRow>>(null);

  // Base padding for when keyboard is closed and tab bar is visible
  const bottomSystemInset =
    process.env.EXPO_OS === "android" ? insets.bottom : 0;
  const basePadding = TAB_BAR_HEIGHT + bottomSystemInset + 12;

  const inputTransformAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(
      keyboardSwipeProgress.get(),
      [0, 1],
      [basePadding, 0],
    ),
  }));

  // KeyboardStickyView in keyboard-controller 1.21.6 still uses the legacy
  // Animated path, which can apply the keyboard translation in the wrong
  // direction on RN 0.85. Drive the same translation from its Reanimated
  // values so the input remains attached to the top of the keyboard.
  const inputKeyboardAnimatedStyle = useAnimatedStyle(() => {
    const openedOffset = interpolate(
      keyboardSwipeProgress.get(),
      [0, 1],
      [0, -KEYBOARD_OPEN_INPUT_GAP],
    );
    return {
      transform: [{ translateY: keyboardHeight.get() + openedOffset }],
    };
  });

  const headerOffset = insets.top + NAV_BAR_HEIGHT + TITLE_ROW_HEIGHT;

  // Keep the empty state centred between the header and the input
  const emptyStateAnimatedStyle = useAnimatedStyle(() => {
    const bottomOffset =
      INPUT_SECTION_HEIGHT +
      interpolate(keyboardSwipeProgress.get(), [0, 1], [0, basePadding]);
    return {
      transform: [{ translateY: headerOffset - bottomOffset }],
    };
  });

  // Compute active list from stored selection or fall back to default
  const activeList = useMemo(() => {
    if (!allLists || allLists.length === 0) return null;

    if (storedList !== null) {
      const foundList = allLists.find((l) => l.id === storedList.id);
      if (foundList) return foundList;
      clearSelectedList();
    }

    const defaultList = allLists.find((l) => l.isDefault);
    return defaultList ?? allLists[0];
  }, [allLists, storedList, clearSelectedList]);

  const { data, isLoading, error } = useGetShoppingList(
    activeList ? { shoppingListId: activeList.id } : undefined,
  );
  const { data: members } = useGetShoppingListShareStatus({
    shoppingListId: activeList?.id ?? 0,
    enabled: Boolean(activeList?.isOwner && !activeList.isDefault),
  });
  // Only the stable `mutate` functions, so the list's callbacks (and so every
  // row) don't change each time a mutation starts or settles.
  const { mutate: toggleItem } = useToggleItemChecked(
    activeList ? { shoppingListId: activeList.id } : undefined,
  );
  const { mutate: removeItem } = useRemoveItem();
  const { mutate: clearChecked } = useClearCheckedItems();
  const { mutate: removeRecipe } = useRemoveRecipeFromList();
  const addManualMutation = useAddManualItem();
  const { data: pendingInvitations } = useGetPendingShoppingListInvitations();
  const acceptInvitation = useAcceptShoppingListInvitation();
  const declineInvitation = useDeclineShoppingListInvitation();

  const items = useMemo(
    () => (data?.items ?? []) as ShoppingListItem[],
    [data?.items],
  );
  const recipes: ShoppingListRecipe[] = useMemo(
    () => data?.recipes ?? [],
    [data?.recipes],
  );
  const listName = activeList?.name ?? "Shopping list";
  const { sections, rows } = useShoppingListData({
    items,
    recipes,
    view,
    showTicked,
  });

  // Counts follow the rows on screen: By recipe counts each recipe's share,
  // By aisle counts whole items (ticked once every share is).
  const viewItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );
  const checkedCount = viewItems.filter((item) => item.isChecked).length;
  const leftCount = viewItems.length - checkedCount;
  // Clearing removes every ticked share, even of an item still partly needed
  const hasTickedRows = useMemo(() => tickedRowIds(items).length > 0, [items]);

  // "10 to get · with Mei"
  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (viewItems.length) {
      parts.push(leftCount ? `${leftCount} to get` : "All got");
      if (checkedCount && leftCount) parts.push(`${checkedCount} ticked`);
    }
    const others = activeList?.isOwner
      ? (members ?? []).map((m) => m.userName.split(" ")[0])
      : activeList
        ? [activeList.owner.name.split(" ")[0]]
        : [];
    if (others.length) {
      parts.push(
        `with ${others.length > 2 ? `${others.length} people` : others.join(" and ")}`,
      );
    }
    return parts.join(" · ");
  }, [viewItems.length, leftCount, checkedCount, activeList, members]);

  // Ticked items go back to hidden when the list is cleared or switched
  const activeListId = activeList?.id;
  useEffect(() => {
    setShowTicked(false);
  }, [activeListId]);
  useEffect(() => {
    if (!hasTickedRows) setShowTicked(false);
  }, [hasTickedRows]);

  // An item can stand for several rows (one per recipe that needs it), so
  // every row changes together and to the same state.
  const handleToggleCheck = useCallback(
    (item: ShoppingListItem) => {
      const isChecked = !item.isChecked;
      toggleItem({
        itemId: item.id,
        itemIds: item.sourceItems.map((source) => source.id),
        isChecked,
      });
      // A ticked item disappears unless ticked items are shown
      if (isChecked && !showTicked) {
        AccessibilityInfo.announceForAccessibility(
          `${itemName(item)} ticked and hidden`,
        );
      }
    },
    [toggleItem, showTicked],
  );

  const handleRemoveItem = useCallback(
    (item: ShoppingListItem) => {
      if (!activeListId) return;
      removeItem({
        itemId: item.id,
        itemIds: item.sourceItems.map((source) => source.id),
        shoppingListId: activeListId,
      });
    },
    [activeListId, removeItem],
  );

  const handleClearChecked = useCallback(() => {
    if (!hasTickedRows || !activeList) return;

    Alert.alert(
      "Clear ticked items",
      "Everything you've ticked comes off the list. Anything still needed for another recipe stays.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            clearChecked({ shoppingListId: activeList.id });
          },
        },
      ],
    );
  }, [activeList, hasTickedRows, clearChecked]);

  const handleOpenRecipe = useCallback(
    (recipe: ShoppingListRecipe) =>
      navigation.navigate("RecipeDetail", { recipeId: recipe.id }),
    [navigation],
  );

  const handleRemoveRecipe = useCallback(
    (recipe: ShoppingListRecipe) => {
      if (!activeList) return;
      Alert.alert(
        `Remove ${recipe.name}?`,
        "Its ingredients come off the list. Anything you added yourself stays.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () =>
              removeRecipe({
                recipeId: recipe.id,
                shoppingListId: activeList.id,
              }),
          },
        ],
      );
    },
    [activeList, removeRecipe],
  );

  const handleAddRecipe = useCallback(
    () => addRecipeSheetRef.current?.present(),
    [],
  );

  const handleRecipeMore = useCallback(
    (recipe: ShoppingListRecipe) => {
      if (!activeList) return;
      Alert.alert(recipe.name, undefined, [
        {
          text: "View recipe",
          onPress: () =>
            navigation.navigate("RecipeDetail", { recipeId: recipe.id }),
        },
        {
          text: "Remove from list",
          style: "destructive",
          onPress: () =>
            removeRecipe({
              recipeId: recipe.id,
              shoppingListId: activeList.id,
            }),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [activeList, navigation, removeRecipe],
  );

  const handleAddManualItem = useCallback(() => {
    if (!manualItemText.trim() || !activeList) return;

    addManualMutation.mutate(
      {
        ingredientText: manualItemText.trim(),
        shoppingListId: activeList.id,
      },
      {
        onSuccess: () => {
          setManualItemText("");
        },
      },
    );
  }, [activeList, addManualMutation, manualItemText]);

  // Pending list ID for newly created lists that aren't in the query cache yet
  const [pendingListId, setPendingListId] = useState<number | null>(null);

  // Once the query refetches and the pending list appears, select it
  useEffect(() => {
    if (pendingListId === null || !allLists) return;
    const list = allLists.find((l) => l.id === pendingListId);
    if (list) {
      setSelectedList(list.id, list.name);
      setPendingListId(null);
    }
  }, [pendingListId, allLists, setSelectedList]);

  const handleSelectShoppingList = useCallback(
    (listId: number) => {
      const list = allLists?.find((l) => l.id === listId);
      if (list) {
        setSelectedList(listId, list.name);
      } else {
        // New list not in cache yet — wait for query to refetch
        setPendingListId(listId);
      }
    },
    [allLists, setSelectedList],
  );

  const handleOpenListPicker = useCallback(() => {
    listPickerSheetRef.current?.present();
  }, []);

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  useEffect(() => {
    // @ts-expect-error navigation type
    const unsubscribe = navigation.addListener("tabPress", () => {
      if (isFocused) {
        scrollToTop();
      }
    });

    return unsubscribe;
  }, [navigation, isFocused, scrollToTop]);

  const handleShareWithSomeone = useCallback(() => {
    if (activeList?.isDefault && activeList?.isOwner) {
      Alert.alert(
        "Can't share this list",
        "Your default shopping list is just for you. Make a new list to share it with friends.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "New list",
            onPress: () => listPickerSheetRef.current?.present(),
          },
        ],
      );
      return;
    }
    shareSheetRef.current?.present();
  }, [activeList]);

  // The native ••• menu in the navigation bar, like the recipe screen's
  useLayoutEffect(() => {
    if (!IS_IOS) return;
    const action = (
      label: string,
      symbol: string,
      onPress: () => void,
      extra: Record<string, unknown> = {},
    ) => ({
      type: "action" as const,
      label,
      icon: { type: "sfSymbol" as const, name: symbol },
      onPress,
      ...extra,
    });
    const items: any[] = [
      {
        type: "submenu" as const,
        // An untitled inline section, shown as a divider
        label: "",
        inline: true,
        items: [
          action("Share list", "square.and.arrow.up", () =>
            exportSheetRef.current?.present(),
          ),
          action(
            "Share with someone",
            "person.badge.plus",
            handleShareWithSomeone,
          ),
          action("Add a recipe", "plus", () =>
            addRecipeSheetRef.current?.present(),
          ),
        ],
      },
      {
        type: "submenu" as const,
        label: "Group by",
        inline: true,
        items: [
          action("By aisle", "cart", () => setView("aisle"), {
            state: view === "aisle" ? "on" : "off",
          }),
          action("By recipe", "fork.knife", () => setView("recipe"), {
            state: view === "recipe" ? "on" : "off",
          }),
        ],
      },
    ];
    const tickedActions = [
      // Shown while anything ticked could be on screen, so a hidden row can
      // always be brought back to untick it
      ...(checkedCount > 0 || showTicked
        ? [
            action(
              `Show ticked (${checkedCount})`,
              "checkmark.circle",
              () => setShowTicked((v) => !v),
              { state: showTicked ? "on" : "off" },
            ),
          ]
        : []),
      ...(hasTickedRows
        ? [
            action("Clear ticked", "trash", handleClearChecked, {
              destructive: true,
            }),
          ]
        : []),
    ];
    if (tickedActions.length) {
      items.push({
        type: "submenu" as const,
        // An untitled inline section, shown as a divider
        label: "",
        inline: true,
        items: tickedActions,
      });
    }
    navigation.setOptions({
      unstable_headerLeftItems: () => [
        {
          type: "custom" as const,
          hidesSharedBackground: true,
          element: (
            <Pressable
              style={styles.barTitle}
              onPress={handleOpenListPicker}
              accessibilityRole="button"
              accessibilityHint="Switch shopping list"
            >
              <Text type="screenTitle" numberOfLines={1} style={styles.title}>
                {listName}
              </Text>
              <Ionicons
                name="chevron-down"
                size={20}
                style={styles.titleChevron}
              />
            </Pressable>
          ),
        },
      ],
      unstable_headerRightItems: () => [
        {
          type: "menu" as const,
          label: "List options",
          icon: { type: "sfSymbol" as const, name: "ellipsis" },
          menu: { items },
        },
      ],
    } as never);
  }, [
    navigation,
    listName,
    handleOpenListPicker,
    view,
    setView,
    checkedCount,
    hasTickedRows,
    showTicked,
    handleClearChecked,
    handleShareWithSomeone,
  ]);

  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<ShoppingListRow>) => {
      if (row.type === "section-header") {
        return (
          <Animated.View layout={LinearTransition}>
            <ShoppingListSectionHeader
              title={row.title}
              recipe={row.recipe}
              isFirst={row.isFirst}
              onRecipeMore={handleRecipeMore}
            />
          </Animated.View>
        );
      }
      return (
        <Animated.View layout={LinearTransition}>
          <SwipeableItem
            item={row.item}
            showSeparator={!row.isFirstInSection}
            onToggle={handleToggleCheck}
            onRemove={handleRemoveItem}
          />
        </Animated.View>
      );
    },
    [handleToggleCheck, handleRemoveItem, handleRecipeMore],
  );

  const keyExtractor = useCallback((row: ShoppingListRow) => row.id, []);

  const renderEmpty = () => {
    if (error) {
      return (
        <Animated.View style={[styles.centered, emptyStateAnimatedStyle]}>
          <Text type="bodyFaded">Failed to load shopping list</Text>
        </Animated.View>
      );
    }

    // Everything is ticked and hidden
    if (items.length > 0) {
      return (
        <Animated.View style={[styles.centered, emptyStateAnimatedStyle]}>
          <Ionicons name="checkmark-circle" size={56} style={styles.doneIcon} />
          <VSpace size={12} />
          <Text type="heading">You've got everything</Text>
        </Animated.View>
      );
    }

    return (
      <Animated.View style={[styles.centered, emptyStateAnimatedStyle]}>
        <Ionicons name="cart-outline" size={56} style={styles.emptyIcon} />
        <VSpace size={12} />
        <Text type="heading">Your shopping list is empty</Text>
        <VSpace size={6} />
        <Text type="bodyFaded" style={styles.emptyText}>
          Type an item below, or add a recipe's ingredients with the + above
        </Text>
      </Animated.View>
    );
  };

  const listHeaderComponent = useMemo(
    () => (
      <View>
        <VSpace size={insets.top + NAV_BAR_HEIGHT} />
        {!IS_IOS && (
          <View style={styles.titleRow}>
            <Pressable
              style={styles.titleButton}
              onPress={handleOpenListPicker}
              accessibilityRole="button"
              accessibilityHint="Switch shopping list"
            >
              <Text type="screenTitle" numberOfLines={1} style={styles.title}>
                {listName}
              </Text>
              <Ionicons
                name="chevron-down"
                size={20}
                style={styles.titleChevron}
              />
            </Pressable>
            {!IS_IOS && (
              <Pressable
                onPress={() => setMenuOpen(true)}
                style={({ pressed }) => [
                  styles.roundButton,
                  pressed && styles.roundButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="List options"
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={22}
                  style={styles.headerIcon}
                />
              </Pressable>
            )}
          </View>
        )}
        {subtitle ? (
          <Text type="subheadline" style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
        <ShoppingListRecipeStrip
          recipes={recipes}
          onOpenRecipe={handleOpenRecipe}
          onRemoveRecipe={handleRemoveRecipe}
          onAddRecipe={handleAddRecipe}
        />
        {pendingInvitations?.map((invitation) => (
          <InvitationBanner
            key={invitation.id}
            inviterName={invitation.inviterName}
            inviterImage={invitation.inviterImage}
            resourceName={invitation.shoppingListName}
            onAccept={() =>
              acceptInvitation.mutate({ invitationId: invitation.id })
            }
            onDecline={() =>
              declineInvitation.mutate({ invitationId: invitation.id })
            }
            isAccepting={acceptInvitation.isPending}
            isDeclining={declineInvitation.isPending}
          />
        ))}
      </View>
    ),
    [
      insets.top,
      listName,
      handleOpenListPicker,
      subtitle,
      recipes,
      handleOpenRecipe,
      handleRemoveRecipe,
      handleAddRecipe,
      pendingInvitations,
      acceptInvitation,
      declineInvitation,
    ],
  );

  const canAdd = manualItemText.trim().length > 0;

  return (
    <View style={styles.screen}>
      <SkeletonContainer
        isLoading={isLoading}
        skeleton={
          <FlatList
            data={[]}
            renderItem={() => null}
            ListHeaderComponent={listHeaderComponent}
            ListEmptyComponent={ShoppingListSkeleton}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: LIST_BOTTOM_CLEARANCE }}
          />
        }
      >
        <ReanimatedFlatList
          ref={listRef}
          data={rows}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={listHeaderComponent}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            paddingBottom: LIST_BOTTOM_CLEARANCE,
            ...(rows.length === 0 && { flexGrow: 1 }),
          }}
          windowSize={5}
        />
      </SkeletonContainer>

      {/* Bottom input - sticks to the keyboard */}
      <Animated.View
        style={[styles.inputWrapper, inputKeyboardAnimatedStyle]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={inputTransformAnimatedStyle}
          pointerEvents="box-none"
        >
          <LinearGradient
            colors={[
              `${theme.colors.background}00`,
              theme.colors.background,
              theme.colors.background,
            ]}
            locations={[0, 0.45, 1]}
            style={styles.inputGradient}
            pointerEvents="box-none"
          >
            {/* The row layout goes on both: the blur fallback lays out children itself */}
            <GlassSurface
              style={[styles.inputGlass, styles.inputRow]}
              contentStyle={styles.inputRowContent}
            >
              <TextInput
                style={styles.input}
                placeholder="Add an item"
                value={manualItemText}
                onChangeText={setManualItemText}
                onSubmitEditing={handleAddManualItem}
                returnKeyType="done"
                submitBehavior="submit"
                autoCapitalize="none"
                placeholderTextColor={theme.colors.textSecondary}
                accessibilityLabel="Add an item"
              />
              {canAdd && (
                <Pressable
                  style={styles.addButton}
                  onPress={handleAddManualItem}
                  disabled={addManualMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Add item"
                  hitSlop={6}
                >
                  <Ionicons name="arrow-up" size={20} color="#fff" />
                </Pressable>
              )}
            </GlassSurface>
          </LinearGradient>
        </Animated.View>
      </Animated.View>

      {/* iOS uses the native header menu instead */}
      {!IS_IOS && (
        <ShoppingListMenu
          visible={menuOpen}
          top={insets.top + NAV_BAR_HEIGHT + TITLE_ROW_HEIGHT}
          view={view}
          tickedCount={checkedCount}
          canClearTicked={hasTickedRows}
          showTicked={showTicked}
          onToggleTicked={() => setShowTicked((v) => !v)}
          onClose={() => setMenuOpen(false)}
          onShareList={() => exportSheetRef.current?.present()}
          onShareWithSomeone={handleShareWithSomeone}
          onAddRecipe={() => addRecipeSheetRef.current?.present()}
          onChangeView={setView}
          onClearTicked={handleClearChecked}
        />
      )}

      {/* Sheets */}
      <ShoppingListExportSheet
        ref={exportSheetRef}
        listName={listName}
        items={items}
        recipes={recipes}
        view={view}
      />
      <AddRecipeToShoppingListSheet
        ref={addRecipeSheetRef}
        shoppingListId={activeList?.id}
      />
      <ShoppingListShareSheet
        ref={shareSheetRef}
        shoppingListId={activeList?.id}
        listName={activeList?.name}
      />
      <ShoppingListPickerSheet
        ref={listPickerSheetRef}
        activeListId={activeList?.id}
        onSelectList={handleSelectShoppingList}
      />
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  titleRow: {
    height: TITLE_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: ROW_PADDING,
    paddingRight: 16,
  },
  // A custom bar item needs a real size, or iOS hands its taps to the
  // nearest bar button instead.
  barTitle: {
    width: rt.screen.width - 120,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
  },
  titleButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  roundButton: {
    width: ROUND_BUTTON_SIZE,
    height: ROUND_BUTTON_SIZE,
    borderRadius: ROUND_BUTTON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  roundButtonPressed: {
    opacity: 0.6,
  },
  title: {
    flexShrink: 1,
  },
  titleChevron: {
    marginLeft: 4,
    marginTop: 2,
    color: theme.colors.textSecondary,
  },
  headerIcon: {
    color: theme.colors.text,
  },
  subtitle: {
    paddingHorizontal: ROW_PADDING,
    paddingTop: 4,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.medium,
  },

  // Rows
  itemRow: {
    paddingHorizontal: ROW_PADDING - ROW_INSET,
    paddingVertical: 1,
  },
  itemInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: ROW_INSET,
    borderRadius: theme.borderRadius.large,
  },
  itemPressed: {
    opacity: 0.6,
  },
  separator: {
    position: "absolute",
    top: 0,
    left: ROW_PADDING + CHECK_SIZE + 14,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  checkbox: (checked: boolean) => ({
    width: CHECK_SIZE,
    height: CHECK_SIZE,
    borderRadius: CHECK_SIZE / 2,
    borderWidth: checked ? 0 : 2,
    borderColor: theme.colors.placeholderText,
    backgroundColor: checked ? theme.colors.primary : "transparent",
    alignItems: "center",
    justifyContent: "center",
  }),
  checkIcon: {
    color: "#fff",
  },
  itemText: (checked: boolean) => ({
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontFamily: theme.fonts.medium,
    color: checked ? theme.colors.textSecondary : theme.colors.text,
    textDecorationLine: checked ? "line-through" : "none",
  }),
  itemQuantity: (checked: boolean) => ({
    fontFamily: theme.fonts.medium,
    color: checked ? theme.colors.placeholderText : theme.colors.textSecondary,
  }),
  deleteActionContainer: {
    justifyContent: "center",
    alignItems: "center",
    paddingRight: 20,
  },
  deleteActionPill: {
    height: 44,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.destructive,
    justifyContent: "center",
    alignItems: "center",
  },

  // Empty states
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    top: -80,
  },
  emptyIcon: {
    color: theme.colors.border,
  },
  doneIcon: {
    color: theme.colors.primary,
  },
  emptyText: {
    textAlign: "center",
  },

  // Add an item
  inputWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  inputGradient: {
    paddingTop: 24,
    paddingHorizontal: 16,
    // Reaches under the tab bar so the fade has no hard edge
    paddingBottom: rt.insets.bottom + TAB_BAR_HEIGHT + 8,
    marginBottom: -(rt.insets.bottom + TAB_BAR_HEIGHT),
  },
  inputGlass: {
    height: 50,
    borderRadius: 25,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 18,
    paddingRight: 6,
  },
  inputRowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 16,
    fontFamily: theme.fonts.medium,
    color: theme.colors.text,
  },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
}));
