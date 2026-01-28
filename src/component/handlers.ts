import { v, type Infer } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import { internalMutation } from "./_generated/server.js";
import type { DataModel } from "./_generated/dataModel.js";
import {
  environmentValidator,
  periodTypeValidator,
  storeValidator,
  subscriberAttributesValidator,
} from "./schema.js";

type MutationCtx = GenericMutationCtx<DataModel>;

const eventPayloadValidator = v.object({
  type: v.string(),
  id: v.string(),
  app_id: v.optional(v.string()),
  app_user_id: v.optional(v.string()),
  original_app_user_id: v.optional(v.string()),
  aliases: v.optional(v.array(v.string())),
  event_timestamp_ms: v.number(),
  product_id: v.optional(v.string()),
  entitlement_ids: v.optional(v.array(v.string())),
  period_type: v.optional(periodTypeValidator),
  purchased_at_ms: v.optional(v.number()),
  expiration_at_ms: v.optional(v.number()),
  transaction_id: v.optional(v.string()),
  original_transaction_id: v.optional(v.string()),
  store: v.optional(storeValidator),
  environment: v.optional(environmentValidator),
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
  transferred_from: v.optional(v.array(v.string())),
  transferred_to: v.optional(v.array(v.string())),
  experiment_id: v.optional(v.string()),
  experiment_variant: v.optional(v.string()),
  offering_id: v.optional(v.string()),
  experiment_enrolled_at_ms: v.optional(v.number()),
  adjustments: v.optional(v.array(v.any())),
  virtual_currency_transaction_id: v.optional(v.string()),
  source: v.optional(v.string()),
  invoice_id: v.optional(v.string()),
  metadata: v.optional(v.any()),
  product_display_name: v.optional(v.string()),
  purchase_environment: v.optional(environmentValidator),
  items: v.optional(v.array(v.any())),
  subscriber_attributes: v.optional(subscriberAttributesValidator),
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

type EventPayload = Infer<typeof eventPayloadValidator>;

async function upsertCustomer(ctx: MutationCtx, event: EventPayload): Promise<void> {
  if (!event.app_user_id) return;

  const appUserId = event.app_user_id;
  const now = Date.now();
  const existing = await ctx.db
    .query("customers")
    .withIndex("by_app_user_id", (q) => q.eq("appUserId", appUserId))
    .first();

  const aliases = event.aliases ?? [];
  const originalAppUserId = event.original_app_user_id ?? appUserId;

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
  if (!event.app_user_id || !event.original_transaction_id || !event.product_id) return;
  if (!event.store || !event.environment || !event.period_type) return;

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
          billingIssueDetectedAt: undefined,
          updatedAt: now,
        });
      }
    }
  }
}

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

async function transferEntitlements(
  ctx: MutationCtx,
  fromUserId: string,
  toUserId: string,
  entitlementIds?: string[],
): Promise<void> {
  const now = Date.now();

  const sourceEntitlements = await ctx.db
    .query("entitlements")
    .withIndex("by_app_user", (q) => q.eq("appUserId", fromUserId))
    .collect();

  for (const ent of sourceEntitlements) {
    if (!entitlementIds || entitlementIds.includes(ent.entitlementId)) {
      await ctx.db.patch(ent._id, {
        isActive: false,
        updatedAt: now,
      });

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
    return null;
  },
});

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

export const processSubscriptionPaused = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event, {
      autoResumeAtMs: event.auto_resume_at_ms,
    });
    return null;
  },
});

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

export const processProductChange = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    await upsertSubscription(ctx, event);
    return null;
  },
});

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

export const processTransfer = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;

    const sourceUsers = event.transferred_from ?? [];
    const destUsers = event.transferred_to ?? [];

    for (const sourceUserId of sourceUsers) {
      for (const destUserId of destUsers) {
        await transferEntitlements(ctx, sourceUserId, destUserId, event.entitlement_ids);
      }
    }

    return null;
  },
});

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

export const processTest = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async () => {
    return null;
  },
});

export const processInvoiceIssuance = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    return null;
  },
});

export const processVirtualCurrencyTransaction = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    return null;
  },
});

export const processExperimentEnrollment = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);

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

export const processSubscriberAlias = internalMutation({
  args: { event: eventPayloadValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await upsertCustomer(ctx, event);
    return null;
  },
});

export { eventPayloadValidator };
