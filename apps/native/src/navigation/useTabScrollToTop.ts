import { useNavigation, useScrollToTop } from "@react-navigation/native";
import { useEffect, type RefObject } from "react";

type Scrollable = {
  scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
};

type TabPressEvent = {
  data?: { origin?: string; behavior?: { scrollToTop?: boolean } };
  defaultPrevented?: boolean;
};

/**
 * Scroll a tab's list to the top when its tab is tapped again.
 *
 * `useScrollToTop` skips presses from the native tab bar, leaving iOS to find
 * the scroll view itself. That lookup walks each screen's first child views
 * and misses lists wrapped in other views (like Home's feed), so we handle
 * the native repeated press here too. Scrolling an already-top list is a no-op.
 */
export function useTabScrollToTop(ref: RefObject<Scrollable | null>) {
  useScrollToTop(ref as never);
  const navigation = useNavigation();

  useEffect(() => {
    const unsubscribe = navigation.addListener(
      // @ts-expect-error tabPress only exists on tab navigators
      "tabPress",
      (event: TabPressEvent) => {
        if (
          event.data?.origin === "native" &&
          event.data.behavior?.scrollToTop &&
          !event.defaultPrevented &&
          navigation.isFocused()
        ) {
          ref.current?.scrollToOffset({ offset: 0, animated: true });
        }
      },
    );
    return unsubscribe;
  }, [navigation, ref]);
}
