import { Redirect } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { useAuth } from "@/hooks/use-auth";
import { ActionButton, ErrorText, Screen, colors } from "@/components/ui";

export default function Index() {
  const { user, profile, loading, profileError, refreshProfile, signOut } = useAuth();
  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFCFA" }}><ActivityIndicator color="#B66B7C" /></View>;
  if (user && !profile) return <Screen>
    <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "700", marginBottom: 10 }}>We couldn’t load your account</Text>
    <ErrorText>{profileError || "Your account profile is not available. Check your connection and try again."}</ErrorText>
    <ActionButton label="Try again" onPress={() => void refreshProfile().catch((error: unknown) => console.error("Profile retry failed", error))} />
    <Text onPress={() => void signOut()} style={{ color: colors.rose, textAlign: "center", padding: 16 }}>Sign out</Text>
  </Screen>;
  if (!user) return <Redirect href="/auth/sign-in" />;
  return <Redirect href={profile?.role === "CLIENT" ? "/client" : "/operational"} />;
}
