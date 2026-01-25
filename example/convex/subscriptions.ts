import { v } from "convex/values";
import { query, mutation } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { RevenueCat } from "convex-revenuecat";

// Initialize the RevenueCat client
const revenuecat = new RevenueCat(components.revenuecat, {
  // API keys would come from environment in production
  // REVENUECAT_API_KEY: process.env.REVENUECAT_API_KEY,
  // REVENUECAT_PROJECT_ID: process.env.REVENUECAT_PROJECT_ID,
});

// Validators for RevenueCat types
const storeValidator = v.union(
  v.literal("AMAZON"),
  v.literal("APP_STORE"),
  v.literal("MAC_APP_STORE"),
  v.literal("PADDLE"),
  v.literal("PLAY_STORE"),
  v.literal("PROMOTIONAL"),
  v.literal("RC_BILLING"),
  v.literal("ROKU"),
  v.literal("STRIPE"),
  v.literal("TEST_STORE"),
);

const entitlementValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  appUserId: v.string(),
  entitlementId: v.string(),
  productId: v.optional(v.string()),
  isActive: v.boolean(),
  expiresAtMs: v.optional(v.number()),
  purchasedAtMs: v.optional(v.number()),
  store: v.optional(storeValidator),
  isSandbox: v.boolean(),
  unsubscribeDetectedAt: v.optional(v.number()),
  billingIssueDetectedAt: v.optional(v.number()),
  updatedAt: v.number(),
});

const subscriptionValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  appUserId: v.string(),
  productId: v.string(),
  entitlementIds: v.optional(v.array(v.string())),
  store: storeValidator,
  environment: v.union(v.literal("SANDBOX"), v.literal("PRODUCTION")),
  periodType: v.union(
    v.literal("TRIAL"),
    v.literal("INTRO"),
    v.literal("NORMAL"),
    v.literal("PROMOTIONAL"),
    v.literal("PREPAID"),
  ),
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
  updatedAt: v.number(),
});

const customerValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  appUserId: v.string(),
  originalAppUserId: v.string(),
  aliases: v.array(v.string()),
  firstSeenAt: v.number(),
  lastSeenAt: v.optional(v.number()),
  attributes: v.optional(v.any()),
  updatedAt: v.number(),
});

/**
 * Check if a user has premium access
 */
export const checkPremium = query({
  args: { appUserId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await revenuecat.hasEntitlement(ctx, {
      appUserId: args.appUserId,
      entitlementId: "premium",
    });
  },
});

/**
 * Get all active entitlements for a user
 */
export const getActiveEntitlements = query({
  args: { appUserId: v.string() },
  returns: v.array(entitlementValidator),
  handler: async (ctx, args) => {
    return await revenuecat.getActiveEntitlements(ctx, {
      appUserId: args.appUserId,
    });
  },
});

/**
 * Get all active subscriptions for a user
 */
export const getActiveSubscriptions = query({
  args: { appUserId: v.string() },
  returns: v.array(subscriptionValidator),
  handler: async (ctx, args) => {
    return await revenuecat.getActiveSubscriptions(ctx, {
      appUserId: args.appUserId,
    });
  },
});

/**
 * Get customer info
 */
export const getCustomer = query({
  args: { appUserId: v.string() },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    return await revenuecat.getCustomer(ctx, {
      appUserId: args.appUserId,
    });
  },
});

/**
 * Grant a promotional entitlement (local database only)
 * For production, use grantEntitlementViaApi to sync with RevenueCat
 */
export const grantPromoEntitlement = mutation({
  args: {
    appUserId: v.string(),
    entitlementId: v.string(),
    expiresAtMs: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await revenuecat.grantEntitlement(ctx, {
      appUserId: args.appUserId,
      entitlementId: args.entitlementId,
      expiresAtMs: args.expiresAtMs,
      isSandbox: true,
    });
  },
});

/**
 * Revoke an entitlement (local database only)
 */
export const revokeEntitlement = mutation({
  args: {
    appUserId: v.string(),
    entitlementId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await revenuecat.revokeEntitlement(ctx, args);
  },
});
