import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import schema, { environmentValidator, periodTypeValidator, storeValidator } from "./schema.js";

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
      // No expiration = lifetime/non-expiring
      if (!s.expirationAtMs) return true;
      // Check if not expired
      return s.expirationAtMs > now;
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

export const upsert = mutation({
  args: {
    appUserId: v.string(),
    productId: v.string(),
    entitlementIds: v.optional(v.array(v.string())),
    store: storeValidator,
    environment: environmentValidator,
    periodType: periodTypeValidator,
    purchasedAtMs: v.number(),
    expirationAtMs: v.optional(v.number()),
    originalTransactionId: v.string(),
    transactionId: v.string(),
    isFamilyShare: v.boolean(),
    isTrialConversion: v.optional(v.boolean()),
    autoRenewStatus: v.optional(v.boolean()),
    cancelReason: v.optional(v.string()),
    expirationReason: v.optional(v.string()),
    gracePeriodExpirationAtMs: v.optional(v.number()),
    billingIssueDetectedAt: v.optional(v.number()),
    autoResumeAtMs: v.optional(v.number()),
    priceUsd: v.optional(v.number()),
    currency: v.optional(v.string()),
    priceInPurchasedCurrency: v.optional(v.number()),
    countryCode: v.optional(v.string()),
    taxPercentage: v.optional(v.number()),
    commissionPercentage: v.optional(v.number()),
    offerCode: v.optional(v.string()),
    presentedOfferingId: v.optional(v.string()),
    renewalNumber: v.optional(v.number()),
    newProductId: v.optional(v.string()),
  },
  returns: v.id("subscriptions"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_original_transaction", (q) =>
        q.eq("originalTransactionId", args.originalTransactionId),
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("subscriptions", {
      ...args,
      updatedAt: now,
    });
  },
});
