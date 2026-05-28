import { v, ConvexError, type Infer } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import { internalMutation } from "./_generated/server.js";
import type { DataModel, Doc } from "./_generated/dataModel.js";
import {
  environmentValidator,
  ownershipTypeValidator,
  periodTypeValidator,
  storeValidator,
  subscriberAttributesValidator,
} from "./schema.js";

type MutationCtx = GenericMutationCtx<DataModel>;

const TRANSFER_SAFETY_CAP = 500;

const EVENT_TIMESTAMP_FUTURE_SKEW_MS = 5 * 60 * 1000;

const COUNTRY_CODE_LAG_TOLERANCE_MS = 30 * 1000;

function assertUnderCap(
  collected: { length: number },
  op: string,
  userId: string,
): void {
  if (collected.length > TRANSFER_SAFETY_CAP) {
    throw new ConvexError({
      code: "TRANSFER_SAFETY_CAP_EXCEEDED",
      message: `${op} aborted: user ${userId} has more than ${TRANSFER_SAFETY_CAP} records`,
    });
  }
}

function isAnonymousAppUserId(id: string): boolean {
  return id.startsWith("$RCAnonymousID:");
}

async function purgeAnonymousCustomerIfEmpty(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  if (!isAnonymousAppUserId(userId)) return;
  const now = Date.now();

  const ents = await ctx.db
    .query("entitlements")
    .withIndex("by_app_user", (q) => q.eq("appUserId", userId))
    .take(TRANSFER_SAFETY_CAP + 1);
  assertUnderCap(ents, "purgeAnonymousCustomerIfEmpty", userId);
  if (ents.some((e) => e.isActive)) return;

  const subs = await ctx.db
    .query("subscriptions")
    .withIndex("by_app_user", (q) => q.eq("appUserId", userId))
    .take(TRANSFER_SAFETY_CAP + 1);
  assertUnderCap(subs, "purgeAnonymousCustomerIfEmpty", userId);
  if (subs.some((s) => !s.expirationAtMs || s.expirationAtMs > now)) return;

  const exps = await ctx.db
    .query("experiments")
    .withIndex("by_app_user", (q) => q.eq("appUserId", userId))
    .take(TRANSFER_SAFETY_CAP + 1);
  assertUnderCap(exps, "purgeAnonymousCustomerIfEmpty", userId);

  const participants = await ctx.db
    .query("transferParticipants")
    .withIndex("by_app_user", (q) => q.eq("appUserId", userId))
    .take(TRANSFER_SAFETY_CAP + 1);
  assertUnderCap(participants, "purgeAnonymousCustomerIfEmpty", userId);

  for (const ent of ents) {
    await ctx.db.delete(ent._id);
  }
  for (const sub of subs) {
    await ctx.db.delete(sub._id);
  }
  for (const exp of exps) {
    await ctx.db.delete(exp._id);
  }
  for (const p of participants) {
    await ctx.db.delete(p._id);
  }
  const customer = await ctx.db
    .query("customers")
    .withIndex("by_app_user_id", (q) => q.eq("appUserId", userId))
    .first();
  if (customer) {
    await ctx.db.delete(customer._id);
  }
}

function isSourceMoreGenerous(
  sourceExpiresAtMs: number | undefined,
  destExpiresAtMs: number | undefined,
): boolean {
  if (sourceExpiresAtMs === undefined) return destExpiresAtMs !== undefined;
  return destExpiresAtMs !== undefined && sourceExpiresAtMs > destExpiresAtMs;
}

