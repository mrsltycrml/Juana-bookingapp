import { router } from "expo-router";
import { Pressable, Text } from "react-native";
import { Card, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import type { Href } from "expo-router";

const adminTools: [string, Href][] = [
  ["Services", "/operational/services"],
  ["Practitioners & schedules", "/operational/practitioners"],
  ["Consent forms", "/operational/consent"],
  ["Treatment records", "/operational/treatments"],
  ["Payments", "/operational/payments"],
  ["Studio settings", "/operational/settings"],
  ["Staff accounts", "/operational/team"],
];
const frontDeskTools: [string, Href][] = [
  ["Services", "/operational/services"],
  ["Treatment records", "/operational/treatments"],
  ["Payments", "/operational/payments"],
];

export default function OperationalMore() {
  const { profile, signOut } = useAuth();
  const practitioner = profile?.role === "PRACTITIONER";
  const items: [string, Href | "sign-out"][] = practitioner
    ? [["My treatments", "/operational/treatments"], ["Sign out", "sign-out"]]
    : (profile?.role === "FRONT_DESK" ? frontDeskTools : adminTools);
  return <Screen>
    <Heading title="Studio tools" subtitle="Operational tools for your role." />
    {items.map(([label, path]) => <Pressable key={label} onPress={() => path === "sign-out"
      ? void signOut()
      : router.push(path)}>
      <Card><Text style={{ color: colors.ink, fontWeight: "600", fontSize: 16 }}>{label}</Text><Text style={{ color: colors.rose, marginTop: 6 }}>Open →</Text></Card>
    </Pressable>)}
  </Screen>;
}
