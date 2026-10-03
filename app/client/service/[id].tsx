import { Image, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { getService, getServicePractitioners } from "@/features/services/api";
import { supabase } from "@/lib/supabase";
import { formatMoney } from "@/utils/format";

export default function ServiceDetails() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const service = useQuery({ queryKey: ["service", id], queryFn: () => getService(id), enabled: !!id });
  const practitioners = useQuery({
    queryKey: ["service-practitioners", id],
    queryFn: () => getServicePractitioners(id),
    enabled: !!id,
  });
  if (service.isLoading) return <Screen><Text style={{ color: colors.muted }}>Loading service…</Text></Screen>;
  if (service.isError) return <Screen><ErrorText>Service could not be loaded. {service.error.message}</ErrorText></Screen>;
  if (!service.data) return <Screen><Heading title="Service unavailable" subtitle="This service is no longer available." /></Screen>;
  const item = service.data;
  return <Screen>
    {item.showcase_run_id ? <Card style={{ backgroundColor: colors.blush, borderColor: colors.rose }}>
      <Text style={{ color: colors.rose, fontWeight: "800", letterSpacing: 1 }}>SHOWCASE SAMPLE</Text>
      <Text style={{ color: colors.ink, marginTop: 6 }}>Sample service details and pricing only. Confirm real services and prices with the studio.</Text>
    </Card> : null}
    {item.image_path ? <Image source={{ uri: supabase.storage.from("service-images").getPublicUrl(item.image_path).data.publicUrl }} style={{ height: 225, borderRadius: 22, marginBottom: 22 }} /> : null}
    <Text style={{ color: colors.rose, fontWeight: "700", textTransform: "uppercase", fontSize: 12 }}>{item.category}</Text>
    <Heading title={item.name} />
    <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 24, marginBottom: 20 }}>{item.description}</Text>
    <Card>
      <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 19 }}>{formatMoney(item.price_amount, item.currency)}</Text>
      <Text style={{ color: colors.muted, marginTop: 6 }}>{item.duration_minutes} minutes</Text>
      <Text style={{ color: colors.muted, marginTop: 8 }}>{item.requires_consent ? "Consent form required before payment." : "No service consent form is required."}</Text>
    </Card>
    <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 18, marginTop: 10, marginBottom: 10 }}>Practitioners</Text>
    {practitioners.isError ? <ErrorText>Practitioners could not be loaded. {practitioners.error.message}</ErrorText> : null}
    {practitioners.data?.map((person) => <Card key={person.id}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>{person.display_name}</Text>
      {person.bio ? <Text style={{ color: colors.muted, marginTop: 5 }}>{person.bio}</Text> : null}
    </Card>)}
    {practitioners.data?.length === 0 ? <Text style={{ color: colors.muted, marginBottom: 15 }}>No active practitioners are listed for this service.</Text> : null}
    {item.showcase_run_id
      ? <Card><Text style={{ color: colors.muted }}>Showcase services are for browsing only. Booking and payment are disabled for sample data.</Text></Card>
      : <ActionButton label="Book this service" onPress={() => router.push({ pathname: "/client/book", params: { serviceId: item.id } })} />}
  </Screen>;
}