export function deriveWillRenew(sub: {
  periodType?: string;
  store?: string;
  expirationAtMs?: number;
  unsubscribeDetectedAt?: number;
  billingIssueDetectedAt?: number;
}): boolean {
  if (sub.expirationAtMs === undefined) return false;
  if (sub.periodType === "PREPAID") return false;
  if (sub.store === "PROMOTIONAL") return false;
  if (sub.unsubscribeDetectedAt !== undefined) return false;
  if (sub.billingIssueDetectedAt !== undefined) return false;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const eventPayloadValidator = v.object({
  type: v.string(),
  id: v.string(),
  app_id: v.optional(v.string()),
  app_user_id: v.optional(v.string()),
  original_app_user_id: v.optional(v.string()),
  aliases: v.optional(v.array(v.string())),
  event_timestamp_ms: v.number(),
  product_id: v.optional(v.string()),
  entitlement_id: v.optional(v.union(v.string(), v.null())),
  entitlement_ids: v.optional(v.array(v.string())),
  period_type: v.optional(periodTypeValidator),
  purchased_at_ms: v.optional(v.number()),
  expiration_at_ms: v.optional(v.number()),
  transaction_id: v.optional(v.string()),
  original_transaction_id: v.optional(v.string()),
  store: v.optional(storeValidator),
  environment: v.optional(environmentValidator),
  is_family_share: v.optional(v.boolean()),
  ownership_type: v.optional(ownershipTypeValidator),
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
  enrolled_at_ms: v.optional(v.number()),
  experiment_enrolled_at_ms: v.optional(v.number()),
  adjustments: v.optional(
    v.array(
      v.object({
        amount: v.number(),
        currency: v.object({
          code: v.string(),
          name: v.string(),
          description: v.optional(v.string()),
        }),
      }),
    ),
  ),
  virtual_currency_transaction_id: v.optional(v.string()),
  source: v.optional(v.string()),
  redeemed_from: v.optional(v.array(v.string())),
  redeemed_by: v.optional(v.array(v.string())),
  redemption_outcome: v.optional(v.string()),
  redemption_platform: v.optional(v.string()),
  metadata: v.optional(v.any()),
  product_display_name: v.optional(v.string()),
  purchase_environment: v.optional(environmentValidator),
  subscriber_attributes: v.optional(subscriberAttributesValidator),
  experiments: v.optional(
    v.array(
      v.object({
        experiment_id: v.string(),
        experiment_variant: v.string(),
        offering_id: v.optional(v.string()),
        enrolled_at_ms: v.optional(v.number()),
      }),
    ),
  ),
});

type EventPayload = Infer<typeof eventPayloadValidator>;

function getEntitlementIds(event: EventPayload): string[] | undefined {
  if (event.entitlement_ids?.length) return event.entitlement_ids;
  if (
    typeof event.entitlement_id === "string" &&
    event.entitlement_id.length > 0
  ) {
    return [event.entitlement_id];
  }
  return undefined;
}

async function upsertCustomer(
  ctx: MutationCtx,
  event: EventPayload,
): Promise<void> {
  if (!event.app_user_id) return;

  const appUserId = event.app_user_id;
  const now = Date.now();
  const eventTimestamp = Math.min(
    event.event_timestamp_ms,
    now + EVENT_TIMESTAMP_FUTURE_SKEW_MS,
  );
  const existing = await ctx.db
    .query("customers")
    .withIndex("by_app_user_id", (q) => q.eq("appUserId", appUserId))
    .first();

  const aliases = event.aliases ?? [];
  const originalAppUserId =
    event.original_app_user_id ?? existing?.originalAppUserId ?? appUserId;

  const mergedAttributes = existing?.attributes ?? {};
  if (event.subscriber_attributes) {
    for (const [key, attr] of Object.entries(event.subscriber_attributes)) {
      const existingAttr = mergedAttributes[key];
      if (
        !existingAttr ||
        attr.updated_at_ms > (existingAttr.updated_at_ms ?? 0)
      ) {
        mergedAttributes[key] = attr;
      }
    }
  }

  const inboundCountry = event.country_code;
  const referenceLastSeen = Math.min(existing?.lastSeenAt ?? 0, now);
  const stampedNewer =
    !existing?.lastSeenAt ||
    eventTimestamp >= referenceLastSeen - COUNTRY_CODE_LAG_TOLERANCE_MS;
  const countryCode =
    inboundCountry && stampedNewer ? inboundCountry : existing?.countryCode;

  if (existing) {
    const mergedAliases = [...new Set([...existing.aliases, ...aliases])];
    const safeExisting = Math.min(existing.lastSeenAt ?? 0, now);
    const lastSeenAt = Math.max(safeExisting, eventTimestamp);
    await ctx.db.patch(existing._id, {
      originalAppUserId,
      aliases: mergedAliases,
      attributes:
        Object.keys(mergedAttributes).length > 0 ? mergedAttributes : undefined,
      countryCode,
      lastSeenAt,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("customers", {
      appUserId,
      originalAppUserId,
      aliases,
      attributes:
        Object.keys(mergedAttributes).length > 0 ? mergedAttributes : undefined,
      countryCode,
      firstSeenAt: eventTimestamp,
      lastSeenAt: eventTimestamp,
      updatedAt: now,
    });
  }
}

type SubscriptionOverrides = Partial<{
  cancelReason: string | undefined;
  expirationReason: string | undefined;
  gracePeriodExpirationAtMs: number | undefined;
  billingIssueDetectedAt: number | undefined;
  autoResumeAtMs: number | undefined;
  autoRenewStatus: boolean | undefined;
  refundedAtMs: number | undefined;
  unsubscribeDetectedAt: number | undefined;
  newProductId: string | undefined;
  kind: "subscription" | "consumable";
}>;

async function upsertSubscription(
  ctx: MutationCtx,
  event: EventPayload,
  overrides?: SubscriptionOverrides,
): Promise<boolean> {
  const {
    app_user_id: appUserId,
    original_transaction_id: originalTransactionId,
    product_id: productId,
    store,
    environment,
    period_type: periodType,
  } = event;

  if (
    !appUserId ||
    !originalTransactionId ||
    !productId ||
    !store ||
    !environment ||
    !periodType
  ) {
    const missing = [
      !appUserId && "app_user_id",
      !originalTransactionId && "original_transaction_id",
      !productId && "product_id",
      !store && "store",
      !environment && "environment",
      !periodType && "period_type",
    ].filter(Boolean);
    console.warn(
      `[revenuecat] upsertSubscription skipped for event ${event.id} (${event.type}): missing ${missing.join(", ")}`,
    );
    return false;
  }

  const now = Date.now();
  let existing = await ctx.db
    .query("subscriptions")
    .withIndex("by_original_transaction", (q) =>
      q.eq("originalTransactionId", originalTransactionId),
    )
    .first();

  if (!existing) {
    existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_app_user_product", (q) =>
        q.eq("appUserId", appUserId).eq("productId", productId),
      )
      .first();
  }

  const effectiveBillingIssue =
    overrides && "billingIssueDetectedAt" in overrides
      ? overrides.billingIssueDetectedAt
      : existing?.billingIssueDetectedAt;
  const effectiveUnsubscribe =
    overrides && "unsubscribeDetectedAt" in overrides
      ? overrides.unsubscribeDetectedAt
      : existing?.unsubscribeDetectedAt;

  const entitlementIds = getEntitlementIds(event) ?? existing?.entitlementIds;
  const ownershipType = event.ownership_type ?? existing?.ownershipType;
  const isFamilyShareDerived =
    event.is_family_share ?? event.ownership_type === "FAMILY_SHARED";
  const kind: "subscription" | "consumable" =
    overrides?.kind ?? existing?.kind ?? "subscription";
  const subscriptionData = {
    appUserId,
    productId,
    kind,
    entitlementIds,
    store,
    environment,
    periodType,
    purchasedAtMs:
      event.purchased_at_ms ?? existing?.purchasedAtMs ?? Date.now(),
    expirationAtMs: event.expiration_at_ms ?? existing?.expirationAtMs,
    originalTransactionId,
    transactionId:
      event.transaction_id ?? existing?.transactionId ?? originalTransactionId,
    isFamilyShare:
      event.is_family_share !== undefined || event.ownership_type !== undefined
        ? isFamilyShareDerived
        : (existing?.isFamilyShare ?? false),
    ownershipType,
    isTrialConversion: event.is_trial_conversion ?? existing?.isTrialConversion,
    priceUsd: event.price ?? existing?.priceUsd,
    currency: event.currency ?? existing?.currency,
    priceInPurchasedCurrency:
      event.price_in_purchased_currency ?? existing?.priceInPurchasedCurrency,
    countryCode: event.country_code ?? existing?.countryCode,
    taxPercentage: event.tax_percentage ?? existing?.taxPercentage,
    commissionPercentage:
      event.commission_percentage ?? existing?.commissionPercentage,
    offerCode: event.offer_code ?? existing?.offerCode,
    presentedOfferingId:
      event.presented_offering_id ?? existing?.presentedOfferingId,
    renewalNumber: event.renewal_number ?? existing?.renewalNumber,
    newProductId: event.new_product_id ?? existing?.newProductId,
    originalPurchasedAtMs: existing?.originalPurchasedAtMs,
    ...overrides,
    updatedAt: now,
  };

  const derivedWillRenew = deriveWillRenew({
    periodType,
    store,
    expirationAtMs: event.expiration_at_ms,
    unsubscribeDetectedAt: effectiveUnsubscribe,
    billingIssueDetectedAt: effectiveBillingIssue,
  });
  const explicitOverride =
    overrides && "autoRenewStatus" in overrides
      ? overrides.autoRenewStatus
      : undefined;
  subscriptionData.autoRenewStatus =
    explicitOverride === false ? false : derivedWillRenew;

  if (existing) {
    await ctx.db.patch(existing._id, subscriptionData);
  } else {
    await ctx.db.insert("subscriptions", subscriptionData);
  }
  return true;
}

async function grantEntitlements(
  ctx: MutationCtx,
  event: EventPayload,
): Promise<void> {
  const entitlementIds = getEntitlementIds(event);
  if (!entitlementIds?.length || !event.app_user_id) return;

  const now = Date.now();
  const isSandbox = event.environment === "SANDBOX";

  for (const entitlementId of entitlementIds) {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q
          .eq("appUserId", event.app_user_id!)
          .eq("entitlementId", entitlementId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isActive: true,
        productId: event.product_id ?? existing.productId,
        expiresAtMs: event.expiration_at_ms ?? existing.expiresAtMs,
        purchasedAtMs: event.purchased_at_ms ?? existing.purchasedAtMs,
        store: event.store ?? existing.store,
        isSandbox,
        ownershipType: event.ownership_type ?? existing.ownershipType,
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
        ownershipType: event.ownership_type,
        updatedAt: now,
      });
    }
  }
}

