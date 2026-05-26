// DEMO ONLY. Fires synthetic RevenueCat webhook events so the showcase UI can
// exercise every event type the component handles and you can watch the live
// state react. It calls the component's `process` directly (the same mutation
// the auth-gated HTTP handler calls), so no secret is needed from the browser.
// Production receives these from RevenueCat over the webhook; this is purely a
// test harness for the example.
import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { components } from "./_generated/api.js";

const DAY = 24 * 60 * 60 * 1000;
type Json = Record<string, unknown>;
const rid = (p: string) =>
  `sim-${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Build a realistic RC event payload for a named scenario. `original_transaction_id`
// is stable per user so renew/cancel/expire act on the same subscription.
function buildEvent(
  appUserId: string,
  scenario: string,
  toAppUserId: string,
): Json {
  const now = Date.now();
  const txn = `sim-txn-${appUserId}`;
  const sub: Json = {
    app_id: "app_demo",
    app_user_id: appUserId,
    original_app_user_id: appUserId,
    aliases: [appUserId],
    event_timestamp_ms: now,
    environment: "PRODUCTION",
    store: "APP_STORE",
    product_id: "monthly",
    entitlement_ids: ["TEST Pro"],
    period_type: "NORMAL",
    purchased_at_ms: now,
    transaction_id: txn,
    original_transaction_id: txn,
    price: 9.99,
    currency: "USD",
  };
  switch (scenario) {
    case "INITIAL_PURCHASE":
      return {
        ...sub,
        id: rid("init"),
        type: "INITIAL_PURCHASE",
        expiration_at_ms: now + 30 * DAY,
      };
    case "RENEWAL":
      return {
        ...sub,
        id: rid("renew"),
        type: "RENEWAL",
        renewal_number: 2,
        expiration_at_ms: now + 30 * DAY,
      };
    case "TRIAL":
      return {
        ...sub,
        id: rid("trial"),
        type: "INITIAL_PURCHASE",
        period_type: "TRIAL",
        price: 0,
        expiration_at_ms: now + 7 * DAY,
      };
    case "PRODUCT_CHANGE":
      return {
        ...sub,
        id: rid("change"),
        type: "PRODUCT_CHANGE",
        new_product_id: "yearly",
        expiration_at_ms: now + 30 * DAY,
      };
    case "UNSUBSCRIBE":
      return {
        ...sub,
        id: rid("unsub"),
        type: "CANCELLATION",
        cancel_reason: "UNSUBSCRIBE",
        expiration_at_ms: now + 30 * DAY,
      };
    case "UNCANCELLATION":
      return {
        ...sub,
        id: rid("uncancel"),
        type: "UNCANCELLATION",
        expiration_at_ms: now + 30 * DAY,
      };
    case "PAUSE":
      return {
        ...sub,
        id: rid("pause"),
        type: "SUBSCRIPTION_PAUSED",
        auto_resume_at_ms: now + 14 * DAY,
        expiration_at_ms: now + 30 * DAY,
      };
    case "EXTEND":
      return {
        ...sub,
        id: rid("extend"),
        type: "SUBSCRIPTION_EXTENDED",
        expiration_at_ms: now + 37 * DAY,
      };
    case "BILLING_ISSUE":
      return {
        ...sub,
        id: rid("billing"),
        type: "BILLING_ISSUE",
        grace_period_expiration_at_ms: now + 16 * DAY,
        expiration_at_ms: now + DAY,
      };
    case "EXPIRATION":
      return {
        ...sub,
        id: rid("expire"),
        type: "EXPIRATION",
        expiration_reason: "BILLING_ERROR",
        expiration_at_ms: now - 1,
      };
    case "REFUND":
      return { ...sub, id: rid("refund"), type: "REFUND", price: -9.99 };
    case "REFUND_REVERSED":
      return {
        ...sub,
        id: rid("reversed"),
        type: "REFUND_REVERSED",
        expiration_at_ms: now + 30 * DAY,
      };
    case "NON_RENEWING":
      return {
        ...sub,
        id: rid("otp"),
        type: "NON_RENEWING_PURCHASE",
        product_id: "lifetime",
        entitlement_ids: ["TEST Pro"],
        transaction_id: `sim-otp-${appUserId}`,
        original_transaction_id: `sim-otp-${appUserId}`,
      };
    case "TEMP_GRANT":
      return {
        ...sub,
        id: rid("temp"),
        type: "TEMPORARY_ENTITLEMENT_GRANT",
        expiration_at_ms: now + DAY,
      };
    case "INVOICE":
      return {
        ...sub,
        id: rid("inv"),
        type: "INVOICE_ISSUANCE",
        price_in_purchased_currency: 9.99,
      };
    case "VC_GRANT":
      return {
        id: rid("vcg"),
        app_id: "app_demo",
        app_user_id: appUserId,
        environment: "PRODUCTION",
        event_timestamp_ms: now,
        type: "VIRTUAL_CURRENCY_TRANSACTION",
        virtual_currency_transaction_id: rid("vc"),
        source: "in_app_purchase",
        adjustments: [
          { amount: 500, currency: { code: "COINS", name: "Gold Coins" } },
        ],
      };
    case "VC_SPEND":
      return {
        id: rid("vcs"),
        app_id: "app_demo",
        app_user_id: appUserId,
        environment: "PRODUCTION",
        event_timestamp_ms: now,
        type: "VIRTUAL_CURRENCY_TRANSACTION",
        virtual_currency_transaction_id: rid("vc"),
        source: "spend",
        adjustments: [
          { amount: -100, currency: { code: "COINS", name: "Gold Coins" } },
        ],
      };
    case "EXPERIMENT":
      return {
        ...sub,
        id: rid("exp"),
        type: "EXPERIMENT_ENROLLMENT",
        experiment_id: "paywall_color_test",
        experiment_variant: "B",
        offering_id: "default",
        enrolled_at_ms: now,
      };
    case "TRANSFER":
      return {
        id: rid("xfer"),
        app_id: "app_demo",
        environment: "PRODUCTION",
        event_timestamp_ms: now,
        type: "TRANSFER",
        transferred_from: [appUserId],
        transferred_to: [toAppUserId],
        entitlement_ids: ["TEST Pro"],
      };
    case "REDEEM":
      return {
        id: rid("redeem"),
        app_id: "app_demo",
        environment: "PRODUCTION",
        event_timestamp_ms: now,
        type: "PURCHASE_REDEEMED",
        redeemed_from: [toAppUserId],
        redeemed_by: [appUserId],
        redemption_outcome: "alias",
        entitlement_ids: ["TEST Pro"],
      };
    case "TEST":
      return { ...sub, id: rid("test"), type: "TEST" };
    default:
      return { ...sub, id: rid("evt"), type: scenario };
  }
}

export const fire = mutation({
  args: {
    appUserId: v.string(),
    scenario: v.string(),
    toAppUserId: v.optional(v.string()),
  },
  returns: v.object({ processed: v.boolean(), type: v.string() }),
  handler: async (ctx, args) => {
    const event = buildEvent(
      args.appUserId,
      args.scenario,
      args.toAppUserId ?? `${args.appUserId}-alt`,
    );
    const res = await ctx.runMutation(components.revenuecat.webhooks.process, {
      event: {
        id: event.id as string,
        type: event.type as string,
        app_id: event.app_id as string | undefined,
        app_user_id: event.app_user_id as string | undefined,
        environment: event.environment as "SANDBOX" | "PRODUCTION",
        store: event.store as "APP_STORE" | undefined,
      },
      payload: event,
    });
    return { processed: res.processed, type: event.type as string };
  },
});
