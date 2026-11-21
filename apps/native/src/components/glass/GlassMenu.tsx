import { Fragment, type ComponentProps } from "react";
import { Modal, Pressable, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { GlassSurface } from "@/components/glass/Glass";

const MENU_CLOSE_DELAY_MS = 250;

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export interface GlassMenuItem {
  key: string;
  label: string;
  icon?: IoniconName;
  checked?: boolean;
  destructive?: boolean;
  onPress: () => void;
}

interface GlassMenuProps {
  visible: boolean;
  /** Distance from the top of the screen to the menu's top edge. */
  top: number;
  /** Items in groups, with a gap between each group. */
  groups: GlassMenuItem[][];
  onClose: () => void;
}

/**
 * The glass menu behind a screen's ••• button on Android, where there's no
 * native one. iOS uses the navigation bar's menu.
 */
export const GlassMenu = ({
  visible,
  top,
  groups,
  onClose,
}: GlassMenuProps) => (
  <Modal
    visible={visible}
    transparent
    animationType="none"
    onRequestClose={onClose}
    statusBarTranslucent
  >
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={onClose}
      accessibilityLabel="Close menu"
    />
    {visible && (
      <Animated.View
        entering={ZoomIn.springify().damping(18).stiffness(260)}
        style={[styles.anchor, { top }]}
      >
        <Animated.View entering={FadeIn.duration(120)}>
          <GlassSurface style={styles.menu}>
            <View accessibilityRole="menu">
              {groups.map((group, g) => (
                <Fragment key={g}>
                  {g > 0 && <View style={styles.groupGap} />}
                  {group.map((item) => (
                    <Pressable
                      key={item.key}
                      accessibilityRole="menuitem"
                      accessibilityState={
                        item.checked !== undefined
                          ? { checked: item.checked }
                          : undefined
                      }
                      onPress={() => {
                        onClose();
                        // Let the menu finish closing before a sheet opens,
                        // or Android may not show the sheet
                        setTimeout(item.onPress, MENU_CLOSE_DELAY_MS);
                      }}
                      style={({ pressed }) => [
                        styles.item,
                        pressed && styles.itemPressed,
                      ]}
                    >
                      <View style={styles.checkSlot}>
                        {item.checked && (
                          <Ionicons
                            name="checkmark"
                            size={17}
                            style={styles.icon(false)}
                          />
                        )}
                      </View>
                      <Text
                        type="body"
                        style={styles.label(!!item.destructive)}
                      >
                        {item.label}
                      </Text>
                      {item.icon && (
                        <Ionicons
                          name={item.icon}
                          size={20}
                          style={styles.icon(!!item.destructive)}
                        />
                      )}
                    </Pressable>
                  ))}
                </Fragment>
              ))}
            </View>
          </GlassSurface>
        </Animated.View>
      </Animated.View>
    )}
  </Modal>
);

const styles = StyleSheet.create((theme) => ({
  anchor: {
    position: "absolute",
    right: 16,
    width: 250,
    transformOrigin: "top right",
  },
  menu: {
    borderRadius: 24,
    paddingVertical: 6,
    overflow: "hidden",
  },
  groupGap: {
    height: 7,
    backgroundColor: theme.colors.textTertiary,
    opacity: 0.6,
    marginVertical: 2,
  },
  item: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
  },
  itemPressed: {
    backgroundColor: theme.colors.pressHighlight,
  },
  checkSlot: {
    width: 36,
    alignItems: "center",
  },
  label: (destructive: boolean) => ({
    flex: 1,
    color: destructive ? theme.colors.destructive : theme.colors.text,
  }),
  icon: (destructive: boolean) => ({
    color: destructive ? theme.colors.destructive : theme.colors.text,
  }),
}));
