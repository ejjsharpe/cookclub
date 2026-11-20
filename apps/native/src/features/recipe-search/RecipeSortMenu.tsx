import { Host, Menu, RNHostView, Section, Toggle } from "@expo/ui/swift-ui";
import type { ReactElement } from "react";
import { View } from "react-native";

import type { RecipeSort } from "@/api/recipe";

export interface RecipeSortMenuProps {
  sort: RecipeSort;
  options: { value: RecipeSort; label: string }[];
  onChange: (sort: RecipeSort) => void;
  /** What the menu opens from. Not pressable itself: the menu handles taps. */
  children: ReactElement;
}

/**
 * The iOS pull-down menu for ordering search results, drawn by SwiftUI so it
 * has the system glass and animation. Android has its own version.
 */
export const RecipeSortMenu = ({
  sort,
  options,
  onChange,
  children,
}: RecipeSortMenuProps) => {
  const current = options.find((option) => option.value === sort)?.label;
  return (
    <Host matchContents>
      <Menu
        label={
          <RNHostView matchContents>
            {/* The hosted view isn't described to VoiceOver otherwise. */}
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${current ?? "default"}`}
              accessibilityHint="Choose how results are ordered"
            >
              {children}
            </View>
          </RNHostView>
        }
      >
        <Section title="Sort by">
          {options.map((option) => (
            <Toggle
              key={option.value}
              label={option.label}
              isOn={sort === option.value}
              onIsOnChange={(isOn) => isOn && onChange(option.value)}
            />
          ))}
        </Section>
      </Menu>
    </Host>
  );
};
