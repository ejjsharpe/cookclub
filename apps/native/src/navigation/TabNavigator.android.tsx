import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { JellyTabBar } from "react-native-jelly-tabs";
import { useUnistyles } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import type { TabParamList } from "@/navigation/navigationRef";
import { AddRecipeScreen } from "@/screens/AddRecipeScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { MealPlanScreen } from "@/screens/MealPlanScreen";
import { MyRecipesScreen } from "@/screens/MyRecipesScreen";
import { ShoppingListScreen } from "@/screens/ShoppingListScreen";

const Tab = createBottomTabNavigator<TabParamList>();

export const TabNavigator = () => {
  const { theme } = useUnistyles();

  return (
    <Tab.Navigator
      tabBar={(props) => <JellyTabBar {...props} floating />}
      screenOptions={{
        headerShown: false,
        tabBarActiveBackgroundColor: theme.colors.primary,
        tabBarActiveTintColor: theme.colors.buttonText,
        tabBarInactiveBackgroundColor: theme.colors.inputBackground,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarLabelStyle: { fontFamily: theme.fonts.medium },
        tabBarStyle: {
          backgroundColor: theme.colors.background,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Recipes"
        component={MyRecipesScreen}
        options={{
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              name={focused ? "book" : "book-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Add recipe"
        component={AddRecipeScreen}
        options={{
          tabBarLabel: "Add",
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              name={focused ? "add-circle" : "add-circle-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Meal Plan"
        component={MealPlanScreen}
        options={{
          tabBarLabel: "Plan",
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              name={focused ? "calendar" : "calendar-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Shopping List"
        component={ShoppingListScreen}
        options={{
          tabBarLabel: "Shop",
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              name={focused ? "cart" : "cart-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
};
