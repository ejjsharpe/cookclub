import type { SystemIconProps } from "./SystemIcon";

import { Ionicons } from "@/components/Ionicons";

/** Android draws the matching Ionicon. See SystemIcon.tsx. */
export const SystemIcon = ({ android, size = 22, color }: SystemIconProps) => (
  <Ionicons
    name={android}
    size={size}
    color={color}
    accessibilityElementsHidden
    importantForAccessibility="no"
  />
);
