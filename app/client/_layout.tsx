import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors } from "@/components/ui";

const tabs = [
  ["index", "Home", "⌂"],
  ["services", "Services", "✧"],
  ["book", "Book", "+"],
  ["appointments", "Visits", "▣"],
  ["profile", "Profile", "○"],
];

export default function ClientLayout() {
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: colors.rose,
    tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { height: 66, paddingTop: 7, paddingBottom: 8, borderTopColor: colors.line, backgroundColor: colors.cream },
    tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
  }}>
    {tabs.map(([name, title, icon]) => <Tabs.Screen key={name} name={name} options={{
      title,
      tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 19 }}>{icon}</Text>,
    }} />)}
    <Tabs.Screen name="notifications" options={{ href: null }} />
    <Tabs.Screen name="history" options={{ href: null }} />
    <Tabs.Screen name="reschedule" options={{ href: null }} />
    <Tabs.Screen name="service/[id]" options={{ href: null }} />
  </Tabs>;
}
