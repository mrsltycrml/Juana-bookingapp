import { useState } from "react";
import { Text } from "react-native";
import { Screen, Heading, Field, ActionButton, ErrorText } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { z } from "zod";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const parsed = z.string().min(8, "Use at least 8 characters.").safeParse(password);
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Enter a valid password."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    setMessage(error?.message ?? "Your password has been updated.");
  };
  return <Screen><Heading title="Set a new password" subtitle="Choose a secure password with at least 8 characters." />
    <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry />
    {message ? <ErrorText>{message}</ErrorText> : null}
    <ActionButton label="Update password" onPress={submit} busy={busy} />
    <Text style={{ marginTop: 15, color: "#88777F" }}>Open this screen from the secure reset link sent to your email.</Text>
  </Screen>;
}
