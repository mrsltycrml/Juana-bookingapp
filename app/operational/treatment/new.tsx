import { useState } from "react";
import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ActionButton, ErrorText, Field, Heading, Screen } from "@/components/ui";
import { supabase } from "@/lib/supabase";

const schema = z.object({ appointmentId: z.uuid(), details: z.string().trim().min(2) });

export default function NewTreatmentRecord() {
  const { appointmentId = "" } = useLocalSearchParams<{ appointmentId: string }>();
  const client = useQueryClient();
  const [details, setDetails] = useState("");
  const [areas, setAreas] = useState("");
  const [products, setProducts] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const validated = schema.safeParse({ appointmentId, details });
    if (!validated.success) { setError("Add the treatment details before completing this appointment."); return; }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("create_treatment_record", {
      p_appointment_id: appointmentId,
      p_details: details.trim(),
      p_areas: areas.split(",").map((item) => item.trim()).filter(Boolean),
      p_products: products.split(",").map((item) => item.trim()).filter(Boolean),
      p_notes: notes.trim() || null,
      p_follow_up: followUp.trim() || null,
    });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    await client.invalidateQueries({ queryKey: ["operational-appointments"] });
    await client.invalidateQueries({ queryKey: ["appointments"] });
    router.replace("/operational/appointments");
  };
  return <Screen>
    <Heading title="Treatment record" subtitle="Save the visit details. Completing this record marks the appointment as complete." />
    <Field label="Treatment details *" value={details} onChangeText={setDetails} multiline />
    <Field label="Areas treated (separate with commas)" value={areas} onChangeText={setAreas} />
    <Field label="Products used (separate with commas)" value={products} onChangeText={setProducts} />
    <Field label="Clinical / studio notes" value={notes} onChangeText={setNotes} multiline />
    <Field label="Follow-up recommendations" value={followUp} onChangeText={setFollowUp} multiline />
    {error ? <ErrorText>{error}</ErrorText> : null}
    <Text style={{ color: "#88777F", marginBottom: 13 }}>Treatment information is visible only to the customer and authorized staff.</Text>
    <ActionButton label="Save record & complete appointment" onPress={() => void save()} busy={busy} />
  </Screen>;
}
