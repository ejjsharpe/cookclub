import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export const VSpace = ({ size }: { size: number }) => {
  return <View style={[styles.vspace, { height: size }]} />;
};

const styles = StyleSheet.create({
  vspace: {
    width: "100%",
  },
});
