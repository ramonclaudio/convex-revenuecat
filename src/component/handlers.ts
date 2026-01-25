import { v } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import { internalMutation } from "./_generated/server.js";
import type { DataModel } from "./_generated/dataModel.js";
import { environmentValidator, periodTypeValidator, storeValidator } from "./schema.js";

// Type alias for mutation context with our data model
type MutationCtx = GenericMutationCtx<DataModel>;

// Common event payload validator for RevenueCat webhooks
// Many fields are optional because different event types have different required fields
// See: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
const eventPayloadValidator = v.object({
  type: v.string(),
  id: v.string(),
  app_id: v.optional(v.string()),
  // TRANSFER events don't have app_user_id - use transferred_from/transferred_to instead
  app_user_id: v.optional(v.string()),
  original_app_user_id: v.optional(v.string()),
  aliases: v.optional(v.array(v.string())),
  event_timestamp_ms: v.number(),
  // product_id may be missing in TRANSFER, EXPERIMENT_ENROLLMENT events
  product_id: v.optional(v.string()),
  entitlement_ids: v.optional(v.array(v.string())),
  // period_type may be missing in sparse events
  period_type: v.optional(periodTypeValidator),
  purchased_at_ms: v.optional(v.number()),
  expiration_at_ms: v.optional(v.number()),
  transaction_id: v.optional(v.string()),
  original_transaction_id: v.optional(v.string()),
  store: v.optional(storeValidator),
  environment: v.optional(environmentValidator),
  // is_family_share is not always present (e.g., CANCELLATION events)
  is_family_share: v.optional(v.boolean()),
  price: v.optional(v.number()),
  price_in_purchased_currency: v.optional(v.number()),
  currency: v.optional(v.string()),
  country_code: v.optional(v.string()),
  tax_percentage: v.optional(v.number()),
  commission_percentage: v.optional(v.number()),
  offer_code: v.optional(v.string()),
  presented_offering_id: v.optional(v.string()),
  renewal_number: v.optional(v.number()),
  is_trial_conversion: v.optional(v.boolean()),
  cancel_reason: v.optional(v.string()),
  expiration_reason: v.optional(v.string()),
  grace_period_expiration_at_ms: v.optional(v.number()),
  auto_resume_at_ms: v.optional(v.number()),
  new_product_id: v.optional(v.string()),
  // TRANSFER event specific fields
  transferred_from: v.optional(v.array(v.string())),
  transferred_to: v.optional(v.array(v.string())),
  // EXPERIMENT_ENROLLMENT specific fields
  experiment_id: v.optional(v.string()),
  experiment_variant: v.optional(v.string()),
  offering_id: v.optional(v.string()),
  experiment_enrolled_at_ms: v.optional(v.number()),
  // VIRTUAL_CURRENCY_TRANSACTION specific fields
  adjustments: v.optional(v.array(v.any())),
  virtual_currency_transaction_id: v.optional(v.string()),
  source: v.optional(v.string()),
  // INVOICE_ISSUANCE specific fields
  invoice_id: v.optional(v.string()),
  // Customer attributes and experiments (optional enhancements)
  subscriber_attributes: v.optional(v.any()),
  experiments: v.optional(
    v.array(
      v.object({
        experiment_id: v.string(),
        experiment_variant: v.string(),
        enrolled_at_ms: v.optional(v.number()),
      }),
    ),
  ),
});

type Store =
  | "AMAZON"
  | "APP_STORE"
  | "MAC_APP_STORE"
  | "PADDLE"
  | "PLAY_STORE"
  | "PROMOTIONAL"
  | "RC_BILLING"
  | "ROKU"
  | "STRIPE"
  | "TEST_STORE";

