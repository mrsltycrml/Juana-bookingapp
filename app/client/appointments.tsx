import { useState } from "react";
import { router } from "expo-router";
import { Alert, Text } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { cancelAppointment, getAppointments } from "@/features/appointments/api";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime, formatMoney } from "@/utils/format";
import type { Appointment } from "@/types/database";

export default function AppointmentsScreen() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [busyId, setBusyId] = useState("");
  const query = useQuery({ queryKey: ["appointments", user?.id], queryFn: () => getAppointments(user?.id), enabled: !!user });
  const now = Date.now();
  const upcoming = query.data?.filter((item) => new Date(item.starts_at).getTime() >= now && !["CANCELLED", "RESCHEDULED"].includes(item.status)) ?? [];
  const past = query.data?.filter((item) => new Date(item.starts_at).getTime() < now || ["CANCELLED", "RESCHEDULED"].includes(item.status)) ?? [];
  const cancel = (appointment: Appointment) => Alert.alert("Cancel appointment?", "Cancellation is subject to the studio’s policy.", [
    { text: "Keep appointment", style: "cancel" },
    { text: "Cancel appointment", style: "destructive", onPress: () => {
      setBusyId(appointment.id);
      void cancelAppointment(appointment.id).then(() => client.invalidateQueries({ queryKey: ["appointments"] }))
        .catch((error: unknown) => Alert.alert("Could not cancel", error instanceof Error ? error.message : "Please try again."))
        .finally(() => setBusyId(""));
    } },
  ]);
  const card = (appointment: Appointment) => <Card key={appointment.id}>
    <Text style={{ color: colors.rose, fontWeight: "700" }}>{appointment.status.replaceAll("_", " ")}</Text>
    <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", marginTop: 5 }}>{appointment.service?.name ?? "Service"}</Text>
    <Text style={{ color: colors.muted, marginTop: 6 }}>{formatDateTime(appointment.starts_at)}</Text>
    <Text style={{ color: colors.muted, marginTop: 4 }}>Practitioner: {appointment.practitioner?.display_name ?? "To be confirmed"}</Text>
    <Text style={{ color: colors.muted, marginTop: 4 }}>Payment: {appointment.payments?.[0]?.status ?? "PENDING"}</Text>
    {appointment.service ? <Text style={{ color: colors.ink, marginTop: 8 }}>{formatMoney(appointment.service.price_amount, appointment.service.currency)}</Text> : null}
    {["BOOKED", "TEMPORARILY_RESERVED"].includes(appointment.status) ? <ActionButton label="Cancel" variant="secondary" busy={busyId === appointment.id} onPress={() => cancel(appointment)} /> : null}
    {appointment.status === "BOOKED" ? <Text onPress={() => router.push({ pathname: "/client/reschedule", params: { appointmentId: appointment.id } })} style={{ color: colors.rose, textAlign: "center", padding: 12 }}>Reschedule</Text> : null}
  </Card>;
  return <Screen>
    <Heading title="Your appointments" subtitle="Upcoming visits and your appointment history." />
    {query.isLoading ? <Text style={{ color: colors.muted }}>Loading appointments…</Text> : null}
    {query.isError ? <ErrorText>Your appointments could not be loaded. {query.error.message}</ErrorText> : null}
    <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", marginBottom: 12 }}>Upcoming</Text>
    {upcoming.length ? upcoming.map(card) : <Card><Text style={{ color: colors.muted }}>Nothing scheduled yet.</Text></Card>}
    <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 12 }}>Past & cancelled</Text>
    {past.length ? past.map(card) : <Text style={{ color: colors.muted }}>Your appointment history will appear here.</Text>}
  </Screen>;
}
