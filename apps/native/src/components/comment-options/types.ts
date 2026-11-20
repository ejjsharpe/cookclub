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
  /** What the menu opens from. Not pressable itself: the menu handles taps. */
  children: ReactElement;
}

export interface CommentContextMenuProps {
  options: CommentOption[];
  /** The comment row, which opens the menu when long-pressed. */
  children: ReactElement;
}