function bestActiveGrantor(
  subs: Doc<"subscriptions">[],
  entitlementId: string,
  now: number,
  excludeOriginalTransactionId?: string,
): Doc<"subscriptions"> | null {
  let best: Doc<"subscriptions"> | null = null;
  for (const sub of subs) {
    if (sub.originalTransactionId === excludeOriginalTransactionId) continue;
    if (sub.refundedAtMs) continue;
    if (!sub.entitlementIds?.includes(entitlementId)) continue;
    if (sub.expirationAtMs !== undefined && sub.expirationAtMs <= now) continue;
    if (best === null) {
      best = sub;
    } else if (best.expirationAtMs !== undefined) {
      if (
        sub.expirationAtMs === undefined ||
        sub.expirationAtMs > best.expirationAtMs
      ) {
        best = sub;
      }
    }
  }
  return best;
}

async function revokeEntitlements(
  ctx: MutationCtx,
  appUserId: string,
  entitlementIds?: string[],
  excludeOriginalTransactionId?: string,
): Promise<void> {
  const now = Date.now();

  if (entitlementIds?.length) {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
      .take(TRANSFER_SAFETY_CAP + 1);
    assertUnderCap(subs, "revokeEntitlements", appUserId);
    for (const entitlementId of entitlementIds) {
      const ent = await ctx.db
        .query("entitlements")
        .withIndex("by_app_user_entitlement", (q) =>
          q.eq("appUserId", appUserId).eq("entitlementId", entitlementId),
        )
        .first();
      if (!ent || !ent.isActive) continue;
      const grantor = bestActiveGrantor(
        subs,
        entitlementId,
        now,
        excludeOriginalTransactionId,
      );
      if (grantor) {
        await ctx.db.patch(ent._id, {
          isActive: true,
          expiresAtMs: grantor.expirationAtMs,
          productId: grantor.productId,
          store: grantor.store,
          ownershipType: grantor.ownershipType ?? ent.ownershipType,
          billingIssueDetectedAt: undefined,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(ent._id, {
          isActive: false,
          billingIssueDetectedAt: undefined,
          updatedAt: now,
        });
      }
    }
    return;
  }

  const entitlements = await ctx.db
    .query("entitlements")
    .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
    .take(TRANSFER_SAFETY_CAP + 1);
  assertUnderCap(entitlements, "revokeEntitlements", appUserId);
  for (const ent of entitlements) {
    if (ent.isActive) {
      await ctx.db.patch(ent._id, {
        isActive: false,
        billingIssueDetectedAt: undefined,
        updatedAt: now,
      });
    }
  }
}

async function extendEntitlements(
  ctx: MutationCtx,
  event: EventPayload,
): Promise<void> {
  const entitlementIds = getEntitlementIds(event);
  if (!entitlementIds?.length || !event.app_user_id) return;

  const now = Date.now();

  for (const entitlementId of entitlementIds) {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q
          .eq("appUserId", event.app_user_id!)
          .eq("entitlementId", entitlementId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isActive: true,
        expiresAtMs: event.expiration_at_ms ?? existing.expiresAtMs,
        productId: event.product_id ?? existing.productId,
        ownershipType: event.ownership_type ?? existing.ownershipType,
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
        isSandbox: event.environment === "SANDBOX",
        ownershipType: event.ownership_type,
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
    .take(TRANSFER_SAFETY_CAP + 1);
  assertUnderCap(sourceEntitlements, "transferEntitlements", fromUserId);

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
        const sourceIsNewer = isSourceMoreGenerous(
          ent.expiresAtMs,
          destExisting.expiresAtMs,
        );
        await ctx.db.patch(destExisting._id, {
          isActive: sourceIsNewer ? ent.isActive : destExisting.isActive,
          productId: sourceIsNewer ? ent.productId : destExisting.productId,
          expiresAtMs: sourceIsNewer
            ? ent.expiresAtMs
            : destExisting.expiresAtMs,
          purchasedAtMs: sourceIsNewer
            ? ent.purchasedAtMs
            : destExisting.purchasedAtMs,
          store: sourceIsNewer ? ent.store : destExisting.store,
          isSandbox: sourceIsNewer ? ent.isSandbox : destExisting.isSandbox,
          ownershipType: ent.ownershipType ?? destExisting.ownershipType,
          ...(ent.billingIssueDetectedAt !== undefined
            ? { billingIssueDetectedAt: ent.billingIssueDetectedAt }
            : {}),
          ...(ent.unsubscribeDetectedAt !== undefined
            ? { unsubscribeDetectedAt: ent.unsubscribeDetectedAt }
            : {}),
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("entitlements", {
          appUserId: toUserId,
          entitlementId: ent.entitlementId,
          productId: ent.productId,
          isActive: ent.isActive,
          expiresAtMs: ent.expiresAtMs,
          purchasedAtMs: ent.purchasedAtMs,
          store: ent.store,
          isSandbox: ent.isSandbox,
          ownershipType: ent.ownershipType,
          billingIssueDetectedAt: ent.billingIssueDetectedAt,
          unsubscribeDetectedAt: ent.unsubscribeDetectedAt,
          updatedAt: now,
        });
      }
    }
  }
}

async function recordEvent(
  ctx: MutationCtx,
  event: EventPayload,
): Promise<void> {
  await upsertCustomer(ctx, event);
  await upsertExperiments(ctx, event);
}

async function upsertExperiments(
  ctx: MutationCtx,
  event: EventPayload,
): Promise<void> {
  if (!event.experiments?.length || !event.app_user_id) return;

  const now = Date.now();

  for (const exp of event.experiments) {
    const existing = await ctx.db
      .query("experiments")
      .withIndex("by_app_user_experiment", (q) =>
        q
          .eq("appUserId", event.app_user_id!)
          .eq("experimentId", exp.experiment_id),
      )
      .first();

    if (existing) {
      if (
        existing.variant !== exp.experiment_variant ||
        (exp.enrolled_at_ms && exp.enrolled_at_ms > existing.enrolledAtMs)
      ) {
        await ctx.db.patch(existing._id, {
          variant: exp.experiment_variant,
          offeringId: exp.offering_id,
          enrolledAtMs: exp.enrolled_at_ms ?? existing.enrolledAtMs,
          updatedAt: now,
        });
      }
    } else {
      await ctx.db.insert("experiments", {
        appUserId: event.app_user_id,
        experimentId: exp.experiment_id,
        variant: exp.experiment_variant,
        offeringId: exp.offering_id,
        enrolledAtMs: exp.enrolled_at_ms ?? event.event_timestamp_ms,
        updatedAt: now,
      });
    }
  }
}

export const processInitialPurchase = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event);
    await grantEntitlements(ctx, event);
    return null;
  },
});

