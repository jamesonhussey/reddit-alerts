import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import CreateRuleScreen from "./components/CreateRuleScreen";
import MyRulesScreen from "./components/MyRulesScreen";
import AlertsScreen from "./components/AlertsScreen";
import BundlesScreen from "./components/BundlesScreen";

type RootTabParamList = {
  Create: undefined;
  Bundles: undefined;
  "My Rules": undefined;
  Alerts: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        id={undefined as never}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen name="Create" component={CreateRuleScreen} />
        <Tab.Screen name="Bundles" component={BundlesScreen} />
        <Tab.Screen name="My Rules" component={MyRulesScreen} />
        <Tab.Screen name="Alerts" component={AlertsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}