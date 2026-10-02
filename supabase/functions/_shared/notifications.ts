import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function notify(
  admin: SupabaseClient,
  profileId: string,
  title: string,
  body: string,
  type: string,
  appointmentId?: string,
): Promise<void> {
  const { data: notification, error } = await admin.from("notifications").upsert({
    profile_id: profileId,
    appointment_id: appointmentId ?? null,
    title,
    body,
    type,
  }, { onConflict: "profile_id,appointment_id,type", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw new Error(`Unable to store notification: ${error.message}`);
  if (!notification) return;

  const { data: preference, error: preferenceError } = await admin
    .from("notification_preferences")
    .select("push_enabled, expo_push_token")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (preferenceError) throw new Error(`Unable to read notification settings: ${preferenceError.message}`);
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (!preference?.push_enabled || !preference.expo_push_token || !accessToken) return;

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: preference.expo_push_token,
      title,
      body,
      data: appointmentId ? { appointmentId } : {},
      sound: "default",
    }),
  });
  if (!response.ok) throw new Error(`Expo Push API returned ${response.status}.`);
  const result = await response.json() as { data?: { status?: string; message?: string } | Array<{ status?: string; message?: string }> };
  const tickets = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  const failedTicket = tickets.find((ticket) => ticket.status === "error");
  if (failedTicket) throw new Error(`Expo push could not be delivered: ${failedTicket.message ?? "unknown error"}`);
}
