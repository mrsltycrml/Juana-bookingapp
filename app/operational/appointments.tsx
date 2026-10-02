import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { getAppointments } from "@/features/appointments/api";

export default function OperationalAppointments() {
  const query = useQuery({ queryKey: ["operational-appointments"], queryFn: () => getAppointments() });
  return <Screen>
    <Heading title="Appointments" subtitle="Manage today’s visits, upcoming bookings, and treatment flow." />
    {query.isLoading ? <Text style={{ color: colors.muted }}>Loading appointments…</Text> : null}
    {query.isError ? <ErrorText>Appointments could not be loaded. {query.error.message}</ErrorText> : null}
    {query.data?.map((appointment) => <Pressable key={appointment.id} onPress={() => router.push({ pathname: "/operational/appointment/[id]", params: { id: appointment.id } })}>
      <Card>
        <Text style={{ color: colors.rose, fontSize: 12, fontWeight: "700" }}>{appointment.status.replaceAll("_", " ")}</Text>
        <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17, marginTop: 5 }}>{appointment.customer?.full_name ?? "Assigned customer"} · {appointment.service?.name}</Text>
        <Text style={{ color: colors.muted, marginTop: 5 }}>{new Date(appointment.starts_at).toLocaleString()} · {appointment.practitioner?.display_name}</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>Payment: {appointment.payments?.[0]?.status ?? "PENDING"}</Text>
      </Card>
    </Pressable>)}
    {query.data?.length === 0 ? <Text style={{ color: colors.muted }}>No appointments are visible to your account.</Text> : null}
  </Screen>;
}