export const processRenewal = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event, {
      cancelReason: undefined,
      autoRenewStatus: true,
      billingIssueDetectedAt: undefined,
      gracePeriodExpirationAtMs: undefined,
      autoResumeAtMs: undefined,
      expirationReason: undefined,
      newProductId: undefined,
      unsubscribeDetectedAt: undefined,
    });
    await extendEntitlements(ctx, event);
    return null;
  },
});

export const processCancellation = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    const isRefund =
      event.cancel_reason === "CUSTOMER_SUPPORT" ||
      (typeof event.price === "number" && event.price < 0);

    const overrides: SubscriptionOverrides = {
      cancelReason: event.cancel_reason,
    };
    if (!isRefund) {
      overrides.autoRenewStatus = false;
    }
    if (isRefund) {
      overrides.refundedAtMs = event.event_timestamp_ms;
    }
    if (event.cancel_reason === "UNSUBSCRIBE") {
      overrides.unsubscribeDetectedAt = event.event_timestamp_ms;
    }
    if (event.cancel_reason === "BILLING_ERROR") {
      overrides.billingIssueDetectedAt = event.event_timestamp_ms;
    }
    await upsertSubscription(ctx, event, overrides);

    const entitlementIds = getEntitlementIds(event);
    if (isRefund && event.app_user_id && entitlementIds?.length) {
      await revokeEntitlements(
        ctx,
        event.app_user_id,
        entitlementIds,
        event.original_transaction_id,
      );
    }
    return null;
  },
});

