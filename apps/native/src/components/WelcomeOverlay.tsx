import { Image } from "expo-image";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";

import startImage1 from "@/assets/images/start-food-1.jpg";
import startImage6 from "@/assets/images/start-food-6.jpg";
import { Avatar } from "@/components/Avatar";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";

export interface WelcomePerson {
  name: string;
  image?: string | null;
}

export interface WelcomeDetails {
  me: WelcomePerson;
  /** Who they just followed, newest first. Empty shows dishes instead. */
  followed: WelcomePerson[];
  /** "Let's cook" waits for this, e.g. finishing onboarding on the server. */
  ready?: Promise<unknown>;
}

type WelcomeOverlayContextType = {
  /** Shows the welcome over whatever is on screen. */
  showWelcome: (details: WelcomeDetails) => void;
  /** Takes it away straight away, e.g. when finishing onboarding failed. */
  hideWelcome: () => void;
};

const WelcomeOverlayContext = createContext<WelcomeOverlayContextType>({
  showWelcome: () => {},
  hideWelcome: () => {},
});

export const useWelcomeOverlay = () => useContext(WelcomeOverlayContext);

// Gentle springs: a hint of overshoot, no bounce
const SPRING = { damping: 20, stiffness: 170, mass: 0.8 };
const RISE = { duration: 420 };
const ME = 72;
const SIDE = 52;

const firstName = (person: WelcomePerson) =>
  person.name.trim().split(" ")[0] || "them";

export function welcomeLine(followed: WelcomePerson[]): string {
  if (!followed.length) {
    return "Save a recipe you love to get started.\nHome fills up as you cook.";
  }
  const [a, b] = followed;
  if (followed.length === 1) {
    return `You're following ${firstName(a!)}.\nTheir latest cooking is waiting on Home.`;
  }
  const who =
    followed.length === 2
      ? `${firstName(a!)} and ${firstName(b!)}`
      : `${firstName(a!)}, ${firstName(b!)} and ${followed.length - 2} more`;
  return `You're following ${who}.\nTheir latest cooking is waiting on Home.`;
}

/** Fades in while rising `by` points. */
const useRise = (shown: SharedValue<number>, by = 12) =>
  useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * by }],
  }));

/** Slides out from behind the centre face, from the `dir` side. */
const useSlideOut = (shown: SharedValue<number>, dir: 1 | -1) =>
  useAnimatedStyle(() => ({
    opacity: Math.min(1, shown.get()),
    transform: [
      { translateX: (1 - shown.get()) * 34 * dir },
      { scale: 0.8 + 0.2 * shown.get() },
    ],
  }));