type EventPayload = {
  type: string;
  id: string;
  app_id?: string;
  // Optional for TRANSFER events
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  event_timestamp_ms: number;
  // Optional for sparse events (TRANSFER, EXPERIMENT_ENROLLMENT)
  product_id?: string;
  entitlement_ids?: string[];
  period_type?: "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  transaction_id?: string;
  original_transaction_id?: string;
  store?: Store;
  environment?: "SANDBOX" | "PRODUCTION";
  is_family_share?: boolean;
  price?: number;
  price_in_purchased_currency?: number;
  currency?: string;
  country_code?: string;
  tax_percentage?: number;
  commission_percentage?: number;
  offer_code?: string;
  presented_offering_id?: string;
  renewal_number?: number;
  is_trial_conversion?: boolean;
  cancel_reason?: string;
  expiration_reason?: string;
  grace_period_expiration_at_ms?: number;
  auto_resume_at_ms?: number;
  new_product_id?: string;
  // TRANSFER event specific
  transferred_from?: string[];
  transferred_to?: string[];
  // EXPERIMENT_ENROLLMENT specific
  experiment_id?: string;
  experiment_variant?: string;
  offering_id?: string;
  experiment_enrolled_at_ms?: number;
  // VIRTUAL_CURRENCY_TRANSACTION specific
  adjustments?: unknown[];
  virtual_currency_transaction_id?: string;
  source?: string;
  // INVOICE_ISSUANCE specific
  invoice_id?: string;
  // Customer attributes and experiments
  subscriber_attributes?: Record<string, { value: string; updated_at_ms: number }>;
  experiments?: Array<{
    experiment_id: string;
    experiment_variant: string;
    enrolled_at_ms?: number;
  }>;
};

// Helper: upsert customer from event data
async function upsertCustomer(ctx: MutationCtx, event: EventPayload): Promise<void> {
  // Skip if no app_user_id (e.g., TRANSFER events)
  if (!event.app_user_id) return;

  const appUserId = event.app_user_id;
  const now = Date.now();
  const existing = await ctx.db
    .query("customers")
    .withIndex("by_app_user_id", (q) => q.eq("appUserId", appUserId))
    .first();

  const aliases = event.aliases ?? [];
  const originalAppUserId = event.original_app_user_id ?? appUserId;

  // Merge subscriber_attributes (keep newer values based on updated_at_ms)
  // Note: Keys with $ prefix are pre-encoded to __dollar__ by the HTTP handler
  const mergedAttributes = existing?.attributes ?? {};
  if (event.subscriber_attributes) {
    for (const [key, attr] of Object.entries(event.subscriber_attributes)) {
      const existingAttr = mergedAttributes[key];
      if (!existingAttr || attr.updated_at_ms > (existingAttr.updated_at_ms ?? 0)) {
        mergedAttributes[key] = attr;
      }
    }
  }

  if (existing) {
    const mergedAliases = [...new Set([...existing.aliases, ...aliases])];
    await ctx.db.patch(existing._id, {
      originalAppUserId,
      aliases: mergedAliases,
      attributes: Object.keys(mergedAttributes).length > 0 ? mergedAttributes : undefined,
      lastSeenAt: event.event_timestamp_ms,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("customers", {
      appUserId,
      originalAppUserId,
      aliases,
      attributes: Object.keys(mergedAttributes).length > 0 ? mergedAttributes : undefined,
      firstSeenAt: event.event_timestamp_ms,
      lastSeenAt: event.event_timestamp_ms,
      updatedAt: now,
    });
  }
}

// Helper: upsert subscription from event data
async function upsertSubscription(
  ctx: MutationCtx,
  event: EventPayload,
  overrides?: Partial<{
    cancelReason: string | undefined;
    expirationReason: string | undefined;
    gracePeriodExpirationAtMs: number | undefined;
    billingIssueDetectedAt: number | undefined;
    autoResumeAtMs: number | undefined;
    autoRenewStatus: boolean | undefined;
  }>,
): Promise<void> {
  // Skip if missing required fields for subscription
  if (!event.app_user_id || !event.original_transaction_id || !event.product_id) return;
  if (!event.store || !event.environment || !event.period_type) return;

  // Extract validated fields
  const appUserId = event.app_user_id;
  const originalTransactionId = event.original_transaction_id;
  const productId = event.product_id;
  const store = event.store;
  const environment = event.environment;
  const periodType = event.period_type;

  const now = Date.now();
  const existing = await ctx.db
    .query("subscriptions")
    .withIndex("by_original_transaction", (q) =>
      q.eq("originalTransactionId", originalTransactionId),
    )
    .first();

  const subscriptionData = {
    appUserId,
    productId,
    entitlementIds: event.entitlement_ids,
    store,
    environment,
    periodType,
    purchasedAtMs: event.purchased_at_ms ?? Date.now(),
    expirationAtMs: event.expiration_at_ms,
    originalTransactionId,
    transactionId: event.transaction_id ?? originalTransactionId,
    isFamilyShare: event.is_family_share ?? false,
    isTrialConversion: event.is_trial_conversion,
    priceUsd: event.price,
    currency: event.currency,
    priceInPurchasedCurrency: event.price_in_purchased_currency,
    countryCode: event.country_code,
    taxPercentage: event.tax_percentage,
    commissionPercentage: event.commission_percentage,
    offerCode: event.offer_code,
    presentedOfferingId: event.presented_offering_id,
    renewalNumber: event.renewal_number,
    newProductId: event.new_product_id,
    ...overrides,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, subscriptionData);
  } else {
    await ctx.db.insert("subscriptions", subscriptionData);
  }
}

// Helper: grant entitlements from event
async function grantEntitlements(ctx: MutationCtx, event: EventPayload): Promise<void> {
  if (!event.entitlement_ids?.length || !event.app_user_id) return;

  const now = Date.now();
  const isSandbox = event.environment === "SANDBOX";

  for (const entitlementId of event.entitlement_ids) {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q.eq("appUserId", event.app_user_id!).eq("entitlementId", entitlementId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isActive: true,
        productId: event.product_id,
        expiresAtMs: event.expiration_at_ms,
        purchasedAtMs: event.purchased_at_ms,
        store: event.store,
        isSandbox,
        unsubscribeDetectedAt: undefined,
        billingIssueDetectedAt: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("entitlements", {
        appUserId: event.app_user_id,
        entitlementId,
        productId: event.product_id,
        isActive: true,
        expiresAtMs: event.expiration_at_ms,
        purchasedAtMs: event.purchased_at_ms,
        store: event.store,
        isSandbox,
        updatedAt: now,
      });
    }
  }
}

// Helper: revoke entitlements for user
async function revokeEntitlements(
  ctx: MutationCtx,
  appUserId: string,
  entitlementIds?: string[],
): Promise<void> {
  const now = Date.now();
  const entitlements = await ctx.db
    .query("entitlements")
    .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
    .collect();

  for (const ent of entitlements) {
    if (!entitlementIds || entitlementIds.includes(ent.entitlementId)) {
      if (ent.isActive) {
        await ctx.db.patch(ent._id, {
          isActive: false,
          updatedAt: now,
        });
      }
    }
  }
}

// Helper: extend entitlements expiration
async function extendEntitlements(ctx: MutationCtx, event: EventPayload): Promise<void> {
  if (!event.entitlement_ids?.length || !event.app_user_id) return;

  const now = Date.now();

  for (const entitlementId of event.entitlement_ids) {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q.eq("appUserId", event.app_user_id!).eq("entitlementId", entitlementId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isActive: true,
        expiresAtMs: event.expiration_at_ms,
        billingIssueDetectedAt: undefined,
        updatedAt: now,
      });
    }
  }
}

