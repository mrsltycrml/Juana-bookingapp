import { useState } from "react";
import { Text } from "react-native";
import { z } from "zod";
import { ActionButton, Card, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/types/database";

const staffSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the person’s full name."),
  email: z.email("Enter a valid email."),
});
const roles: { value: AppRole; label: string }[] = [
  { value: "ADMIN", label: "Administrator" },
  { value: "FRONT_DESK", label: "Front Desk" },
  { value: "PRACTITIONER", label: "Practitioner" },
  { value: "CLIENT", label: "Client" },
];

export default function TeamManagement() {
  const { profile } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [role, setRole] = useState<AppRole>("FRONT_DESK");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  if (profile?.role !== "ADMIN") return <Screen><Heading title="Staff accounts" subtitle="Only administrators can invite or create staff accounts." /></Screen>;
  const invite = async () => {
    setError(""); setSuccess("");
    const parsed = staffSchema.safeParse({ fullName, email });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the form and try again."); return; }
    setBusy(true);
    const { data, error: inviteError } = await supabase.functions.invoke("admin-create-account", {
      body: { fullName: parsed.data.fullName, email: parsed.data.email.trim(), mobileNumber: mobile.trim(), role },
    });
    setBusy(false);
    if (inviteError || data?.error) {
      setError(inviteError?.message ?? data.error);
      return;
    }
    setSuccess(`${role.replaceAll("_", " ")} invitation sent. The account role is assigned by the server.`);
    setFullName(""); setEmail(""); setMobile("");
  };
  return <Screen>
    <Heading title="Staff accounts" subtitle="Invite accounts by email. Roles are assigned by the trusted Supabase function, never by public registration." />
    <Card>
      <Field label="Full name" value={fullName} onChangeText={setFullName} />
      <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="Mobile number" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
      <Text style={{ color: colors.ink, fontWeight: "700", marginTop: 6 }}>Assign role</Text>
      {roles.map((item) => <Text key={item.value} onPress={() => setRole(item.value)} style={{ color: colors.ink, paddingVertical: 9 }}>
        {role === item.value ? "◉" : "◯"}  {item.label}
      </Text>)}
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, marginVertical: 9 }}>Supabase email delivery must be configured. The invited person verifies their email before signing in.</Text>
      <ActionButton label="Send invitation" onPress={() => void invite()} busy={busy} />
    </Card>
    {error ? <ErrorText>{error}</ErrorText> : null}
    {success ? <Text style={{ color: colors.rose, lineHeight: 21 }}>{success}</Text> : null}
  </Screen>;
}
