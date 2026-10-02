import { useState } from "react";
import { Alert, Text } from "react-native";
import { router } from "expo-router";
import { z } from "zod";
import { ActionButton, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";

const phoneSchema = z.string().trim().min(7);

export default function ProfileScreen() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [mobile, setMobile] = useState(profile?.mobile_number ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || !phoneSchema.safeParse(mobile).success) {
      setError("Enter your name and a valid mobile number."); return;
    }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.from("profiles").update({ full_name: name.trim(), mobile_number: mobile.trim() }).eq("id", profile?.id);
    if (!saveError) await refreshProfile();
    setBusy(false);
    setError(saveError?.message ?? "Profile saved.");
  };
  const logOut = () => Alert.alert("Sign out?", "You can sign back in any time.", [
    { text: "Stay signed in", style: "cancel" },
    { text: "Sign out", style: "destructive", onPress: () => { void signOut().then(() => router.replace("/auth/sign-in")).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not sign out.")); } },
  ]);
  return <Screen>
    <Heading title="Your profile" subtitle="Manage your personal details and preferences." />
    <Text style={{ color: colors.muted, marginBottom: 5 }}>Email</Text>
    <Text style={{ color: colors.ink, fontSize: 16, marginBottom: 18 }}>{profile?.email}</Text>
    <Field label="Full name" value={name} onChangeText={setName} />
    <Field label="Mobile number" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
    {error ? <ErrorText>{error}</ErrorText> : null}
    <ActionButton label="Save changes" onPress={() => void save()} busy={busy} />
    <Text onPress={() => router.push("/client/notifications")} style={{ color: colors.rose, marginTop: 24, paddingVertical: 10 }}>Notification history and preferences →</Text>
    <Text onPress={() => router.push("/client/history")} style={{ color: colors.rose, paddingVertical: 10 }}>Treatment history →</Text>
    <Text onPress={() => void logOut()} style={{ color: colors.muted, paddingVertical: 20 }}>Sign out</Text>
  </Screen>;
}
