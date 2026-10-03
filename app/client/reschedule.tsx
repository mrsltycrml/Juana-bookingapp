import { useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { getAppointments, getSlots, type AvailableSlot } from "@/features/appointments/api";
import { getServicePractitioners } from "@/features/services/api";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { businessDateKey, manilaDate } from "@/utils/dates";

export default function RescheduleScreen({ operational = false }: { operational?: boolean }) {
  const { appointmentId = "" } = useLocalSearchParams<{ appointmentId: string }>();
  const { user } = useAuth();
  const client = useQueryClient();
  const [date, setDate] = useState(businessDateKey(new Date()));
  const [dateOffset, setDateOffset] = useState(0);
  const [selected, setSelected] = useState<AvailableSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const appointments = useQuery({
    queryKey: operational ? ["operational-appointments"] : ["appointments", user?.id],
    queryFn: () => getAppointments(operational ? undefined : user?.id),
    enabled: operational || !!user,
  });
  const appointment = appointments.data?.find((item) => item.id === appointmentId);
  const slots = useQuery({
    queryKey: ["reschedule-slots", appointment?.service_id, date],
    enabled: !!appointment,
    queryFn: () => getSlots(appointment!.service_id, date),
  });
  const practitioners = useQuery({
    queryKey: ["service-practitioners", appointment?.service_id],
    enabled: !!appointment,
    queryFn: () => getServicePractitioners(appointment!.service_id),
  });
  const days = useMemo(() => Array.from({ length: 21 }, (_, index) => manilaDate(dateOffset + index)), [dateOffset]);
  const moveDateRange = (direction: -1 | 1) => {
    const offset = Math.max(0, dateOffset + direction * days.length);
    setDateOffset(offset);
    setDate(businessDateKey(manilaDate(offset))); setSelected(null);
  };
  const submit = () => {
    if (!selected) return;
    Alert.alert("Confirm new appointment time?", "Your current appointment will be replaced by this available time.", [
      { text: "Keep current time", style: "cancel" },
      { text: "Reschedule", onPress: () => {
        setBusy(true); setError("");
        void (async () => {
          try {
            const { error: actionError } = await supabase.rpc("reschedule_appointment", {
          p_appointment_id: appointmentId,
          p_practitioner_id: selected.practitioner_id,
          p_starts_at: selected.starts_at,
            });
            if (actionError) throw actionError;
          await client.invalidateQueries({ queryKey: ["appointments"] });
          await client.invalidateQueries({ queryKey: ["operational-appointments"] });
          router.replace(operational
            ? { pathname: "/operational/appointment/[id]", params: { id: appointmentId } }
            : "/client/appointments");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Appointment could not be rescheduled.");
          } finally { setBusy(false); }
        })();
      } },
    ]);
  };
  if (appointments.isLoading) return <Screen><Text style={{ color: colors.muted }}>Loading appointment…</Text></Screen>;
  if (!appointment) return <Screen><Heading title="Appointment not found" subtitle="This appointment isn’t available to your account." /></Screen>;
  return <Screen>
    <Heading title="Reschedule" subtitle={`${appointment.service?.name} · ${new Date(appointment.starts_at).toLocaleString()}`} />
    {appointments.isError ? <ErrorText>{appointments.error.message}</ErrorText> : null}
    <Text style={{ color: colors.ink, fontWeight: "700", marginBottom: 9 }}>Choose a new day</Text>
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
      <Text onPress={() => moveDateRange(-1)} style={{ color: colors.rose, padding: 5 }}>‹ Earlier</Text>
      <Text style={{ color: colors.muted, padding: 5 }}>{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila" }).format(days[0])} – {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila" }).format(days[days.length - 1])}</Text>
      <Text onPress={() => moveDateRange(1)} style={{ color: colors.rose, padding: 5 }}>Later ›</Text>
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {days.map((day) => {
        const key = businessDateKey(day);
        return <Pressable key={key} onPress={() => { setDate(key); setSelected(null); }} style={{ backgroundColor: key === date ? colors.rose : colors.white, borderColor: key === date ? colors.rose : colors.line, borderWidth: 1, padding: 10, borderRadius: 12 }}>
          <Text style={{ color: key === date ? colors.white : colors.ink }}>{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", day: "numeric" }).format(day)}</Text>
        </Pressable>;
      })}
    </View>
    <Text style={{ color: colors.ink, fontWeight: "700", marginTop: 20, marginBottom: 9 }}>Available practitioners & times</Text>
    {slots.isLoading ? <Text style={{ color: colors.muted }}>Checking availability…</Text> : null}
    {slots.isError ? <ErrorText>Availability could not be checked. {slots.error.message}</ErrorText> : null}
    {slots.data?.map((slot) => <Pressable key={`${slot.practitioner_id}-${slot.starts_at}`} onPress={() => setSelected(slot)}>
      <Card style={{ borderColor: selected?.starts_at === slot.starts_at && selected.practitioner_id === slot.practitioner_id ? colors.rose : colors.line }}>
        <Text style={{ color: colors.ink }}>{new Date(slot.starts_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} · {practitioners.data?.find((person) => person.id === slot.practitioner_id)?.display_name ?? "Practitioner"}</Text>
      </Card>
    </Pressable>)}
    {slots.data?.length === 0 && !slots.isLoading ? <Text style={{ color: colors.muted }}>No available times on this day.</Text> : null}
    {error ? <ErrorText>{error}</ErrorText> : null}
    {selected ? <ActionButton label="Confirm new time" onPress={submit} busy={busy} /> : null}
  </Screen>;
}
