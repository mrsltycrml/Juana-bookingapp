import { Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/utils/format";
import { firstRelation } from "@/utils/relations";

export default function TreatmentHistoryScreen() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["treatment-history", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("treatment_records")
        .select("id, treatment_date, details, areas_treated, products_used, follow_up_recommendations, service:services(name), practitioner:practitioners(display_name)")
        .eq("customer_id", user!.id).order("treatment_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  return <Screen>
    <Heading title="Treatment history" subtitle="A private record of the care you’ve received." />
    {query.isLoading ? <Text style={{ color: colors.muted }}>Loading your history…</Text> : null}
    {query.isError ? <ErrorText>Treatment history could not be loaded. {query.error.message}</ErrorText> : null}
    {query.data?.map((record) => <Card key={record.id}>
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>{firstRelation(record.service)?.name ?? "Treatment"}</Text>
      <Text style={{ color: colors.muted, marginTop: 5 }}>{formatDateTime(record.treatment_date)} · {firstRelation(record.practitioner)?.display_name}</Text>
      <Text style={{ color: colors.ink, lineHeight: 21, marginTop: 10 }}>{record.details}</Text>
      {record.areas_treated.length ? <Text style={{ color: colors.muted, marginTop: 8 }}>Areas: {record.areas_treated.join(", ")}</Text> : null}
      {record.products_used.length ? <Text style={{ color: colors.muted, marginTop: 5 }}>Products: {record.products_used.join(", ")}</Text> : null}
      {record.follow_up_recommendations ? <Text style={{ color: colors.rose, marginTop: 9 }}>Follow-up: {record.follow_up_recommendations}</Text> : null}
    </Card>)}
    {query.data?.length === 0 ? <Text style={{ color: colors.muted }}>Completed treatments will appear here after your visit.</Text> : null}
  </Screen>;
}
