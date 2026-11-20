import {
  DropdownMenu,
  DropdownMenuItem,
  Host,
  RNHostView,
  Text,
} from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { Pressable } from "react-native";
import { useUnistyles } from "react-native-unistyles";

import type { CommentContextMenuProps, CommentOptionsMenuProps } from "./types";

/**
 * The Material dropdown behind a comment's ellipsis on Android.
 */
export const CommentOptionsMenu = ({
  options,
  children,
}: CommentOptionsMenuProps) => {
  const { theme } = useUnistyles();
  const [expanded, setExpanded] = useState(false);

  return (
    <Host matchContents>
      <DropdownMenu
        expanded={expanded}
        onDismissRequest={() => setExpanded(false)}
      >
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <Pressable
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Comment options"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded(true)}
            >
              {children}
            </Pressable>
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.key}
              elementColors={
                option.destructive
                  ? { textColor: theme.colors.destructive }
                  : undefined
              }
              onClick={() => {
                setExpanded(false);
                option.run();
              }}
            >
              <DropdownMenuItem.Text>
                <Text>{option.label}</Text>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
};

/**
 * Android has no system context menu that lifts a row, so the ellipsis is
 * the way in; the row renders as is.
 */
export const CommentContextMenu = ({ children }: CommentContextMenuProps) =>
  children;
