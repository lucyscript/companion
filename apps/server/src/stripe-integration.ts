/**
 * Stripe Payment Integration
 *
 * Handles subscription checkout sessions, webhook processing,
 * and customer portal sessions for plan management.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY       — sk_test_... or sk_live_...
 *   STRIPE_WEBHOOK_SECRET   — whsec_... (from Stripe dashboard → Webhooks)
 *   STRIPE_PRICE_ID_PLUS    — price_... (monthly subscription for Plus plan)
 *   STRIPE_PRICE_ID_PRO     — price_... (monthly subscription for Pro plan)
 *   APP_URL                 — e.g. https://invaron.github.io/companion (for redirect URLs)
 */

import Stripe from "stripe";
import type { PlanId } from "./plan-config.js";

// ── Configuration ────────────────────────────────────────────────────────

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const STRIPE_PRICE_ID_PLUS = process.env.STRIPE_PRICE_ID_PLUS ?? "";
const STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO ?? "";
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";

export function isStripeConfigured(): boolean {
  return Boolean(STRIPE_SECRET_KEY);
}

function getStripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(STRIPE_SECRET_KEY);
}

// ── Price → Plan mapping ─────────────────────────────────────────────────

const PRICE_TO_PLAN: Record<string, PlanId> = {};
if (STRIPE_PRICE_ID_PLUS) PRICE_TO_PLAN[STRIPE_PRICE_ID_PLUS] = "plus";
if (STRIPE_PRICE_ID_PRO) PRICE_TO_PLAN[STRIPE_PRICE_ID_PRO] = "pro";

const PLAN_TO_PRICE: Record<string, string> = {};
if (STRIPE_PRICE_ID_PLUS) PLAN_TO_PRICE["plus"] = STRIPE_PRICE_ID_PLUS;
if (STRIPE_PRICE_ID_PRO) PLAN_TO_PRICE["pro"] = STRIPE_PRICE_ID_PRO;

export function getPlanForPrice(priceId: string): PlanId | null {
  return PRICE_TO_PLAN[priceId] ?? null;
}

export function getPriceForPlan(planId: PlanId): string | null {
  return PLAN_TO_PRICE[planId] ?? null;
}

// ── Checkout Session ─────────────────────────────────────────────────────

export interface CreateCheckoutParams {
  userId: string;
  email: string;
  planId: PlanId;
  stripeCustomerId?: string | null;
}

export interface CheckoutResult {
  sessionId: string;
  url: string;
}

/**
 * Create a Stripe Checkout Session for subscribing to a plan.
 * If the user already has a Stripe customer, reuse it.
 */
export async function createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutResult> {
  const stripe = getStripe();
  const priceId = getPriceForPlan(params.planId);

  if (!priceId) {
    throw new Error(`No Stripe price configured for plan "${params.planId}"`);
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_URL}?payment=success&plan=${params.planId}`,
    cancel_url: `${APP_URL}?payment=cancelled`,
    client_reference_id: params.userId,
    metadata: {
      userId: params.userId,
      planId: params.planId
    },
    subscription_data: {
      metadata: {
        userId: params.userId,
        planId: params.planId
      },
      trial_period_days: params.planId === "plus" ? 7 : undefined
    }
  };

  // Reuse existing Stripe customer or create new one by email
  if (params.stripeCustomerId) {
    sessionParams.customer = params.stripeCustomerId;
  } else {
    sessionParams.customer_email = params.email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return {
    sessionId: session.id,
    url: session.url!
  };
}

// ── Customer Portal ──────────────────────────────────────────────────────

export async function createPortalSession(stripeCustomerId: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${APP_URL}?tab=settings`
  });
  return session.url;
}

// ── Webhook Handling ─────────────────────────────────────────────────────

export interface WebhookEvent {
  type: string;
  userId: string | null;
  planId: PlanId | null;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  status: string | null;
}

/**
 * Verify and parse a Stripe webhook event.
 * Returns a simplified event for the server to process.
 */
export function parseWebhookEvent(rawBody: Buffer, signature: string): WebhookEvent {
  const stripe = getStripe();

  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }

  const event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);

  const result: WebhookEvent = {
    type: event.type,
    userId: null,
    planId: null,
    stripeCustomerId: null,
    subscriptionId: null,
    status: null
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      result.userId = session.metadata?.userId ?? session.client_reference_id ?? null;
      result.planId = (session.metadata?.planId as PlanId) ?? null;
      result.stripeCustomerId = typeof session.customer === "string"
        ? session.customer
        : (session.customer as Stripe.Customer)?.id ?? null;
      result.subscriptionId = typeof session.subscription === "string"
        ? session.subscription
        : null;
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      result.userId = sub.metadata?.userId ?? null;
      result.stripeCustomerId = typeof sub.customer === "string"
        ? sub.customer
        : (sub.customer as Stripe.Customer)?.id ?? null;
      result.subscriptionId = sub.id;
      result.status = sub.status;

      // Determine plan from the subscription's price
      if (sub.items.data.length > 0) {
        const priceId = sub.items.data[0].price.id;
        result.planId = getPlanForPrice(priceId);
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      result.stripeCustomerId = typeof invoice.customer === "string"
        ? invoice.customer
        : (invoice.customer as Stripe.Customer)?.id ?? null;
      // Try to extract userId from invoice metadata
      const invoiceAny = invoice as unknown as Record<string, unknown>;
      const invoiceMeta = invoiceAny["metadata"] as Record<string, string> | undefined;
      result.userId = invoiceMeta?.userId ?? null;
      break;
    }
  }

  return result;
}

// ── Status check ─────────────────────────────────────────────────────────

export interface StripeStatus {
  configured: boolean;
  prices: {
    plus: boolean;
    pro: boolean;
  };
}

export function getStripeStatus(): StripeStatus {
  return {
    configured: isStripeConfigured(),
    prices: {
      plus: Boolean(STRIPE_PRICE_ID_PLUS),
      pro: Boolean(STRIPE_PRICE_ID_PRO)
    }
  };
}
