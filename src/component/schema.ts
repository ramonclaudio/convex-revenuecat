import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const storeValidator = v.union(
  v.literal("AMAZON"),
  v.literal("APP_STORE"),
  v.literal("MAC_APP_STORE"),
  v.literal("GALAXY"),
  v.literal("PADDLE"),
  v.literal("PLAY_STORE"),
  v.literal("PROMOTIONAL"),
  v.literal("RC_BILLING"),
  v.literal("ROKU"),
  v.literal("STRIPE"),
  v.literal("TEST_STORE"),
  v.literal("EXTERNAL"),
  v.literal("UNKNOWN_STORE"),
);

export const environmentValidator = v.union(
  v.literal("SANDBOX"),
  v.literal("PRODUCTION"),
);

export const periodTypeValidator = v.union(
  v.literal("TRIAL"),
  v.literal("INTRO"),
  v.literal("NORMAL"),
  v.literal("PROMOTIONAL"),
  v.literal("PREPAID"),
);

export const ownershipTypeValidator = v.union(
  v.literal("PURCHASED"),
  v.literal("FAMILY_SHARED"),
  v.literal("UNKNOWN"),
);

const subscriberAttributeValidator = v.object({
  value: v.string(),
  updated_at_ms: v.number(),
});

export const subscriberAttributesValidator = v.record(
  v.string(),
  subscriberAttributeValidator,
);

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
    countryCode: v.optional(v.string()),
    managementUrl: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_app_user_id", ["appUserId"]),

  subscriptions: defineTable({
    appUserId: v.string(),
    productId: v.string(),
    kind: v.optional(
      v.union(v.literal("subscription"), v.literal("consumable")),
    ),
    entitlementIds: v.optional(v.array(v.string())),
    store: storeValidator,
    environment: environmentValidator,
    periodType: periodTypeValidator,
    purchasedAtMs: v.number(),
    expirationAtMs: v.optional(v.number()),
    originalTransactionId: v.string(),
    transactionId: v.string(),
    isFamilyShare: v.boolean(),
    ownershipType: v.optional(ownershipTypeValidator),
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
    refundedAtMs: v.optional(v.number()),
    originalPurchasedAtMs: v.optional(v.number()),
    unsubscribeDetectedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_app_user", ["appUserId"])
    .index("by_app_user_product", ["appUserId", "productId"])
    .index("by_original_transaction", ["originalTransactionId"]),

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
    ownershipType: v.optional(ownershipTypeValidator),
    updatedAt: v.number(),
  })
    .index("by_app_user", ["appUserId"])
    .index("by_app_user_entitlement", ["appUserId", "entitlementId"]),

  webhookEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    appId: v.optional(v.string()),
    appUserId: v.optional(v.string()),
    environment: environmentValidator,
    store: v.optional(storeValidator),
    payload: v.any(),
    processedAt: v.number(),
    status: v.union(
      v.literal("processed"),
      v.literal("failed"),
      v.literal("ignored"),
    ),
    error: v.optional(v.string()),
  })
    .index("by_event_id", ["eventId"])
    .index("by_type", ["eventType"])
    .index("by_app_user", ["appUserId"]),

  experiments: defineTable({
    appUserId: v.string(),
    experimentId: v.string(),
    variant: v.string(),
    offeringId: v.optional(v.string()),
    enrolledAtMs: v.number(),
    updatedAt: v.number(),
  })
    .index("by_app_user", ["appUserId"])
    .index("by_app_user_experiment", ["appUserId", "experimentId"]),

  transfers: defineTable({
    eventId: v.string(),
    transferredFrom: v.array(v.string()),
    transferredTo: v.array(v.string()),
    entitlementIds: v.optional(v.array(v.string())),
    timestamp: v.number(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_timestamp", ["timestamp"]),

  transferParticipants: defineTable({
    transferId: v.id("transfers"),
    appUserId: v.string(),
    role: v.union(v.literal("from"), v.literal("to")),
  })
    .index("by_app_user", ["appUserId"])
    .index("by_transfer", ["transferId"]),

  invoices: defineTable({
    invoiceId: v.string(),
    appUserId: v.string(),
    productId: v.optional(v.string()),
    store: v.optional(storeValidator),
    environment: environmentValidator,
    priceUsd: v.optional(v.number()),
    currency: v.optional(v.string()),
    priceInPurchasedCurrency: v.optional(v.number()),
    issuedAt: v.number(),
  })
    .index("by_invoice_id", ["invoiceId"])
    .index("by_app_user", ["appUserId"]),

  virtualCurrencyBalances: defineTable({
    appUserId: v.string(),
    currencyCode: v.string(),
    currencyName: v.string(),
    balance: v.number(),
    updatedAt: v.number(),
  })
    .index("by_app_user", ["appUserId"])
    .index("by_app_user_currency", ["appUserId", "currencyCode"]),

  virtualCurrencyTransactions: defineTable({
    transactionId: v.string(),
    appUserId: v.string(),
    currencyCode: v.string(),
    amount: v.number(),
    source: v.optional(v.string()),
    productId: v.optional(v.string()),
    environment: environmentValidator,
    timestamp: v.number(),
  })
    .index("by_transaction_id", ["transactionId"])
    .index("by_app_user", ["appUserId"])
    .index("by_app_user_currency", ["appUserId", "currencyCode"]),
});
