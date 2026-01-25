import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { environmentValidator, storeValidator } from "./schema.js";

// Event type to handler mapping
// All 17 RevenueCat webhook event types supported
// @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
const EVENT_HANDLERS = {
  // Subscription lifecycle events
  INITIAL_PURCHASE: internal.handlers.processInitialPurchase,
  RENEWAL: internal.handlers.processRenewal,
  CANCELLATION: internal.handlers.processCancellation,
  UNCANCELLATION: internal.handlers.processUncancellation,
  EXPIRATION: internal.handlers.processExpiration,
  BILLING_ISSUE: internal.handlers.processBillingIssue,
  SUBSCRIPTION_PAUSED: internal.handlers.processSubscriptionPaused,
  SUBSCRIPTION_EXTENDED: internal.handlers.processSubscriptionExtended,
  PRODUCT_CHANGE: internal.handlers.processProductChange,
  NON_RENEWING_PURCHASE: internal.handlers.processNonRenewingPurchase,
  TRANSFER: internal.handlers.processTransfer,
  TEMPORARY_ENTITLEMENT_GRANT: internal.handlers.processTemporaryEntitlementGrant,
  REFUND_REVERSED: internal.handlers.processRefundReversed,
  // Informational events
  TEST: internal.handlers.processTest,
  INVOICE_ISSUANCE: internal.handlers.processInvoiceIssuance,
  VIRTUAL_CURRENCY_TRANSACTION: internal.handlers.processVirtualCurrencyTransaction,
  EXPERIMENT_ENROLLMENT: internal.handlers.processExperimentEnrollment,
  // Deprecated events (still handled for backwards compatibility)
  SUBSCRIBER_ALIAS: internal.handlers.processSubscriberAlias,
} as const;

type EventType = keyof typeof EVENT_HANDLERS;

export const process = mutation({
  args: {
    event: v.object({
      id: v.string(),
      type: v.string(),
      app_id: v.optional(v.string()),
      app_user_id: v.optional(v.string()),
      environment: environmentValidator,
      store: v.optional(storeValidator),
    }),
    payload: v.any(),
  },
  returns: v.object({ processed: v.boolean(), eventId: v.string() }),
  handler: async (ctx, args) => {
    const { event, payload } = args;

    // Idempotency check - skip if already processed
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", event.id))
      .first();

    if (existing) {
      return { processed: false, eventId: event.id };
    }

    // Determine status based on event type
    const eventType = event.type as EventType;
    const handler = EVENT_HANDLERS[eventType];
    let status: "processed" | "failed" | "ignored" = "ignored";
    let error: string | undefined;

    if (handler) {
      try {
        // Dispatch to the appropriate handler
        await ctx.runMutation(handler, { event: payload });
        status = "processed";
      } catch (e) {
        status = "failed";
        error = e instanceof Error ? e.message : String(e);
      }
    }

    // Log the event
    await ctx.db.insert("webhookEvents", {
      eventId: event.id,
      eventType: event.type,
      appId: event.app_id,
      appUserId: event.app_user_id,
      environment: event.environment,
      store: event.store,
      payload,
      processedAt: Date.now(),
      status,
      error,
    });

    return { processed: status === "processed", eventId: event.id };
  },
});
