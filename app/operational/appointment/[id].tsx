import { useState } from "react";
import { Alert, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { getAppointments } from "@/features/appointments/api";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { formatDateTime, formatServiceDuration, formatServicePrice } from "@/utils/format";
import { firstRelation } from "@/utils/relations";
import type { Appointment } from "@/types/database";

export default function OperationalAppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["operational-appointments"],
    queryFn: () => getAppointments(),
  });
  const appointment = query.data?.find((item) => item.id === id) as Appointment | undefined;
  const consent = useQuery({
    queryKey: ["appointment-consent", id],
    enabled: !!appointment,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("consent_submissions")
        .select("id, answers, signature, agreed_at, form:consent_forms(title), version:consent_form_versions(version)")
        .eq("appointment_id", id);
      if (queryError) throw queryError;
      return data;
    },
  });
  const completeTreatment = profile?.role === "PRACTITIONER" || profile?.role === "ADMIN" || profile?.role === "FRONT_DESK";
  const updateStatus = async (status: "CHECKED_IN" | "NO_SHOW") => {
    setBusy(true); setError("");
    const { error: updateError } = await supabase.from("appointments").update({ status }).eq("id", id);
    if (!updateError) {
      await queryClient.invalidateQueries({ queryKey: ["operational-appointments"] });
      await queryClient.invalidateQueries({ queryKey: ["appointments"] });
    }
    setBusy(false);
    if (updateError) setError(updateError.message);
  };
  const cancel = () => Alert.alert("Cancel this appointment?", "This cannot be undone.", [
    { text: "Keep appointment", style: "cancel" },
    { text: "Cancel appointment", style: "destructive", onPress: () => {
      setBusy(true);
      void (async () => {
        try {
          const { error: cancelError } = await supabase.rpc("cancel_appointment", { p_appointment_id: id, p_reason: "Cancelled by studio" });
          if (cancelError) throw cancelError;
          await queryClient.invalidateQueries({ queryKey: ["operational-appointments"] });
          await queryClient.invalidateQueries({ queryKey: ["appointments"] });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Appointment could not be cancelled.");
        } finally { setBusy(false); }
      })();
    } },
  ]);
  if (query.isLoading) return <Screen><Text style={{ color: colors.muted }}>Loading appointment…</Text></Screen>;
  if (query.isError) return <Screen><ErrorText>Appointment could not be loaded. {query.error.message}</ErrorText></Screen>;
  if (!appointment) return <Screen><Heading title="Appointment unavailable" subtitle="This appointment isn’t visible to your account or no longer exists." /></Screen>;
  return <Screen>
    <Heading title={appointment.service?.name ?? "Appointment"} subtitle={formatDateTime(appointment.starts_at)} />
    <Card>
      <Text style={{ color: colors.rose, fontWeight: "700" }}>{appointment.status.replaceAll("_", " ")}</Text>
      <Text style={{ color: colors.ink, marginTop: 10, fontWeight: "700" }}>Customer</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>{appointment.customer?.full_name ?? "Customer details restricted"}</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>{appointment.customer?.mobile_number ?? ""}</Text>
      <Text style={{ color: colors.ink, marginTop: 12, fontWeight: "700" }}>Practitioner</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>{appointment.practitioner?.display_name}</Text>
      {appointment.service ? <Text style={{ color: colors.ink, marginTop: 12 }}>{formatServicePrice(appointment.service.price_amount, appointment.service.currency)} · {formatServiceDuration(appointment.service.duration_minutes, !!appointment.showcase_run_id)}</Text> : null}
      <Text style={{ color: colors.muted, marginTop: 5 }}>{appointment.showcase_run_id ? "DEMO ONLY · NO PAYMENT RECORD" : `Payment: ${appointment.payments?.[0]?.status ?? "PENDING"} ${appointment.payments?.[0]?.provider === "MANUAL" ? "(manual)" : ""}`}</Text>
    </Card>
    {consent.isError ? <ErrorText>Consent could not be loaded. {consent.error.message}</ErrorText> : null}
    {consent.data?.map((submission) => <Card key={submission.id}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>{firstRelation(submission.form)?.title ?? "Consent form"} · v{firstRelation(submission.version)?.version}</Text>
      <Text style={{ color: colors.muted, marginTop: 5 }}>Signed {new Date(submission.agreed_at).toLocaleString()}</Text>
      {submission.signature ? <Text style={{ color: colors.muted, marginTop: 5 }}>Digital signature: {submission.signature}</Text> : null}
    </Card>)}
    {error ? <ErrorText>{error}</ErrorText> : null}
    {!appointment.showcase_run_id && appointment.status === "BOOKED" && profile?.role !== "PRACTITIONER" ? <ActionButton label="Check in customer" onPress={() => void updateStatus("CHECKED_IN")} busy={busy} /> : null}
    {!appointment.showcase_run_id && appointment.status === "CHECKED_IN" && completeTreatment ? <ActionButton label="Record treatment & complete" onPress={() => router.push({ pathname: "/operational/treatment/new", params: { appointmentId: id } })} /> : null}
    {!appointment.showcase_run_id && appointment.status === "BOOKED" && profile?.role !== "PRACTITIONER" ? <Text onPress={() => router.push({ pathname: "/operational/reschedule", params: { appointmentId: id } })} style={{ color: colors.rose, textAlign: "center", padding: 16 }}>Reschedule appointment</Text> : null}
    {!appointment.showcase_run_id && appointment.status === "BOOKED" && profile?.role !== "PRACTITIONER" ? <Text onPress={() => void updateStatus("NO_SHOW")} style={{ color: colors.muted, textAlign: "center", padding: 13 }}>Mark no-show</Text> : null}
    {!appointment.showcase_run_id && ["BOOKED", "TEMPORARILY_RESERVED"].includes(appointment.status) && profile?.role !== "PRACTITIONER" ? <Text onPress={cancel} style={{ color: colors.muted, textAlign: "center", padding: 13 }}>Cancel appointment</Text> : null}
  </Screen>;
}
