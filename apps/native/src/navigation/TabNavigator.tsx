import { createNativeBottomTabNavigator } from "@react-navigation/bottom-tabs/unstable";
import { useUnistyles } from "react-native-unistyles";

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
      {/* The signature set has no add icon, so Add keeps the system one. */}
      <Tab.Screen
        name="Add recipe"
        component={AddRecipeScreen}
        options={{
          tabBarIcon: { type: "sfSymbol", name: "plus.circle.fill" },
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
          // A transparent native bar: the screen puts its title (the list
          // picker) on the left and the native ••• menu on the right.
          headerShown: true,
          headerTransparent: true,
          headerTitle: "",
        }}
      />
    </Tab.Navigator>
  );
};
