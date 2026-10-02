import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, requiredEnv } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  try {
    const expected = requiredEnv("RESERVATION_CRON_SECRET");
    if (request.headers.get("Authorization") !== `Bearer ${expected}`) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }
    const admin = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const { data: expired, error: queryError } = await admin.from("appointments")
      .select("id")
      .eq("status", "TEMPORARILY_RESERVED")
      .lt("reservation_expires_at", new Date().toISOString());
    if (queryError) throw queryError;
    const ids = (expired ?? []).map(({ id }) => id);
    if (ids.length) {
      const { error: paymentError } = await admin.from("payments").update({ status: "EXPIRED" })
        .in("appointment_id", ids).eq("status", "PENDING");
      if (paymentError) throw paymentError;
      const { error: appointmentError } = await admin.from("appointments").update({
        status: "CANCELLED",
        reservation_expires_at: null,
        cancellation_reason: "Reservation expired before payment was completed.",
      }).in("id", ids).eq("status", "TEMPORARILY_RESERVED");
      if (appointmentError) throw appointmentError;
    }
    return jsonResponse({ expired: ids.length });
  } catch (error) {
    console.error("Reservation expiry job failed", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Reservation expiry failed." }, 500);
  }
});
