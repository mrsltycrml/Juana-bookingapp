import { useState } from "react";
import { Alert, Text } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";

export default function ShowcaseDataScreen() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const isAdmin = profile?.role === "ADMIN";
  const run = useQuery({
    queryKey: ["showcase-run"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("showcase_runs")
        .select("id,created_at,seed_status").order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const perform = async (action: "seed" | "clear") => {
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("showcase-data", { body: { action } });
      if (error) {
        let detail = error.message;
        try {
          const response = "context" in error ? error.context : null;
          if (response instanceof Response) {
            const body = await response.json() as { error?: string };
            detail = body.error ?? detail;
          }
        } catch {
          // Keep the function error message when its response is not JSON.
        }
        throw new Error(detail);
      }
      setSuccessMessage(data?.message ?? (action === "seed" ? "Showcase data was added." : "Showcase data was removed."));
      await queryClient.invalidateQueries();
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Showcase data could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = (action: "seed" | "clear") => Alert.alert(
    action === "seed" ? "Load showcase data?" : "Remove showcase data?",
    action === "seed"
      ? "This creates clearly labelled sample services, two temporary practitioner accounts, four temporary client accounts, sample appointments, treatment history, and unpaid demo-only payment placeholders. It does not use real customer or business data or record a payment as successful."
      : "This permanently removes the showcase records, temporary accounts, and any bookings or treatments created using the sample services. Other studio records are not changed.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: action === "seed" ? "Load sample data" : "Remove sample data",
        style: action === "clear" ? "destructive" : "default",
        onPress: () => void perform(action),
      },
    ],
  );

  if (!isAdmin) {
    return <Screen><Heading title="Showcase data" subtitle="This tool is available to administrators only." /></Screen>;
  }

  return <Screen>
    <Heading title="Showcase demo" subtitle="Populate the app for stakeholder presentations, then remove the sample data before going live." />
    <Card style={{ backgroundColor: colors.blush, borderColor: colors.rose }}>
      <Text style={{ color: colors.rose, fontWeight: "800", letterSpacing: 1 }}>DEMO DATA ONLY</Text>
      <Text style={{ color: colors.ink, lineHeight: 22, marginTop: 8 }}>
        All names, services, schedules, prices, appointments, treatment notes, and manual payment entries are synthetic examples. They are not Juana business data, real customers, or real payments. Sample prices are not verified prices.
      </Text>
    </Card>
    {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
    {successMessage ? <Card><Text style={{ color: colors.ink }}>{successMessage}</Text></Card> : null}
    {run.isError ? <ErrorText>Showcase status could not be loaded. {run.error.message}</ErrorText> : null}
    {run.data?.seed_status === "ACTIVE" ? (
      <Card>
        <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17 }}>Sample data is loaded</Text>
        <Text style={{ color: colors.muted, marginTop: 7 }}>Created {new Date(run.data.created_at).toLocaleString()}</Text>
        <Text style={{ color: colors.muted, marginTop: 7 }}>Browse the operational calendar, appointments, customers, payments, services, and treatment history to see the populated experience.</Text>
        <ActionButton label="Remove all showcase data" onPress={() => confirm("clear")} variant="secondary" busy={busy} />
      </Card>
    ) : run.data?.seed_status === "PREPARING" ? (
      <Card>
        <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17 }}>Showcase data is being prepared</Text>
        <Text style={{ color: colors.muted, lineHeight: 21, marginVertical: 10 }}>Wait for setup to finish, or refresh the status. You can remove an interrupted setup here.</Text>
        <ActionButton label="Refresh status" onPress={() => void run.refetch()} variant="secondary" />
        <ActionButton label="Remove interrupted setup" onPress={() => confirm("clear")} busy={busy} />
      </Card>
    ) : (
      <Card>
        <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17 }}>Your studio tables stay untouched</Text>
        <Text style={{ color: colors.muted, lineHeight: 21, marginVertical: 10 }}>
          The sample records use dedicated showcase markers and temporary accounts with randomly generated passwords that are never displayed or sent. You can safely remove the complete sample set from here.
        </Text>
        <ActionButton label="Load showcase sample data" onPress={() => confirm("seed")} busy={busy || run.isLoading} />
      </Card>
    )}
  </Screen>;
}
