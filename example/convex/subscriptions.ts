// Authorization pattern
//
// `revenuecat.api()` returns identity-aware query handlers. Each resolves the
// caller's `appUserId` via `ctx.auth.getUserIdentity().subject` server-side,
// so accepting `appUserId` as a function argument (an IDOR) becomes
// impossible by construction. This file spreads `api()` for the standard
// queries, then defines a tier-specific `checkPremium` to show the manual
// auth pattern when you need a query the factory doesn't cover.
//
// Convex's own AI guidelines: "NEVER accept a `userId` or any user
// identifier as a function argument for authorization purposes."
//
// This example assumes `identity.subject` is the same string the mobile app
// passes to `Purchases.configure(...)` or `Purchases.logIn(...)`. If your
// auth provider's `subject` and your RC `appUserId` differ, configure
// `getAppUserId` on `RevenueCat` to do the lookup. Admin tooling that
// legitimately needs to read other users' data should use a separate
// `internalQuery` gated by an explicit role check.

import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { RevenueCat } from "convex-revenuecat";

const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
});

// One-line spread covers every user-scoped query the component exposes.
// Each handler reads the caller's identity server-side. The client never
// passes an `appUserId`.
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

// Tier-specific helper: when you want a named query for a single
// entitlement, write it on top of `revenuecat.hasEntitlement`. The pattern
// below derives `appUserId` from `ctx.auth.getUserIdentity().subject`,
// identical to what `api()` does internally.
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
