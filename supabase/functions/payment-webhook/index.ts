import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse, requiredEnv } from "../_shared/http.ts";
import { notify } from "../_shared/notifications.ts";

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i++) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  try {
    const rawBody = await request.text();
    const provider = (Deno.env.get("PAYMENT_PROVIDER") ?? "").toLowerCase();
    let event: Record<string, unknown>;
    try { event = JSON.parse(rawBody) as Record<string, unknown>; }
    catch { return jsonResponse({ error: "Malformed webhook event." }, 400); }
    const data = event.data as { id?: string; attributes?: Record<string, unknown> } | undefined;
    const attributes = data?.attributes ?? {};
    let reference: string | undefined;
    let eventType: string;
    let success: boolean;
    let failed: boolean;
    let verified = false;

    if (provider === "paymongo") {
      const signature = request.headers.get("paymongo-signature");
      const fields = Object.fromEntries((signature ?? "").split(",").map((part) => {
        const [key, ...value] = part.trim().split("=");
        return [key, value.join("=")];
      }));
      const timestamp = fields.t;
      const secret = requiredEnv("PAYMONGO_WEBHOOK_SECRET");
      const expected = timestamp ? await hmacHex(secret, `${timestamp}.${rawBody}`) : "";
      const allowed = Deno.env.get("PAYMONGO_MODE") === "live" ? fields.li : fields.te;
      if (!allowed || !expected || !safeEqual(expected, allowed)) return jsonResponse({ error: "Invalid webhook signature." }, 401);
      const eventAttributes = attributes as { type?: string; data?: { id?: string } };
      eventType = eventAttributes.type ?? "unknown";
      reference = eventAttributes.data?.id ?? data?.id;
      success = eventType === "checkout_session.payment.paid";
      failed = eventType === "checkout_session.payment.failed" || eventType === "payment.failed";
      verified = success;
    } else if (provider === "xendit") {
      const supplied = request.headers.get("x-callback-token") ?? "";
      if (!safeEqual(supplied, requiredEnv("XENDIT_WEBHOOK_TOKEN"))) return jsonResponse({ error: "Invalid webhook signature." }, 401);
      eventType = String(event.event ?? event.status ?? "unknown");
      reference = String(event.id ?? attributes.id ?? "");
      success = ["invoice.paid", "PAID", "SUCCEEDED"].includes(eventType);
      failed = ["invoice.expired", "EXPIRED", "FAILED"].includes(eventType);
      verified = success;
    } else {
      return jsonResponse({ error: "Payment provider is not configured." }, 503);
    }
    if (!reference || (!success && !failed)) return jsonResponse({ received: true });

    const admin = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const { data: payment, error: paymentError } = await admin.from("payments")
      .select("id, appointment_id, customer_id, amount, currency, status, provider_reference")
      .eq("provider", provider.toUpperCase())
      .eq("provider_reference", reference)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return jsonResponse({ error: "Payment reference not found." }, 404);
    const eventId = String(event.id ?? `${reference}:${eventType}`);
    const { error: transactionError } = await admin.from("payment_transactions").upsert({
      payment_id: payment.id,
      provider_event_id: eventId,
      event_type: eventType,
      payload: event,
      verified: !success,
    }, { onConflict: "provider_event_id", ignoreDuplicates: true });
    if (transactionError) throw transactionError;
    if (payment.status === "PAID" || (!success && payment.status !== "PENDING")) {
      return jsonResponse({ received: true });
    }

    if (success && provider === "paymongo") {
      const secret = requiredEnv("PAYMONGO_SECRET_KEY");
      const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${reference}`, {
        headers: { "Authorization": `Basic ${btoa(`${secret}:`)}` },
      });
      const body = await response.json() as {
        data?: { attributes?: {
          payment_intent_id?: string;
          payment_intent?: { id?: string };
        } };
      };
      if (!response.ok) throw new Error("Unable to verify PayMongo checkout session.");
      const intentId = body.data?.attributes?.payment_intent_id ?? body.data?.attributes?.payment_intent?.id;
      if (!intentId) throw new Error("PayMongo event is missing a payment intent.");
      const intentResponse = await fetch(`https://api.paymongo.com/v1/payment_intents/${intentId}`, {
        headers: { "Authorization": `Basic ${btoa(`${secret}:`)}` },
      });
      const intentBody = await intentResponse.json() as {
        data?: { attributes?: { status?: string; amount?: number; currency?: string } };
      };
      const intent = intentBody.data?.attributes;
      if (!intentResponse.ok || intent?.status !== "succeeded"
        || intent.amount !== Math.round(Number(payment.amount) * 100)
        || intent.currency?.toUpperCase() !== payment.currency) {
        return jsonResponse({ error: "Payment verification did not match the expected full amount." }, 409);
      }
    }
    if (success && provider === "xendit") {
      const status = String(event.status ?? attributes.status ?? "");
      const paidAmount = Number(event.paid_amount ?? attributes.paid_amount ?? event.amount ?? attributes.amount);
      const currency = String(event.currency ?? attributes.currency ?? payment.currency).toUpperCase();
      if (status !== "PAID" && status !== "SUCCEEDED") return jsonResponse({ error: "Invoice is not paid." }, 409);
      if (paidAmount !== Number(payment.amount) || currency !== payment.currency) {
        return jsonResponse({ error: "Payment verification did not match the expected full amount." }, 409);
      }
    }

    if (success) {
      const { error: verifiedError } = await admin.from("payment_transactions")
        .update({ verified: true }).eq("provider_event_id", eventId);
      if (verifiedError) throw verifiedError;
      const { data: appointmentId, error: finalizeError } = await admin.rpc("finalize_verified_payment", {
        p_payment_id: payment.id,
        p_provider_reference: reference,
      });
      if (finalizeError) throw finalizeError;
      if (appointmentId) {
        await notify(admin, payment.customer_id, "Appointment confirmed", "Your full payment is verified and your appointment is booked.", "PAYMENT_CONFIRMED", appointmentId);
      } else {
        await notify(admin, payment.customer_id, "Payment received — studio follow-up required",
          "Your payment was verified, but the reservation is no longer active. Contact the studio to arrange your appointment or a refund.",
          "PAYMENT_REVIEW_REQUIRED", payment.appointment_id);
        const { data: administrators, error: adminsError } = await admin.from("profiles").select("id").eq("role", "ADMIN").eq("is_active", true);
        if (adminsError) throw adminsError;
        for (const administrator of administrators ?? []) {
          await notify(admin, administrator.id, "Payment needs review",
            "A verified payment could not be matched to an active reservation. Contact the customer.",
            "PAYMENT_REVIEW_REQUIRED", payment.appointment_id);
        }
      }
    } else if (failed) {
      const { error: finishError } = await admin.rpc("finish_reservation", {
        p_appointment_id: payment.appointment_id,
        p_payment_status: eventType.toLowerCase().includes("expir") ? "EXPIRED" : "FAILED",
      });
      if (finishError) throw finishError;
      await notify(admin, payment.customer_id, "Payment not completed", "Your payment was not completed. Choose another appointment time to try again.", "PAYMENT_FAILED", payment.appointment_id);
    }
    return jsonResponse({ received: true });
  } catch (error) {
    console.error("Payment webhook processing failed", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Webhook processing failed." }, 500);
  }
});
