import { useEffect } from "react";
import { Link, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { Screen, Heading, Card, ActionButton, colors, ErrorText } from "@/components/ui";
import { getAppointments } from "@/features/appointments/api";
import { getActiveServices } from "@/features/services/api";
import { registerPushNotifications } from "@/features/notifications/register-push";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { formatDateTime, formatMoney } from "@/utils/format";

export default function ClientHome() {
  const { profile, user } = useAuth();
  const appointments = useQuery({ queryKey: ["appointments", user?.id], queryFn: () => getAppointments(user?.id), enabled: !!user });
  const services = useQuery({ queryKey: ["services"], queryFn: getActiveServices });
  const upcoming = appointments.data?.find((item) => ["BOOKED", "CHECKED_IN"].includes(item.status) && new Date(item.starts_at) > new Date());
  useEffect(() => {
    if (profile?.id) void registerPushNotifications(profile.id).catch((error: unknown) => console.warn("Push notifications could not be enabled", error));
  }, [profile?.id]);
  const openNotifications = async () => {
    router.push("/client/notifications");
  };
  return <Screen>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
      <View><Text style={{ color: colors.muted }}>A moment for you</Text><Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>{profile?.full_name.split(" ")[0] ?? "Welcome"}</Text></View>
      <Text onPress={() => void openNotifications()} style={{ fontSize: 22, padding: 10, color: colors.rose }}>♧</Text>
    </View>
    <Heading title="Care, at your pace." subtitle="Discover thoughtful treatments, booked around you." />
    {services.data?.some((service) => service.showcase_run_id) ? <Card style={{ backgroundColor: colors.blush, borderColor: colors.rose }}>
      <Text style={{ color: colors.rose, fontWeight: "800", letterSpacing: 1 }}>STAKEHOLDER SHOWCASE</Text>
      <Text style={{ color: colors.ink, lineHeight: 21, marginTop: 6 }}>This catalog contains sample services and sample prices only. It does not represent confirmed Juana offerings or pricing.</Text>
    </Card> : null}
    {appointments.isError ? <ErrorText>We couldn’t load your appointments: {appointments.error.message}</ErrorText> : null}
    {upcoming ? <Card style={{ backgroundColor: colors.blush, borderColor: colors.blush }}>
      {upcoming.showcase_run_id ? <Text style={{ color: colors.rose, fontWeight: "800", letterSpacing: 1, fontSize: 11 }}>SHOWCASE SAMPLE · NOT A REAL BOOKING</Text> : null}
      <Text style={{ color: colors.rose, fontWeight: "700", fontSize: 12, letterSpacing: 1 }}>UP NEXT</Text>
      <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 19, marginTop: 10 }}>{upcoming.service?.name ?? "Appointment"}</Text>
      <Text style={{ color: colors.muted, marginTop: 7 }}>{formatDateTime(upcoming.starts_at)}</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>With {upcoming.practitioner?.display_name ?? "your practitioner"}</Text>
      <Text style={{ color: colors.rose, fontWeight: "600", marginTop: 8 }}>{upcoming.showcase_run_id ? "SAMPLE ONLY · NOT PAID" : `Payment: ${upcoming.payments?.[0]?.status ?? "PENDING"}`}</Text>
    </Card> : <Card>
      <Text style={{ fontSize: 18, color: colors.ink, fontWeight: "700" }}>Your next little escape</Text>
      <Text style={{ color: colors.muted, lineHeight: 21, marginTop: 8, marginBottom: 14 }}>No upcoming appointments yet. Find a service that feels right for you.</Text>
      <ActionButton label="Book an appointment" onPress={() => router.push("/client/book")} />
    </Card>}
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 20, marginBottom: 12 }}>
      <Text style={{ fontSize: 19, color: colors.ink, fontWeight: "700" }}>A few favorites</Text>
      <Link href="/client/services" style={{ color: colors.rose, fontWeight: "600" }}>See all</Link>
    </View>
    {services.isError ? <ErrorText>Services could not be loaded. {services.error.message}</ErrorText> : null}
    {services.data?.slice(0, 3).map((service) => <Card key={service.id}>
      {service.showcase_run_id ? <Text style={{ color: colors.rose, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 5 }}>SAMPLE · NOT A REAL SERVICE</Text> : null}
      <Text style={{ color: colors.rose, fontSize: 12, fontWeight: "700", textTransform: "uppercase" }}>{service.category}</Text>
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", marginTop: 4 }}>{service.name}</Text>
      <Text numberOfLines={2} style={{ color: colors.muted, marginTop: 5 }}>{service.description}</Text>
      <Text style={{ color: colors.ink, marginTop: 10 }}>{formatMoney(service.price_amount, service.currency)}  ·  {service.duration_minutes} min</Text>
      <Text onPress={() => router.push({ pathname: "/client/book", params: { serviceId: service.id } })} style={{ color: colors.rose, fontWeight: "700", marginTop: 12 }}>Choose this service →</Text>
    </Card>)}
    {services.data?.length === 0 ? <Text style={{ color: colors.muted }}>Services are being added by the studio. Please check back soon.</Text> : null}
    {services.isLoading || appointments.isLoading ? <Text style={{ color: colors.muted, marginTop: 12 }}>Loading your Juana experience…</Text> : null}
    <Text onPress={() => void supabase.auth.refreshSession()} style={{ display: "none" }}>refresh</Text>
  </Screen>;
}
