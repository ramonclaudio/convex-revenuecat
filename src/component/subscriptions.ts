import { v } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";
import { mutation, query } from "./_generated/server.js";
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
      if (s.kind === "consumable") return false;
      if (!s.expirationAtMs) return true;
      const effectiveExpiration = Math.max(
        s.expirationAtMs,
        s.gracePeriodExpirationAtMs ?? 0,
      );
      return effectiveExpiration > now;
    });
  },
});

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

export const backfillKind = mutation({
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
      const payload = event.payload as {
        original_transaction_id?: string;
      } | null;
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
      return Boolean(
        s.billingIssueDetectedAt &&
        s.gracePeriodExpirationAtMs &&
        s.gracePeriodExpirationAtMs > now,
      );
    });
  },
});
