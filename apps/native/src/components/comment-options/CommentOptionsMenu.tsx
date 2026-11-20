import {
  Button,
  ContextMenu,
  Divider,
  Host,
  Menu,
  RNHostView,
} from "@expo/ui/swift-ui";

import type {
  CommentContextMenuProps,
  CommentOption,
  CommentOptionsMenuProps,
} from "./types";

/** The actions, with destructive ones set apart below a divider. */
const OptionButtons = ({ options }: { options: CommentOption[] }) => {
  const actions = options.filter((option) => !option.destructive);
  const destructive = options.filter((option) => option.destructive);

  return (
    <>
      {actions.map((option) => (
        <Button
          key={option.key}
          label={option.label}
          systemImage={option.systemImage}
          onPress={option.run}
        />
      ))}
      {actions.length > 0 && destructive.length > 0 ? <Divider /> : null}
      {destructive.map((option) => (
        <Button
          key={option.key}
          label={option.label}
          systemImage={option.systemImage}
          role="destructive"
          onPress={option.run}
        />
      ))}
    </>
  );
};

/**
 * The iOS pull-down menu behind a comment's ellipsis, drawn by SwiftUI so it
 * has the system glass and animation. Android has its own version.
 */
export const CommentOptionsMenu = ({
  options,
  children,
}: CommentOptionsMenuProps) => (
  <Host matchContents>
    <Menu label={<RNHostView matchContents>{children}</RNHostView>}>
      <OptionButtons options={options} />
    </Menu>
  </Host>
);

/**
 * Long-pressing a comment lifts it out of the list with the same actions
 * underneath, as a native iOS context menu.
 */
export const CommentContextMenu = ({
  options,
  children,
}: CommentContextMenuProps) => (
  <Host matchContents={{ vertical: true }} style={{ width: "100%" }}>
    <ContextMenu>
      <ContextMenu.Items>
        <OptionButtons options={options} />
      </ContextMenu.Items>
      <ContextMenu.Trigger>
        <RNHostView matchContents={{ vertical: true }}>{children}</RNHostView>
      </ContextMenu.Trigger>
    </ContextMenu>
  </Host>
);
