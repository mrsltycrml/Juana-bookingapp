import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { ActionButton, ErrorText, Screen, colors } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const { code, type } = useLocalSearchParams<{ code?: string; type?: string }>();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(true);
  useEffect(() => {
    let active = true;
    const exchange = async () => {
      if (!code) {
        setError("This sign-in link is invalid or has expired. Request a new email from the sign-in screen.");
        setWorking(false);
        return;
      }
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (!active) return;
      if (exchangeError) {
        setError(exchangeError.message);
      } else if (type === "recovery") {
        router.replace("/auth/reset-password");
      } else {
        router.replace("/");
      }
      setWorking(false);
    };
    void exchange().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "The email link could not be verified.");
      if (active) setWorking(false);
    });
    return () => { active = false; };
  }, [code, type]);
  return <Screen scroll={false}>
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      {working ? <><ActivityIndicator color={colors.rose} /><Text style={{ color: colors.muted, textAlign: "center", marginTop: 15 }}>Verifying your email link…</Text></> : null}
      {error ? <><ErrorText>{error}</ErrorText><ActionButton label="Return to sign in" onPress={() => router.replace("/auth/sign-in")} /></> : null}
    </View>
  </Screen>;
}