export const processUncancellation = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event, {
      cancelReason: undefined,
      autoRenewStatus: true,
      unsubscribeDetectedAt: undefined,
    });
    return null;
  },
});

export const processExpiration = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event, {
      expirationReason: event.expiration_reason,
      autoResumeAtMs: undefined,
      gracePeriodExpirationAtMs: undefined,
      autoRenewStatus: false,
    });
    const entitlementIds = getEntitlementIds(event);
    if (event.app_user_id && entitlementIds?.length) {
      await revokeEntitlements(
        ctx,
        event.app_user_id,
        entitlementIds,
        event.original_transaction_id,
      );
    }
    return null;
  },
});

export const processBillingIssue = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event, {
      billingIssueDetectedAt: event.event_timestamp_ms,
      gracePeriodExpirationAtMs: event.grace_period_expiration_at_ms,
      autoRenewStatus: false,
    });

    const billingEntitlementIds = getEntitlementIds(event);
    if (billingEntitlementIds?.length && event.app_user_id) {
      const now = Date.now();
      const graceEnd = event.grace_period_expiration_at_ms;
      for (const entitlementId of billingEntitlementIds) {
        const ent = await ctx.db
          .query("entitlements")
          .withIndex("by_app_user_entitlement", (q) =>
            q
              .eq("appUserId", event.app_user_id!)
              .eq("entitlementId", entitlementId),
          )
          .first();
        if (ent) {
          const extendedExpiry =
            graceEnd !== undefined &&
            ent.expiresAtMs !== undefined &&
            graceEnd > ent.expiresAtMs
              ? graceEnd
              : ent.expiresAtMs;
          await ctx.db.patch(ent._id, {
            billingIssueDetectedAt: event.event_timestamp_ms,
            expiresAtMs: extendedExpiry,
            updatedAt: now,
          });
        }
      }
    }
    return null;
  },
});

