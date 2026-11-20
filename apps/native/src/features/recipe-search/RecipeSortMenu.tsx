import { Host, Menu, RNHostView, Section, Toggle } from "@expo/ui/swift-ui";
import type { ReactElement } from "react";

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
}: RecipeSortMenuProps) => (
  <Host matchContents>
    <Menu label={<RNHostView matchContents>{children}</RNHostView>}>
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
