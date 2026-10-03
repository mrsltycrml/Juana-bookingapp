import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, requiredEnv } from "../_shared/http.ts";

type ShowcaseAction = "seed" | "clear";
function createAdminClient(url: string, serviceKey: string) {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

type AdminClient = ReturnType<typeof createAdminClient>;

interface DemoAccount {
  id: string;
  role: "PRACTITIONER" | "CLIENT";
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Showcase data operation failed.";
}

async function getShowcaseUsers(admin: AdminClient) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users.filter((user) => user.app_metadata?.juana_showcase === true));
    if (data.users.length < 1000) return users;
  }
}

async function removeShowcaseUsers(
  admin: AdminClient,
  runId?: string,
  preserveRunId?: string,
): Promise<string[]> {
  const errors: string[] = [];
  for (const user of await getShowcaseUsers(admin)) {
    const userRunId = user.app_metadata?.juana_showcase_run_id;
    if (runId && userRunId !== runId) continue;
    if (preserveRunId && userRunId === preserveRunId) continue;
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) errors.push(`${user.id}: ${error.message}`);
  }
  return errors;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return jsonResponse({ error: "Sign in with an administrator account first." }, 401);

    const url = requiredEnv("SUPABASE_URL");
    const anon = requiredEnv("SUPABASE_ANON_KEY");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Your session is invalid or expired." }, 401);

    const admin = createAdminClient(url, serviceKey);
    const { data: actor, error: actorError } = await admin.from("profiles")
      .select("role,is_active").eq("id", user.id).single();
    if (actorError || actor?.role !== "ADMIN" || !actor.is_active) {
      return jsonResponse({ error: "Only an active administrator can manage showcase data." }, 403);
    }

    const body = await request.json() as { action?: ShowcaseAction };
    if (body.action !== "seed" && body.action !== "clear") {
      return jsonResponse({ error: "Choose either the seed or clear action." }, 400);
    }

    if (body.action === "clear") {
      const { data: runs, error: runError } = await admin.from("showcase_runs")
        .select("id").limit(1);
      if (runError) throw runError;
      if (runs?.[0]) {
        const { error } = await caller.rpc("clear_showcase_data", { p_run_id: runs[0].id });
        if (error) throw error;
      }
      const deletionErrors = await removeShowcaseUsers(admin);
      if (deletionErrors.length) {
        return jsonResponse({
          error: `Showcase records were removed, but some temporary accounts remain: ${deletionErrors.join("; ")}`,
        }, 500);
      }
      return jsonResponse({ message: "Showcase records and temporary accounts were removed." });
    }

    const { data: activeRuns, error: activeRunError } = await admin.from("showcase_runs").select("id").limit(1);
    if (activeRunError) throw activeRunError;
    if (activeRuns?.length) {
      return jsonResponse({ error: "Showcase data is already installed. Remove it before seeding again." }, 409);
    }

    const accounts: DemoAccount[] = [];
    const runId = crypto.randomUUID();
    const plannedAccounts = [
      { role: "PRACTITIONER" as const, name: "DEMO · Practitioner One" },
      { role: "PRACTITIONER" as const, name: "DEMO · Practitioner Two" },
      { role: "CLIENT" as const, name: "DEMO · Showcase Client 01" },
      { role: "CLIENT" as const, name: "DEMO · Showcase Client 02" },
      { role: "CLIENT" as const, name: "DEMO · Showcase Client 03" },
      { role: "CLIENT" as const, name: "DEMO · Showcase Client 04" },
    ];

    const { error: beginError } = await caller.rpc("begin_showcase_data", { p_run_id: runId });
    if (beginError?.code === "23505") {
      return jsonResponse({ error: "Showcase data is already being created or is currently installed. Remove it before starting again." }, 409);
    }
    if (beginError) throw beginError;

    try {
      const staleUserErrors = await removeShowcaseUsers(admin, undefined, runId);
      if (staleUserErrors.length) {
        throw new Error(`Could not remove previous temporary accounts: ${staleUserErrors.join("; ")}`);
      }
      for (const [index, planned] of plannedAccounts.entries()) {
        const email = `juana-showcase-${runId}-${index + 1}@example.invalid`;
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password: randomPassword(),
          email_confirm: true,
          app_metadata: { juana_showcase: true, juana_showcase_run_id: runId },
          user_metadata: { full_name: planned.name },
        });
        if (error || !data.user) throw new Error(error?.message ?? "A temporary showcase account could not be created.");
        accounts.push({ id: data.user.id, role: planned.role });
      }

      const practitionerIds = accounts.filter((account) => account.role === "PRACTITIONER").map((account) => account.id);
      const customerIds = accounts.filter((account) => account.role === "CLIENT").map((account) => account.id);
      const { error: roleError } = await admin.from("profiles")
        .update({ role: "PRACTITIONER" })
        .in("id", practitionerIds);
      if (roleError) throw roleError;

      const { data: showcaseRunId, error: seedError } = await caller.rpc("seed_showcase_data", {
        p_run_id: runId,
        p_practitioner_profile_ids: practitionerIds,
        p_customer_profile_ids: customerIds,
      });
      if (seedError) throw seedError;

      return jsonResponse({
        runId: showcaseRunId,
        message: "Showcase services, schedules, appointments, treatment history, and clearly marked unpaid payment placeholders are ready. No payments were taken or verified.",
      }, 201);
    } catch (error) {
      const cleanupErrors = await removeShowcaseUsers(admin, runId);
      const { error: abortError } = await caller.rpc("abort_showcase_data", { p_run_id: runId });
      const failure = errorMessage(error);
      if (cleanupErrors.length || abortError) {
        throw new Error(`${failure} Cleanup failed${cleanupErrors.length ? `: ${cleanupErrors.join("; ")}` : ""}${abortError ? `: ${abortError.message}` : ""}`);
      }
      throw error;
    }
  } catch (error) {
    console.error("Showcase data operation failed", error);
    return jsonResponse({ error: errorMessage(error) }, 500);
  }
});
