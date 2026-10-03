import { useEffect } from "react";
import { Link, router } from "expo-router";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen, Heading, Card, ActionButton, colors, ErrorText } from "@/components/ui";
import { getAppointments } from "@/features/appointments/api";
import { getActiveServices } from "@/features/services/api";
import { registerPushNotifications } from "@/features/notifications/register-push";
import { useAuth } from "@/hooks/use-auth";
import { clinicInfo } from "@/lib/clinic-info";
import { supabase } from "@/lib/supabase";
import { formatDateTime, formatServiceDuration, formatServicePrice } from "@/utils/format";

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
  const openClinicLink = (url: string, label: string) => {
    void Linking.openURL(url).catch((cause: unknown) => {
      Alert.alert(`Could not open ${label}`, cause instanceof Error ? cause.message : "Please try again.");
    });
  };
  return <Screen>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
      <View><Text style={{ color: colors.muted }}>A moment for you</Text><Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>{profile?.full_name.split(" ")[0] ?? "Welcome"}</Text></View>
      <Text onPress={() => void openNotifications()} style={{ fontSize: 22, padding: 10, color: colors.rose }}>♧</Text>
    </View>
    <Heading title="Care, at your pace." subtitle="Discover thoughtful treatments, booked around you." />
    {services.data?.some((service) => service.showcase_run_id) ? <Card style={{ backgroundColor: colors.blush, borderColor: colors.rose }}>
      <Text style={{ color: colors.rose, fontWeight: "800", letterSpacing: 1 }}>STAKEHOLDER SHOWCASE</Text>
      <Text style={{ color: colors.ink, lineHeight: 21, marginTop: 6 }}>Preview services cannot be booked. Prices are not published, durations are estimates, and sample appointments and schedules are not real clinic availability.</Text>
    </Card> : null}
    {appointments.isError ? <ErrorText>We couldn’t load your appointments: {appointments.error.message}</ErrorText> : null}
    {upcoming ? <Card style={{ backgroundColor: colors.blush, borderColor: colors.blush }}>
      {upcoming.showcase_run_id ? <Text style={{ color: colors.rose, fontWeight: "800", letterSpacing: 1, fontSize: 11 }}>SHOWCASE SAMPLE · NOT A REAL BOOKING</Text> : null}
      <Text style={{ color: colors.rose, fontWeight: "700", fontSize: 12, letterSpacing: 1 }}>UP NEXT</Text>
      <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 19, marginTop: 10 }}>{upcoming.service?.name ?? "Appointment"}</Text>
      <Text style={{ color: colors.muted, marginTop: 7 }}>{formatDateTime(upcoming.starts_at)}</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>With {upcoming.practitioner?.display_name ?? "your practitioner"}</Text>
      <Text style={{ color: colors.rose, fontWeight: "600", marginTop: 8 }}>{upcoming.showcase_run_id ? "DEMO ONLY · NO PAYMENT RECORD" : `Payment: ${upcoming.payments?.[0]?.status ?? "PENDING"}`}</Text>
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
      {service.showcase_run_id ? <Text style={{ color: colors.rose, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 5 }}>REFERENCE PREVIEW · NOT BOOKABLE</Text> : null}
      <Text style={{ color: colors.rose, fontSize: 12, fontWeight: "700", textTransform: "uppercase" }}>{service.category}</Text>
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", marginTop: 4 }}>{service.name}</Text>
      <Text numberOfLines={2} style={{ color: colors.muted, marginTop: 5 }}>{service.description}</Text>
      <Text style={{ color: colors.ink, marginTop: 10 }}>{formatServicePrice(service.price_amount, service.currency)}  ·  {formatServiceDuration(service.duration_minutes, !!service.showcase_run_id)}</Text>
      {service.showcase_run_id
        ? <Text style={{ color: colors.muted, fontWeight: "600", marginTop: 12 }}>Confirm details and suitability with the clinic</Text>
        : <Text onPress={() => router.push({ pathname: "/client/book", params: { serviceId: service.id } })} style={{ color: colors.rose, fontWeight: "700", marginTop: 12 }}>Choose this service →</Text>}
    </Card>)}
    {services.data?.length === 0 ? <Text style={{ color: colors.muted }}>Services are being added by the studio. Please check back soon.</Text> : null}
    <Card>
      <Text style={{ color: colors.rose, fontWeight: "800", letterSpacing: 1, fontSize: 11 }}>VISIT THE STUDIO</Text>
      <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17, marginTop: 6 }}>{clinicInfo.name}</Text>
      <Text style={{ color: colors.muted, lineHeight: 21, marginTop: 6 }}>{clinicInfo.address}</Text>
      <Pressable onPress={() => openClinicLink(clinicInfo.phoneUrl, "the phone app")} accessibilityRole="link" style={{ justifyContent: "center", minHeight: 44, marginTop: 8 }}>
        <Text style={{ color: colors.rose, fontWeight: "700" }}>Call {clinicInfo.phone}</Text>
      </Pressable>
      <Pressable onPress={() => openClinicLink(clinicInfo.mapUrl, "maps")} accessibilityRole="link" style={{ justifyContent: "center", minHeight: 44 }}>
        <Text style={{ color: colors.rose, fontWeight: "700" }}>Open directions</Text>
      </Pressable>
      <Pressable onPress={() => openClinicLink(clinicInfo.facebookUrl, "Facebook")} accessibilityRole="link" style={{ justifyContent: "center", minHeight: 44 }}>
        <Text style={{ color: colors.rose, fontWeight: "700" }}>Visit Facebook</Text>
      </Pressable>
    </Card>
    {services.isLoading || appointments.isLoading ? <Text style={{ color: colors.muted, marginTop: 12 }}>Loading your Juana experience…</Text> : null}
    <Text onPress={() => void supabase.auth.refreshSession()} style={{ display: "none" }}>refresh</Text>
  </Screen>;
}
