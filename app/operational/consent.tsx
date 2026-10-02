import { useState } from "react";
import { Alert, Text } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import type { Service } from "@/types/database";

export default function ConsentManagement() {
  const { profile } = useAuth();
  const client = useQueryClient();
  const [formId, setFormId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questionsText, setQuestionsText] = useState("");
  const [agreementsText, setAgreementsText] = useState("");
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [activate, setActivate] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = profile?.role === "ADMIN";
  const forms = useQuery({
    queryKey: ["consent-admin"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("consent_forms")
        .select("id,title,description,service_id,is_active,current_version:consent_form_versions!consent_form_current_version_fk(id,version,questions,agreements,requires_signature)")
        .order("title");
      if (queryError) throw queryError;
      return data;
    },
  });
  const services = useQuery({
    queryKey: ["admin-services"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("services").select("*").order("name");
      if (queryError) throw queryError;
      return data as Service[];
    },
  });
  if (!isAdmin) return <Screen><Heading title="Consent forms" subtitle="Consent form management is available to administrators only." /></Screen>;
  const reset = () => {
    setFormId(null); setServiceId(""); setTitle(""); setDescription("");
    setQuestionsText(""); setAgreementsText(""); setRequiresSignature(false);
    setActivate(true); setError("");
  };
  const startEdit = (form: NonNullable<typeof forms.data>[number]) => {
    const version = Array.isArray(form.current_version) ? form.current_version[0] : form.current_version;
    setFormId(form.id); setServiceId(form.service_id ?? ""); setTitle(form.title);
    setDescription(form.description); setRequiresSignature(version?.requires_signature ?? false);
    setQuestionsText((version?.questions ?? []).map((question: { label?: string }) => question.label ?? "").join("\n"));
    setAgreementsText((version?.agreements ?? []).map((agreement: string | { text?: string }) => typeof agreement === "string" ? agreement : agreement.text ?? "").join("\n"));
    setActivate(form.is_active); setError("");
  };
  const save = async () => {
    if (title.trim().length < 2) { setError("Enter a title for the consent form."); return; }
    const questions = questionsText.split("\n").map((label, index) => label.trim()).filter(Boolean)
      .map((label, index) => ({ id: `question-${index + 1}`, label, type: "text", required: true }));
    const agreements = agreementsText.split("\n").map((text) => text.trim()).filter(Boolean)
      .map((text, index) => ({ id: `agreement-${index + 1}`, text }));
    if (!agreements.length) { setError("Add at least one agreement for the customer to acknowledge."); return; }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_consent_form", {
      p_form_id: formId,
      p_service_id: serviceId || null,
      p_title: title.trim(),
      p_description: description.trim(),
      p_questions: questions,
      p_agreements: agreements,
      p_requires_signature: requiresSignature,
      p_activate: activate,
    });
    setBusy(false);
    if (saveError) setError(saveError.message);
    else { reset(); await client.invalidateQueries({ queryKey: ["consent-admin"] }); }
  };
  const deactivate = (id: string) => Alert.alert("Deactivate consent form?", "Previous consent versions and submissions will remain available.", [
    { text: "Keep active", style: "cancel" },
    { text: "Deactivate", style: "destructive", onPress: () => {
      void (async () => {
        try {
          const { error: actionError } = await supabase.rpc("deactivate_consent_form", { p_form_id: id });
          if (actionError) throw actionError;
          await client.invalidateQueries({ queryKey: ["consent-admin"] });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Form could not be deactivated.");
        }
      })();
    } },
  ]);
  return <Screen>
    <Heading title="Consent forms" subtitle="Every save creates an immutable version; submitted records remain unchanged." />
    {error ? <ErrorText>{error}</ErrorText> : null}
    <Card>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>{formId ? "Create a new version" : "Create a consent form"}</Text>
      <Field label="Title" value={title} onChangeText={setTitle} />
      <Field label="Description" value={description} onChangeText={setDescription} multiline />
      <Text style={{ color: colors.ink, marginBottom: 7 }}>Service (optional; an all-services form is used when no service-specific form exists)</Text>
      <Text onPress={() => setServiceId("")} style={{ color: colors.rose, paddingVertical: 6 }}>All services {serviceId ? "" : "✓"}</Text>
      {services.data?.map((service) => <Text key={service.id} onPress={() => setServiceId(service.id)} style={{ color: colors.ink, paddingVertical: 6 }}>{serviceId === service.id ? "☑" : "☐"} {service.name}</Text>)}
      <Field label="Questions (one per line)" value={questionsText} onChangeText={setQuestionsText} multiline />
      <Field label="Agreements (one per line)" value={agreementsText} onChangeText={setAgreementsText} multiline />
      <Text onPress={() => setRequiresSignature((value) => !value)} style={{ color: colors.ink, paddingVertical: 9 }}>{requiresSignature ? "☑" : "☐"} Require digital signature</Text>
      <Text onPress={() => setActivate((value) => !value)} style={{ color: colors.ink, paddingVertical: 9 }}>{activate ? "☑" : "☐"} Activate this version now</Text>
      <ActionButton label={formId ? "Save new version" : "Create consent form"} onPress={() => void save()} busy={busy} />
      {formId ? <Text onPress={reset} style={{ color: colors.muted, textAlign: "center", padding: 12 }}>Cancel</Text> : null}
    </Card>
    {forms.isError ? <ErrorText>Consent forms could not be loaded. {forms.error.message}</ErrorText> : null}
    {forms.data?.map((form) => {
      const version = Array.isArray(form.current_version) ? form.current_version[0] : form.current_version;
      return <Card key={form.id}>
        <Text style={{ color: colors.rose, fontWeight: "700" }}>{form.is_active ? "ACTIVE" : "INACTIVE"} · VERSION {version?.version ?? "DRAFT"}</Text>
        <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17, marginTop: 5 }}>{form.title}</Text>
        <Text style={{ color: colors.muted, marginTop: 5 }}>{services.data?.find((service) => service.id === form.service_id)?.name ?? "No linked service"}</Text>
        <Text onPress={() => startEdit(form)} style={{ color: colors.rose, marginTop: 12 }}>Create a new version</Text>
        {form.is_active ? <Text onPress={() => deactivate(form.id)} style={{ color: colors.muted, marginTop: 10 }}>Deactivate</Text> : null}
      </Card>;
    })}
  </Screen>;
}