export const processSubscriptionPaused = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event, {
      autoResumeAtMs: event.auto_resume_at_ms,
    });
    return null;
  },
});

export const processSubscriptionExtended = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event);
    await extendEntitlements(ctx, event);
    return null;
  },
});

export const processProductChange = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event);
    await extendEntitlements(ctx, event);
    return null;
  },
});

export const processNonRenewingPurchase = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event, { kind: "consumable" });
    await grantEntitlements(ctx, event);
    return null;
  },
});

async function aliasEntitlements(
  ctx: MutationCtx,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  const now = Date.now();

  const entitlements = await ctx.db
    .query("entitlements")
    .withIndex("by_app_user", (q) => q.eq("appUserId", fromUserId))
    .take(TRANSFER_SAFETY_CAP + 1);
  assertUnderCap(entitlements, "aliasEntitlements", fromUserId);

  for (const ent of entitlements) {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q.eq("appUserId", toUserId).eq("entitlementId", ent.entitlementId),
      )
      .first();

    if (existing) {
      const sourceIsNewer = isSourceMoreGenerous(
        ent.expiresAtMs,
        existing.expiresAtMs,
      );
      if (sourceIsNewer) {
        await ctx.db.patch(existing._id, {
          isActive: ent.isActive,
          productId: ent.productId,
          expiresAtMs: ent.expiresAtMs,
          purchasedAtMs: ent.purchasedAtMs,
          store: ent.store,
          isSandbox: ent.isSandbox,
          ...(ent.billingIssueDetectedAt !== undefined
            ? { billingIssueDetectedAt: ent.billingIssueDetectedAt }
            : {}),
          ...(ent.unsubscribeDetectedAt !== undefined
            ? { unsubscribeDetectedAt: ent.unsubscribeDetectedAt }
            : {}),
          updatedAt: now,
        });
      }
      await ctx.db.delete(ent._id);
    } else {
      await ctx.db.patch(ent._id, { appUserId: toUserId, updatedAt: now });
    }
  }
}

