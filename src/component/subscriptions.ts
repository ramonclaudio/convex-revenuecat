import { v } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";
import { internalMutation, query } from "./_generated/server.js";
import schema from "./schema.js";

const subscriptionDoc = schema.tables.subscriptions.validator.extend({
  _id: v.id("subscriptions"),
  _creationTime: v.number(),
});

export const getByUser = query({
  args: {
    appUserId: v.string(),
  },
  returns: v.array(subscriptionDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();
  },
});

export const getActive = query({
  args: {
    appUserId: v.string(),
  },
  returns: v.array(subscriptionDoc),
  handler: async (ctx, args) => {
    // `Date.now()` is deliberate here (see entitlements.ts header): it keeps the
    // active/grace filter reactive between lifecycle webhooks. Per-user tables
    // are tiny, so the query-cache cost is negligible.
    const now = Date.now();
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();

    return subscriptions.filter((s) => {
      // Default to recurring-subscription semantics for rows that predate the
      // `kind` field. One-shots are filtered out so `getActiveSubscriptions`
      // doesn't conflate them with renewing subs. Consumers wanting
      // consumables call `getConsumables`.
      if (s.kind === "consumable") return false;
      if (!s.expirationAtMs) return true;
      const effectiveExpiration = Math.max(s.expirationAtMs, s.gracePeriodExpirationAtMs ?? 0);
      return effectiveExpiration > now;
    });
  },
});

/** One-shot non-renewing purchases (RC `NON_RENEWING_PURCHASE`). Consumables
 * don't expire by time. They're consumed by the app's own logic, so this
 * returns every row with `kind === "consumable"` regardless of when it was
 * purchased. The app is responsible for tracking what's been spent. Use
 * `getInvoices` for one-time-purchase receipts. */
export const getConsumables = query({
  args: {
    appUserId: v.string(),
  },
  returns: v.array(subscriptionDoc),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();
    return subscriptions.filter((s) => s.kind === "consumable");
  },
});

/** Backfill `subscriptions.kind` for pre-0.3.0 rows by walking the
 * `webhookEvents` audit log for `NON_RENEWING_PURCHASE` events and patching
 * the matching subscription to `kind: "consumable"`. Idempotent. Pre-0.3.0
 * recurring subscriptions stay `kind: undefined` and are treated as
 * `"subscription"` by `getActiveSubscriptions`. Loop until `nextCursor` is
 * null. Bounded by the 30-day audit retention. Consumable rows whose
 * NON_RENEWING_PURCHASE event predates retention can't be backfilled this
 * way and stay `kind: undefined` (so `getActiveSubscriptions` will keep
 * returning them). Operators with older data should patch directly. */
export const backfillKind = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    written: v.number(),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.pageSize ?? 256, 1000);
    const page = await paginator(ctx.db, schema)
      .query("webhookEvents")
      .withIndex("by_type", (q) => q.eq("eventType", "NON_RENEWING_PURCHASE"))
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });
    const now = Date.now();
    let written = 0;
    for (const event of page.page) {
      const payload = event.payload as
        | { original_transaction_id?: string }
        | null;
      const originalTransactionId = payload?.original_transaction_id;
      if (!originalTransactionId) continue;
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_original_transaction", (q) =>
          q.eq("originalTransactionId", originalTransactionId),
        )
        .first();
      if (!sub) continue;
      if (sub.kind === "consumable") continue;
      await ctx.db.patch(sub._id, { kind: "consumable", updatedAt: now });
      written++;
    }
    return {
      scanned: page.page.length,
      written,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const getByOriginalTransaction = query({
  args: {
    originalTransactionId: v.string(),
  },
  returns: v.union(v.null(), subscriptionDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_original_transaction", (q) =>
        q.eq("originalTransactionId", args.originalTransactionId),
      )
      .first();
  },
});

export const isInGracePeriod = query({
  args: {
    originalTransactionId: v.string(),
  },
  returns: v.object({
    inGracePeriod: v.boolean(),
    gracePeriodExpiresAt: v.optional(v.number()),
    billingIssueDetectedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_original_transaction", (q) =>
        q.eq("originalTransactionId", args.originalTransactionId),
      )
      .first();

    if (!subscription) {
      return { inGracePeriod: false };
    }

    const now = Date.now();
    const { gracePeriodExpirationAtMs, billingIssueDetectedAt } = subscription;

    // iOS `SubscriptionInfo.billingIssuesDetectedAt != nil && gracePeriodExpiresDate != nil
    // && now < gracePeriodExpiresDate` is the SDK-matching check. The prior
    // implementation also required `expirationAtMs <= now`, which missed
    // pre-expiry billing retry windows (Google Play fires BILLING_ISSUE
    // before the current period ends, and RC may extend grace past the
    // original expiry).
    const inGracePeriod = Boolean(
      billingIssueDetectedAt &&
        gracePeriodExpirationAtMs &&
        gracePeriodExpirationAtMs > now,
    );

    return {
      inGracePeriod,
      gracePeriodExpiresAt: gracePeriodExpirationAtMs,
      billingIssueDetectedAt,
    };
  },
});

export const getInGracePeriod = query({
  args: {
    appUserId: v.string(),
  },
  returns: v.array(subscriptionDoc),
  handler: async (ctx, args) => {
    const now = Date.now();
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();

    return subscriptions.filter((s) => {
      // Same SDK-matching check as `isInGracePeriod`. See that handler for
      // rationale on dropping the `normalExpired` clause.
      return Boolean(
        s.billingIssueDetectedAt &&
          s.gracePeriodExpirationAtMs &&
          s.gracePeriodExpirationAtMs > now,
      );
    });
  },
});
