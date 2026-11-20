import type { ButtonProps } from "@expo/ui/swift-ui";
import type { ReactElement } from "react";

/** One action in a comment's menu, shared by the iOS and Android menus. */
export interface CommentOption {
  key: string;
  label: string;
  /** SF Symbol shown beside the label on iOS. */
  systemImage: NonNullable<ButtonProps["systemImage"]>;
  destructive?: boolean;
  run: () => void;
}

export interface CommentOptionsMenuProps {
  options: CommentOption[];
  /** What screen readers call the button. Defaults to "Comment options". */
  accessibilityLabel?: string;
  /** What the menu opens from. Not pressable itself: the menu handles taps. */
  children: ReactElement;
}

export interface CommentContextMenuProps {
  options: CommentOption[];
  /** The comment row, which opens the menu when long-pressed. */
  children: ReactElement;
  /**
   * What lifts out while the menu is open. A separate view, so the live row
   * never leaves the list (iOS would otherwise lift the row itself, and it
   * snaps back as soon as React Native lays it out again).
   */
  preview: ReactElement;
}
