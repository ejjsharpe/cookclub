import {
  GlassMenu,
  type GlassMenuItem as MenuItem,
} from "@/components/glass/GlassMenu";
import type { ShoppingListView } from "@/lib/shoppingListGroups";

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
    <GlassMenu visible={visible} top={top} groups={groups} onClose={onClose} />
  );
};