async function transferSubscriptions(
  ctx: MutationCtx,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  const now = Date.now();

  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_app_user", (q) => q.eq("appUserId", fromUserId))
    .take(TRANSFER_SAFETY_CAP + 1);
  assertUnderCap(subscriptions, "transferSubscriptions", fromUserId);

  for (const sub of subscriptions) {
    const destExisting = await ctx.db
      .query("subscriptions")
      .withIndex("by_original_transaction", (q) =>
        q.eq("originalTransactionId", sub.originalTransactionId),
      )
      .filter((q) => q.eq(q.field("appUserId"), toUserId))
      .first();

    if (destExisting) {
      if (sub.updatedAt > destExisting.updatedAt) {
        await ctx.db.delete(destExisting._id);
        await ctx.db.patch(sub._id, {
          appUserId: toUserId,
          updatedAt: now,
        });
      } else {
        await ctx.db.delete(sub._id);
      }
    } else {
      await ctx.db.patch(sub._id, {
        appUserId: toUserId,
        updatedAt: now,
      });
    }
  }
}

async function aliasExperiments(
  ctx: MutationCtx,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  const now = Date.now();

  const experiments = await ctx.db
    .query("experiments")
    .withIndex("by_app_user", (q) => q.eq("appUserId", fromUserId))
    .take(TRANSFER_SAFETY_CAP + 1);
  assertUnderCap(experiments, "aliasExperiments", fromUserId);

  for (const exp of experiments) {
    const existing = await ctx.db
      .query("experiments")
      .withIndex("by_app_user_experiment", (q) =>
        q.eq("appUserId", toUserId).eq("experimentId", exp.experimentId),
      )
      .first();

    if (existing) {
      if (exp.enrolledAtMs > existing.enrolledAtMs) {
        await ctx.db.patch(existing._id, {
          variant: exp.variant,
          offeringId: exp.offeringId,
          enrolledAtMs: exp.enrolledAtMs,
          updatedAt: now,
        });
      }
      await ctx.db.delete(exp._id);
    } else {
      await ctx.db.patch(exp._id, { appUserId: toUserId, updatedAt: now });
    }
  }
}

async function recordTransfer(
  ctx: MutationCtx,
  eventId: string,
  from: string[],
  to: string[],
  entitlementIds: string[] | undefined,
  timestampMs: number,
): Promise<void> {
  if (from.length === 0 && to.length === 0) return;
  const existing = await ctx.db
    .query("transfers")
    .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
    .first();
  if (existing) return;
  const transferId = await ctx.db.insert("transfers", {
    eventId,
    transferredFrom: from,
    transferredTo: to,
    entitlementIds,
    timestamp: timestampMs,
  });
  for (const userId of from) {
    await ctx.db.insert("transferParticipants", {
      transferId,
      appUserId: userId,
      role: "from",
    });
  }
  for (const userId of to) {
    await ctx.db.insert("transferParticipants", {
      transferId,
      appUserId: userId,
      role: "to",
    });
  }
}

export const processTransfer = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    const entitlementIds = getEntitlementIds(event);

    const sourceUsers = event.transferred_from ?? [];
    const destUsers = event.transferred_to ?? [];

    for (const userId of [...sourceUsers, ...destUsers]) {
      await upsertCustomer(ctx, {
        ...event,
        app_user_id: userId,
        aliases: undefined,
      });
    }

    for (const sourceUserId of sourceUsers) {
      for (const destUserId of destUsers) {
        await transferEntitlements(
          ctx,
          sourceUserId,
          destUserId,
          entitlementIds,
        );
        await transferSubscriptions(ctx, sourceUserId, destUserId);
      }
    }

    await recordTransfer(
      ctx,
      event.id,
      sourceUsers,
      destUsers,
      entitlementIds,
      event.event_timestamp_ms,
    );

    for (const sourceUserId of sourceUsers) {
      await purgeAnonymousCustomerIfEmpty(ctx, sourceUserId);
    }

    return null;
  },
});

export const processTemporaryEntitlementGrant = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await grantEntitlements(ctx, event);
    return null;
  },
});

export const processRefund = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event, {
      refundedAtMs: event.event_timestamp_ms,
    });
    const entitlementIds = getEntitlementIds(event);
    if (event.app_user_id && entitlementIds?.length) {
      await revokeEntitlements(
        ctx,
        event.app_user_id,
        entitlementIds,
        event.original_transaction_id,
      );
    }
    return null;
  },
});

export const processRefundReversed = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    await upsertSubscription(ctx, event, {
      refundedAtMs: undefined,
      cancelReason: undefined,
      autoRenewStatus: true,
    });
    await grantEntitlements(ctx, event);
    return null;
  },
});

