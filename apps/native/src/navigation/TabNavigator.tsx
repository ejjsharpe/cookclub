import { createNativeBottomTabNavigator } from "@react-navigation/bottom-tabs/unstable";
import { useUnistyles } from "react-native-unistyles";

import { useAddRecipe } from "@/features/add-recipe/AddRecipeProvider";
import type { TabParamList } from "@/navigation/navigationRef";
import { signatureTabIcon } from "@/navigation/tabIcons";
import { AddRecipeScreen } from "@/screens/AddRecipeScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { MealPlanScreen } from "@/screens/MealPlanScreen";
import { MyRecipesScreen } from "@/screens/MyRecipesScreen";
import { ShoppingListScreen } from "@/screens/ShoppingListScreen";

const Tab = createNativeBottomTabNavigator<TabParamList>();

export const TabNavigator = () => {
  const { theme } = useUnistyles();
  const { openAddMenu } = useAddRecipe();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarControllerMode: "tabBar",
        tabBarMinimizeBehavior: "auto",
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: signatureTabIcon("home"),
        }}
      />
      <Tab.Screen
        name="Recipes"
        component={MyRecipesScreen}
        options={{
          tabBarIcon: signatureTabIcon("recipes"),
        }}
      />
      <Tab.Screen
        name="Meal Plan"
        component={MealPlanScreen}
        options={{
          tabBarLabel: "Plan",
          tabBarIcon: signatureTabIcon("plan"),
        }}
      />
      <Tab.Screen
        name="Shopping List"
        component={ShoppingListScreen}
        options={{
          tabBarLabel: "Shop",
          tabBarIcon: signatureTabIcon("shop"),
        }}
      />
      {/*
        On iOS 26+ the "search" system item is drawn as its own glass button
        beside the tab bar. We borrow that slot for Add, overriding the icon
        and label so VoiceOver announces "Add recipe" rather than "Search".
        The tab is never selected (iOS would swap in the search glyph);
        tapping it opens the glass add menu instead.
      */}
      <Tab.Screen
        name="Add recipe"
        component={AddRecipeScreen}
        options={{
          tabBarSystemItem: "search",
          tabBarLabel: "Add recipe",
          tabBarIcon: { type: "sfSymbol", name: "plus" },
          tabBarSelectionEnabled: false,
        }}
        listeners={{ tabPress: openAddMenu }}
      />
    </Tab.Navigator>
  );
};
