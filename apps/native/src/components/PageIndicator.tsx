import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./Text";

interface PageIndicatorProps {
  currentPage: number;
  totalPages: number;
}

export const PageIndicator = ({
  currentPage,
  totalPages,
}: PageIndicatorProps) => {
  if (totalPages <= 1) return null;

  return (
    <View pointerEvents="none" style={styles.container}>
      <Text style={styles.text}>
        {currentPage} / {totalPages}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create(() => ({
  container: {
    position: "absolute",
    bottom: 32,
    right: 16,
    minHeight: 30,
    backgroundColor: "rgba(0,0,0,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    zIndex: 20,
    elevation: 2,
  },
  text: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
}));
