import { useNavigation } from "@react-navigation/native";
import { LEGAL_URLS } from "@repo/contracts";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  StyleSheet,
  useUnistyles,
  withUnistyles,
} from "react-native-unistyles";

import { useSignOut } from "@/api/auth";
import {
  currentTermsAcceptanceInput,
  useAcceptCurrentTerms,
  useLegalStatus,
} from "@/api/legal";
import { useDeleteAccount, useUpdateProfile, useUser } from "@/api/user";
import { Avatar } from "@/components/Avatar";
import {
  SegmentedControl,
  type TabOption,
} from "@/components/SegmentedControl";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { TopScrollFade } from "@/components/TopScrollFade";
import { GLASS_CONTROL_SIZE, GlassSurface } from "@/components/glass/Glass";
import { GlassCircleButton } from "@/components/glass/GlassCircleButton";
import { alertApiError } from "@/lib/apiErrorAlert";
import {
  openExternalWebsite,
  setExternalBrowserPreference,
  useExternalBrowserPreference,
  type ExternalBrowserPreference,
} from "@/lib/externalBrowser";
import type { MeasurementSystem } from "@/lib/measurementPreferences";
import { useSubscription } from "@/lib/subscription";
import {
  applyThemePreference,
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from "@/lib/themePreferences";

const StyledScrollView = withUnistyles(ScrollView);

const THEME_OPTIONS: TabOption<ThemePreference>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match phone" },
];

const MEASUREMENT_OPTIONS: TabOption<MeasurementSystem>[] = [
  { value: "metric", label: "Metric" },
  { value: "imperial", label: "Imperial" },
  { value: "auto", label: "As written" },
];

const BROWSER_OPTIONS: TabOption<ExternalBrowserPreference>[] = [
  { value: "in_app", label: "In cookclub" },
  {
    value: "system",
    label: process.env.EXPO_OS === "ios" ? "In Safari" : "In browser",
  },
];

/** Free accounts get this many smart imports a month. */
const FREE_SMART_IMPORTS = 5;

/** How far the large title scrolls before the glass title takes over. */
const TITLE_SCROLL_THRESHOLD = 44;

const SUBSCRIPTION_URL =
  process.env.EXPO_OS === "ios"
    ? "https://apps.apple.com/account/subscriptions"
    : "https://play.google.com/store/account/subscriptions?package=com.shakyhand.cookclub";

/** The row "goes somewhere" chevron, in the system style. */
const Chevron = () => {
  const { theme } = useUnistyles();
  return (
    <SystemIcon
      sf="chevron.forward"
      android="chevron-forward"
      size={15}
      color={theme.colors.textTertiary}
    />
  );
};

const SectionTitle = ({ children }: { children: string }) => (
  <Text type="title3" style={styles.sectionTitle} accessibilityRole="header">
    {children}
  </Text>
);

