import { Keyboard } from "react-native";

/**
 * Opening a native menu takes focus from any text field, and iOS hides the
 * keyboard without the keyboard events a field riding on it follows, so the
 * field would be left floating and then jump when the keyboard returned. Put
 * the keyboard away first so the field goes down with it.
 */
export const dismissKeyboardForMenu = () => {
  if (Keyboard.isVisible()) Keyboard.dismiss();
};
