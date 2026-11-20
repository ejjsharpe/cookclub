import { Host, Image } from "@expo/ui/swift-ui";
import { font } from "@expo/ui/swift-ui/modifiers";
import { View } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";

import type { Ionicons } from "@/components/Ionicons";

export interface SystemIconProps {
  /** The SF Symbol drawn on iOS. */
  sf: SFSymbol;
  /** The closest Ionicon, drawn on Android. */
  android: keyof typeof Ionicons.glyphMap;
  size?: number;
  color: string;
}

/**
 * A native system icon: an SF Symbol on iOS (at the semibold weight the
 * cookclub icons are drawn at), an Ionicon on Android. Use this for
 * everyday icons; only the signature set is drawn by hand.
 */
export const SystemIcon = ({ sf, size = 22, color }: SystemIconProps) => (
  // The native view would otherwise take the touch from the button around it.
  <View pointerEvents="none" accessibilityElementsHidden>
    <Host matchContents>
      <Image
        systemName={sf}
        color={color}
        modifiers={[font({ size: size * 0.86, weight: "semibold" })]}
      />
    </Host>
  </View>
);
