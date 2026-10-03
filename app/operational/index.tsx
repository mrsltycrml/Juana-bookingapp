import { Link, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { getAppointments } from "@/features/appointments/api";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { formatDateTime, formatMoney } from "@/utils/format";
import { businessDateKey } from "@/utils/dates";

export default function OperationalHome() {
  const { profile } = useAuth();
  const appointments = useQuery({ queryKey: ["operational-appointments"], queryFn: () => getAppointments() });
  const customers = useQuery({
    queryKey: ["customer-count"],
    enabled: profile?.role !== "PRACTITIONER",
    queryFn: async () => {
      const { count, error } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "CLIENT");
      if (error) throw error;
      return count ?? 0;
    },
  });
  const payments = useQuery({
    queryKey: ["operational-payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("amount,status,provider,currency,paid_at");
      if (error) throw error;
      return data;
    },
  });
  const showcase = useQuery({
    queryKey: ["showcase-run"],
    enabled: profile?.role !== "CLIENT",
    queryFn: async () => {
      const { data, error } = await supabase.from("showcase_runs").select("seed_status").limit(1);
      if (error && ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code)) return false;
      if (error) throw error;
      return data?.some((run) => run.seed_status === "ACTIVE") ?? false;
    },
  });
  const items = appointments.data ?? [];
  const today = businessDateKey(new Date());
  const todays = items.filter((appointment) => businessDateKey(appointment.starts_at) === today);
  const paidToday = payments.data?.filter((payment) => payment.status === "PAID"
    && payment.paid_at && businessDateKey(payment.paid_at) === today) ?? [];
  const revenueByCurrency = [...paidToday.reduce((totals, payment) => {
    totals.set(payment.currency, (totals.get(payment.currency) ?? 0) + Number(payment.amount));
    return totals;
  }, new Map<string, number>()).entries()];
  const paymentIssues = payments.data?.filter((payment) => ["PENDING", "FAILED", "EXPIRED"].includes(payment.status)).length ?? 0;
  const count = (status: string) => todays.filter((appointment) => appointment.status === status).length;
  const errorMessage = appointments.error?.message ?? payments.error?.message ?? customers.error?.message ?? showcase.error?.message;
  return <Screen>
    <Text style={{ color: colors.rose, letterSpacing: 2, fontSize: 11, fontWeight: "700", marginBottom: 12 }}>JUANA · STUDIO</Text>
    <Heading title={`Hello, ${profile?.full_name.split(" ")[0] ?? "team"}`} subtitle="Here’s what’s happening at the studio." />
    {showcase.data ? <Card style={{ backgroundColor: colors.blush, borderColor: colors.rose }}>
      <Text style={{ color: colors.rose, fontWeight: "800", letterSpacing: 1 }}>DEMO DATA ACTIVE</Text>
      <Text style={{ color: colors.ink, lineHeight: 21, marginTop: 6 }}>Appointments, revenue, payments, services, and customer records on this dashboard include clearly marked sample data. Remove it from More → Showcase demo data before going live.</Text>
    </Card> : null}
    {errorMessage ? <ErrorText>Dashboard data could not be loaded. {errorMessage}</ErrorText> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
      {[
        ["Today", todays.length],
        ["Checked in", count("CHECKED_IN")],
        ["Completed", count("COMPLETED")],
        ["No-shows", count("NO_SHOW")],
        ["Paid today", paidToday.length],
        ["Payment issues", paymentIssues],
      ].map(([label, value]) => <Card key={label} style={{ width: "48%", minHeight: 86 }}>
        <Text style={{ color: colors.muted }}>{label}</Text><Text style={{ color: colors.ink, fontSize: 25, fontWeight: "700", marginTop: 6 }}>{value}</Text>
      </Card>)}
    </View>
    <Card>
      <Text style={{ color: colors.muted }}>Paid revenue today</Text>
      {revenueByCurrency.length ? revenueByCurrency.map(([currency, amount]) => <Text key={currency} style={{ color: colors.ink, fontWeight: "700", fontSize: 17, marginTop: 8 }}>{formatMoney(amount, currency)}</Text>)
        : <Text style={{ color: colors.muted, marginTop: 7 }}>No verified payments recorded today.</Text>}
      {profile?.role !== "PRACTITIONER" ? <Text style={{ color: colors.muted, marginTop: 12 }}>Customers · {customers.data ?? "—"}</Text> : null}
    </Card>
    <View style={{ flexDirection: "row", gap: 10, marginBottom: 19 }}>
      <Text onPress={() => router.push("/operational/walk-in")} style={{ backgroundColor: colors.rose, color: "white", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 15, fontWeight: "700" }}>+ New appointment</Text>
      <Link href="/operational/calendar" style={{ color: colors.rose, borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 15, fontWeight: "700" }}>Calendar</Link>
    </View>
    <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", marginBottom: 10 }}>Today’s agenda</Text>
    {appointments.isLoading ? <Text style={{ color: colors.muted }}>Loading appointments…</Text> : null}
    {todays.slice(0, 6).map((appointment) => <Card key={appointment.id}>
      <Text style={{ color: colors.rose, fontWeight: "700" }}>{formatDateTime(appointment.starts_at)}</Text>
      <Text style={{ color: colors.ink, fontWeight: "700", marginTop: 5 }}>{appointment.customer?.full_name ?? "Client"} · {appointment.service?.name ?? "Service"}</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>{appointment.practitioner?.display_name} · {appointment.status.replaceAll("_", " ")}</Text>
    </Card>)}
    {todays.length === 0 && !appointments.isLoading ? <Card><Text style={{ color: colors.muted }}>No appointments scheduled for today.</Text></Card> : null}
    <Text onPress={() => router.push("/operational/more")} style={{ color: colors.rose, marginTop: 8 }}>Pending payment issues and studio tools →</Text>
  </Screen>;
}
