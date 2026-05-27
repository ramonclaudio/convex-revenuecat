import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { RevenueCat } from "convex-revenuecat";

const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
});

export const status = query({
  args: { appUserId: v.string() },
  handler: async (ctx, { appUserId }) => {
    const [
      isSubscriber,
      isInTrial,
      customer,
      activeEntitlements,
      subscriptions,
      gracePeriod,
      virtualCurrency,
      invoices,
    ] = await Promise.all([
      revenuecat.isSubscriber(ctx, { appUserId }),
      revenuecat.isInTrial(ctx, { appUserId }),
      revenuecat.getCustomer(ctx, { appUserId }),
      revenuecat.getActiveEntitlements(ctx, { appUserId }),
      revenuecat.getAllSubscriptions(ctx, { appUserId }),
      revenuecat.getSubscriptionsInGracePeriod(ctx, { appUserId }),
      revenuecat.getVirtualCurrencyBalances(ctx, { appUserId }),
      revenuecat.getInvoices(ctx, { appUserId }),
    ]);
    return {
      isSubscriber,
      isInTrial,
      customer,
      activeEntitlements,
      subscriptions,
      gracePeriod,
      virtualCurrency,
      invoices,
    };
  },
});

export const recentEvents = query({
  args: { appUserId: v.string() },
  handler: async (ctx, { appUserId }) => {
    return await ctx.runQuery(components.revenuecat.webhookEvents.listByUser, {
      appUserId,
      limit: 25,
    });
  },
});

export const reset = mutation({
  args: { appUserId: v.string() },
  handler: async (ctx, { appUserId }) => {
    return await revenuecat.deleteCustomer(ctx, { appUserId });
  },
});
