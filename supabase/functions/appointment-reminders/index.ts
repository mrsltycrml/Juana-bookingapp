import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse, requiredEnv } from "../_shared/http.ts";
import { notify } from "../_shared/notifications.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  try {
    const expected = requiredEnv("RESERVATION_CRON_SECRET");
    if (request.headers.get("Authorization") !== `Bearer ${expected}`) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }
    const admin = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const { data: setting, error: settingError } = await admin.from("app_settings")
      .select("value").eq("key", "reminder_settings").maybeSingle();
    if (settingError) throw settingError;
    const hours = Number((setting?.value as { hours_before?: number } | undefined)?.hours_before);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
      return jsonResponse({ error: "Configure appointment reminder timing (1–168 hours) before scheduling this function." }, 409);
    }
    const now = Date.now();
    const startsAfter = new Date(now + hours * 60 * 60_000).toISOString();
    const startsBefore = new Date(now + (hours + 1) * 60 * 60_000).toISOString();
    const { data: appointments, error: appointmentsError } = await admin.from("appointments")
      .select("id,customer_id,starts_at,service:services(name)")
      .eq("status", "BOOKED").gte("starts_at", startsAfter).lt("starts_at", startsBefore);
    if (appointmentsError) throw appointmentsError;
    let sent = 0;
    for (const appointment of appointments ?? []) {
      const { data: preference, error: preferenceError } = await admin.from("notification_preferences")
        .select("appointment_reminders").eq("profile_id", appointment.customer_id).maybeSingle();
      if (preferenceError) throw preferenceError;
      if (!preference?.appointment_reminders) continue;
      const service = Array.isArray(appointment.service) ? appointment.service[0] : appointment.service;
      await notify(
        admin,
        appointment.customer_id,
        "Appointment reminder",
        `${service?.name ?? "Your appointment"} is coming up ${hours} hour${hours === 1 ? "" : "s"} from now.`,
        "APPOINTMENT_REMINDER",
        appointment.id,
      );
      sent++;
    }
    return jsonResponse({ sent });
  } catch (error) {
    console.error("Appointment reminder dispatch failed", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Appointment reminders could not be sent." }, 500);
  }
});
