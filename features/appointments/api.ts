import { supabase } from "@/lib/supabase";
import type { Appointment } from "@/types/database";
import { firstRelation } from "@/utils/relations";

export interface AvailableSlot {
  practitioner_id: string;
  starts_at: string;
  ends_at: string;
}

export async function getAppointments(customerId?: string): Promise<Appointment[]> {
  let query = supabase.from("appointments")
    .select("*, service:services(id,name,category,price_amount,currency,duration_minutes,showcase_run_id), practitioner:practitioners(id,display_name,showcase_run_id), customer:profiles!appointments_customer_id_fkey(id,full_name,email,mobile_number), payments(id,status,amount,currency,provider)")
    .order("starts_at", { ascending: true });
  if (customerId) query = query.eq("customer_id", customerId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    service: firstRelation(row.service),
    practitioner: firstRelation(row.practitioner),
    customer: firstRelation(row.customer),
    payments: Array.isArray(row.payments) ? row.payments : row.payments ? [row.payments] : [],
  })) as Appointment[];
}

export async function cancelAppointment(appointmentId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_appointment", {
    p_appointment_id: appointmentId,
    p_reason: "Cancelled by customer",
  });
  if (error) throw error;
}

export async function getSlots(serviceId: string, date: string, practitionerId?: string): Promise<AvailableSlot[]> {
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_service_id: serviceId,
    p_date: date,
    p_practitioner_id: practitionerId ?? null,
    p_slot_interval_minutes: 30,
  });
  if (error) throw error;
  return (data ?? []) as AvailableSlot[];
}

export async function createReservation(serviceId: string, practitionerId: string, startsAt: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_reservation", {
    p_service_id: serviceId,
    p_practitioner_id: practitionerId,
    p_starts_at: startsAt,
  });
  if (error) throw error;
  return data as string;
}

export async function createCheckout(appointmentId: string) {
  const { data, error } = await supabase.functions.invoke("create-checkout", {
    body: { appointmentId },
  });
  if (error) throw error;
  if (!data?.checkoutUrl || !data?.paymentId) throw new Error("Payment service returned an incomplete checkout.");
  return data as { checkoutUrl: string; paymentId: string };
}

export async function submitConsent(input: {
  appointmentId: string;
  formId: string;
  answers: Record<string, unknown>;
  agreements: string[];
  signature: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("submit_consent", {
    p_appointment_id: input.appointmentId,
    p_form_id: input.formId,
    p_answers: input.answers,
    p_agreements: input.agreements,
    p_signature: input.signature,
  });
  if (error) throw error;
}

export async function getActiveConsentForm(serviceId: string) {
  const select = "id, title, description, current_version:consent_form_versions!consent_form_current_version_fk(id, version, questions, agreements, requires_signature)";
  const { data, error } = await supabase.from("consent_forms")
    .select(select)
    .eq("service_id", serviceId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: globalForm, error: globalError } = await supabase.from("consent_forms")
    .select(select)
    .is("service_id", null)
    .eq("is_active", true)
    .maybeSingle();
  if (globalError) throw globalError;
  return globalForm;
}
