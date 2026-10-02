import { useState } from "react";
import { Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { formatDateTime } from "@/utils/format";
import { supabase } from "@/lib/supabase";
import { firstRelation } from "@/utils/relations";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("profiles")
        .select("id,full_name,email,mobile_number,created_at").eq("id", id).single();
      if (queryError) throw queryError;
      return data;
    },
  });
  const appointments = useQuery({
    queryKey: ["customer-appointments", id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("appointments")
        .select("id,starts_at,status,service:services(name),practitioner:practitioners(display_name),payments(status,amount,currency)")
        .eq("customer_id", id).order("starts_at", { ascending: false });
      if (queryError) throw queryError;
      return data;
    },
  });
  const records = useQuery({
    queryKey: ["customer-treatments", id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("treatment_records")
        .select("id,treatment_date,details,service:services(name)").eq("customer_id", id).order("treatment_date", { ascending: false });
      if (queryError) throw queryError;
      return data;
    },
  });
  const notes = useQuery({
    queryKey: ["customer-notes", id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("customer_notes")
        .select("id,note,created_at,author:profiles(full_name)").eq("customer_id", id).order("created_at", { ascending: false });
      if (queryError) throw queryError;
      return data;
    },
  });
  const saveNote = async () => {
    if (!note.trim()) { setError("Enter an internal note before saving."); return; }
    setBusy(true); setError("");
    const { error: insertError } = await supabase.from("customer_notes").insert({ customer_id: id, note: note.trim() });
    if (insertError) setError(insertError.message);
    else { setNote(""); await client.invalidateQueries({ queryKey: ["customer-notes", id] }); }
    setBusy(false);
  };
  if (query.isLoading) return <Screen><Text style={{ color: colors.muted }}>Loading customer…</Text></Screen>;
  if (query.isError) return <Screen><ErrorText>Customer could not be loaded. {query.error.message}</ErrorText></Screen>;
  if (!query.data) return <Screen><Heading title="Customer unavailable" subtitle="This customer could not be found." /></Screen>;
  return <Screen>
    <Heading title={query.data.full_name} subtitle="Customer profile and studio history." />
    <Card><Text style={{ color: colors.ink }}>{query.data.email}</Text><Text style={{ color: colors.muted, marginTop: 6 }}>{query.data.mobile_number ?? "No mobile number"}</Text></Card>
    <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", marginVertical: 10 }}>Appointments & payments</Text>
    {appointments.isError ? <ErrorText>Appointments could not be loaded. {appointments.error.message}</ErrorText> : null}
    {appointments.data?.map((item) => <Card key={item.id}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>{firstRelation(item.service)?.name ?? "Service"} · {item.status.replaceAll("_", " ")}</Text>
      <Text style={{ color: colors.muted, marginTop: 5 }}>{formatDateTime(item.starts_at)} · {firstRelation(item.practitioner)?.display_name}</Text>
      {item.payments?.map((payment, index) => <Text key={index} style={{ color: colors.muted, marginTop: 5 }}>Payment {payment.status}: {payment.currency} {payment.amount}</Text>)}
    </Card>)}
    <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", marginVertical: 10 }}>Treatment history</Text>
    {records.data?.map((record) => <Card key={record.id}><Text style={{ color: colors.ink, fontWeight: "600" }}>{firstRelation(record.service)?.name ?? "Service"} · {formatDateTime(record.treatment_date)}</Text><Text style={{ color: colors.muted, marginTop: 5 }}>{record.details}</Text></Card>)}
    <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", marginVertical: 10 }}>Internal notes</Text>
    {notes.isError ? <ErrorText>Internal notes could not be loaded. {notes.error.message}</ErrorText> : null}
    {notes.data?.map((item) => <Card key={item.id}><Text style={{ color: colors.ink }}>{item.note}</Text><Text style={{ color: colors.muted, fontSize: 12, marginTop: 7 }}>{firstRelation(item.author)?.full_name} · {new Date(item.created_at).toLocaleString()}</Text></Card>)}
    <Field label="Add an internal note (staff only)" value={note} onChangeText={setNote} multiline />
    {error ? <ErrorText>{error}</ErrorText> : null}
    <ActionButton label="Save internal note" onPress={() => void saveNote()} busy={busy} />
  </Screen>;
}
