import { v, ConvexError } from "convex/values";
import { internalMutation, mutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { environmentValidator, storeValidator } from "./schema.js";
import {
  affectedUserIds,
  fireTransitionHooks,
  resolveHooks,
  snapshotEntitlements,
} from "./transitions.js";

const hooksValidator = v.optional(
  v.object({
    onEntitlementActivated: v.optional(v.string()),
    onEntitlementDeactivated: v.optional(v.string()),
  }),
);

const RATE_LIMIT_MAX_REQUESTS = 100;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_KEY_PREFIX = "webhook";

const MAX_EVENT_ID_LENGTH = 128;

const EVENT_HANDLERS = {
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
  PURCHASE_REDEEMED: internal.handlers.processPurchaseRedeemed,
  TEMPORARY_ENTITLEMENT_GRANT:
    internal.handlers.processTemporaryEntitlementGrant,
  REFUND: internal.handlers.processRefund,
  REFUND_REVERSED: internal.handlers.processRefundReversed,
  TEST: internal.handlers.processTest,
  INVOICE_ISSUANCE: internal.handlers.processInvoiceIssuance,
  VIRTUAL_CURRENCY_TRANSACTION:
    internal.handlers.processVirtualCurrencyTransaction,
  EXPERIMENT_ENROLLMENT: internal.handlers.processExperimentEnrollment,
  SUBSCRIBER_ALIAS: internal.handlers.processSubscriberAlias,
} as const;

type EventType = keyof typeof EVENT_HANDLERS;

export const checkRateLimit = internalMutation({
  args: { key: v.string() },
  returns: v.object({
    allowed: v.boolean(),
    remaining: v.number(),
    resetAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    const currentRequests = await ctx.db
      .query("rateLimits")
      .withIndex("by_key_and_time", (q) =>
        q.eq("key", args.key).gte("timestamp", now - RATE_LIMIT_WINDOW_MS),
      )
      .take(RATE_LIMIT_MAX_REQUESTS);

    const remaining = Math.max(
      0,
      RATE_LIMIT_MAX_REQUESTS - currentRequests.length,
    );
    const allowed = remaining > 0;

    if (allowed) {
      await ctx.db.insert("rateLimits", { key: args.key, timestamp: now });
    }

    const oldestRequest = currentRequests[0];
    const resetAt = oldestRequest
      ? oldestRequest.timestamp + RATE_LIMIT_WINDOW_MS
      : now + RATE_LIMIT_WINDOW_MS;

    return { allowed, remaining: remaining - (allowed ? 1 : 0), resetAt };
  },
});

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
    hooks: hooksValidator,
  },
  returns: v.object({
    processed: v.boolean(),
    eventId: v.string(),
  }),
  handler: async (ctx, args) => {
    const { event, payload } = args;
    const hooks = resolveHooks(args.hooks);
    const now = Date.now();

    if (!event.id?.trim()) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: "Event ID is required",
      });
    }
    if (event.id.length > MAX_EVENT_ID_LENGTH) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: `Event ID exceeds max length of ${MAX_EVENT_ID_LENGTH} bytes`,
      });
    }
    if (!event.type?.trim()) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: "Event type is required",
      });
    }

    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", event.id))
      .first();

    if (existing) {
      return { processed: false, eventId: event.id };
    }

    const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}:${event.app_id ?? event.app_user_id ?? "global"}`;
    const rateCheck = await ctx.runMutation(internal.webhooks.checkRateLimit, {
      key: rateLimitKey,
    });

    if (!rateCheck.allowed) {
      throw new ConvexError({
        code: "RATE_LIMITED",
        message: `Rate limit exceeded. Try again after ${new Date(rateCheck.resetAt).toISOString()}`,
        data: { resetAt: rateCheck.resetAt, remaining: rateCheck.remaining },
      });
    }

    const eventType = event.type as EventType;
    const handler = EVENT_HANDLERS[eventType];
    let status: "processed" | "failed" | "ignored" = "ignored";

    if (handler) {
      const affected = hooks ? affectedUserIds(payload) : [];
      const beforeSnap = hooks
        ? await snapshotEntitlements(ctx, affected)
        : undefined;

      try {
        await ctx.runMutation(handler, { event: payload });
        status = "processed";
      } catch (e) {
        if (e instanceof ConvexError) {
          throw e;
        }
        const message = e instanceof Error ? e.message : String(e);
        throw new ConvexError({
          code: "INTERNAL_ERROR",
          message: `Handler failed: ${message}`,
        });
      }

      if (hooks && beforeSnap) {
        const afterSnap = await snapshotEntitlements(ctx, affected);
        await fireTransitionHooks(
          ctx,
          hooks,
          beforeSnap,
          afterSnap,
          event.type,
        );
      }
    }

    await ctx.db.insert("webhookEvents", {
      eventId: event.id,
      eventType: event.type,
      appId: event.app_id,
      appUserId: event.app_user_id,
      environment: event.environment,
      store: event.store,
      payload,
      processedAt: now,
      status,
    });

    return { processed: status === "processed", eventId: event.id };
  },
});

export const recordFailure = mutation({
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
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.event.id.length > MAX_EVENT_ID_LENGTH) return null;
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.event.id))
      .first();
    if (existing) return null;
    await ctx.db.insert("webhookEvents", {
      eventId: args.event.id,
      eventType: args.event.type,
      appId: args.event.app_id,
      appUserId: args.event.app_user_id,
      environment: args.event.environment,
      store: args.event.store,
      payload: args.payload,
      processedAt: Date.now(),
      status: "failed",
      error: args.error.slice(0, 1024),
    });
    return null;
  },
});
