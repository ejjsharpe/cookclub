import { borderRadius } from "./borderRadius";
import { colors } from "./colors";
import { fonts } from "./fonts";

export const lightTheme = {
  colors: {
    background: colors.white,
    primary: colors.red,
    // Solid buttons and pills: the brand red, lit from above.
    primaryGradient: "linear-gradient(180deg, #FF2E4C, #E00022)",
    // Tinted fill for secondary primary actions (e.g. Save on feed cards),
    // with its text colour.
    primarySoft: "#FFE5E9",
    onPrimarySoft: "#C2001E",
    destructive: "#FF3B30",
    text: colors.black,
    textSecondary: "rgba(0, 0, 0, 0.5)",
    textTertiary: "rgba(0, 0, 0, 0.1)",
    buttonText: colors.white,
    border: `${colors.black}26`,
    inputBackground: "#F2F4F5",
    tabBarBackground: "#F9FAFA",
    pressHighlight: "rgba(0, 0, 0, 0.05)",
    placeholderText: "#BCBDC0",
  },
  fonts,
  borderRadius,
} as const;

export const darkTheme = {
  colors: {
    background: colors.black,
    primary: colors.red,
    primaryGradient: "linear-gradient(180deg, #FF2E4C, #E00022)",
    primarySoft: "rgba(255, 0, 39, 0.22)",
    onPrimarySoft: "#FF8A9B",
    destructive: "#FF453A",
    text: colors.white,
    textSecondary: "rgba(255, 255, 255, 0.6)",
    textTertiary: "rgba(255, 255, 255, 0.27)",
    buttonText: colors.white,
    border: `${colors.white}26`,
    inputBackground: "#303032",
    tabBarBackground: "#252526",
    pressHighlight: "rgba(255, 255, 255, 0.08)",
    placeholderText: "#BCBDC0",
  },
  fonts,
  borderRadius,
} as const;
