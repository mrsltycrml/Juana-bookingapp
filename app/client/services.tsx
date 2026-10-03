import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { getActiveServices } from "@/features/services/api";
import { formatMoney } from "@/utils/format";

export default function ServicesScreen() {
  const query = useQuery({ queryKey: ["services"], queryFn: getActiveServices });
  return <Screen>
    <Heading title="Treatments" subtitle="Explore services and find the right fit for you." />
    {query.isLoading ? <Text style={{ color: colors.muted }}>Loading services…</Text> : null}
    {query.isError ? <ErrorText>Services could not be loaded. {query.error.message}</ErrorText> : null}
    {query.data?.map((service) => <Card key={service.id}>
      {service.showcase_run_id ? <Text style={{ color: colors.rose, fontWeight: "800", letterSpacing: 1, fontSize: 11, marginBottom: 7 }}>SHOWCASE SAMPLE · NOT A REAL JUANA SERVICE</Text> : null}
      <Text style={{ color: colors.rose, fontWeight: "700", textTransform: "uppercase", fontSize: 12 }}>{service.category}</Text>
      <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink, marginTop: 5 }}>{service.name}</Text>
      <Text style={{ color: colors.muted, lineHeight: 21, marginTop: 8 }}>{service.description}</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
        <Text style={{ color: colors.ink, fontWeight: "600" }}>{formatMoney(service.price_amount, service.currency)}</Text>
        <Text style={{ color: colors.muted }}>{service.duration_minutes} min</Text>
      </View>
      {service.requires_consent ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>Consent form required before payment</Text> : null}
      <Pressable onPress={() => router.push({ pathname: "/client/service/[id]", params: { id: service.id } })} hitSlop={8}>
        <Text style={{ color: colors.rose, fontWeight: "700", marginTop: 15 }}>View details →</Text>
      </Pressable>
      <Text onPress={() => router.push({ pathname: "/client/book", params: { serviceId: service.id } })} style={{ color: colors.muted, fontWeight: "600", marginTop: 12 }}>Book this treatment</Text>
    </Card>)}
    {query.data?.length === 0 ? <Text style={{ color: colors.muted }}>There are no active services available right now.</Text> : null}
  </Screen>;
}
