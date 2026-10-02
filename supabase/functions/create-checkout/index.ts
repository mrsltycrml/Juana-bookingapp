import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, requiredEnv } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const url = requiredEnv("SUPABASE_URL");
    const anon = requiredEnv("SUPABASE_ANON_KEY");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization");
    if (!authorization) return jsonResponse({ error: "Sign in before creating a payment." }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Your session is invalid or expired." }, 401);

    const body = await request.json() as { appointmentId?: string };
    if (!body.appointmentId) return jsonResponse({ error: "Appointment is required." }, 400);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: appointment, error: appointmentError } = await admin
      .from("appointments")
      .select("id, customer_id, service_id, service_snapshot, starts_at, status, reservation_expires_at")
      .eq("id", body.appointmentId)
      .single();
    if (appointmentError || !appointment || appointment.customer_id !== user.id) {
      return jsonResponse({ error: "Reservation not found." }, 404);
    }
    if (appointment.status !== "TEMPORARILY_RESERVED"
      || !appointment.reservation_expires_at
      || new Date(appointment.reservation_expires_at).getTime() <= Date.now()) {
      return jsonResponse({ error: "This reservation has expired. Choose another available time." }, 409);
    }
    const snapshot = appointment.service_snapshot as {
      name: string; price_amount: number; currency: string; requires_consent: boolean;
    };
    if (snapshot.requires_consent) {
      let { data: form, error: formError } = await admin.from("consent_forms")
        .select("id, current_version_id")
        .eq("service_id", appointment.service_id)
        .eq("is_active", true)
        .maybeSingle();
      if (formError) throw formError;
      if (!form) {
        const globalForm = await admin.from("consent_forms")
          .select("id, current_version_id")
          .is("service_id", null)
          .eq("is_active", true)
          .maybeSingle();
        if (globalForm.error) throw globalForm.error;
        form = globalForm.data;
      }
      if (!form?.current_version_id) return jsonResponse({ error: "Required consent is not configured for this service." }, 409);
      const { data: submission, error: submissionError } = await admin.from("consent_submissions")
        .select("id")
        .eq("appointment_id", appointment.id)
        .eq("customer_id", user.id)
        .eq("form_id", form.id)
        .eq("form_version_id", form.current_version_id)
        .maybeSingle();
      if (submissionError) throw submissionError;
      if (!submission) return jsonResponse({ error: "Complete the current consent form before payment." }, 409);
    }

    const provider = (Deno.env.get("PAYMENT_PROVIDER") ?? "").toLowerCase();
    if (provider !== "paymongo" && provider !== "xendit") {
      return jsonResponse({ error: "The studio has not configured a supported payment provider." }, 503);
    }
    const { data: priorPayment, error: priorError } = await admin.from("payments")
      .select("id, status, checkout_url, expires_at")
      .eq("appointment_id", appointment.id)
      .eq("status", "PENDING")
      .maybeSingle();
    if (priorError) throw priorError;
    if (priorPayment) {
      const paymentExpiresAt = priorPayment.expires_at ? new Date(priorPayment.expires_at).getTime() : 0;
      if (paymentExpiresAt > Date.now()) {
        if (priorPayment.checkout_url) {
          return jsonResponse({ checkoutUrl: priorPayment.checkout_url, paymentId: priorPayment.id });
        }
        return jsonResponse({ error: "Payment checkout is already being prepared. Try again shortly." }, 409);
      }
      const { error: stalePaymentError } = await admin.from("payments")
        .update({ status: "FAILED" })
        .eq("id", priorPayment.id)
        .eq("status", "PENDING");
      if (stalePaymentError) throw stalePaymentError;
    }
    if (!Number.isFinite(snapshot.price_amount) || snapshot.price_amount <= 0) {
      return jsonResponse({ error: "The service price is invalid. Contact the studio." }, 409);
    }

    const expiresAt = new Date(Math.min(
      Date.now() + 15 * 60_000,
      new Date(appointment.reservation_expires_at).getTime(),
    )).toISOString();
    const { data: payment, error: insertError } = await admin.from("payments")
      .insert({
        appointment_id: appointment.id,
        customer_id: user.id,
        amount: snapshot.price_amount,
        currency: snapshot.currency,
        provider: provider.toUpperCase(),
        status: "PENDING",
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    const returnUrl = requiredEnv("PAYMENT_RETURN_URL");
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("full_name, email, mobile_number")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;
    let providerReference: string;
    let checkoutUrl: string;
    if (provider === "paymongo") {
      const secret = requiredEnv("PAYMONGO_SECRET_KEY");
      const encoded = btoa(`${secret}:`);
      const amountMinor = Math.round(snapshot.price_amount * 100);
      const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
        method: "POST",
        headers: { "Authorization": `Basic ${encoded}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { attributes: {
            billing: { name: profile.full_name, email: profile.email, phone: profile.mobile_number ?? undefined },
            line_items: [{
              currency: snapshot.currency,
              amount: amountMinor,
              description: snapshot.name,
              name: snapshot.name,
              quantity: 1,
            }],
            payment_method_types: ["gcash", "card", "paymaya"],
            success_url: `${returnUrl}?appointment_id=${appointment.id}`,
            cancel_url: `${returnUrl}?appointment_id=${appointment.id}&cancelled=true`,
            metadata: { appointment_id: appointment.id, payment_id: payment.id },
          } },
        }),
      });
      const responseBody = await response.json() as {
        data?: { id?: string; attributes?: { checkout_url?: string } };
        errors?: Array<{ detail?: string }>;
      };
      if (!response.ok || !responseBody.data?.id || !responseBody.data.attributes?.checkout_url) {
        throw new Error(responseBody.errors?.[0]?.detail ?? "PayMongo could not create a checkout session.");
      }
      providerReference = responseBody.data.id;
      checkoutUrl = responseBody.data.attributes.checkout_url;
    } else {
      const secret = requiredEnv("XENDIT_SECRET_KEY");
      const response = await fetch("https://api.xendit.co/v2/invoices", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${secret}:`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          external_id: payment.id,
          amount: snapshot.price_amount,
          currency: snapshot.currency,
          payer_email: profile.email,
          description: snapshot.name,
          customer: { given_names: profile.full_name, email: profile.email, mobile_number: profile.mobile_number },
          success_redirect_url: `${returnUrl}?appointment_id=${appointment.id}`,
          failure_redirect_url: `${returnUrl}?appointment_id=${appointment.id}&failed=true`,
          metadata: { appointment_id: appointment.id, payment_id: payment.id },
        }),
      });
      const responseBody = await response.json() as { id?: string; invoice_url?: string; message?: string };
      if (!response.ok || !responseBody.id || !responseBody.invoice_url) {
        throw new Error(responseBody.message ?? "Xendit could not create an invoice.");
      }
      providerReference = responseBody.id;
      checkoutUrl = responseBody.invoice_url;
    }
    const { error: updateError } = await admin.from("payments")
      .update({ provider_reference: providerReference, checkout_url: checkoutUrl })
      .eq("id", payment.id)
      .eq("status", "PENDING");
    if (updateError) throw updateError;
    return jsonResponse({ checkoutUrl, paymentId: payment.id });
  } catch (error) {
    console.error("Unable to create payment checkout", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Payment checkout could not be created." }, 500);
  }
});
