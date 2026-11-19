import { memo } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";

import {
  signatureIconSvg,
  type SignatureIconName,
  type SignatureIconVariant,
} from "./signatureIcons";

interface Props {
  name: SignatureIconName;
  /** Outline by default; use filled for selected / active states. */
  variant?: SignatureIconVariant;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}

/** One of the eight cookclub signature icons. Everything else uses system icons. */
export const SignatureIcon = memo(
  ({ name, variant = "outline", size = 24, color, style }: Props) => (
    <SvgXml
      // Remount when the shape changes: react-native-svg keeps a removed
      // `fill` on the native path, so outline-after-filled stays filled.
      key={`${name}-${variant}`}
      xml={signatureIconSvg(name, variant, { size })}
      width={size}
      height={size}
      color={color}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  ),
);