// Helper: transfer entitlements between users
async function transferEntitlements(
  ctx: MutationCtx,
  fromUserId: string,
  toUserId: string,
  entitlementIds?: string[],
): Promise<void> {
  const now = Date.now();

  // Get source user's entitlements
  const sourceEntitlements = await ctx.db
    .query("entitlements")
    .withIndex("by_app_user", (q) => q.eq("appUserId", fromUserId))
    .collect();

  for (const ent of sourceEntitlements) {
    if (!entitlementIds || entitlementIds.includes(ent.entitlementId)) {
      // Revoke from source
      await ctx.db.patch(ent._id, {
        isActive: false,
        updatedAt: now,
      });

      // Grant to destination
      const destExisting = await ctx.db
        .query("entitlements")
        .withIndex("by_app_user_entitlement", (q) =>
          q.eq("appUserId", toUserId).eq("entitlementId", ent.entitlementId),
        )
        .first();

      if (destExisting) {
        await ctx.db.patch(destExisting._id, {
          isActive: true,
          productId: ent.productId,
          expiresAtMs: ent.expiresAtMs,
          purchasedAtMs: ent.purchasedAtMs,
          store: ent.store,
          isSandbox: ent.isSandbox,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("entitlements", {
          appUserId: toUserId,
          entitlementId: ent.entitlementId,
          productId: ent.productId,
          isActive: true,
          expiresAtMs: ent.expiresAtMs,
          purchasedAtMs: ent.purchasedAtMs,
          store: ent.store,
          isSandbox: ent.isSandbox,
          updatedAt: now,
        });
      }
    }
  }
}

// Helper: upsert experiment enrollments from event
async function upsertExperiments(ctx: MutationCtx, event: EventPayload): Promise<void> {
  if (!event.experiments?.length || !event.app_user_id) return;

  const now = Date.now();

  for (const exp of event.experiments) {
    const existing = await ctx.db
      .query("experiments")
      .withIndex("by_app_user_experiment", (q) =>
        q.eq("appUserId", event.app_user_id!).eq("experimentId", exp.experiment_id),
      )
      .first();

    if (existing) {
      // Update if variant changed or enrollment time is newer
      if (
        existing.variant !== exp.experiment_variant ||
        (exp.enrolled_at_ms && exp.enrolled_at_ms > existing.enrolledAtMs)
      ) {
        await ctx.db.patch(existing._id, {
          variant: exp.experiment_variant,
          enrolledAtMs: exp.enrolled_at_ms ?? existing.enrolledAtMs,
          updatedAt: now,
        });
      }
    } else {
      await ctx.db.insert("experiments", {
        appUserId: event.app_user_id,
        experimentId: exp.experiment_id,
        variant: exp.experiment_variant,
        enrolledAtMs: exp.enrolled_at_ms ?? event.event_timestamp_ms,
        updatedAt: now,
      });
    }
  }
}

/**
 * INITIAL_PURCHASE: New subscription started
 * → Create customer, subscription, grant entitlements
 */
export const processInitialPurchase = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event);
    await grantEntitlements(ctx, event);
    await upsertExperiments(ctx, event);
    return null;
  },
});

