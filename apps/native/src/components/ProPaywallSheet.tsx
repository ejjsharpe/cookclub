import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { LEGAL_URLS } from "@repo/contracts";
import { Image } from "expo-image";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import type { AdaptyPaywallProduct } from "react-native-adapty";
import { StyleSheet } from "react-native-unistyles";

import type { SubscriptionStatus } from "@/api/subscription";
import startImage11 from "@/assets/images/start-food-11.jpg";
import startImage2 from "@/assets/images/start-food-2.jpg";
import startImage7 from "@/assets/images/start-food-7.jpg";
import { AppSheet } from "@/components/AppSheet";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import {
  ADAPTY_PAYWALL_PLACEMENT_ID,
  adapty,
  hasActiveAdaptyAccess,
  identifyAdaptyUser,
  isAdaptyConfigured,
} from "@/lib/adapty";
import { openExternalWebsite } from "@/lib/externalBrowser";

export interface ProPaywallSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface ProPaywallSheetProps {
  userId: string;
  isPro: boolean;
  smartImportsRemaining: number | null;
  refreshEntitlement: () => Promise<SubscriptionStatus | undefined>;
  onResult: (didUnlock: boolean) => void;
}

const FEATURES: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}[] = [
  {
    icon: "sparkles-outline",
    title: "Unlimited Smart Imports",
    subtitle: "Save recipes from links, images, and text without rationing.",
  },
  {
    icon: "nutrition-outline",
    title: "Nutrition insights",
    subtitle: "See per-serving estimates when you cook from your recipes.",
  },
  {
    icon: "color-wand-outline",
    title: "AI recipe tools",
    subtitle: "Generate ideas and personalise recipes around your kitchen.",
  },
];

const STORE_NAME = process.env.EXPO_OS === "ios" ? "App Store" : "Google Play";
const SUBSCRIPTION_MANAGEMENT_URL =
  process.env.EXPO_OS === "ios"
    ? "https://apps.apple.com/account/subscriptions"
    : "https://play.google.com/store/account/subscriptions?package=com.shakyhand.cookclub";

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function getPeriodLabel(product: AdaptyPaywallProduct) {
  const localized = product.subscription?.localizedSubscriptionPeriod;
  if (localized) return localized.toLowerCase();

  const period = product.subscription?.subscriptionPeriod;
  if (!period) return null;

  const unit = period.unit;
  return period.numberOfUnits === 1 ? unit : `${period.numberOfUnits} ${unit}s`;
}

function getPlanName(product: AdaptyPaywallProduct) {
  const period = product.subscription?.subscriptionPeriod;
  if (period?.unit === "year") return "Annual";
  if (period?.unit === "month") return "Monthly";
  if (period?.unit === "week") return "Weekly";
  return product.localizedTitle || "Pro";
}

function getPrice(product: AdaptyPaywallProduct) {
  return product.price?.localizedString ?? "Select";
}

function getPriceLine(product: AdaptyPaywallProduct) {
  const period = getPeriodLabel(product);
  if (!period) return getPrice(product);
  return `${getPrice(product)} / ${period}`;
}

function getMonthlyEquivalent(product: AdaptyPaywallProduct) {
  const period = product.subscription?.subscriptionPeriod;
  const price = product.price;
  if (!period || period.unit !== "year" || !price?.amount) return null;

  const monthlyAmount = price.amount / (12 * period.numberOfUnits);
  const amount = monthlyAmount.toFixed(2);
  const value = price.currencySymbol
    ? `${price.currencySymbol}${amount}`
    : `${amount} ${price.currencyCode ?? ""}`.trim();

  return `${value} / month`;
}

function isAnnual(product: AdaptyPaywallProduct) {
  return product.subscription?.subscriptionPeriod?.unit === "year";
}

export const ProPaywallSheet = forwardRef<
  ProPaywallSheetRef,
  ProPaywallSheetProps
