import { v } from "convex/values";
import { query } from "./_generated/server.js";
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
    const now = Date.now();
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();

    return subscriptions.filter((s) => {
      if (!s.expirationAtMs) return true;
      const effectiveExpiration = Math.max(s.expirationAtMs, s.gracePeriodExpirationAtMs ?? 0);
      return effectiveExpiration > now;
    });
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

/**
 * Check if a subscription is currently in a billing grace period.
 * During grace period, the user should retain access while the store
 * retries charging their payment method.
 */
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

/**
 * Get all subscriptions currently in a grace period for a user.
 */
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
