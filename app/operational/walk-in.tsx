import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { getServicePractitioners } from "@/features/services/api";
import { getActiveConsentForm, getSlots } from "@/features/appointments/api";
import { supabase } from "@/lib/supabase";
import { formatServiceDuration, formatServicePrice } from "@/utils/format";
import type { AvailableSlot } from "@/features/appointments/api";
import type { ConsentForm } from "@/types/database";
import { businessDateKey, manilaDate } from "@/utils/dates";

export default function WalkInScreen() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState<{ id: string; full_name: string; email: string } | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [date, setDate] = useState(businessDateKey(new Date()));
  const [dateOffset, setDateOffset] = useState(0);
  const [slot, setSlot] = useState<AvailableSlot | null>(null);
  const [reservationId, setReservationId] = useState("");
  const [consentForm, setConsentForm] = useState<(ConsentForm & { current_version: {
    id: string; version: number; questions: { id: string; label: string; required?: boolean; type?: string }[];
    agreements: ({ id: string; text: string } | string)[]; requires_signature: boolean;
  } | null }) | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [signature, setSignature] = useState("");
  const [manualPaid, setManualPaid] = useState(false);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const services = useQuery({
    queryKey: ["services"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("services")
        .select("id,name,price_amount,currency,duration_minutes,requires_consent,showcase_run_id")
        .eq("is_active", true).is("showcase_run_id", null).order("name");
      if (queryError) throw queryError;
      return data;
    },
  });
  const people = useQuery({
    queryKey: ["walk-in-customer-search", search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const term = `%${search.trim().replace(/[%_\\]/g, "\\$&")}%`;
      const results = await Promise.all([
        supabase.from("profiles").select("id,full_name,email,mobile_number").eq("role", "CLIENT").ilike("full_name", term).limit(15),
        supabase.from("profiles").select("id,full_name,email,mobile_number").eq("role", "CLIENT").ilike("email", term).limit(15),
        supabase.from("profiles").select("id,full_name,email,mobile_number").eq("role", "CLIENT").ilike("mobile_number", term).limit(15),
      ]);
      const failure = results.find((result) => result.error);
      if (failure?.error) throw failure.error;
      return [...new Map(results.flatMap((result) => result.data ?? []).map((person) => [person.id, person])).values()];
    },
  });
  const practitioners = useQuery({
    queryKey: ["service-practitioners", serviceId],
    enabled: !!serviceId,
    queryFn: () => getServicePractitioners(serviceId),
  });
  const slots = useQuery({
    queryKey: ["walk-in-slots", serviceId, practitionerId, date],
    enabled: !!serviceId,
    queryFn: () => getSlots(serviceId, date, practitionerId || undefined),
  });
  const service = services.data?.find((item) => item.id === serviceId);
  const days = useMemo(() => Array.from({ length: 14 }, (_, index) => manilaDate(dateOffset + index)), [dateOffset]);
  const moveDateRange = (direction: -1 | 1) => {
    const offset = Math.max(0, dateOffset + direction * days.length);
    setDateOffset(offset);
    setDate(businessDateKey(manilaDate(offset))); setSlot(null);
  };
  const create = async () => {
    if (!customer || !service || !slot) { setError("Select a customer, service, and available time."); return; }
    if (manualPaid && !reference.trim()) { setError("Enter the manual payment receipt/reference before recording payment."); return; }
    setBusy(true); setError("");
    const { data, error: createError } = await supabase.rpc("create_walk_in_appointment", {
      p_customer_id: customer.id,
      p_service_id: service.id,
      p_practitioner_id: slot.practitioner_id,
      p_starts_at: slot.starts_at,
      p_manual_reference: manualPaid ? reference.trim() : null,
    });
    if (createError) { setBusy(false); setError(createError.message); return; }
    if (service.requires_consent) {
      setReservationId(data);
      try {
        const activeForm = await getActiveConsentForm(service.id);
        if (!activeForm) throw new Error("Required consent has no active form. Release the reservation and configure the form before continuing.");
        const normalized = Array.isArray(activeForm.current_version) ? activeForm.current_version[0] : activeForm.current_version;
        if (!normalized) throw new Error("Required consent has no published version. Release the reservation and publish a form version.");
        setConsentForm({ ...activeForm, current_version: normalized } as typeof consentForm);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Consent form could not be loaded.");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(false);
    await client.invalidateQueries({ queryKey: ["operational-appointments"] });
    await client.invalidateQueries({ queryKey: ["appointments"] });
    router.replace({ pathname: "/operational/appointment/[id]", params: { id: data } });
  };
  const agreementList = consentForm?.current_version?.agreements.map((agreement, index) =>
    typeof agreement === "string" ? { id: String(index), text: agreement } : agreement) ?? [];
  const canSubmitConsent = !!consentForm?.current_version
    && agreementList.every((agreement) => agreements[agreement.id])
    && consentForm.current_version.questions.every((question) => !question.required || answers[question.id]?.trim())
    && (!consentForm.current_version.requires_signature || signature.trim().length >= 2);
  const submitConsent = async () => {
    if (!consentForm?.current_version || !service) return;
    if (!canSubmitConsent) { setError("Complete each required answer, agreement, and signature."); return; }
    if (manualPaid && !reference.trim()) { setError("Enter the manual receipt/reference before recording payment."); return; }
    setBusy(true); setError("");
    try {
      const { error: consentError } = await supabase.rpc("submit_walk_in_consent", {
        p_appointment_id: reservationId,
        p_form_id: consentForm.id,
        p_answers: answers,
        p_agreements: agreementList.map((agreement) => agreement.id),
        p_signature: consentForm.current_version.requires_signature ? signature.trim() : null,
      });
      if (consentError) throw consentError;
      const { error: finalizeError } = await supabase.rpc("finalize_walk_in_appointment", {
        p_appointment_id: reservationId,
        p_manual_reference: manualPaid ? reference.trim() : null,
      });
      if (finalizeError) throw finalizeError;
      await client.invalidateQueries({ queryKey: ["operational-appointments"] });
      await client.invalidateQueries({ queryKey: ["appointments"] });
      router.replace({ pathname: "/operational/appointment/[id]", params: { id: reservationId } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consent or the walk-in appointment could not be finalized.");
    } finally { setBusy(false); }
  };
  const releaseReservation = () => {
    void (async () => {
      try {
        const { error: cancelError } = await supabase.rpc("cancel_appointment", {
          p_appointment_id: reservationId,
          p_reason: "Walk-in reservation released by staff",
        });
        if (cancelError) throw cancelError;
        setReservationId(""); setConsentForm(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The reservation could not be released.");
      }
    })();
  };
  if (reservationId) return <Screen>
    <Heading title="Walk-in consent" subtitle={`Collect the customer’s agreement and signature before confirming ${service?.name ?? "this service"}.`} />
    <Card>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>{customer?.full_name} · {service?.name}</Text>
      <Text style={{ color: colors.rose, marginTop: 7 }}>Temporary hold expires in 15 minutes.</Text>
      <Text onPress={() => setManualPaid((value) => !value)} style={{ color: colors.ink, marginTop: 10 }}>{manualPaid ? "☑" : "☐"} Full payment received in person</Text>
      {manualPaid ? <Field label="Manual receipt/reference" value={reference} onChangeText={setReference} /> : null}
    </Card>
    {consentForm?.current_version ? <>
      <Heading title={consentForm.title} subtitle={consentForm.description} />
      {consentForm.current_version.questions.map((question) => <Field key={question.id}
        label={`${question.label}${question.required ? " *" : ""}`}
        value={answers[question.id] ?? ""}
        onChangeText={(value) => setAnswers((previous) => ({ ...previous, [question.id]: value }))}
        multiline={question.type === "long_text"} />)}
      {agreementList.map((agreement) => <Text key={agreement.id}
        onPress={() => setAgreements((previous) => ({ ...previous, [agreement.id]: !previous[agreement.id] }))}
        style={{ color: colors.ink, lineHeight: 22, marginBottom: 12 }}>
        {agreements[agreement.id] ? "☑" : "☐"} {agreement.text}
      </Text>)}
      {consentForm.current_version.requires_signature ? <Field label="Customer digital signature (type full name)" value={signature} onChangeText={setSignature} /> : null}
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 14 }}>Consent version {consentForm.current_version.version} is recorded without overwriting previous submissions.</Text>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ActionButton label="Save consent & confirm walk-in" onPress={() => void submitConsent()} busy={busy} disabled={!canSubmitConsent} />
    </> : <ErrorText>{error || "Loading the active consent form…"}</ErrorText>}
    <Text onPress={releaseReservation} style={{ color: colors.muted, textAlign: "center", padding: 18 }}>Release walk-in reservation</Text>
  </Screen>;
  return <Screen>
    <Heading title="New walk-in appointment" subtitle="Choose an existing customer and an available service time." />
    <Field label="Search customer by name, email, or mobile" value={search} onChangeText={(value) => { setSearch(value); setCustomer(null); }} />
    {people.isError ? <ErrorText>Customer search failed. {people.error.message}</ErrorText> : null}
    {people.data?.map((person) => <Pressable key={person.id} onPress={() => { setCustomer(person); setSearch(person.full_name); }}>
      <Card style={{ borderColor: customer?.id === person.id ? colors.rose : colors.line }}>
        <Text style={{ color: colors.ink, fontWeight: "700" }}>{person.full_name}</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>{person.email} · {person.mobile_number ?? "No mobile"}</Text>
      </Card>
    </Pressable>)}
    {customer ? <Text style={{ color: colors.rose, marginBottom: 13 }}>Selected: {customer.full_name}</Text> : null}
    <Text style={{ color: colors.ink, fontWeight: "700", marginVertical: 8 }}>Service</Text>
    {services.isError ? <ErrorText>Services could not be loaded. {services.error.message}</ErrorText> : null}
    {services.data?.map((item) => <Pressable key={item.id} onPress={() => { setServiceId(item.id); setPractitionerId(""); setSlot(null); }}>
      <Card style={{ borderColor: serviceId === item.id ? colors.rose : colors.line }}>
        <Text style={{ color: colors.ink, fontWeight: "700" }}>{item.name}</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>{formatServicePrice(item.price_amount, item.currency)} · {formatServiceDuration(item.duration_minutes)}{item.requires_consent ? " · Consent will be collected before confirmation" : ""}</Text>
      </Card>
    </Pressable>)}
    {serviceId ? <>
      <Text style={{ color: colors.ink, fontWeight: "700", marginVertical: 8 }}>Date</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
        <Text onPress={() => moveDateRange(-1)} style={{ color: colors.rose, padding: 5 }}>‹ Earlier</Text>
        <Text style={{ color: colors.muted, padding: 5 }}>        {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila" }).format(days[0])} – {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila" }).format(days[days.length - 1])}</Text>
        <Text onPress={() => moveDateRange(1)} style={{ color: colors.rose, padding: 5 }}>Later ›</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {days.map((day) => {
          const key = businessDateKey(day);
          return <Pressable key={key} onPress={() => { setDate(key); setSlot(null); }} style={{ backgroundColor: key === date ? colors.rose : colors.white, borderColor: key === date ? colors.rose : colors.line, borderWidth: 1, padding: 10, borderRadius: 12 }}>
            <Text style={{ color: key === date ? colors.white : colors.ink }}>{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", day: "numeric" }).format(day)}</Text>
          </Pressable>;
        })}
      </View>
      <Text style={{ color: colors.ink, fontWeight: "700", marginVertical: 10 }}>Practitioner</Text>
      <Pressable onPress={() => setPractitionerId("")}><Card style={{ borderColor: practitionerId ? colors.line : colors.rose }}><Text style={{ color: colors.ink }}>Any available practitioner</Text></Card></Pressable>
      {practitioners.data?.map((person) => <Pressable key={person.id} onPress={() => { setPractitionerId(person.id); setSlot(null); }}>
        <Card style={{ borderColor: practitionerId === person.id ? colors.rose : colors.line }}><Text style={{ color: colors.ink }}>{person.display_name}</Text></Card>
      </Pressable>)}
      <Text style={{ color: colors.ink, fontWeight: "700", marginVertical: 8 }}>Available time</Text>
      {slots.isError ? <ErrorText>Availability could not be checked. {slots.error.message}</ErrorText> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {slots.data?.map((item) => {
              const isSelected = slot?.starts_at === item.starts_at && slot?.practitioner_id === item.practitioner_id;
              return <Pressable key={`${item.practitioner_id}-${item.starts_at}`} onPress={() => setSlot(item)} style={{ borderWidth: 1, borderRadius: 12, padding: 11, borderColor: isSelected ? colors.rose : colors.line }}>
                <Text style={{ color: colors.ink }}>{new Date(item.starts_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</Text>
              </Pressable>;
            })}
      </View>
      {slots.data?.length === 0 && !slots.isLoading ? <Text style={{ color: colors.muted }}>No times are available on this day.</Text> : null}
    </> : null}
    {slot && service ? <Card style={{ marginTop: 18 }}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>Manual payment (optional)</Text>
      <Text onPress={() => setManualPaid((value) => !value)} style={{ color: colors.ink, marginTop: 8 }}>{manualPaid ? "☑" : "☐"} Full payment received in person</Text>
      <Text style={{ color: colors.muted, marginTop: 5 }}>Online gateway payment is not represented as cash/manual.</Text>
      {manualPaid ? <Field label="Receipt or reference (required)" value={reference} onChangeText={setReference} /> : null}
      <Text style={{ color: colors.ink, marginBottom: 12 }}>Appointment: {service.name} · {formatServicePrice(service.price_amount, service.currency)}</Text>
    </Card> : null}
    {error ? <ErrorText>{error}</ErrorText> : null}
    {slot ? <ActionButton label="Create walk-in appointment" onPress={() => void create()} busy={busy} /> : null}
  </Screen>;
}