>(
  (
    { userId, isPro, smartImportsRemaining, refreshEntitlement, onResult },
    ref,
  ) => {
    const sheetRef = useRef<TrueSheet>(null);
    const resultSettledRef = useRef(false);
    const loadRequestIdRef = useRef(0);
    const [products, setProducts] = useState<AdaptyPaywallProduct[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string | null>(
      null,
    );
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isPurchasing, setIsPurchasing] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);

    const selectedProduct =
      products.find(
        (product) => product.vendorProductId === selectedProductId,
      ) ?? null;
    const isBusy = isLoading || isPurchasing || isRestoring;

    const resolve = useCallback(
      (didUnlock: boolean) => {
        if (resultSettledRef.current) return;
        resultSettledRef.current = true;
        onResult(didUnlock);
      },
      [onResult],
    );

    const loadProducts = useCallback(async () => {
      const requestId = ++loadRequestIdRef.current;

      if (!isAdaptyConfigured()) {
        setIsLoading(false);
        setLoadError("Subscriptions are unavailable for this build.");
        return;
      }

      setIsLoading(true);
      setLoadError(null);

      try {
        await identifyAdaptyUser(userId);
        const nextPaywall = await adapty.getFlow(ADAPTY_PAYWALL_PLACEMENT_ID);
        const nextProducts = await adapty.getPaywallProducts(nextPaywall);

        if (requestId !== loadRequestIdRef.current) return;

        setProducts(nextProducts);
        setSelectedProductId(
          nextProducts.find(isAnnual)?.vendorProductId ??
            nextProducts[0]?.vendorProductId ??
            null,
        );

        adapty.logShowFlow(nextPaywall).catch((error) => {
          console.log("Adapty paywall view logging failed:", error);
        });
      } catch (error) {
        if (requestId !== loadRequestIdRef.current) return;

        setLoadError(
          getErrorMessage(error, "Could not load subscription options."),
        );
      } finally {
        if (requestId === loadRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, [userId]);

    useImperativeHandle(
      ref,
      () => ({
        present: () => {
          resultSettledRef.current = false;
          loadRequestIdRef.current += 1;
          setProducts([]);
          setSelectedProductId(null);
          setLoadError(null);
          setIsLoading(false);
          sheetRef.current?.present();
          if (!isPro) {
            loadProducts();
          }
        },
        dismiss: () => sheetRef.current?.dismiss(),
      }),
      [isPro, loadProducts],
    );

    const handleDidDismiss = useCallback(() => {
      loadRequestIdRef.current += 1;
      if (!resultSettledRef.current) {
        onResult(false);
      }
      resultSettledRef.current = false;
      setIsPurchasing(false);
      setIsRestoring(false);
    }, [onResult]);

    const completeAndDismiss = useCallback(
      (didUnlock: boolean) => {
        resolve(didUnlock);
        sheetRef.current?.dismiss();
      },
      [resolve],
    );

    const handlePurchase = useCallback(async () => {
      if (!selectedProduct || isPurchasing || isRestoring) return;

      setIsPurchasing(true);
      try {
        const result = await adapty.makePurchase(selectedProduct);

        if (result.type === "success") {
          await refreshEntitlement().catch((error) => {
            console.log("Subscription refresh failed:", error);
          });
          completeAndDismiss(true);
          return;
        }

        if (result.type === "pending") {
          Alert.alert(
            "Purchase pending",
            "Your subscription will unlock when the purchase is confirmed.",
          );
        }
      } catch (error) {
        const message = getErrorMessage(
          error,
          "Could not complete the purchase. Please try again.",
        );
        if (!/cancel/i.test(message)) {
          Alert.alert("Purchase failed", message);
        }
      } finally {
        setIsPurchasing(false);
      }
    }, [
      completeAndDismiss,
      isPurchasing,
      isRestoring,
      refreshEntitlement,
      selectedProduct,
    ]);

    const handleRestore = useCallback(async () => {
      if (isPurchasing || isRestoring) return;

      setIsRestoring(true);
      try {
        const profile = await adapty.restorePurchases();
        const refreshedStatus = await refreshEntitlement().catch((error) => {
          console.log("Subscription refresh failed:", error);
          return undefined;
        });

        if (hasActiveAdaptyAccess(profile) || refreshedStatus?.isPro) {
          Alert.alert("Purchases restored", "cookclub Pro is active.");
          completeAndDismiss(true);
          return;
        }

        Alert.alert(
          "No active subscription",
          "We couldn't find an active cookclub Pro subscription.",
        );
      } catch (error) {
        Alert.alert(
          "Restore failed",
          getErrorMessage(error, "Could not restore purchases."),
        );
      } finally {
        setIsRestoring(false);
      }
    }, [completeAndDismiss, isPurchasing, isRestoring, refreshEntitlement]);

    const footer = (
      <View style={styles.footer}>
        <PrimaryButton
          onPress={isPro ? () => completeAndDismiss(true) : handlePurchase}
          disabled={!isPro && (!selectedProduct || isBusy)}
        >
          {isPro
            ? "Done"
            : isPurchasing
              ? "Starting Pro..."
              : selectedProduct
                ? `Start ${getPlanName(selectedProduct)} Pro`
                : "Start Pro"}
        </PrimaryButton>
        <View style={styles.footerLinks}>
          <TouchableOpacity
            onPress={handleRestore}
            disabled={isBusy}
            activeOpacity={0.7}
          >
            <Text style={[styles.restoreText, isBusy && styles.disabledText]}>
              {isRestoring ? "Restoring..." : "Restore purchases"}
            </Text>
          </TouchableOpacity>
          <Text style={styles.footerNote}>
            {isPro
              ? `Managed through ${STORE_NAME}.`
              : `Cancel anytime in ${STORE_NAME}.`}
          </Text>
        </View>
      </View>
    );

    return (
      <AppSheet
        ref={sheetRef}
        title="cookclub Pro"
        subtitle={
          isPro
            ? "Active subscription"
            : `${smartImportsRemaining ?? 0} Smart Imports left`
        }
        detents={[0.92]}
        scrollable
        dismissible={!isBusy}
        draggable={!isBusy}
        closeDisabled={isBusy}
        footer={footer}
        footerStyle={styles.footerContainer}
        onDidDismiss={handleDidDismiss}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.hero}>
            <Image source={startImage11} style={styles.heroImageLarge} />
            <View style={styles.heroSide}>
              <Image source={startImage2} style={styles.heroImageSmall} />
              <Image source={startImage7} style={styles.heroImageSmall} />
            </View>
            <View style={styles.heroBadge}>
              <Ionicons
                name="sparkles"
                size={15}
                style={styles.heroBadgeIcon}
              />
              <Text style={styles.heroBadgeText}>Pro</Text>
            </View>
          </View>

          <View style={styles.intro}>
            <Text type="title1" style={styles.title}>
              Cook with fewer limits.
            </Text>
            <Text type="bodyFaded" style={styles.subtitle}>
              Upgrade for the recipe tools that make cookclub feel effortless.
            </Text>
          </View>

          <View style={styles.featureList}>
            {FEATURES.map((feature) => (
              <View key={feature.title} style={styles.featureRow}>
                <View style={styles.featureIconCircle}>
                  <Ionicons
                    name={feature.icon}
                    size={18}
                    style={styles.featureIcon}
                  />
                </View>
                <View style={styles.featureCopy}>
                  <Text type="headline" style={styles.featureTitle}>
                    {feature.title}
                  </Text>
                  <Text type="caption" style={styles.featureSubtitle}>
                    {feature.subtitle}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.plansHeader}>
            <Text type="headline" style={styles.sectionHeading}>
              {isPro ? "Subscription" : "Choose a plan"}
            </Text>
            {!isPro && isLoading ? <ActivityIndicator size="small" /> : null}
          </View>

          {isPro ? (
            <View style={styles.activeBox}>
              <View style={styles.activeIconCircle}>
                <Ionicons
                  name="checkmark"
                  size={18}
                  style={styles.activeIcon}
                />
              </View>
              <View style={styles.activeCopy}>
                <Text type="headline" style={styles.activeTitle}>
                  cookclub Pro is active
                </Text>
                <Text type="caption" style={styles.activeSubtitle}>
                  Your account has access to all Pro tools.
                </Text>
              </View>
            </View>
          ) : null}

          {!isPro && loadError ? (
            <View style={styles.messageBox}>
              <Text type="subheadline" style={styles.messageText}>
                {loadError}
              </Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={loadProducts}
                activeOpacity={0.75}
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!isPro && !loadError && !isLoading && products.length === 0 ? (
            <View style={styles.messageBox}>
              <Text type="subheadline" style={styles.messageText}>
                No plans are available right now.
              </Text>
            </View>
          ) : null}

          {!isPro ? (
            <View style={styles.planList}>
              {products.map((product) => {
                const selected = product.vendorProductId === selectedProductId;
                const monthlyEquivalent = getMonthlyEquivalent(product);

                return (
                  <TouchableOpacity
                    key={product.vendorProductId}
                    style={[
                      styles.planCard,
                      selected && styles.planCardSelected,
                    ]}
                    onPress={() =>
                      setSelectedProductId(product.vendorProductId)
                    }
                    activeOpacity={0.78}
                    disabled={isBusy}
                  >
                    <View style={styles.planCopy}>
                      <View style={styles.planTitleRow}>
                        <Text type="headline" style={styles.planTitle}>
                          {getPlanName(product)}
                        </Text>
                        {isAnnual(product) ? (
                          <View style={styles.valueBadge}>
                            <Text style={styles.valueBadgeText}>
                              Best value
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text type="title3" style={styles.planPrice}>
                        {getPriceLine(product)}
                      </Text>
                      {monthlyEquivalent ? (
                        <Text type="caption" style={styles.planMeta}>
                          {monthlyEquivalent}
                        </Text>
                      ) : (
                        <Text type="caption" style={styles.planMeta}>
                          {product.localizedDescription || "cookclub Pro"}
                        </Text>
                      )}
                    </View>
                    <View
                      style={[
                        styles.radioOuter,
                        selected && styles.radioSelected,
                      ]}
                    >
                      {selected ? <View style={styles.radioInner} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <View style={styles.subscriptionDisclosure}>
            <Text type="caption" style={styles.disclosureText}>
              {selectedProduct
                ? `${getPriceLine(selectedProduct)}. Payment is charged to your ${STORE_NAME} account when you confirm. `
                : "Payment is charged to your store account when you confirm. "}
              Subscriptions renew automatically unless cancelled at least 24
              hours before the current period ends. No free trial is included.
            </Text>
            <View style={styles.legalLinkRow}>
              <TouchableOpacity
                onPress={() => openExternalWebsite(LEGAL_URLS.terms)}
              >
                <Text style={styles.legalLink}>Terms</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openExternalWebsite(LEGAL_URLS.privacy)}
              >
                <Text style={styles.legalLink}>Privacy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openExternalWebsite(SUBSCRIPTION_MANAGEMENT_URL)}
              >
                <Text style={styles.legalLink}>Manage subscription</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </AppSheet>
    );
  },
);

const styles = StyleSheet.create((theme, rt) => ({
  content: {
    paddingHorizontal: 20,
    paddingBottom: 132,
    gap: 22,
  },
  hero: {
    height: 176,
    flexDirection: "row",
    gap: 8,
    borderRadius: theme.borderRadius.large,
    overflow: "hidden",
    backgroundColor: theme.colors.inputBackground,
  },
  heroImageLarge: {
    flex: 1.25,
    height: "100%",
  },
  heroSide: {
    flex: 0.82,
    gap: 8,
  },
  heroImageSmall: {
    flex: 1,
    width: "100%",
  },
  heroBadge: {
    position: "absolute",
    left: 12,
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.background,
  },
  heroBadgeIcon: {
    color: theme.colors.primary,
  },
  heroBadgeText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.semiBold,
    fontSize: 13,
    letterSpacing: 0,
  },
  intro: {
    gap: 8,
  },
  title: {
    letterSpacing: 0,
  },
  subtitle: {
    maxWidth: 330,
    letterSpacing: 0,
  },
  featureList: {
    gap: 10,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: theme.borderRadius.medium,
    backgroundColor: theme.colors.inputBackground,
  },
  featureIconCircle: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  featureIcon: {
    color: theme.colors.primary,
  },
  featureCopy: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    fontSize: 16,
    letterSpacing: 0,
  },
  featureSubtitle: {
    color: theme.colors.textSecondary,
    letterSpacing: 0,
  },
  plansHeader: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionHeading: {
    letterSpacing: 0,
  },
  activeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: theme.borderRadius.large,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary + "0D",
  },
  activeIconCircle: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  activeIcon: {
    color: theme.colors.buttonText,
  },
  activeCopy: {
    flex: 1,
    gap: 2,
  },
  activeTitle: {
    fontSize: 16,
    letterSpacing: 0,
  },
  activeSubtitle: {
    color: theme.colors.textSecondary,
    letterSpacing: 0,
  },
  messageBox: {
    gap: 12,
    padding: 16,
    borderRadius: theme.borderRadius.medium,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  messageText: {
    color: theme.colors.textSecondary,
    letterSpacing: 0,
  },
  retryButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    height: 34,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  retryText: {
    color: theme.colors.text,
    fontFamily: theme.fonts.semiBold,
    fontSize: 14,
    letterSpacing: 0,
  },
  planList: {
    gap: 10,
  },
  subscriptionDisclosure: { gap: 10 },
  disclosureText: {
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },
  legalLinkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  legalLink: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.semiBold,
    fontSize: 13,
  },
  planCard: {
    minHeight: 112,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    borderRadius: theme.borderRadius.large,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  planCardSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary + "0D",
  },
  planCopy: {
    flex: 1,
    gap: 5,
  },
  planTitleRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  planTitle: {
    fontSize: 16,
    letterSpacing: 0,
  },
  valueBadge: {
    paddingHorizontal: 8,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  valueBadgeText: {
    color: theme.colors.buttonText,
    fontSize: 12,
    fontFamily: theme.fonts.semiBold,
    letterSpacing: 0,
  },
  planPrice: {
    color: theme.colors.text,
    letterSpacing: 0,
  },
  planMeta: {
    color: theme.colors.textSecondary,
    letterSpacing: 0,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    borderColor: theme.colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
  },
  footerContainer: {
    backgroundColor: theme.colors.background,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: rt.insets.bottom + 14,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  footerLinks: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  restoreText: {
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: theme.fonts.semiBold,
    letterSpacing: 0,
  },
  footerNote: {
    flex: 1,
    color: theme.colors.textSecondary,
    fontSize: 13,
    textAlign: "right",
    letterSpacing: 0,
  },
  disabledText: {
    opacity: 0.45,
  },
}));
