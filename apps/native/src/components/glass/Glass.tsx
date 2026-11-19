import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useEffect, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

// Liquid Glass needs iOS 26+. Everywhere else we fall back to the system
// blur on iOS and a solid surface on Android, so the same component works
// across platforms and OS versions.
const HAS_LIQUID_GLASS = isLiquidGlassAvailable();

export const GLASS_CONTROL_SIZE = 44;

/** Matches the native glass (de)materialise timing. */
const GLASS_HIDE_DURATION_MS = 300;

interface GlassSurfaceProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Lets the glass react to touches (shimmer / flex). Use on tappable glass. */
  interactive?: boolean;
  /**
   * Hide the surface. On Liquid Glass the material dematerialises with the
   * native iOS animation while its contents fade; elsewhere it fades.
   */
  hidden?: boolean;
  /**
   * Layout for the contents. They sit in their own view (so they can fade
   * with the glass), which lays out as a column unless told otherwise.
   */
  contentStyle?: StyleProp<ViewStyle>;
}

function useHiddenProgress(hidden: boolean) {
  const visible = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    visible.set(
      withTiming(hidden ? 0 : 1, { duration: GLASS_HIDE_DURATION_MS }),
    );
  }, [hidden, visible]);
  return visible;
}

/**
 * A floating glass surface for controls that sit over content (toolbar
 * buttons, bottom accessories). Never use it inside list rows — glass is
 * expensive to render while scrolling.
 */
export const GlassSurface = ({
  children,
  style,
  interactive = false,
  hidden = false,
  contentStyle: contentLayout,
}: GlassSurfaceProps) => {
  const visible = useHiddenProgress(hidden);
  const contentStyle = useAnimatedStyle(() => ({
    opacity: visible.get(),
    transform: [{ scale: 0.85 + 0.15 * visible.get() }],
  }));
  const pointerEvents = hidden ? "none" : "auto";

  if (HAS_LIQUID_GLASS) {
    return (
      <GlassView
        glassEffectStyle={{
          style: hidden ? "none" : "regular",
          animate: true,
          animationDuration: GLASS_HIDE_DURATION_MS / 1000,
        }}
        isInteractive={interactive && !hidden}
        pointerEvents={pointerEvents}
        style={style}
      >
        <Animated.View style={[contentLayout, contentStyle]}>
          {children}
        </Animated.View>
      </GlassView>
    );
  }

  // Without Liquid Glass the whole surface fades and shrinks.
  if (Platform.OS === "ios") {
    return (
      <Animated.View pointerEvents={pointerEvents} style={contentStyle}>
        <BlurView
          intensity={80}
          tint="systemChromeMaterial"
          style={[styles.blurFallback, style]}
        >
          {children}
        </BlurView>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[styles.solidFallback, style, contentStyle]}
    >
      {children}
    </Animated.View>
  );
};

interface GlassButtonGroupProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  hidden?: boolean;
}

/** A glass capsule that holds one or more related icon buttons. */
export const GlassButtonGroup = ({
  children,
  style,
  hidden,
}: GlassButtonGroupProps) => (
  <GlassSurface
    interactive
    hidden={hidden}
    style={[styles.group, style]}
    contentStyle={styles.groupContent}
  >
    {children}
  </GlassSurface>
);

type GlassIconButtonProps = Omit<PressableProps, "children" | "style"> & {
  accessibilityLabel: string;
  children: ReactNode;
};

/** An icon button sized for use inside a {@link GlassButtonGroup}. */
export const GlassIconButton = ({
  children,
  ...props
}: GlassIconButtonProps) => (
  <Pressable
    accessibilityRole="button"
    hitSlop={4}
    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    {...props}
  >
    {children}
  </Pressable>
);

const styles = StyleSheet.create((theme) => ({
  group: {
    height: GLASS_CONTROL_SIZE,
    borderRadius: GLASS_CONTROL_SIZE / 2,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  iconButton: {
    width: GLASS_CONTROL_SIZE + 2,
    height: GLASS_CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  groupContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  blurFallback: {
    overflow: "hidden",
  },
  solidFallback: {
    backgroundColor: theme.colors.inputBackground,
  },
}));