/**
 * RENEWAL: Subscription renewed
 * → Update subscription, extend entitlements
 */
export const processRenewal = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event, {
      billingIssueDetectedAt: undefined,
      gracePeriodExpirationAtMs: undefined,
    });
    await extendEntitlements(ctx, event);
    await upsertExperiments(ctx, event);
    return null;
  },
});

/**
 * CANCELLATION: Subscription cancelled (will not renew)
 * → Update subscription with cancel_reason, KEEP entitlements active until EXPIRATION
 */
export const processCancellation = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event, {
      cancelReason: event.cancel_reason,
      autoRenewStatus: false,
    });
    // DO NOT revoke entitlements - they remain active until EXPIRATION
    return null;
  },
});

/**
 * UNCANCELLATION: Subscription re-enabled
 * → Clear cancel_reason, restore auto_renew
 */
export const processUncancellation = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event, {
      cancelReason: undefined,
      autoRenewStatus: true,
    });
    return null;
  },
});

/**
 * EXPIRATION: Subscription expired
 * → Update subscription, REVOKE entitlements
 */
export const processExpiration = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event, {
      expirationReason: event.expiration_reason,
    });
    if (event.app_user_id) {
      await revokeEntitlements(ctx, event.app_user_id, event.entitlement_ids);
    }
    return null;
  },
});

/**
 * BILLING_ISSUE: Payment failed, grace period started
 * → Update subscription with grace period, KEEP entitlements during grace period
 */
export const processBillingIssue = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event, {
      billingIssueDetectedAt: event.event_timestamp_ms,
      gracePeriodExpirationAtMs: event.grace_period_expiration_at_ms,
    });

    // Mark entitlements with billing issue but keep active
    if (event.entitlement_ids?.length && event.app_user_id) {
      const now = Date.now();
      for (const entitlementId of event.entitlement_ids) {
        const ent = await ctx.db
          .query("entitlements")
          .withIndex("by_app_user_entitlement", (q) =>
            q.eq("appUserId", event.app_user_id!).eq("entitlementId", entitlementId),
          )
          .first();
        if (ent) {
          await ctx.db.patch(ent._id, {
            billingIssueDetectedAt: event.event_timestamp_ms,
            updatedAt: now,
          });
        }
      }
    }
    return null;
  },
});

