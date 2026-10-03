import { useMemo, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { createCheckout, createReservation, getActiveConsentForm, getSlots, submitConsent } from "@/features/appointments/api";
import { getActiveServices, getServicePractitioners } from "@/features/services/api";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/utils/format";
import { businessDateKey, manilaDate } from "@/utils/dates";
import type { AvailableSlot } from "@/features/appointments/api";

interface ConsentQuestion { id: string; label: string; type?: string; required?: boolean }
interface ConsentAgreement { id: string; text: string }
interface ConsentVersion {
  id: string;
  version: number;
  questions: ConsentQuestion[];
  agreements: ConsentAgreement[] | string[];
  requires_signature: boolean;
}
interface ConsentFormData {
  id: string;
  title: string;
  description: string;
  current_version: ConsentVersion | ConsentVersion[] | null;
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" }).format(date);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default function BookScreen() {
  const params = useLocalSearchParams<{ serviceId?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const services = useQuery({ queryKey: ["services"], queryFn: getActiveServices });
  const [serviceId, setServiceId] = useState(params.serviceId ?? "");
  const [practitionerId, setPractitionerId] = useState("");
  const [date, setDate] = useState(businessDateKey(new Date()));
  const [dateOffset, setDateOffset] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [reservedSlot, setReservedSlot] = useState<AvailableSlot | null>(null);
  const [reservationId, setReservationId] = useState("");
  const [form, setForm] = useState<ConsentFormData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [signature, setSignature] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const service = services.data?.find((item) => item.id === serviceId);
  const practitioners = useQuery({
    queryKey: ["service-practitioners", serviceId],
    queryFn: () => getServicePractitioners(serviceId),
    enabled: !!serviceId,
  });
  const activePractitionerId = practitionerId || (practitioners.data?.length === 1 ? practitioners.data[0]?.id : "");
  const slots = useQuery({
    queryKey: ["availability", serviceId, activePractitionerId, date],
    queryFn: () => getSlots(serviceId, date, activePractitionerId || undefined),
    enabled: !!serviceId && !!date,
  });
  const days = useMemo(() => Array.from({ length: 21 }, (_, index) => {
    return manilaDate(dateOffset + index);
  }), [dateOffset]);
  const moveDateRange = (direction: -1 | 1) => {
    const offset = Math.max(0, dateOffset + direction * days.length);
    setDateOffset(offset);
    setDate(businessDateKey(manilaDate(offset)));
    setSelectedSlot(null);
  };
  const version = form ? (Array.isArray(form.current_version) ? form.current_version[0] : form.current_version) : null;
  const agreementList = version?.agreements.map((agreement, index) => typeof agreement === "string"
    ? { id: String(index), text: agreement }
    : agreement) ?? [];
  const canSubmitConsent = !!version
    && agreementList.every((agreement) => agreements[agreement.id])
    && (version.requires_signature ? signature.trim().length >= 2 : true)
    && version.questions.every((question) => !question.required || answers[question.id]?.trim());

  const startReservation = async () => {
    if (!serviceId || !selectedSlot || !user) return;
    setBusy(true); setError("");
    try {
      const id = await createReservation(serviceId, selectedSlot.practitioner_id, selectedSlot.starts_at);
      setReservationId(id);
      setReservedSlot(selectedSlot);
      setSelectedSlot(null);
      if (service?.requires_consent) {
        const activeForm = await getActiveConsentForm(serviceId);
        if (!activeForm) throw new Error("Consent is required for this service, but no active form is configured. Contact the studio.");
        setForm(activeForm as ConsentFormData);
      } else {
        await startCheckout(id);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The reservation could not be created.";
      setError(message);
      void queryClient.invalidateQueries({ queryKey: ["availability", serviceId] });
    } finally {
      setBusy(false);
    }
  };

  const startCheckout = async (appointmentId: string) => {
    const checkout = await createCheckout(appointmentId);
    setCheckoutUrl(checkout.checkoutUrl);
    const supported = await Linking.canOpenURL(checkout.checkoutUrl);
    if (!supported) throw new Error("Your device could not open the secure payment page.");
    await Linking.openURL(checkout.checkoutUrl);
  };

  const submitFormAndPay = async () => {
    if (!user || !service || !form || !version || !reservationId) return;
    if (!canSubmitConsent) { setError("Complete every required answer, agreement, and signature."); return; }
    setBusy(true); setError("");
    try {
      await submitConsent({
        appointmentId: reservationId,
        formId: form.id,
        answers,
        agreements: agreementList.map((agreement) => agreement.id),
        signature: version.requires_signature ? signature.trim() : null,
      });
      await startCheckout(reservationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consent or checkout could not be submitted.");
    } finally { setBusy(false); }
  };

  const releaseReservation = () => {
    Alert.alert("Release this time?", "This temporary reservation will be cancelled.", [
      { text: "Keep it", style: "cancel" },
      { text: "Release", style: "destructive", onPress: () => {
        void import("@/features/appointments/api").then(({ cancelAppointment }) => cancelAppointment(reservationId))
          .then(() => { setReservationId(""); setReservedSlot(null); setForm(null); setCheckoutUrl(""); })
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not release this time."));
      } },
    ]);
  };

  if (reservationId) return <Screen>
    <Heading title={form ? "A few details before we begin" : checkoutUrl ? "Complete your payment" : "Time held for you"} subtitle="Your appointment time is temporarily reserved while you complete the next step." />
    <Card>
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>{service?.name}</Text>
      <Text style={{ color: colors.muted, marginTop: 6 }}>{reservedSlot ? formatTime(reservedSlot.starts_at) : ""}</Text>
      <Text style={{ color: colors.rose, marginTop: 8, fontWeight: "600" }}>Reservation expires in 15 minutes</Text>
    </Card>
    {form && version ? <>
      <Heading title={form.title} subtitle={form.description} />
      {version.questions.map((question) => <Field key={question.id} label={`${question.label}${question.required ? " *" : ""}`}
        value={answers[question.id] ?? ""} onChangeText={(answer) => setAnswers((previous) => ({ ...previous, [question.id]: answer }))}
        multiline={question.type === "long_text"} />)}
      {agreementList.map((agreement) => <Text key={agreement.id}
        onPress={() => setAgreements((previous) => ({ ...previous, [agreement.id]: !previous[agreement.id] }))}
        style={{ color: colors.ink, lineHeight: 22, marginBottom: 12 }}>
        {agreements[agreement.id] ? "☑" : "☐"}  {agreement.text}
      </Text>)}
      {version.requires_signature ? <Field label="Type your full name as your digital signature" value={signature} onChangeText={setSignature} /> : null}
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 15 }}>Consent version {version.version} is stored with this appointment and will not be overwritten.</Text>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ActionButton label={`Agree & pay ${service ? formatMoney(service.price_amount, service.currency) : ""}`} onPress={() => void submitFormAndPay()} busy={busy} disabled={!canSubmitConsent} />
    </> : checkoutUrl ? <>
      <Text style={{ color: colors.muted, lineHeight: 22, marginBottom: 16 }}>The secure payment page was opened. Your booking is confirmed only after the provider verifies the full payment.</Text>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ActionButton label="Reopen secure payment" onPress={() => void Linking.openURL(checkoutUrl).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not open the payment page."))} />
      <Text onPress={() => { void queryClient.invalidateQueries({ queryKey: ["appointments"] }); router.replace("/client/appointments"); }} style={{ color: colors.rose, textAlign: "center", marginTop: 18 }}>Check appointment status</Text>
    </> : <>
      <Text style={{ color: colors.muted, lineHeight: 22 }}>We are setting up your secure checkout…</Text>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>}
    <Text onPress={releaseReservation} style={{ color: colors.muted, textAlign: "center", padding: 18 }}>Release this reservation</Text>
  </Screen>;

  return <Screen>
    <Heading title="Book a treatment" subtitle="Choose a service, a day, and a time that suits you." />
    <Text style={{ color: colors.ink, fontWeight: "700", marginBottom: 10 }}>1 · Choose a service</Text>
    {services.isError ? <ErrorText>Services could not be loaded. {services.error.message}</ErrorText> : null}
    {services.data?.map((item) => <Pressable key={item.id} onPress={() => {
      setServiceId(item.id); setPractitionerId(""); setSelectedSlot(null); setError("");
    }}>
      <Card style={{ borderColor: serviceId === item.id ? colors.rose : colors.line, backgroundColor: serviceId === item.id ? colors.blush : colors.white }}>
        <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>{item.name}</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>{formatMoney(item.price_amount, item.currency)} · {item.duration_minutes} minutes{item.requires_consent ? " · Consent required" : ""}</Text>
      </Card>
    </Pressable>)}
    {serviceId ? <>
      <Text style={{ color: colors.ink, fontWeight: "700", marginTop: 12, marginBottom: 10 }}>2 · Choose a day</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
        <Text onPress={() => moveDateRange(-1)} style={{ color: colors.rose, padding: 5 }}>‹ Earlier</Text>
        <Text style={{ color: colors.muted, padding: 5 }}>{shortDate(days[0])} – {shortDate(days[days.length - 1])}</Text>
        <Text onPress={() => moveDateRange(1)} style={{ color: colors.rose, padding: 5 }}>Later ›</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {days.map((day) => {
          const key = businessDateKey(day);
          return <Pressable key={key} onPress={() => { setDate(key); setSelectedSlot(null); }} style={{
            backgroundColor: key === date ? colors.rose : colors.white, borderColor: key === date ? colors.rose : colors.line,
            borderWidth: 1, borderRadius: 13, paddingVertical: 11, paddingHorizontal: 12,
          }}><Text style={{ color: key === date ? colors.white : colors.ink, fontSize: 12 }}>{shortDate(day)}</Text></Pressable>;
        })}
      </View>
      <Text style={{ color: colors.ink, fontWeight: "700", marginBottom: 10 }}>3 · Choose a practitioner</Text>
      {practitioners.isLoading ? <Text style={{ color: colors.muted }}>Finding available practitioners…</Text> : null}
      {practitioners.isError ? <ErrorText>Practitioners could not be loaded. {practitioners.error.message}</ErrorText> : null}
      {practitioners.data?.length ? <>
        <Pressable onPress={() => { setPractitionerId(""); setSelectedSlot(null); }}>
          <Card style={{ borderColor: !practitionerId ? colors.rose : colors.line, backgroundColor: !practitionerId ? colors.blush : colors.white }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>Any available practitioner</Text>
          </Card>
        </Pressable>
        {practitioners.data.map((person) => <Pressable key={person.id} onPress={() => { setPractitionerId(person.id); setSelectedSlot(null); }}>
          <Card style={{ borderColor: practitionerId === person.id ? colors.rose : colors.line, backgroundColor: practitionerId === person.id ? colors.blush : colors.white }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>{person.display_name}</Text>
            {person.bio ? <Text style={{ color: colors.muted, marginTop: 4 }}>{person.bio}</Text> : null}
          </Card>
        </Pressable>)}
      </> : practitioners.data && <Text style={{ color: colors.muted }}>No active practitioners currently offer this service.</Text>}
      <Text style={{ color: colors.ink, fontWeight: "700", marginTop: 12, marginBottom: 10 }}>4 · Choose a time</Text>
      {slots.isLoading ? <Text style={{ color: colors.muted }}>Checking live availability…</Text> : null}
      {slots.isError ? <ErrorText>Availability could not be checked. {slots.error.message}</ErrorText> : null}
      {slots.data?.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        {slots.data.map((slot) => {
          const isSelected = selectedSlot?.starts_at === slot.starts_at && selectedSlot?.practitioner_id === slot.practitioner_id;
          return <Pressable key={`${slot.practitioner_id}-${slot.starts_at}`} onPress={() => setSelectedSlot(slot)} style={{
            paddingHorizontal: 15, paddingVertical: 12, borderRadius: 13, borderWidth: 1,
            borderColor: isSelected ? colors.rose : colors.line,
            backgroundColor: isSelected ? colors.blush : colors.white,
          }}><Text style={{ color: colors.ink }}>{formatTime(slot.starts_at)}</Text></Pressable>;
        })}
      </View> : null}
      {slots.data?.length === 0 && !slots.isLoading ? <Text style={{ color: colors.muted }}>No times are available on this day. Choose another date.</Text> : null}
    </> : null}
    {error ? <ErrorText>{error}</ErrorText> : null}
    {selectedSlot ? <View style={{ marginTop: 18 }}>
      <Card><Text style={{ color: colors.ink, fontWeight: "700" }}>Your selection</Text>
        {service?.showcase_run_id ? <Text style={{ color: colors.rose, fontWeight: "800", marginTop: 6 }}>SHOWCASE SAMPLE · SAMPLE PRICE ONLY</Text> : null}
        <Text style={{ color: colors.muted, marginTop: 6 }}>{service?.name} · {shortDate(new Date(`${date}T12:00:00`))} · {formatTime(selectedSlot.starts_at)}</Text>
        <Text style={{ color: colors.ink, marginTop: 6 }}>Full payment: {service ? formatMoney(service.price_amount, service.currency) : ""}</Text>
      </Card>
      <ActionButton label="Reserve & continue" onPress={() => void startReservation()} busy={busy} />
    </View> : null}
  </Screen>;
}
