import {
  DropdownMenu,
  Host,
  RNHostView,
  SelectableDropdownMenuItem,
  Text,
} from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { Keyboard, Pressable } from "react-native";

import type { RecipeSortMenuProps } from "./RecipeSortMenu";

/** The Material dropdown for ordering search results on Android. */
export const RecipeSortMenu = ({
  sort,
  options,
  onChange,
  children,
}: RecipeSortMenuProps) => {
  const [expanded, setExpanded] = useState(false);
  const current = options.find((option) => option.value === sort)?.label;

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
              accessibilityLabel={`Sort by ${current ?? "default"}`}
              accessibilityHint="Choose how results are ordered"
              accessibilityState={{ expanded }}
              onPress={() => {
                Keyboard.dismiss();
                setExpanded(true);
              }}
            >
              {children}
            </Pressable>
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {options.map((option) => (
            <SelectableDropdownMenuItem
              key={option.value}
              selected={sort === option.value}
              onClick={() => {
                setExpanded(false);
                onChange(option.value);
              }}
            >
              <SelectableDropdownMenuItem.Text>
                <Text>{option.label}</Text>
              </SelectableDropdownMenuItem.Text>
            </SelectableDropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
};