export const processPurchaseRedeemed = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);
    const redeemers = event.redeemed_by ?? [];
    for (const redeemerId of redeemers) {
      await upsertCustomer(ctx, {
        ...event,
        app_user_id: redeemerId,
        aliases: undefined,
      });
    }
    if (event.redemption_outcome === "transfer") return null;
    if (event.redemption_outcome === "alias") {
      for (const fromUserId of event.redeemed_from ?? []) {
        for (const toUserId of redeemers) {
          if (fromUserId === toUserId) continue;
          await aliasEntitlements(ctx, fromUserId, toUserId);
          await transferSubscriptions(ctx, fromUserId, toUserId);
          await aliasExperiments(ctx, fromUserId, toUserId);
          await purgeAnonymousCustomerIfEmpty(ctx, fromUserId);
        }
      }
      await recordTransfer(
        ctx,
        event.id,
        event.redeemed_from ?? [],
        redeemers,
        getEntitlementIds(event),
        event.event_timestamp_ms,
      );
    }
    return null;
  },
});

export const processTest = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async () => {
    return null;
  },
});

export const processInvoiceIssuance = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);

    if (event.id && event.app_user_id && event.environment) {
      const existing = await ctx.db
        .query("invoices")
        .withIndex("by_invoice_id", (q) => q.eq("invoiceId", event.id))
        .first();

      if (!existing) {
        await ctx.db.insert("invoices", {
          invoiceId: event.id,
          appUserId: event.app_user_id,
          productId: event.product_id,
          store: event.store,
          environment: event.environment,
          priceUsd: event.price,
          currency: event.currency,
          priceInPurchasedCurrency: event.price_in_purchased_currency,
          issuedAt: event.event_timestamp_ms,
        });
      }
    } else {
      console.warn(
        `[revenuecat] processInvoiceIssuance skipped invoice for event ${event.id}: missing app_user_id or environment`,
      );
    }

    return null;
  },
});

export const processVirtualCurrencyTransaction = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);

    const environment = event.environment ?? event.purchase_environment;
    if (!event.adjustments?.length || !event.app_user_id || !environment) {
      return null;
    }

    const transactionId = event.virtual_currency_transaction_id ?? event.id;
    const now = Date.now();

    const lookups = await Promise.all(
      event.adjustments.map(async (adjustment) => {
        const currencyCode = adjustment.currency.code;
        const [existingTx, existingBalance] = await Promise.all([
          ctx.db
            .query("virtualCurrencyTransactions")
            .withIndex("by_transaction_id", (q) =>
              q.eq("transactionId", transactionId),
            )
            .filter((q) => q.eq(q.field("currencyCode"), currencyCode))
            .first(),
          ctx.db
            .query("virtualCurrencyBalances")
            .withIndex("by_app_user_currency", (q) =>
              q
                .eq("appUserId", event.app_user_id!)
                .eq("currencyCode", currencyCode),
            )
            .first(),
        ]);
        return { adjustment, existingTx, existingBalance };
      }),
    );

    for (const { adjustment, existingTx, existingBalance } of lookups) {
      const currencyCode = adjustment.currency.code;
      const currencyName = adjustment.currency.name;
      const amount = adjustment.amount;

      if (existingTx) continue;
      await ctx.db.insert("virtualCurrencyTransactions", {
        transactionId,
        appUserId: event.app_user_id,
        currencyCode,
        amount,
        source: event.source,
        productId: event.product_id,
        environment,
        timestamp: event.event_timestamp_ms,
      });

      if (existingBalance) {
        await ctx.db.patch(existingBalance._id, {
          balance: Math.max(0, existingBalance.balance + amount),
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("virtualCurrencyBalances", {
          appUserId: event.app_user_id,
          currencyCode,
          currencyName,
          balance: Math.max(0, amount),
          updatedAt: now,
        });
      }
    }

    return null;
  },
});

export const processExperimentEnrollment = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);

    if (event.experiment_id && event.experiment_variant && event.app_user_id) {
      const experimentEvent = {
        ...event,
        experiments: [
          {
            experiment_id: event.experiment_id,
            experiment_variant: event.experiment_variant,
            offering_id: event.offering_id,
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
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    await recordEvent(ctx, event);

    const fromUserId = event.original_app_user_id;
    const toUserId = event.app_user_id;
    if (fromUserId && toUserId && fromUserId !== toUserId) {
      await aliasEntitlements(ctx, fromUserId, toUserId);
      await transferSubscriptions(ctx, fromUserId, toUserId);
      await aliasExperiments(ctx, fromUserId, toUserId);
      await purgeAnonymousCustomerIfEmpty(ctx, fromUserId);
    }

    return null;
  },
});
