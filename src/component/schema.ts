import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const storeValidator = v.union(
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

export const environmentValidator = v.union(v.literal("SANDBOX"), v.literal("PRODUCTION"));

export const periodTypeValidator = v.union(
  v.literal("TRIAL"),
  v.literal("INTRO"),
  v.literal("NORMAL"),
  v.literal("PROMOTIONAL"),
  v.literal("PREPAID"),
);

export const subscriberAttributeValidator = v.object({
  value: v.string(),
  updated_at_ms: v.number(),
});

export const subscriberAttributesValidator = v.record(v.string(), subscriberAttributeValidator);

export default defineSchema({
  rateLimits: defineTable({
    key: v.string(),
    timestamp: v.number(),
  })
    .index("by_key_and_time", ["key", "timestamp"])
    .index("by_timestamp", ["timestamp"]),

  customers: defineTable({
    appUserId: v.string(),
    originalAppUserId: v.string(),
    aliases: v.array(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.optional(v.number()),
    attributes: v.optional(subscriberAttributesValidator),
    updatedAt: v.number(),
  })
    .index("by_app_user_id", ["appUserId"])
    .index("by_original_app_user_id", ["originalAppUserId"]),

  subscriptions: defineTable({
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
    updatedAt: v.number(),
  })
    .index("by_app_user", ["appUserId"])
    .index("by_original_transaction", ["originalTransactionId"])
    .index("by_product", ["productId"]),

  entitlements: defineTable({
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
  })
    .index("by_app_user", ["appUserId"])
    .index("by_app_user_entitlement", ["appUserId", "entitlementId"])
    .index("by_active", ["isActive"]),

  webhookEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    appId: v.optional(v.string()),
    appUserId: v.optional(v.string()),
    environment: environmentValidator,
    store: v.optional(storeValidator),
    payload: v.any(),
    processedAt: v.number(),
    status: v.union(v.literal("processed"), v.literal("failed"), v.literal("ignored")),
    error: v.optional(v.string()),
  })
    .index("by_event_id", ["eventId"])
    .index("by_type", ["eventType"])
    .index("by_app_user", ["appUserId"])
    .index("by_status", ["status"]),

});
