import { useState } from "react";
import { Link, router } from "expo-router";
import { Text, View } from "react-native";
import { Screen, Heading, Field, ActionButton, ErrorText, colors } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { getErrorMessage } from "@/utils/errors";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) { setError(authError.message); return; }
    router.replace("/");
  };
  const forgotPassword = async () => {
    if (!email.trim()) { setError("Enter your email address first so we can send a reset link."); return; }
    setBusy(true); setError("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: "juanabeauty://auth/callback?type=recovery" });
    setBusy(false);
    setError(resetError ? getErrorMessage(resetError) : "If an account exists for that email, a password reset link has been sent.");
  };
  return <Screen>
    <View style={{ marginTop: 40 }}>
      <Text style={{ color: colors.rose, letterSpacing: 3, fontSize: 12, fontWeight: "700", marginBottom: 18 }}>JUANA BEAUTY & AESTHETICS</Text>
      <Heading title="Welcome back" subtitle="Your moment of care starts here." />
      <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ActionButton label="Sign in" onPress={submit} busy={busy} />
      <Text onPress={() => void forgotPassword()} style={{ textAlign: "center", marginTop: 18, color: colors.rose, fontWeight: "600", padding: 10 }}>Forgot password?</Text>
      <Link href="/auth/sign-up" style={{ textAlign: "center", marginTop: 12, color: colors.ink }}>New to Juana? <Text style={{ color: colors.rose, fontWeight: "700" }}>Create an account</Text></Link>
    </View>
  </Screen>;
}
