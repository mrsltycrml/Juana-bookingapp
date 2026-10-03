import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { getAppointments } from "@/features/appointments/api";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime } from "@/utils/format";
import { businessDateKey } from "@/utils/dates";

export default function CalendarScreen() {
  const { profile } = useAuth();
  const [date, setDate] = useState(new Date());
  const [mode, setMode] = useState<"DAY" | "AGENDA" | "WEEK" | "MONTH">("AGENDA");
  const appointments = useQuery({ queryKey: ["operational-appointments"], queryFn: () => getAppointments() });
  const days = useMemo(() => {
    if (mode === "MONTH") {
      const first = new Date(date.getFullYear(), date.getMonth(), 1);
      return Array.from({ length: new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() }, (_, index) => {
        const day = new Date(first); day.setDate(first.getDate() + index); return day;
      });
    }
    if (mode === "WEEK") {
      const first = new Date(date); first.setDate(date.getDate() - date.getDay());
      return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(first); day.setDate(first.getDate() + index); return day;
      });
    }
    return Array.from({ length: 15 }, (_, index) => {
      const next = new Date(date); next.setDate(next.getDate() + index); return next;
    });
  }, [date, mode]);
  const key = businessDateKey(date);
  const rangeStart = mode === "MONTH" ? businessDateKey(new Date(date.getFullYear(), date.getMonth(), 1))
    : mode === "WEEK" ? businessDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay())) : key;
  const rangeEnd = mode === "MONTH" ? businessDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 1))
    : mode === "WEEK" ? businessDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay() + 7)) : key;
  const agenda = appointments.data?.filter((item) => {
    const appointmentDay = businessDateKey(item.starts_at);
    return mode === "DAY" || mode === "AGENDA" ? appointmentDay === key : appointmentDay >= rangeStart && appointmentDay < rangeEnd;
  }) ?? [];
  const shiftRange = (direction: -1 | 1) => {
    const next = new Date(date);
    if (mode === "MONTH") next.setMonth(next.getMonth() + direction);
    else if (mode === "WEEK") next.setDate(next.getDate() + direction * 7);
    else next.setDate(next.getDate() + direction * 15);
    setDate(next);
  };
  return <Screen>
    <Heading title="Studio calendar" subtitle="Day and agenda view of booked appointments." />
    <View style={{ flexDirection: "row", gap: 7, marginBottom: 12 }}>
      {(["DAY", "AGENDA", "WEEK", "MONTH"] as const).map((value) => <Pressable key={value} onPress={() => setMode(value)} style={{ backgroundColor: mode === value ? colors.rose : colors.white, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 12 }}>
        <Text style={{ color: mode === value ? colors.white : colors.muted, fontSize: 11, fontWeight: "700" }}>{value}</Text>
      </Pressable>)}
    </View>
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
      <Text onPress={() => shiftRange(-1)} style={{ color: colors.rose, padding: 5 }}>‹ Previous</Text>
      <Text style={{ color: colors.ink, fontWeight: "600", padding: 5 }}>{mode === "MONTH" ? date.toLocaleDateString("en-PH", { month: "long", year: "numeric" }) : mode === "WEEK" ? "Selected week" : "Upcoming days"}</Text>
      <Text onPress={() => shiftRange(1)} style={{ color: colors.rose, padding: 5 }}>Next ›</Text>
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 15 }}>
      {days.map((day) => {
        const dateKey = businessDateKey(day);
        return <Pressable key={dateKey} onPress={() => setDate(day)} style={{ padding: 10, borderRadius: 12, backgroundColor: dateKey === key ? colors.rose : colors.white, borderWidth: 1, borderColor: dateKey === key ? colors.rose : colors.line }}>
          <Text style={{ color: dateKey === key ? colors.white : colors.ink, fontSize: 12 }}>{new Intl.DateTimeFormat("en-PH", { weekday: "short", day: "numeric" }).format(day)}</Text>
        </Pressable>;
      })}
    </View>
    {appointments.isError ? <ErrorText>Calendar could not be loaded. {appointments.error.message}</ErrorText> : null}
    {agenda.map((appointment) => <Pressable key={appointment.id} onPress={() => router.push({ pathname: "/operational/appointment/[id]", params: { id: appointment.id } })}>
      <Card>
        <Text style={{ color: colors.rose, fontWeight: "700" }}>{formatDateTime(appointment.starts_at)}</Text>
        {appointment.showcase_run_id ? <Text style={{ color: colors.rose, fontWeight: "800", fontSize: 11, letterSpacing: 1, marginTop: 5 }}>SHOWCASE SAMPLE</Text> : null}
        <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", marginTop: 5 }}>{appointment.customer?.full_name ?? (profile?.role === "PRACTITIONER" ? "Assigned customer" : "Customer")}</Text>
        <Text style={{ color: colors.muted, marginTop: 5 }}>{appointment.service?.name} · {appointment.practitioner?.display_name}</Text>
        <Text style={{ color: colors.muted, marginTop: 5 }}>{appointment.status.replaceAll("_", " ")} · {appointment.showcase_run_id ? "SAMPLE PAYMENT · UNPAID" : appointment.payments?.[0]?.status ?? "PENDING"}</Text>
      </Card>
    </Pressable>)}
    {agenda.length === 0 && !appointments.isLoading ? <Card><Text style={{ color: colors.muted }}>No appointments in this {mode.toLowerCase()} view.</Text></Card> : null}
  </Screen>;
}
