import { createStaticNavigation } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { lazy } from "react";

import { TabNavigator } from "./TabNavigator";

import {
  useIsSignedIn,
  useIsSignedOut,
  useNeedsOnboarding,
} from "@/lib/signedInContext";
import type { RootStackParamList } from "@/navigation/navigationRef";
import { AccountScreen } from "@/screens/AccountScreen";
import { ActivityScreen } from "@/screens/ActivityScreen";
import { BlockedUsersScreen } from "@/screens/BlockedUsersScreen";
import { CollectionDetailScreen } from "@/screens/CollectionDetailScreen";
import { CookModeScreen } from "@/screens/CookModeScreen";
import { EmailVerificationScreen } from "@/screens/EmailVerificationScreen";
import {
  FIND_COOKS_SEARCH_BAR,
  FindCooksScreen,
} from "@/screens/FindCooksScreen";
import { FollowsScreen } from "@/screens/FollowsScreen";
import GenerateRecipeScreen from "@/screens/GenerateRecipeScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import OnboardingScreen from "@/screens/OnboardingScreen";
import { RecipeDetailScreen } from "@/screens/RecipeDetailScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { UserProfileScreen } from "@/screens/UserProfileScreen";
export { navigationRef } from "@/navigation/navigationRef";

const StartScreen = lazy(() => import("@/screens/StartScreen"));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RootNavigator = createNativeStackNavigator<RootStackParamList>();
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
        BlockedUsers: { screen: BlockedUsersScreen },
        Notifications: { screen: NotificationsScreen },
        FindCooks: {
          screen: FindCooksScreen,
          options: ({ theme }) => ({
            headerShown: true,
            title: "Find cooks",
            headerSearchBarOptions: {
              ...FIND_COOKS_SEARCH_BAR,
              tintColor: theme.colors.primary,
            },
            // The list runs under the glass bar and insets itself
            // (contentInsetAdjustmentBehavior).
            headerTransparent: true,
            headerShadowVisible: false,
            headerBackButtonDisplayMode: "minimal",
            headerTitleStyle: { fontFamily: "Satoshi-Bold" },
          }),
        },
        Activity: {
          screen: ActivityScreen,
          linking: {
            path: "activity/:activityEventId",
            parse: {
              activityEventId: Number,
              commentId: Number,
            },
          },
        },
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
