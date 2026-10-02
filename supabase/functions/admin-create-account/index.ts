import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, requiredEnv } from "../_shared/http.ts";

type AccountRole = "CLIENT" | "ADMIN" | "FRONT_DESK" | "PRACTITIONER";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return jsonResponse({ error: "Sign in is required." }, 401);
    const url = requiredEnv("SUPABASE_URL");
    const anon = requiredEnv("SUPABASE_ANON_KEY");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Your session is invalid or expired." }, 401);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: actor, error: actorError } = await admin.from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();
    if (actorError || !actor?.is_active) return jsonResponse({ error: "Active staff access is required." }, 403);

    const body = await request.json() as {
      email?: string; fullName?: string; mobileNumber?: string; role?: AccountRole;
    };
    const role = body.role;
    if (!body.email?.trim() || !body.fullName?.trim()
      || !["CLIENT", "ADMIN", "FRONT_DESK", "PRACTITIONER"].includes(String(role))) {
      return jsonResponse({ error: "A name, email, and valid role are required." }, 400);
    }
    if (actor.role !== "ADMIN" && role !== "CLIENT") {
      return jsonResponse({ error: "Only an administrator can create staff accounts." }, 403);
    }
    const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      body.email.trim().toLowerCase(),
      {
        redirectTo: "juanabeauty://auth/callback",
        data: { full_name: body.fullName.trim(), mobile_number: body.mobileNumber?.trim() ?? "" },
      },
    );
    if (inviteError || !invitation.user) {
      return jsonResponse({ error: inviteError?.message ?? "Account invitation could not be sent." }, 400);
    }
    const { error: roleError } = await admin.from("profiles").update({ role }).eq("id", invitation.user.id);
    if (roleError) throw roleError;
    if (role === "PRACTITIONER") {
      const { error: practitionerError } = await admin.from("practitioners").insert({
        profile_id: invitation.user.id,
        display_name: body.fullName.trim(),
      });
      if (practitionerError) throw practitionerError;
    }
    return jsonResponse({ userId: invitation.user.id, message: "Invitation email sent." }, 201);
  } catch (error) {
    console.error("Staff account creation failed", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Account could not be created." }, 500);
  }
});
