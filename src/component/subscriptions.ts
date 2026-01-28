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
      // No expiration = lifetime/non-expiring
      if (!s.expirationAtMs) return true;
      // Use the later of normal expiration or grace period expiration
      // During billing issues, gracePeriodExpirationAtMs extends the deadline
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