function Welcome({
  details,
  onDone,
}: {
  details: WelcomeDetails;
  onDone: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const backdrop = useSharedValue(0);
  const me = useSharedValue(0);
  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const lead = useSharedValue(0);
  const wordmark = useSharedValue(0);
  const line = useSharedValue(0);
  const button = useSharedValue(0);
  const leaving = useSharedValue(0);
  const shownAt = useRef(0);
  const [isReady, setIsReady] = useState(!details.ready);

  useEffect(() => {
    let live = true;
    // A failure is handled by whoever showed the welcome (it hides it)
    details.ready?.then(
      () => live && setIsReady(true),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [details.ready]);

  useEffect(() => {
    if (reduceMotion) {
      for (const v of [backdrop, me, left, right, lead, wordmark, line])
        v.set(1);
      return;
    }
    shownAt.current = Date.now();
    backdrop.set(withTiming(1, { duration: 150 }));
    me.set(withDelay(150, withSpring(1, SPRING)));
    left.set(withDelay(420, withSpring(1, SPRING)));
    right.set(withDelay(480, withSpring(1, SPRING)));
    lead.set(withDelay(700, withTiming(1, RISE)));
    wordmark.set(withDelay(780, withTiming(1, { duration: 460 })));
    line.set(withDelay(980, withTiming(1, RISE)));
    // Shared values are stable; this runs once when the welcome appears
  }, []);

  // The button arrives last, and never before there's somewhere to go
  useEffect(() => {
    if (!isReady) return;
    if (reduceMotion) {
      button.set(1);
      return;
    }
    const wait = Math.max(0, 1200 - (Date.now() - shownAt.current));
    button.set(withDelay(wait, withSpring(1, SPRING)));
  }, [isReady, reduceMotion, button]);

  const leave = () => {
    leaving.set(
      withTiming(
        1,
        { duration: 300, reduceMotion: ReduceMotion.System },
        (done) => {
          if (done) scheduleOnRN(onDone);
        },
      ),
    );
  };

  const screenStyle = useAnimatedStyle(() => ({
    opacity: backdrop.get() * (1 - leaving.get()),
    transform: [{ scale: 1 - 0.04 * leaving.get() }],
  }));
  const meStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, me.get() * 1.5),
    transform: [{ scale: 0.6 + 0.4 * me.get() }],
  }));
  const leftStyle = useSlideOut(left, 1);
  const rightStyle = useSlideOut(right, -1);
  const leadStyle = useRise(lead);
  const wordmarkStyle = useRise(wordmark, 14);
  const lineStyle = useRise(line, 10);
  const buttonStyle = useRise(button, 24);

  const [first, second] = details.followed;
  const sides: ReactNode[] = first
    ? [
        <Avatar key="a" imageUrl={first.image} name={first.name} size={SIDE} />,
        second ? (
          <Avatar
            key="b"
            imageUrl={second.image}
            name={second.name}
            size={SIDE}
          />
        ) : null,
      ]
    : [
        <Image key="a" source={startImage6} style={styles.dish} />,
        <Image key="b" source={startImage1} style={styles.dish} />,
      ];

  return (
    <Animated.View
      style={[styles.overlay, screenStyle]}
      accessibilityViewIsModal
    >
      <View style={styles.centre}>
        <View style={styles.faces} accessibilityElementsHidden>
          {sides[0] ? (
            <Animated.View style={[styles.ring, leftStyle]}>
              {sides[0]}
            </Animated.View>
          ) : null}
          <Animated.View style={[styles.ring, styles.me, meStyle]}>
            <Avatar
              imageUrl={details.me.image}
              name={details.me.name}
              size={ME}
            />
          </Animated.View>
          {sides[1] ? (
            <Animated.View style={[styles.ring, rightStyle]}>
              {sides[1]}
            </Animated.View>
          ) : null}
        </View>
        <Animated.View style={leadStyle}>
          <Text style={styles.lead}>Welcome to</Text>
        </Animated.View>
        <Animated.View style={wordmarkStyle}>
          <Text style={styles.wordmark} accessibilityRole="header">
            cook<Text style={[styles.wordmark, styles.club]}>club</Text>
          </Text>
        </Animated.View>
        <Animated.View style={lineStyle}>
          <Text style={styles.line}>{welcomeLine(details.followed)}</Text>
        </Animated.View>
      </View>
      <Animated.View style={[styles.footer, buttonStyle]}>
        <PrimaryButton onPress={leave} disabled={!isReady}>
          Let's cook
        </PrimaryButton>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Shown once onboarding finishes: your face with the cooks you followed
 * (or a couple of dishes), "Welcome to cookclub", and one button into Home.
 * Home mounts underneath while it plays.
 */
export function WelcomeOverlayProvider({ children }: { children: ReactNode }) {
  const [details, setDetails] = useState<WelcomeDetails | null>(null);

  const showWelcome = useCallback((next: WelcomeDetails) => {
    setDetails(next);
  }, []);
  const hideWelcome = useCallback(() => setDetails(null), []);
  const value = useMemo(
    () => ({ showWelcome, hideWelcome }),
    [showWelcome, hideWelcome],
  );

  return (
    <WelcomeOverlayContext.Provider value={value}>
      {/* TalkBack has no modal flag, so hide what's behind the welcome */}
      <View
        style={styles.app}
        importantForAccessibility={details ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={!!details}
      >
        {children}
      </View>
      {details ? <Welcome details={details} onDone={hideWelcome} /> : null}
    </WelcomeOverlayContext.Provider>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  app: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.background,
    zIndex: 9999,
  },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  faces: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 28,
  },
  ring: {
    borderRadius: 999,
    borderWidth: 3,
    borderColor: theme.colors.background,
    backgroundColor: theme.colors.background,
  },
  me: {
    marginHorizontal: -12,
    zIndex: 1,
  },
  dish: {
    width: SIDE,
    height: SIDE,
    borderRadius: SIDE / 2,
  },
  lead: {
    fontSize: 17,
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  wordmark: {
    fontSize: 36,
    lineHeight: 44,
    fontFamily: theme.fonts.black,
    letterSpacing: -1.8,
    color: theme.colors.text,
    textAlign: "center",
  },
  club: {
    color: theme.colors.primary,
  },
  line: {
    marginTop: 14,
    fontSize: 16,
    lineHeight: 22,
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: rt.insets.bottom + 8,
  },
}));
