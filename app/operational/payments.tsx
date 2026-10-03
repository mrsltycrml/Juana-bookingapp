import { Text } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { formatDateTime, formatMoney } from "@/utils/format";
import { firstRelation } from "@/utils/relations";

export default function PaymentsScreen() {
  const { profile } = useAuth();
  const allowed = profile?.role === "ADMIN" || profile?.role === "FRONT_DESK";
  const query = useQuery({
    queryKey: ["payments"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.from("payments")
        .select("id,appointment_id,amount,currency,status,provider,provider_reference,manual_reference,paid_at,created_at,appointment:appointments(id,starts_at,showcase_run_id,customer:profiles(full_name),service:services(name))")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });
  if (!allowed) return <Screen><Heading title="Payments" subtitle="Payment management is available to Front Desk and Administrators." /></Screen>;
  return <Screen>
    <Heading title="Payments" subtitle="Gateway-verified payments and clearly labeled manual payments." />
    {query.isError ? <ErrorText>Payments could not be loaded. {query.error.message}</ErrorText> : null}
    {query.data?.map((payment) => <Card key={payment.id}>
      <Text style={{ color: payment.status === "PAID" ? colors.rose : colors.muted, fontWeight: "700" }}>{firstRelation(payment.appointment)?.showcase_run_id || payment.manual_reference?.startsWith("DEMO ONLY") ? "DEMO SAMPLE · NOT A REAL PAYMENT" : `${payment.status} · ${payment.provider === "MANUAL" ? "MANUAL PAYMENT" : payment.provider}`}</Text>
      <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17, marginTop: 6 }}>{formatMoney(Number(payment.amount), payment.currency)}</Text>
      <Text style={{ color: colors.muted, marginTop: 5 }}>{firstRelation(firstRelation(payment.appointment)?.customer)?.full_name ?? "Customer"} · {firstRelation(firstRelation(payment.appointment)?.service)?.name ?? "Service"}</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>{firstRelation(payment.appointment)?.starts_at ? formatDateTime(firstRelation(payment.appointment)!.starts_at) : "Appointment unavailable"}</Text>
      {payment.provider === "MANUAL" ? <Text style={{ color: colors.muted, marginTop: 5 }}>Receipt: {payment.manual_reference ?? "—"}</Text> : null}
      {payment.paid_at ? <Text style={{ color: colors.muted, marginTop: 5 }}>Paid {new Date(payment.paid_at).toLocaleString()}</Text> : null}
      <Text onPress={() => router.push({ pathname: "/operational/appointment/[id]", params: { id: payment.appointment_id } })} style={{ color: colors.rose, marginTop: 10 }}>View appointment →</Text>
    </Card>)}
    {query.data?.length === 0 && !query.isLoading ? <Text style={{ color: colors.muted }}>No payment records yet.</Text> : null}
    {query.data?.some((payment) => ["FAILED", "EXPIRED"].includes(payment.status)) ? <Card style={{ backgroundColor: colors.blush }}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>Payment issues need attention</Text>
      <Text style={{ color: colors.muted, marginTop: 6 }}>Review failed and expired attempts with the customer. The mobile app never marks gateway payments as paid.</Text>
    </Card> : null}
  </Screen>;
}
