import { createStaticNavigation } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { lazy } from "react";

import { TabNavigator } from "./TabNavigator";

import {
  useIsSignedIn,
  useIsSignedOut,
  useNeedsOnboarding,
} from "@/lib/signedInContext";
import type { AppParamList } from "@/navigation/navigationRef";
export { navigationRef } from "@/navigation/navigationRef";
import { AccountScreen } from "@/screens/AccountScreen";
import { CollectionDetailScreen } from "@/screens/CollectionDetailScreen";
import { CookModeScreen } from "@/screens/CookModeScreen";
import { EmailVerificationScreen } from "@/screens/EmailVerificationScreen";
import { FollowsScreen } from "@/screens/FollowsScreen";
import GenerateRecipeScreen from "@/screens/GenerateRecipeScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import OnboardingScreen from "@/screens/OnboardingScreen";
import { RecipeDetailScreen } from "@/screens/RecipeDetailScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { UserProfileScreen } from "@/screens/UserProfileScreen";

const StartScreen = lazy(() => import("@/screens/StartScreen"));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RootNavigator = createNativeStackNavigator<AppParamList>();
type RootNavigatorType = typeof RootNavigator;

declare module "@react-navigation/core" {
  interface RootNavigator extends RootNavigatorType {}
}

const RootStack = createNativeStackNavigator({
  screens: {
    // Common screens
  },
  groups: {
    Onboarding: {
      if: useNeedsOnboarding,
      screenOptions: {
        headerShown: false,
        gestureEnabled: false, // Prevent swiping back
      },
      screens: {
        Onboarding: { screen: OnboardingScreen },
      },
    },
    SignedIn: {
      if: useIsSignedIn,
      screenOptions: {
        headerShown: false,
      },
      screens: {
        Tabs: TabNavigator,
        GenerateRecipe: { screen: GenerateRecipeScreen },
        Settings: { screen: SettingsScreen },
        Notifications: { screen: NotificationsScreen },
        UserProfile: { screen: UserProfileScreen },
        FollowsList: { screen: FollowsScreen },
        RecipeDetail: {
          screen: RecipeDetailScreen,
          options: {
            headerShown: true,
            headerTransparent: true,
            headerTitle: "",
            headerBackButtonDisplayMode: "minimal",
          },
        },
        CollectionDetail: { screen: CollectionDetailScreen },
        Account: { screen: AccountScreen },
        CookMode: {
          screen: CookModeScreen,
          options: {
            presentation: "fullScreenModal",
            animation: "slide_from_bottom",
          },
        },
      },
    },

    SignedOut: {
      if: useIsSignedOut,
      screenOptions: {
        headerShown: false,
      },
      screens: {
        Start: { screen: StartScreen },
        EmailVerification: { screen: EmailVerificationScreen },
      },
    },
  },
});

export const Navigation = createStaticNavigation(RootStack);
