import { useState } from "react";
import { Link } from "expo-router";
import { Text } from "react-native";
import { z } from "zod";
import { Screen, Heading, Field, ActionButton, ErrorText, colors } from "@/components/ui";
import { supabase } from "@/lib/supabase";

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name."),
  email: z.email("Enter a valid email address."),
  mobile: z.string().trim().min(7, "Enter a valid mobile number."),
  password: z.string().min(8, "Use at least 8 characters."),
  confirm: z.string(),
  accepted: z.boolean().refine(Boolean, "Accept the Terms and Privacy notice to continue."),
}).refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match." });

export default function SignUp() {
  const [values, setValues] = useState({ fullName: "", email: "", mobile: "", password: "", confirm: "" });
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof typeof values) => (value: string) => setValues((previous) => ({ ...previous, [key]: value }));
  const submit = async () => {
    setError("");
    const parsed = schema.safeParse({ ...values, accepted });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the form and try again."); return; }
    setBusy(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: values.email.trim().toLowerCase(),
      password: values.password,
      options: {
        emailRedirectTo: "juanabeauty://auth/callback",
        data: {
          full_name: values.fullName.trim(),
          mobile_number: values.mobile.trim(),
          accepted_terms: true,
          accepted_privacy: true,
        },
      },
    });
    setBusy(false);
    setError(signUpError?.message ?? "Account created. Check your email to verify your address before signing in.");
  };
  return <Screen>
    <Heading title="Create your account" subtitle="A little self-care, thoughtfully booked." />
    <Field label="Full name" value={values.fullName} onChangeText={update("fullName")} />
    <Field label="Email address" value={values.email} onChangeText={update("email")} keyboardType="email-address" />
    <Field label="Mobile number" value={values.mobile} onChangeText={update("mobile")} keyboardType="phone-pad" />
    <Field label="Password" value={values.password} onChangeText={update("password")} secureTextEntry />
    <Field label="Confirm password" value={values.confirm} onChangeText={update("confirm")} secureTextEntry />
    <Text onPress={() => setAccepted((current) => !current)} style={{ color: colors.ink, lineHeight: 22, marginBottom: 16 }}>
      {accepted ? "☑" : "☐"}  I accept the Terms of Service and Privacy Policy.
    </Text>
    {error ? <ErrorText>{error}</ErrorText> : null}
    <ActionButton label="Create account" onPress={submit} busy={busy} />
    <Link href="/auth/sign-in" style={{ textAlign: "center", marginTop: 20, color: colors.rose }}>Already have an account? Sign in</Link>
  </Screen>;
}
