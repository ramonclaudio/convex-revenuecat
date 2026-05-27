import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { RevenueCat } from "convex-revenuecat";

const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
});

export const {
  getActiveEntitlements,
  getAllEntitlements,
  getActiveSubscriptions,
  getAllSubscriptions,
  getConsumables,
  getSubscriptionsInGracePeriod,
  getCustomer,
  getEntitlement,
  hasEntitlement,
  hasAnyEntitlement,
  isSubscriber,
  isInTrial,
  wasInTrialEver,
  getLatestSubscription,
  getRenewsAtMs,
  getExpiresAtMs,
  getExperiment,
  getExperiments,
  getInvoices,
  getVirtualCurrencyBalance,
  getVirtualCurrencyBalances,
  getVirtualCurrencyTransactions,
} = revenuecat.api();

export const checkPremium = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await revenuecat.hasEntitlement(ctx, {
      appUserId: identity.subject,
      entitlementId: "premium",
    });
  },
});
