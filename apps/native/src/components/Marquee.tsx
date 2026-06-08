import * as React from "react";
import type { LayoutRectangle, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDecay,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

type MarqueeDirection = "horizontal" | "vertical";
export type MarqueeProps = React.PropsWithChildren<{
  speed?: number;
  offset?: number;
  spacing?: number;
  style?: ViewStyle;
  reverse?: boolean;
  frameRate?: number;
  direction?: MarqueeDirection;
  position?: SharedValue<number>;
  withGesture?: boolean;
}>;

export type MarqueeRef = {
  start: () => void;
  stop: () => void;
  isActive: boolean;
};

const AnimatedChild = ({
  index,
  children,
  anim,
  textMeasurement,
  spacing,
  direction,
  offset = 0,
}: React.PropsWithChildren<{
  index: number;
  anim: SharedValue<number>;
  textMeasurement: SharedValue<LayoutRectangle>;
  spacing: number;
  direction: MarqueeDirection;
  offset?: number;
}>) => {
  const stylez = useAnimatedStyle(() => {
    if (direction === "vertical") {
      return {
        position: "absolute",
        top: (index - 1) * (textMeasurement.get().height + spacing),
        transform: [
          {
            translateY:
              -(anim.get() % (textMeasurement.get().height + spacing)) + offset,
          },
        ],
      };
    }
    return {
      position: "absolute",
      left: (index - 1) * (textMeasurement.get().width + spacing),
      transform: [
        {
          translateX:
            -(anim.get() % (textMeasurement.get().width + spacing)) + offset,
        },
      ],
    };
  }, [index, spacing, textMeasurement]);
  return <Animated.View style={stylez}>{children}</Animated.View>;
};

/**
 * Used to animate the given children in a horizontal manner.
 */
export const Marquee = React.memo(
  React.forwardRef<MarqueeRef, MarqueeProps>(
    (
      {
        speed = 1,
        offset,
        children,
        spacing = 0,
        style,
        reverse,
        frameRate,
        direction = "horizontal",
        position,
        withGesture = true,
      },
      ref,
    ) => {
      const parentMeasurement = useSharedValue<LayoutRectangle>({
        width: 0,
        height: 0,
        x: 0,
        y: 0,
      });
      const textMeasurement = useSharedValue<LayoutRectangle>({
        width: 0,
        height: 0,
        x: 0,
        y: 0,
      });
      const [cloneTimes, setCloneTimes] = React.useState(0);
      const anim = useSharedValue(0);

      const frameRateMs = frameRate ? 1000 / frameRate : null;

      const frameCallback = useFrameCallback((frameInfo) => {
        if (frameInfo.timeSincePreviousFrame === null) return;

        const frameDelta = frameRateMs
          ? frameInfo.timeSincePreviousFrame / frameRateMs
          : 1;

        if (reverse) {
          anim.set(anim.get() - speed * frameDelta);
        } else {
          anim.set(anim.get() + speed * frameDelta);
        }
      }, true);

      useDerivedValue(() => {
        if (position) {
          position.set(anim.get());
        }
      });

      useAnimatedReaction(
        () => {
          if (
            textMeasurement.get().width === 0 ||
            parentMeasurement.get().width === 0 ||
            textMeasurement.get().height === 0 ||
            parentMeasurement.get().height === 0
          ) {
            return 0;
          }
          return (
            Math.round(
              direction === "horizontal"
                ? parentMeasurement.get().width / textMeasurement.get().width
                : parentMeasurement.get().height / textMeasurement.get().height,
            ) + 1
          );
        },
        (v) => {
          if (v === 0) {
            return;
          }
          // This is going to cover the case when the text/element size
          // is greater than the actual parent size
          // Double this to cover the entire screen twice, in this way we can
          // reset the position of the first element when its going to move out
          // of the screen without any noticible glitch
          scheduleOnRN(setCloneTimes, v + 2);
        },
        [direction],
      );

      // Pan Gestures
      function start() {
        frameCallback.setActive(true);
      }
      function stop() {
        frameCallback.setActive(false);
      }

      React.useImperativeHandle(ref, () => ({
        start,
        stop,
        isActive: frameCallback.isActive,
      }));

      const pan = Gesture.Pan()
        .enabled(withGesture)
        .onBegin(() => {
          scheduleOnRN(stop);
        })
        .onChange((e) => {
          anim.set(
            anim.get() - (direction === "horizontal" ? e.changeX : e.changeY),
          );
        })
        .onFinalize((e) => {
          anim.set(
            withDecay(
              {
                velocity: -(direction === "horizontal"
                  ? e.velocityX
                  : e.velocityY),
                velocityFactor: 0.5,
              },
              (finished) => {
                if (finished) {
                  scheduleOnRN(start);
                }
              },
            ),
          );
        });

      return (
        <Animated.View
          key={direction}
          style={style}
          onLayout={(ev) => {
            parentMeasurement.set(ev.nativeEvent.layout);
          }}
          pointerEvents="box-none"
        >
          <GestureDetector gesture={pan}>
            <Animated.View style={styles.row} pointerEvents="box-none">
              <Animated.ScrollView
                horizontal={direction === "horizontal"}
                style={styles.hidden}
                pointerEvents="box-none"
              >
                <View
                  onLayout={(ev) => {
                    textMeasurement.set(ev.nativeEvent.layout);
                  }}
                >
                  {children}
                </View>
              </Animated.ScrollView>
              {cloneTimes > 0 &&
                [...Array(cloneTimes).keys()].map((index) => {
                  return (
                    <AnimatedChild
                      key={`clone-${index}`}
                      index={index}
                      anim={anim}
                      textMeasurement={textMeasurement}
                      spacing={spacing}
                      direction={direction}
                      offset={offset}
                    >
                      {children}
                    </AnimatedChild>
                  );
                })}
            </Animated.View>
          </GestureDetector>
        </Animated.View>
      );
    },
  ),
);

const styles = StyleSheet.create({
  hidden: { opacity: 0, zIndex: -9999 },
  row: { flexDirection: "row" },
});
