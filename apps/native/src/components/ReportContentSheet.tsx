import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useCreateReport } from "@/api/moderation";
import { AppSheet } from "@/components/AppSheet";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { alertApiError } from "@/lib/apiErrorAlert";

type ReportTargetType = "user" | "comment" | "activity" | "recipe";
type ReportReason =
  | "spam_scam"
  | "harassment_hate"
  | "sexual_content"
  | "violence_danger"
  | "child_safety"
  | "intellectual_property"
  | "other";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam_scam", label: "Spam or scam" },
  { value: "harassment_hate", label: "Harassment or hate" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "violence_danger", label: "Violence or dangerous content" },
  { value: "child_safety", label: "Child safety" },
  { value: "intellectual_property", label: "Intellectual property" },
  { value: "other", label: "Other" },
];

export interface ReportContentSheetRef {
  present(target: { targetType: ReportTargetType; targetId: string }): void;
}

export const ReportContentSheet = forwardRef<ReportContentSheetRef>(
  function ReportContentSheet(_props, ref) {
    const sheetRef = useRef<TrueSheet>(null);
    const reportMutation = useCreateReport();
    const [target, setTarget] = useState<{
      targetType: ReportTargetType;
      targetId: string;
    } | null>(null);
    const [reason, setReason] = useState<ReportReason | null>(null);
    const [details, setDetails] = useState("");

    useImperativeHandle(ref, () => ({
      present(nextTarget) {
        setTarget(nextTarget);
        setReason(null);
        setDetails("");
        sheetRef.current?.present();
      },
    }));

    const submit = async () => {
      if (!target || !reason) return;
      try {
        await reportMutation.mutateAsync({
          ...target,
          reason,
          details: details.trim() || undefined,
        });
        await sheetRef.current?.dismiss();
        Alert.alert(
          "Report received",
          "Thank you. cookclub will review this report.",
        );
      } catch (error) {
        alertApiError("Report Failed", error, {
          operation: "moderation.createReport",
          fallback: "Could not submit your report. Please try again.",
        });
      }
    };

    return (
      <AppSheet
        ref={sheetRef}
        title="Report content"
        subtitle="Choose the reason that best describes the issue."
        detents={[0.78]}
        scrollable
        dismissible={!reportMutation.isPending}
        draggable={!reportMutation.isPending}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
        >
          <View style={styles.reasons}>
            {REASONS.map((item) => {
              const selected = reason === item.value;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={item.value}
                  onPress={() => setReason(item.value)}
                  style={[styles.reason, selected && styles.reasonSelected]}
                >
                  <Text type="body">{item.label}</Text>
                  <Ionicons
                    name={selected ? "radio-button-on" : "radio-button-off"}
                    size={21}
                    style={selected ? styles.selectedIcon : styles.icon}
                  />
                </Pressable>
              );
            })}
          </View>
          <TextInput
            accessibilityLabel="Additional report details"
            maxLength={1_000}
            multiline
            onChangeText={setDetails}
            placeholder="Add details (optional)"
            placeholderTextColor="#888888"
            style={styles.details}
            textAlignVertical="top"
            value={details}
          />
          <Text type="caption" style={styles.counter}>
            {details.length}/1000
          </Text>
          <PrimaryButton
            disabled={!reason || reportMutation.isPending}
            onPress={submit}
          >
            {reportMutation.isPending ? "Submitting…" : "Submit report"}
          </PrimaryButton>
        </ScrollView>
      </AppSheet>
    );
  },
);

const styles = StyleSheet.create((theme, rt) => ({
  content: {
    paddingHorizontal: 20,
    paddingBottom: rt.insets.bottom + 28,
    gap: 12,
  },
  reasons: { gap: 8 },
  reason: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.medium,
  },
  reasonSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary + "10",
  },
  icon: { color: theme.colors.textTertiary },
  selectedIcon: { color: theme.colors.primary },
  details: {
    minHeight: 104,
    padding: 14,
    color: theme.colors.text,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: theme.borderRadius.medium,
  },
  counter: {
    textAlign: "right",
    color: theme.colors.textTertiary,
    fontVariant: ["tabular-nums"],
  },
}));