const Row = ({
  label,
  value,
  onPress,
  last,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={value ? `${label}, ${value}` : label}
    style={({ pressed }) => [styles.rowHit, pressed && styles.rowPressed]}
  >
    <View style={[styles.row, last && styles.rowLast]}>
      <Text type="body" style={styles.rowLabel}>
        {label}
      </Text>
      {value ? (
        <Text type="callout" style={styles.rowValue}>
          {value}
        </Text>
      ) : null}
      <Chevron />
    </View>
  </Pressable>
);

export const SettingsScreen = () => {
  const { theme } = useUnistyles();
  const navigation = useNavigation();
  const signOutMutation = useSignOut();
  const deleteAccountMutation = useDeleteAccount();
  const legalStatus = useLegalStatus();
  const acceptTerms = useAcceptCurrentTerms();
  const updateProfileMutation = useUpdateProfile();
  const { data: userData } = useUser();
  const user = userData?.user;
  const { isPro, smartImportsRemaining, presentPaywall, restorePurchases } =
    useSubscription();
  const currentExternalBrowser = useExternalBrowserPreference();
  const [currentTheme, setCurrentTheme] =
    useState<ThemePreference>(getThemePreference);
  const [currentMeasurement, setCurrentMeasurement] =
    useState<MeasurementSystem>(
      (user?.measurementPreference as MeasurementSystem) ?? "auto",
    );
  const [isTitleCollapsed, setIsTitleCollapsed] = useState(false);

  const version = Constants.expoConfig?.version;

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const collapsed =
      event.nativeEvent.contentOffset.y > TITLE_SCROLL_THRESHOLD;
    if (collapsed !== isTitleCollapsed) setIsTitleCollapsed(collapsed);
  };

  const handleThemeChange = (theme: ThemePreference) => {
    setCurrentTheme(theme);
    setThemePreference(theme);
    applyThemePreference(theme);
  };

  const savedMeasurement = user?.measurementPreference as
    MeasurementSystem | undefined;
  // The account may load after this screen opens.
  useEffect(() => {
    if (savedMeasurement) setCurrentMeasurement(savedMeasurement);
  }, [savedMeasurement]);

  const handleMeasurementChange = (system: MeasurementSystem) => {
    const previous = currentMeasurement;
    setCurrentMeasurement(system);
    updateProfileMutation.mutate(
      { measurementPreference: system },
      {
        onError: (error) => {
          setCurrentMeasurement(previous);
          alertApiError("Couldn't change measurements", error, {
            operation: "user.updateProfile",
            fallback: "Please try again.",
          });
        },
      },
    );
  };

  const handleSignOut = () => {
    Alert.alert("Sign out?", "You can sign back in at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => signOutMutation.mutate(),
      },
    ]);
  };

  const deleteAccount = () => {
    deleteAccountMutation.mutate(undefined, {
      onError: (error) => {
        alertApiError("Delete Account Failed", error, {
          operation: "account.delete",
          fallback: "Please try again.",
        });
      },
    });
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your cookclub account and app data. It does not cancel any App Store or Google Play subscription.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Delete account permanently?",
              "This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete account",
                  style: "destructive",
                  onPress: deleteAccount,
                },
              ],
            );
          },
        },
      ],
    );
  };

  const handleTermsAcceptance = () => {
    if (legalStatus.data?.hasAcceptedCurrentTerms) {
      openExternalWebsite(LEGAL_URLS.terms);
      return;
    }

    Alert.alert(
      "Accept current Terms?",
      "Read the Terms of Service before accepting. Acceptance is required before publishing public content.",
      [
        {
          text: "Read Terms",
          onPress: () => openExternalWebsite(LEGAL_URLS.terms),
        },
        { text: "Cancel", style: "cancel" },
        {
          text: "Accept",
          onPress: () =>
            acceptTerms.mutate(currentTermsAcceptanceInput, {
              onError: (error) =>
                alertApiError("Acceptance Failed", error, {
                  operation: "legal.acceptTerms",
                  fallback:
                    "Could not record your acceptance. Please try again.",
                }),
            }),
        },
      ],
    );
  };

  const proSubtitle = isPro
    ? "Active"
    : `${smartImportsRemaining ?? 0} of ${FREE_SMART_IMPORTS} smart imports left`;

  return (
    <View style={styles.container}>
      <StyledScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={32}
      >
        <Text type="largeTitle" style={styles.title} accessibilityRole="header">
          Settings
        </Text>

        {user ? (
          <Pressable
            onPress={() => navigation.navigate("Account")}
            accessibilityRole="button"
            accessibilityLabel={`Account, ${user.name}`}
            accessibilityHint="Edit your name, username, email and photo"
            style={({ pressed }) => [styles.me, pressed && styles.rowPressed]}
          >
            <Avatar
              imageUrl={user.image}
              imageVersion={user.updatedAt}
              name={user.name}
              size={48}
            />
            <View style={styles.meText}>
              <Text type="headline" numberOfLines={1}>
                {user.name}
              </Text>
              <Text type="subheadline" style={styles.muted} numberOfLines={1}>
                {user.email}
              </Text>
            </View>
            <Chevron />
          </Pressable>
        ) : null}

        <Pressable
          onPress={presentPaywall}
          accessibilityRole="button"
          accessibilityLabel={`cookclub Pro, ${proSubtitle}`}
          style={({ pressed }) => [styles.pro, pressed && styles.rowPressed]}
        >
          <SystemIcon
            sf="sparkles"
            android="sparkles"
            size={20}
            color={theme.colors.primary}
          />
          <View style={styles.proText}>
            <Text type="headline">cookclub Pro</Text>
            <Text type="footnote" style={styles.muted}>
              {proSubtitle}
            </Text>
          </View>
          <Text type="headline" style={styles.proAction}>
            {isPro ? "Manage" : "Upgrade"}
          </Text>
        </Pressable>

        <SectionTitle>Appearance</SectionTitle>
        <View style={styles.segment}>
          <SegmentedControl
            fullWidth
            compact
            options={THEME_OPTIONS}
            value={currentTheme}
            onValueChange={handleThemeChange}
          />
        </View>

        <SectionTitle>Measurements</SectionTitle>
        <View style={styles.segment}>
          <SegmentedControl
            fullWidth
            compact
            options={MEASUREMENT_OPTIONS}
            value={currentMeasurement}
            onValueChange={handleMeasurementChange}
          />
        </View>
        <Text type="footnote" style={styles.note}>
          As written keeps each recipe in the units it came with.
        </Text>

        <SectionTitle>Open recipe websites</SectionTitle>
        <View style={styles.segment}>
          <SegmentedControl
            fullWidth
            compact
            options={BROWSER_OPTIONS}
            value={currentExternalBrowser}
            onValueChange={setExternalBrowserPreference}
          />
        </View>
        {currentExternalBrowser ? null : (
          <Text type="footnote" style={styles.note}>
            You’ll be asked the first time you open one.
          </Text>
        )}

        <SectionTitle>Safety and legal</SectionTitle>
        <View style={styles.rows}>
          <Row
            label="Blocked users"
            onPress={() => navigation.navigate("BlockedUsers")}
          />
          <Row
            label="Privacy policy"
            onPress={() => openExternalWebsite(LEGAL_URLS.privacy)}
          />
          <Row
            label="Terms of service"
            value={
              legalStatus.data?.hasAcceptedCurrentTerms ? "Accepted" : "Review"
            }
            onPress={handleTermsAcceptance}
          />
          <Row
            label="Support"
            onPress={() => openExternalWebsite(LEGAL_URLS.support)}
            last
          />
        </View>

        <SectionTitle>Subscription</SectionTitle>
        <View style={styles.rows}>
          <Row
            label="Manage subscription"
            onPress={() => openExternalWebsite(SUBSCRIPTION_URL)}
          />
          <Row label="Restore purchases" onPress={restorePurchases} last />
        </View>

        <Pressable
          onPress={handleSignOut}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.signOut,
            pressed && styles.rowPressed,
          ]}
        >
          <Text type="headline">Sign out</Text>
        </Pressable>

        <Pressable
          onPress={handleDeleteAccount}
          disabled={deleteAccountMutation.isPending}
          accessibilityRole="button"
          accessibilityState={{ busy: deleteAccountMutation.isPending }}
          style={({ pressed }) => [styles.delete, pressed && styles.rowPressed]}
        >
          <Text type="subheadline" style={styles.deleteText}>
            {deleteAccountMutation.isPending
              ? "Deleting account…"
              : "Delete account"}
          </Text>
        </Pressable>

        {version ? (
          <Text type="footnote" style={styles.version}>
            cookclub {version}
          </Text>
        ) : null}
      </StyledScrollView>

      <TopScrollFade />
      <View style={styles.toolbar} pointerEvents="box-none">
        <GlassCircleButton
          icon={{ sf: "chevron.backward", android: "chevron-back" }}
          accessibilityLabel="Go back"
          onPress={navigation.goBack}
        />
        <GlassSurface
          hidden={!isTitleCollapsed}
          style={styles.titlePill}
          contentStyle={styles.titlePillContent}
        >
          {/* The large title already says this to screen readers. */}
          <Text
            type="headline"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            Settings
          </Text>
        </GlassSurface>
        <View style={styles.toolbarSpacer} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingTop: rt.insets.top + GLASS_CONTROL_SIZE + 20,
    paddingBottom: rt.insets.bottom + 32,
  },
  toolbar: {
    position: "absolute",
    top: rt.insets.top + 4,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toolbarSpacer: {
    width: GLASS_CONTROL_SIZE,
  },
  titlePill: {
    height: GLASS_CONTROL_SIZE,
    borderRadius: GLASS_CONTROL_SIZE / 2,
  },
  titlePillContent: {
    flex: 1,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  title: {
    paddingHorizontal: 20,
  },
  me: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginTop: 8,
  },
  meText: {
    flex: 1,
    minWidth: 0,
  },
  muted: {
    color: theme.colors.textSecondary,
  },
  pro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    marginHorizontal: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: theme.colors.inputBackground,
  },
  proIcon: {
    color: theme.colors.primary,
  },
  proText: {
    flex: 1,
    minWidth: 0,
  },
  proAction: {
    color: theme.colors.primary,
  },
  sectionTitle: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 12,
  },
  segment: {
    paddingHorizontal: 20,
  },
  note: {
    color: theme.colors.textSecondary,
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  rows: {
    paddingLeft: 20,
  },
  rowHit: {
    paddingRight: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowLabel: {
    flex: 1,
  },
  rowValue: {
    color: theme.colors.textSecondary,
  },
  chevron: {
    color: theme.colors.textTertiary,
  },
  signOut: {
    height: 50,
    marginTop: 28,
    marginHorizontal: 20,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  delete: {
    alignSelf: "center",
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  deleteText: {
    color: theme.colors.destructive,
    fontFamily: theme.fonts.bold,
  },
  version: {
    color: theme.colors.textTertiary,
    textAlign: "center",
  },
}));
