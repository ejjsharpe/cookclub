import { borderRadius } from "./borderRadius";
import { colors } from "./colors";
import { fonts } from "./fonts";

export const lightTheme = {
  colors: {
    background: colors.white,
    primary: colors.paprika,
    // Solid buttons and pills: Paprika, lit from above.
    primaryGradient: "linear-gradient(180deg, #D23F27, #B3301B)",
    // Tinted fill for secondary primary actions (e.g. Save on feed cards),
    // with its text colour.
    primarySoft: "#FCE6E0",
    onPrimarySoft: "#9C2A16",
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
    // Lifted a little so it holds contrast on the dark background.
    primary: "#E0533B",
    primaryGradient: "linear-gradient(180deg, #E8624A, #CC4530)",
    primarySoft: "rgba(224, 83, 59, 0.22)",
    onPrimarySoft: "#FF9C86",
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
