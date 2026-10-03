import { supabase } from "@/lib/supabase";
import type { Service } from "@/types/database";
import { firstRelation } from "@/utils/relations";

export async function getActiveServices(): Promise<Service[]> {
  const { data, error } = await supabase.from("services")
    .select("id, name, description, category, image_path, price_amount, currency, duration_minutes, requires_consent, is_active, showcase_run_id")
    .eq("is_active", true)
    .order("category")
    .order("name");
  if (error) throw error;
  return data as Service[];
}

export async function getService(serviceId: string): Promise<Service> {
  const { data, error } = await supabase.from("services").select("*").eq("id", serviceId).single();
  if (error) throw error;
  return data as Service;
}

export async function getServicePractitioners(serviceId: string) {
  const { data, error } = await supabase.from("practitioner_services")
    .select("practitioner:practitioners!inner(id, display_name, bio)")
    .eq("service_id", serviceId)
    .eq("practitioner.is_active", true);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const practitioner = firstRelation(row.practitioner);
    return practitioner ? [practitioner] : [];
  });
}