/**
 * SUBSCRIPTION_PAUSED: Subscription paused (Android only)
 * → Update subscription with auto_resume, DO NOT revoke entitlements
 */
export const processSubscriptionPaused = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event, {
      autoResumeAtMs: event.auto_resume_at_ms,
    });
    // DO NOT revoke entitlements - they remain active until EXPIRATION
    return null;
  },
});

/**
 * SUBSCRIPTION_EXTENDED: Subscription extended (e.g., customer support)
 * → Update subscription expiration, extend entitlements
 */
export const processSubscriptionExtended = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event);
    await extendEntitlements(ctx, event);
    return null;
  },
});

/**
 * PRODUCT_CHANGE: User changed subscription product
 * → Update subscription with new product, informational only
 */
export const processProductChange = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event);
    // Entitlements will be updated by subsequent RENEWAL event
    return null;
  },
});

/**
 * NON_RENEWING_PURCHASE: One-time purchase or consumable
 * → Create subscription record, grant entitlements
 */
export const processNonRenewingPurchase = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event);
    await grantEntitlements(ctx, event);
    await upsertExperiments(ctx, event);
    return null;
  },
});

/**
 * TRANSFER: Entitlements transferred between users
 * → Move entitlements from source to destination user
 *
 * Note: TRANSFER events use transferred_from[] and transferred_to[] arrays
 * instead of app_user_id. The webhook is only sent for destination users.
 * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 */
export const processTransfer = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;

    // TRANSFER events don't have app_user_id - they use transferred_from/transferred_to
    const sourceUsers = event.transferred_from ?? [];
    const destUsers = event.transferred_to ?? [];

    // For each source → destination pair, transfer all entitlements
    for (const sourceUserId of sourceUsers) {
      for (const destUserId of destUsers) {
        await transferEntitlements(ctx, sourceUserId, destUserId, event.entitlement_ids);
      }
    }

    return null;
  },
});

/**
 * TEMPORARY_ENTITLEMENT_GRANT: Store outage compensation
 * → Grant temporary entitlements
 */
export const processTemporaryEntitlementGrant = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await grantEntitlements(ctx, event);
    return null;
  },
});

/**
 * REFUND_REVERSED: Refund was undone
 * → Restore entitlements
 */
export const processRefundReversed = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event);
    await grantEntitlements(ctx, event);
    return null;
  },
});

/**
 * TEST: Test event issued through RevenueCat dashboard
 * → Log only, no processing needed
 */
export const processTest = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async () => {
    // Test events don't require any action
    return null;
  },
});

/**
 * INVOICE_ISSUANCE: Web Billing invoice created
 * → Log only, informational event
 */
export const processInvoiceIssuance = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    // Update customer last seen if available
    await upsertCustomer(ctx, event);
    return null;
  },
});

/**
 * VIRTUAL_CURRENCY_TRANSACTION: Virtual currency adjustment
 * → Log only, informational event
 */
export const processVirtualCurrencyTransaction = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    // Update customer last seen if available
    await upsertCustomer(ctx, event);
    return null;
  },
});

/**
 * EXPERIMENT_ENROLLMENT: Customer enrolled in experiment
 * → Track experiment enrollment
 */
export const processExperimentEnrollment = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);

    // EXPERIMENT_ENROLLMENT events have experiment data in top-level fields
    // Convert to experiments array format for upsertExperiments
    if (event.experiment_id && event.experiment_variant && event.app_user_id) {
      const experimentEvent = {
        ...event,
        experiments: [
          {
            experiment_id: event.experiment_id,
            experiment_variant: event.experiment_variant,
            enrolled_at_ms: event.experiment_enrolled_at_ms,
          },
        ],
      };
      await upsertExperiments(ctx, experimentEvent);
    }

    return null;
  },
});

/**
 * SUBSCRIBER_ALIAS: Customer aliased with another App User ID (DEPRECATED)
 * → Log only, aliases are now handled via the aliases array in other events
 * @deprecated This event type is deprecated per RevenueCat docs
 */
export const processSubscriberAlias = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    // Update customer if available (merges aliases)
    await upsertCustomer(ctx, event);
    return null;
  },
});

// Export event payload validator for webhooks.ts
export { eventPayloadValidator };
