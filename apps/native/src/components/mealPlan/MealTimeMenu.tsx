import {
  Button,
  Divider,
  Host,
  Menu,
  RNHostView,
  Toggle,
} from "@expo/ui/swift-ui";
import type { ReactElement } from "react";
import { View } from "react-native";

import { dismissKeyboardForMenu } from "@/utils/dismissKeyboardForMenu";

export interface MealTimeMenuOption {
  key: string;
  name: string;
  /** What's already planned for this meal time on the day, if anything. */
  planned?: string;
}

export interface MealTimeMenuProps {
  options: MealTimeMenuOption[];
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
  onNew: () => void;
  onEdit: () => void;
  /** What the menu opens from. Not pressable itself: the menu handles taps. */
  children: ReactElement;
  accessibilityLabel: string;
}

const optionLabel = (option: MealTimeMenuOption) =>
  option.planned ? `${option.name} · ${option.planned}` : option.name;

/**
 * The iOS pull-down for choosing a meal time, drawn by SwiftUI so it has the
 * system glass. Android has its own version.
 */
export const MealTimeMenu = ({
  options,
  selectedKey,
  onSelect,
  onNew,
  onEdit,
  children,
  accessibilityLabel,
}: MealTimeMenuProps) => (
  <Host matchContents>
    <Menu
      label={
        <RNHostView matchContents>
          {/* The hosted view isn't described to VoiceOver otherwise. */}
          <View
            accessible
            // The menu takes over without iOS sending keyboard events, so
            // put the keyboard away first or the search bar is left floating.
            onTouchStart={dismissKeyboardForMenu}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint="Choose which meal to add to"
          >
            {children}
          </View>
        </RNHostView>
      }
    >
      {options.map((option) => (
        <Toggle
          key={option.key}
          label={optionLabel(option)}
          isOn={option.key === selectedKey}
          onIsOnChange={(isOn) => isOn && onSelect(option.key)}
        />
      ))}
      <Divider />
      <Button label="New meal time" systemImage="plus" onPress={onNew} />
      <Button
        label="Edit meal times"
        systemImage="gearshape"
        onPress={onEdit}
      />
    </Menu>
  </Host>
);
