import { Fragment, type ComponentProps } from "react";
import { Modal, Pressable, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { GlassSurface } from "@/components/glass/Glass";
import type { ShoppingListView } from "@/lib/shoppingListGroups";

const MENU_CLOSE_DELAY_MS = 250;

type IoniconName = ComponentProps<typeof Ionicons>["name"];

interface MenuItem {
  key: string;
  label: string;
  icon?: IoniconName;
  checked?: boolean;
  destructive?: boolean;
  onPress: () => void;
}

interface ShoppingListMenuProps {
  visible: boolean;
  /** Distance from the top of the screen to the menu's top edge. */
  top: number;
  view: ShoppingListView;
  /** Ticked rows in the current view. */
  tickedCount: number;
  /** Whether any share of any item is ticked. */
  canClearTicked: boolean;
  showTicked: boolean;
  onToggleTicked: () => void;
  onClose: () => void;
  onShareList: () => void;
  onShareWithSomeone: () => void;
  onAddRecipe: () => void;
  onChangeView: (view: ShoppingListView) => void;
  onClearTicked: () => void;
}

/** The glass menu behind the list's ••• button. */
export const ShoppingListMenu = ({
  visible,
  top,
  view,
  tickedCount,
  canClearTicked,
  showTicked,
  onToggleTicked,
  onClose,
  onShareList,
  onShareWithSomeone,
  onAddRecipe,
  onChangeView,
  onClearTicked,
}: ShoppingListMenuProps) => {
  const groups: MenuItem[][] = [
    [
      {
        key: "share",
        label: "Share list",
        icon: "share-outline",
        onPress: onShareList,
      },
      {
        key: "invite",
        label: "Share with someone",
        icon: "person-add-outline",
        onPress: onShareWithSomeone,
      },
      {
        key: "recipe",
        label: "Add a recipe",
        icon: "add",
        onPress: onAddRecipe,
      },
    ],
    [
      {
        key: "aisle",
        label: "By aisle",
        checked: view === "aisle",
        onPress: () => onChangeView("aisle"),
      },
      {
        key: "by-recipe",
        label: "By recipe",
        checked: view === "recipe",
        onPress: () => onChangeView("recipe"),
      },
    ],
  ];
  const tickedGroup: MenuItem[] = [];
  if (tickedCount > 0 || showTicked) {
    tickedGroup.push({
      key: "show-ticked",
      label: `Show ticked (${tickedCount})`,
      checked: showTicked,
      onPress: onToggleTicked,
    });
  }
  if (canClearTicked) {
    tickedGroup.push({
      key: "clear",
      label: "Clear ticked",
      icon: "trash-outline",
      destructive: true,
      onPress: onClearTicked,
    });
  }
  if (tickedGroup.length) groups.push(tickedGroup);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close menu"
      />
      {visible && (
        <Animated.View
          entering={ZoomIn.springify().damping(18).stiffness(260)}
          style={[styles.anchor, { top }]}
        >
          <Animated.View entering={FadeIn.duration(120)}>
            <GlassSurface style={styles.menu}>
              <View accessibilityRole="menu">
                {groups.map((group, g) => (
                  <Fragment key={g}>
                    {g > 0 && <View style={styles.groupGap} />}
                    {group.map((item) => (
                      <Pressable
                        key={item.key}
                        accessibilityRole="menuitem"
                        accessibilityState={
                          item.checked !== undefined
                            ? { checked: item.checked }
                            : undefined
                        }
                        onPress={() => {
                          onClose();
                          // Let the menu finish closing before a sheet opens,
                          // or Android may not show the sheet
                          setTimeout(item.onPress, MENU_CLOSE_DELAY_MS);
                        }}
                        style={({ pressed }) => [
                          styles.item,
                          pressed && styles.itemPressed,
                        ]}
                      >
                        <View style={styles.checkSlot}>
                          {item.checked && (
                            <Ionicons
                              name="checkmark"
                              size={17}
                              style={styles.icon(false)}
                            />
                          )}
                        </View>
                        <Text
                          type="body"
                          style={styles.label(!!item.destructive)}
                        >
                          {item.label}
                        </Text>
                        {item.icon && (
                          <Ionicons
                            name={item.icon}
                            size={20}
                            style={styles.icon(!!item.destructive)}
                          />
                        )}
                      </Pressable>
                    ))}
                  </Fragment>
                ))}
              </View>
            </GlassSurface>
          </Animated.View>
        </Animated.View>
      )}
    </Modal>
  );
};

const styles = StyleSheet.create((theme) => ({
  anchor: {
    position: "absolute",
    right: 16,
    width: 250,
    transformOrigin: "top right",
  },
  menu: {
    borderRadius: 24,
    paddingVertical: 6,
    overflow: "hidden",
  },
  groupGap: {
    height: 7,
    backgroundColor: theme.colors.textTertiary,
    opacity: 0.6,
    marginVertical: 2,
  },
  item: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
  },
  itemPressed: {
    backgroundColor: theme.colors.pressHighlight,
  },
  checkSlot: {
    width: 36,
    alignItems: "center",
  },
  label: (destructive: boolean) => ({
    flex: 1,
    color: destructive ? theme.colors.destructive : theme.colors.text,
  }),
  icon: (destructive: boolean) => ({
    color: destructive ? theme.colors.destructive : theme.colors.text,
  }),
}));
