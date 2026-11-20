import {
  Column,
  DropdownMenu,
  Host,
  RNHostView,
  SelectableDropdownMenuItem,
  Text,
} from "@expo/ui/jetpack-compose";
import type { RecipeImportType } from "@repo/contracts/recipe-import";
import { useState } from "react";
import { Keyboard, Pressable } from "react-native";

import type { ImportMethodMenuProps } from "./ImportMethodMenu";

const OPTIONS: { type: RecipeImportType; title: string }[] = [
  { type: "basic", title: "Quick import" },
  { type: "smart", title: "Smart import" },
];

/**
 * The Material dropdown behind the Quick / Smart pill on Android.
 */
export const ImportMethodMenu = ({
  importType,
  smartSubtitle,
  onChoose,
  disabled = false,
  children,
}: ImportMethodMenuProps) => {
  const [expanded, setExpanded] = useState(false);
  const subtitles: Record<RecipeImportType, string> = {
    basic: "Free · for recipe websites",
    smart: smartSubtitle,
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
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={
                importType === "smart" ? "Smart import" : "Quick import"
              }
              accessibilityHint="Choose how to import"
              accessibilityState={{ disabled, expanded }}
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
          {OPTIONS.map((option) => (
            <SelectableDropdownMenuItem
              key={option.type}
              selected={importType === option.type}
              onClick={() => {
                setExpanded(false);
                onChoose(option.type);
              }}
            >
              <SelectableDropdownMenuItem.Text>
                <Column>
                  <Text>{option.title}</Text>
                  <Text style={{ fontSize: 12 }}>{subtitles[option.type]}</Text>
                </Column>
              </SelectableDropdownMenuItem.Text>
            </SelectableDropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
};
