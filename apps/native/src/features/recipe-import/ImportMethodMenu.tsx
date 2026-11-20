import {
  Host,
  Menu,
  RNHostView,
  Section,
  Text,
  Toggle,
} from "@expo/ui/swift-ui";
import { disabled as disabledModifier } from "@expo/ui/swift-ui/modifiers";
import type { RecipeImportType } from "@repo/contracts/recipe-import";
import type { ReactElement } from "react";

export interface ImportMethodMenuProps {
  importType: RecipeImportType;
  /** e.g. "Uses AI · 4 of 5 left" */
  smartSubtitle: string;
  onChoose: (type: RecipeImportType) => void;
  /** While an import is being sent, the choice can't change. */
  disabled?: boolean;
  /** The pill the menu opens from. Not pressable itself: the menu handles taps. */
  children: ReactElement;
}

/**
 * The iOS pull-down menu behind the Quick / Smart pill, drawn by SwiftUI so it
 * has the system glass and animation. Android has its own version.
 */
export const ImportMethodMenu = ({
  importType,
  smartSubtitle,
  onChoose,
  disabled = false,
  children,
}: ImportMethodMenuProps) => (
  <Host matchContents>
    <Menu
      label={<RNHostView matchContents>{children}</RNHostView>}
      modifiers={[disabledModifier(disabled)]}
    >
      <Section title="Import with">
        <Toggle
          isOn={importType === "basic"}
          onIsOnChange={(isOn) => isOn && onChoose("basic")}
        >
          <Text>Quick import</Text>
          <Text>Free · for recipe websites</Text>
        </Toggle>
        <Toggle
          isOn={importType === "smart"}
          onIsOnChange={(isOn) => isOn && onChoose("smart")}
        >
          <Text>Smart import</Text>
          <Text>{smartSubtitle}</Text>
        </Toggle>
      </Section>
    </Menu>
  </Host>
);
