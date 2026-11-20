import {
  DropdownMenu,
  DropdownMenuItem,
  Host,
  RNHostView,
  SelectableDropdownMenuItem,
  Text,
} from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { Pressable } from "react-native";

import type { MealTimeMenuProps } from "./MealTimeMenu";

/** The Material dropdown for choosing a meal time on Android. */
export const MealTimeMenu = ({
  options,
  selectedKey,
  onSelect,
  onNew,
  onEdit,
  children,
  accessibilityLabel,
}: MealTimeMenuProps) => {
  const [expanded, setExpanded] = useState(false);
  const run = (action: () => void) => () => {
    setExpanded(false);
    action();
  };

  return (
    <Host matchContents>
      <DropdownMenu
        expanded={expanded}
        onDismissRequest={() => setExpanded(false)}
      >
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityHint="Choose which meal to add to"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded(true)}
            >
              {children}
            </Pressable>
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {options.map((option) => (
            <SelectableDropdownMenuItem
              key={option.key}
              selected={option.key === selectedKey}
              onClick={run(() => onSelect(option.key))}
            >
              <SelectableDropdownMenuItem.Text>
                <Text>
                  {option.planned
                    ? `${option.name} · ${option.planned}`
                    : option.name}
                </Text>
              </SelectableDropdownMenuItem.Text>
            </SelectableDropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={run(onNew)}>
            <DropdownMenuItem.Text>
              <Text>New meal time</Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={run(onEdit)}>
            <DropdownMenuItem.Text>
              <Text>Edit meal times</Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
};
