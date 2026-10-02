import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { getAppointments } from "@/features/appointments/api";

export default function TreatmentQueue() {
  const query = useQuery({ queryKey: ["operational-appointments"], queryFn: () => getAppointments() });
  const queued = query.data?.filter((appointment) => appointment.status === "CHECKED_IN") ?? [];
  return <Screen>
    <Heading title="Treatment queue" subtitle="Create a treatment record after the customer has checked in." />
    {query.isError ? <ErrorText>Appointment queue could not be loaded. {query.error.message}</ErrorText> : null}
    {queued.map((appointment) => <Pressable key={appointment.id} onPress={() => router.push({ pathname: "/operational/treatment/new", params: { appointmentId: appointment.id } })}>
      <Card><Text style={{ color: colors.ink, fontWeight: "700" }}>{appointment.customer?.full_name ?? "Assigned customer"} · {appointment.service?.name}</Text><Text style={{ color: colors.muted, marginTop: 5 }}>{new Date(appointment.starts_at).toLocaleString()} · {appointment.practitioner?.display_name}</Text><Text style={{ color: colors.rose, marginTop: 8 }}>Create treatment record →</Text></Card>
    </Pressable>)}
    {queued.length === 0 && !query.isLoading ? <Text style={{ color: colors.muted }}>No checked-in appointments need a treatment record.</Text> : null}
  </Screen>;
}
