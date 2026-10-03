import { useEffect } from "react";
import { Tabs, router } from "expo-router";
import { Text } from "react-native";
import { colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";

export default function OperationalLayout() {
  const { profile, loading } = useAuth();
  useEffect(() => {
    if (!loading && profile?.role === "CLIENT") router.replace("/client");
  }, [loading, profile?.role]);
  const practitioner = profile?.role === "PRACTITIONER";
  const tabs = [
    ["index", "Home", "⌂"],
    ["calendar", "Calendar", "▦"],
    ["appointments", "Visits", "▣"],
    ["customers", "Customers", "♡"],
    ["more", "More", "•••"],
  ];
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: colors.rose,
    tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { height: 66, paddingTop: 7, paddingBottom: 8, borderTopColor: colors.line, backgroundColor: colors.cream },
    tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
  }}>
    {tabs.map(([name, title, icon]) => <Tabs.Screen key={name} name={name} options={{
      title,
      href: practitioner && name === "customers" ? null : undefined,
      tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 19 }}>{icon}</Text>,
    }} />)}
    <Tabs.Screen name="walk-in" options={{ href: null }} />
    <Tabs.Screen name="services" options={{ href: null }} />
    <Tabs.Screen name="practitioners" options={{ href: null }} />
    <Tabs.Screen name="consent" options={{ href: null }} />
    <Tabs.Screen name="treatments" options={{ href: null }} />
    <Tabs.Screen name="payments" options={{ href: null }} />
    <Tabs.Screen name="settings" options={{ href: null }} />
    <Tabs.Screen name="team" options={{ href: null }} />
    <Tabs.Screen name="showcase" options={{ href: null }} />
    <Tabs.Screen name="appointment/[id]" options={{ href: null }} />
    <Tabs.Screen name="customer/[id]" options={{ href: null }} />
    <Tabs.Screen name="treatment/new" options={{ href: null }} />
    <Tabs.Screen name="reschedule" options={{ href: null }} />
  </Tabs>;
}
