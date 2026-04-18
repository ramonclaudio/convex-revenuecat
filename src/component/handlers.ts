import { v, ConvexError, type Infer } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import { internalMutation } from "./_generated/server.js";
import type { DataModel } from "./_generated/dataModel.js";
import {
  environmentValidator,
  ownershipTypeValidator,
  periodTypeValidator,
  storeValidator,
  subscriberAttributesValidator,
} from "./schema.js";

type MutationCtx = GenericMutationCtx<DataModel>;

// Safety cap for transfer/alias operations that collect all records for a user.
// Convex mutations have a per-transaction write budget (~8k docs). A user with
// more entitlements/subscriptions than this is pathological; fail loudly so it
// surfaces in logs rather than corrupting state partway through.
const TRANSFER_SAFETY_CAP = 500;

function assertUnderCap(collected: { length: number }, op: string, userId: string): void {
  if (collected.length > TRANSFER_SAFETY_CAP) {
    throw new ConvexError({
      code: "TRANSFER_SAFETY_CAP_EXCEEDED",
      message: `${op} aborted: user ${userId} has more than ${TRANSFER_SAFETY_CAP} records`,
    });
  }
}

// Anonymous app-user IDs have the `$RCAnonymousID:` prefix. RC's iOS/Android
// SDKs clear cache for these IDs immediately after logIn succeeds (see
// `DeviceCache.clearCaches`), treating them as dead. Mirror that: after a
// TRANSFER / SUBSCRIBER_ALIAS completes, drop the source row if it's anonymous
// and no data remains on it.
function isAnonymousAppUserId(id: string): boolean {
  return id.startsWith("$RCAnonymousID:");
}

async function purgeAnonymousCustomerIfEmpty(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  if (!isAnonymousAppUserId(userId)) return;
  const now = Date.now();

  // `transferEntitlements` deactivates (not deletes) source rows for audit.
  // For anonymous IDs that audit trail is worthless (the ID is dead after
  // merge). A partial TRANSFER would leave some entitlements ACTIVE on the
  // source; in that case bail out.
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

  // No live data on this anonymous user: drop all orphan audit rows and the
  // customer record. Mirror iOS/Android `DeviceCache.clearCaches` semantics.
  for (const ent of ents) {
    await ctx.db.delete(ent._id);
  }
  for (const sub of subs) {
    await ctx.db.delete(sub._id);
  }
  for (const exp of exps) {
    await ctx.db.delete(exp._id);
  }
  const customer = await ctx.db
    .query("customers")
    .withIndex("by_app_user_id", (q) => q.eq("appUserId", userId))
    .first();
  if (customer) {
    await ctx.db.delete(customer._id);
  }
}

// Returns true iff `source` covers strictly more time than `dest`. Lifetime
// entitlements (undefined expiresAtMs) beat any finite expiry; among finites,
// later wins. Used by `transferEntitlements` and `aliasEntitlements` to pick
// which side's state survives when both users own the same entitlement ID.
function isSourceMoreGenerous(
  sourceExpiresAtMs: number | undefined,
  destExpiresAtMs: number | undefined,
): boolean {
  if (sourceExpiresAtMs === undefined) {
    // Source is lifetime. Wins unless dest is also lifetime (tie, dest keeps).
    return destExpiresAtMs !== undefined;
  }
  // Source is finite. Can only win if dest is also finite and source is later;
  // a lifetime dest always keeps (lifetime > any finite).
  return destExpiresAtMs !== undefined && sourceExpiresAtMs > destExpiresAtMs;
}

// iOS `EntitlementInfo.willRenew` / Android `EntitlementInfoHelper.getWillRenew`:
// will this sub auto-charge at next period boundary? Lifetime, prepaid,
// promotional, unsubscribed, and billing-issue subs all return false. We store
// the derived value as `autoRenewStatus` so a single query answers "will renew".
// Raw user preference (separate concept in iOS) isn't exposed by webhook events,
// so we can't model it distinctly without conflating signals.
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

// Kept for the `EventPayload` TypeScript type only. Handler args use
// `v.any()` at runtime because Convex's `v.object` rejects unknown fields,
// and RevenueCat explicitly reserves the right to add new fields within an
// API version: "You should be able to handle webhooks that include
// additional fields ... We may add new fields or event types in the future
// without changing the API version."
// Strict validation here would cause new fields to fail validation, RC to
// retry 5x, and eventually drop the event.
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
  // Deprecated: use entitlement_ids instead
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
  // PURCHASED = direct purchase, FAMILY_SHARED = received via Family Sharing
  ownership_type: v.optional(ownershipTypeValidator),
  price: v.optional(v.number()),
  price_in_purchased_currency: v.optional(v.number()),
  currency: v.optional(v.string()),
  country_code: v.optional(v.string()),
  tax_percentage: v.optional(v.number()),
  // Deprecated: use tax_percentage and commission_percentage instead
  takehome_percentage: v.optional(v.number()),
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
  // EXPERIMENT_ENROLLMENT event fields
  experiment_id: v.optional(v.string()),
  experiment_variant: v.optional(v.string()),
  offering_id: v.optional(v.string()),
  enrolled_at_ms: v.optional(v.number()),
  // Legacy field name (some events use this instead of enrolled_at_ms)
  experiment_enrolled_at_ms: v.optional(v.number()),
  // Virtual currency adjustments (VIRTUAL_CURRENCY_TRANSACTION events)
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
  // VIRTUAL_CURRENCY_TRANSACTION source: in_app_purchase | admin_api
  source: v.optional(v.string()),
  // Arbitrary user metadata - intentionally untyped
  metadata: v.optional(v.any()),
  product_display_name: v.optional(v.string()),
  purchase_environment: v.optional(environmentValidator),
  // Undocumented field - kept as any for forward compatibility
  items: v.optional(v.array(v.any())),
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

// RC's legacy API contract includes a singular `entitlement_id` field that
// predates the `entitlement_ids` array. Some long-running projects still emit
// the singular form. Normalize so downstream handlers only need the array.
function getEntitlementIds(event: EventPayload): string[] | undefined {
  if (event.entitlement_ids?.length) return event.entitlement_ids;
  if (typeof event.entitlement_id === "string" && event.entitlement_id.length > 0) {
    return [event.entitlement_id];
  }
  return undefined;
}

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

  // Webhook payload arrives with `$email`, etc. already encoded to
  // `__dollar__email` by the client SDK's `transformPayload`. We keep the
  // encoded form in storage because Convex rejects `$` at every nesting
  // level (not just top-level fields). Consumers decode on READ via the
  // `decodeSubscriberAttributes` helper exported from the client SDK.
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
    refundedAtMs: number | undefined;
    unsubscribeDetectedAt: number | undefined;
  }>,
): Promise<boolean> {
  const {
    app_user_id: appUserId,
    original_transaction_id: originalTransactionId,
    product_id: productId,
    store,
    environment,
    period_type: periodType,
  } = event;

  if (!appUserId || !originalTransactionId || !productId || !store || !environment || !periodType) {
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

  // Fallback: match sync-created records by (appUserId, productId)
  if (!existing) {
    existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
      .filter((q) => q.eq(q.field("productId"), productId))
      .first();
  }

  // Merge effective field values (event + overrides + existing) once so the
  // derived `autoRenewStatus` reads from the final state. Without this merge,
  // the clears in `processRenewal` (billingIssueDetectedAt: undefined) wouldn't
  // be reflected in the derived willRenew computed on the same write.
  const effectiveBillingIssue =
    overrides && "billingIssueDetectedAt" in overrides
      ? overrides.billingIssueDetectedAt
      : existing?.billingIssueDetectedAt;
  const effectiveUnsubscribe =
    overrides && "unsubscribeDetectedAt" in overrides
      ? overrides.unsubscribeDetectedAt
      : existing?.unsubscribeDetectedAt;

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
    // Derive from ownership_type when is_family_share is absent so the two
    // fields stay consistent. Explicit false wins if the event sets it.
    isFamilyShare:
      event.is_family_share ?? event.ownership_type === "FAMILY_SHARED",
    ownershipType: event.ownership_type,
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

  // Compute derived `autoRenewStatus` (willRenew) after overrides land so
  // clears in this event propagate. Explicit `autoRenewStatus` in overrides
  // (e.g. CANCELLATION non-refund) wins when false; true is AND-ed against
  // the derived check so PREPAID/PROMOTIONAL/billing-issue can't force true.
  const derivedWillRenew = deriveWillRenew({
    periodType,
    store,
    expirationAtMs: event.expiration_at_ms,
    unsubscribeDetectedAt: effectiveUnsubscribe,
    billingIssueDetectedAt: effectiveBillingIssue,
  });
  const explicitOverride =
    overrides && "autoRenewStatus" in overrides ? overrides.autoRenewStatus : undefined;
  subscriptionData.autoRenewStatus =
    explicitOverride === false ? false : derivedWillRenew;

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...subscriptionData,
      // Fix originalTransactionId on sync-created records
      originalTransactionId: originalTransactionId,
    });
  } else {
    await ctx.db.insert("subscriptions", subscriptionData);
  }
  return true;
}

async function grantEntitlements(ctx: MutationCtx, event: EventPayload): Promise<void> {
  const entitlementIds = getEntitlementIds(event);
  if (!entitlementIds?.length || !event.app_user_id) return;

  const now = Date.now();
  const isSandbox = event.environment === "SANDBOX";

  for (const entitlementId of entitlementIds) {
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
        // Guard against a malformed event that drops `expiration_at_ms`:
        // Convex patch with undefined REMOVES the field, which our gate
        // reads as lifetime. Fall back to the prior expiry so a partial
        // payload can't silently grant infinite access.
        expiresAtMs: event.expiration_at_ms ?? existing.expiresAtMs,
        purchasedAtMs: event.purchased_at_ms,
        store: event.store,
        isSandbox,
        ownershipType: event.ownership_type,
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

async function revokeEntitlements(
  ctx: MutationCtx,
  appUserId: string,
  entitlementIds?: string[],
): Promise<void> {
  const now = Date.now();

  // Fast path: specific IDs → compound-index lookup per ID. Avoids a full
  // `.collect()` scan that would hit the read budget on heavy users.
  if (entitlementIds?.length) {
    for (const entitlementId of entitlementIds) {
      const ent = await ctx.db
        .query("entitlements")
        .withIndex("by_app_user_entitlement", (q) =>
          q.eq("appUserId", appUserId).eq("entitlementId", entitlementId),
        )
        .first();
      if (ent && ent.isActive) {
        await ctx.db.patch(ent._id, {
          isActive: false,
          billingIssueDetectedAt: undefined,
          updatedAt: now,
        });
      }
    }
    return;
  }

  // Slow path: no IDs provided → scan. Upstream callers guard this via
  // `entitlement_ids?.length` so it's effectively unreachable from real flows,
  // but retained defensively.
  const entitlements = await ctx.db
    .query("entitlements")
    .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
    .collect();
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

async function extendEntitlements(ctx: MutationCtx, event: EventPayload): Promise<void> {
  const entitlementIds = getEntitlementIds(event);
  if (!entitlementIds?.length || !event.app_user_id) return;

  const now = Date.now();

  for (const entitlementId of entitlementIds) {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q.eq("appUserId", event.app_user_id!).eq("entitlementId", entitlementId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isActive: true,
        // Guard against a malformed RENEWAL/PRODUCT_CHANGE/REFUND_REVERSED that
        // drops `expiration_at_ms`: Convex patch with undefined REMOVES the
        // field, which our gate reads as lifetime. Fall back to the prior
        // expiry so a partial payload can't silently grant infinite access.
        expiresAtMs: event.expiration_at_ms ?? existing.expiresAtMs,
        // Propagate product_id so PRODUCT_CHANGE (and RENEWAL onto a changed
        // product) keeps the entitlement's productId in sync with the live
        // subscription. Fall back to existing when absent.
        productId: event.product_id ?? existing.productId,
        // Ownership can change across renewals (e.g., converted from
        // FAMILY_SHARED to PURCHASED). Keep in sync with the event.
        ownershipType: event.ownership_type ?? existing.ownershipType,
        billingIssueDetectedAt: undefined,
        updatedAt: now,
      });
    } else {
      // Entitlement missing (e.g. race condition, prior transfer) — create it
      // so the user isn't locked out after a successful renewal.
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

      // Copy ALL transferrable fields — drops here cause family-share drift,
      // loss of grace-period signals, and unsubscribe state on restore flows.
      // Matches aliasEntitlements' conditional-spread pattern for status flags.
      if (destExisting) {
        // Out-of-order guard: keep whichever side covers more time. Lifetime
        // source beats finite dest; finite-later source beats finite-earlier
        // dest; lifetime dest always wins against finite source. Without this
        // a fresh RENEWAL on the destination could be overwritten by a queued
        // TRANSFER carrying older state, and a lifetime entitlement on either
        // side could get regressed to the other's finite expiry.
        const sourceIsNewer = isSourceMoreGenerous(
          ent.expiresAtMs,
          destExisting.expiresAtMs,
        );
        await ctx.db.patch(destExisting._id, {
          isActive: true,
          productId: sourceIsNewer ? ent.productId : destExisting.productId,
          expiresAtMs: sourceIsNewer ? ent.expiresAtMs : destExisting.expiresAtMs,
          purchasedAtMs: sourceIsNewer ? ent.purchasedAtMs : destExisting.purchasedAtMs,
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
          isActive: true,
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

async function recordEvent(ctx: MutationCtx, event: EventPayload): Promise<void> {
  await upsertCustomer(ctx, event);
  await upsertExperiments(ctx, event);
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
      // Subscription successfully renewed — clear every stale period-specific
      // marker. A successful renewal supersedes prior cancellations, billing
      // issues, pauses, pending product changes, and expiration reasons.
      // `autoRenewStatus` is re-derived from the cleared state by
      // `upsertSubscription`.
      cancelReason: undefined,
      autoRenewStatus: true,
      billingIssueDetectedAt: undefined,
      gracePeriodExpirationAtMs: undefined,
      // Clear the pause marker — a RENEWAL on a previously-paused subscription
      // means it's resumed. Leaving a stale `autoResumeAtMs` would show a
      // phantom "resumes on …" date for a live renewing sub.
      autoResumeAtMs: undefined,
      // A successful RENEWAL means any pending product change has landed;
      // `newProductId` and `expirationReason` are now stale signals. Clear so
      // consumers reading the live sub don't see phantom pending state.
      expirationReason: undefined,
      // UNSUBSCRIBE followed by a RENEWAL means the user un-cancelled. Clear
      // the marker so `willRenew`/derived `autoRenewStatus` flips back true.
      unsubscribeDetectedAt: undefined,
    });
    // `newProductId` is cleared implicitly: `upsertSubscription` always sets
    // it from `event.new_product_id`, which is absent on RENEWAL events, so a
    // prior pending change gets patched to `undefined` (Convex drops the
    // field) with no extra logic needed.
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
    // RC emits refunds as CANCELLATION (no distinct REFUND event in 2026).
    // Two signals indicate a refund, either suffices:
    //   (a) cancel_reason === "CUSTOMER_SUPPORT" — Apple Report-a-Problem,
    //       support-issued refunds, Stripe refunds, dashboard refunds
    //   (b) price < 0 — catches Google Play self-serve refunds, chargebacks,
    //       and DEVELOPER_INITIATED refunds where cancel_reason doesn't flip
    //       to CUSTOMER_SUPPORT
    // Using cancel_reason alone leaks access on Google self-serve and
    // dashboard-initiated refunds. Never gate on price alone — it's 0 for
    // free trials and unrelated non-refund cancellations.
    const isRefund =
      event.cancel_reason === "CUSTOMER_SUPPORT" ||
      (typeof event.price === "number" && event.price < 0);

    // Per RC docs: "refunds can be given without cancelling a subscription ...
    // autorenewal preference may still be active." Only force autoRenewStatus
    // to false for genuine cancellations (UNSUBSCRIBE, DEVELOPER_INITIATED,
    // PRICE_INCREASE, BILLING_ERROR, UNKNOWN). For refund-only cases leave
    // autoRenewStatus alone so a subsequent RENEWAL can arrive truthfully.
    // Pause is never a cancel_reason — Play Store pauses flow as their own
    // SUBSCRIPTION_PAUSED event type, then EXPIRATION with
    // expiration_reason=SUBSCRIPTION_PAUSED. See event-types-and-fields docs.
    const overrides: Parameters<typeof upsertSubscription>[2] = {
      cancelReason: event.cancel_reason,
    };
    if (!isRefund) {
      overrides.autoRenewStatus = false;
    }
    if (isRefund) {
      // Record when the refund was detected for audit/reporting.
      overrides.refundedAtMs = event.event_timestamp_ms;
    }
    // UNSUBSCRIBE means the user explicitly turned off auto-renew within the
    // current paid period. Track the timestamp so consumers can render
    // "access until <expiry>, will not renew" without conflating with refunds.
    if (event.cancel_reason === "UNSUBSCRIBE") {
      overrides.unsubscribeDetectedAt = event.event_timestamp_ms;
    }
    // BILLING_ERROR cancel means RC gave up retrying the payment. Treat the
    // same as BILLING_ISSUE for coherence: set `billingIssueDetectedAt` so
    // derived `willRenew` is false and consumer grace-period queries return
    // the correct state. Without this, the sub stays cancelled but the billing
    // signal is missing from the stored state.
    if (event.cancel_reason === "BILLING_ERROR") {
      overrides.billingIssueDetectedAt = event.event_timestamp_ms;
    }
    await upsertSubscription(ctx, event, overrides);

    const entitlementIds = getEntitlementIds(event);
    if (isRefund && event.app_user_id && entitlementIds?.length) {
      await revokeEntitlements(ctx, event.app_user_id, entitlementIds);
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
      // UNCANCELLATION means the user re-enabled auto-renew after a prior
      // UNSUBSCRIBE. Clear the marker so the derived `willRenew` flips back
      // true; without this, the stale `unsubscribeDetectedAt` would keep
      // `autoRenewStatus` at false.
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
      // Clear intent-to-continue markers: the sub has hard-expired, so a
      // pending `autoResumeAtMs` (from a prior PAUSE) or a `gracePeriodExpirationAtMs`
      // (from a prior BILLING_ISSUE) is stale. Without this, `isInGracePeriod`
      // and "resumes on …" UI would show phantom state on an already-dead sub.
      // `billingIssueDetectedAt` stays for forensic lookup.
      autoResumeAtMs: undefined,
      gracePeriodExpirationAtMs: undefined,
      autoRenewStatus: false,
    });
    // Only revoke specific entitlements — if entitlement_ids is absent/null
    // (product not mapped to an entitlement), revoking all would incorrectly
    // strip entitlements from other active subscriptions on the same account.
    const entitlementIds = getEntitlementIds(event);
    if (event.app_user_id && entitlementIds?.length) {
      await revokeEntitlements(ctx, event.app_user_id, entitlementIds);
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
      // iOS/Android `willRenew` is false while billing issues are unresolved.
      // `upsertSubscription` re-derives `autoRenewStatus` from the effective
      // state, which now includes this `billingIssueDetectedAt`, so the
      // stored `autoRenewStatus` flips to false automatically. We still pass
      // an explicit false to document intent.
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
            q.eq("appUserId", event.app_user_id!).eq("entitlementId", entitlementId),
          )
          .first();
        if (ent) {
          // Extend expiresAtMs to the grace period end so hasEntitlement keeps
          // returning true during retry. If RENEWAL resolves the billing issue,
          // extendEntitlements pushes expiresAtMs further. If grace times out,
          // EXPIRATION revokes. If EXPIRATION drops, the grace end acts as a
          // hard ceiling instead of indefinite access.
          // Only extend finite expiries — preserve lifetime entitlements (no
          // expiresAtMs) untouched. BILLING_ISSUE shouldn't reach a lifetime
          // entitlement in practice, but the guard prevents silently converting
          // "forever" access into a finite window on any odd edge case.
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
    // Propagate new productId/expiry to entitlements so queries don't return
    // stale productId between PRODUCT_CHANGE and the subsequent RENEWAL. RC
    // sends PRODUCT_CHANGE at the moment the change takes effect (Play Store
    // IMMEDIATE policy) or at the next period boundary (DEFERRED).
    const entitlementIds = getEntitlementIds(event);
    if (entitlementIds?.length && event.app_user_id) {
      await extendEntitlements(ctx, event);
    }
    return null;
  },
});

export const processNonRenewingPurchase = internalMutation({
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
      // Both IDs are the same person — keep whichever record is strictly more
      // generous. Lifetime beats any finite; among finites, later wins.
      const sourceIsNewer = isSourceMoreGenerous(ent.expiresAtMs, existing.expiresAtMs);
      if (sourceIsNewer) {
        await ctx.db.patch(existing._id, {
          isActive: ent.isActive,
          productId: ent.productId,
          expiresAtMs: ent.expiresAtMs,
          purchasedAtMs: ent.purchasedAtMs,
          store: ent.store,
          isSandbox: ent.isSandbox,
          // Preserve status flags from source if set; leave destination's
          // value alone if only the destination has one.
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
    // Dedup on `originalTransactionId`: if the destination already has a sub
    // for the same transaction (e.g. a retried TRANSFER or a race with a
    // concurrent webhook ingest that upserted on the destination), keep the
    // newer record. Without this, two rows share the same
    // `originalTransactionId` across appUserIds, which violates the
    // single-sub-per-transaction invariant.
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
      // Same user, different aliases. Keep whichever enrollment is newer so
      // A/B conversion attribution stays correct across login.
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

export const processTransfer = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EventPayload;
    const entitlementIds = getEntitlementIds(event);

    const sourceUsers = event.transferred_from ?? [];
    const destUsers = event.transferred_to ?? [];

    // Upsert customers for every participant. Strip `aliases` from the event
    // per-user — the event's `aliases` array describes the subscriber making
    // the transfer, not the source users. Letting it leak onto every customer
    // pollutes their alias history.
    for (const userId of [...sourceUsers, ...destUsers]) {
      await upsertCustomer(ctx, { ...event, app_user_id: userId, aliases: undefined });
    }

    // Transfer entitlements and subscriptions
    for (const sourceUserId of sourceUsers) {
      for (const destUserId of destUsers) {
        await transferEntitlements(ctx, sourceUserId, destUserId, entitlementIds);
        await transferSubscriptions(ctx, sourceUserId, destUserId);
      }
    }

    // Drop the source customer row if it's an anonymous ID with no data left.
    // RC's iOS/Android SDKs treat anonymous IDs as dead after merge (see
    // `DeviceCache.clearCaches`); we mirror that so the customers table doesn't
    // accumulate zombie rows for every logIn. Partial-entitlement transfers
    // leave source data in place, and `purgeAnonymousCustomerIfEmpty` no-ops
    // in that case.
    for (const sourceUserId of sourceUsers) {
      await purgeAnonymousCustomerIfEmpty(ctx, sourceUserId);
    }

    // Store transfer record
    if (sourceUsers.length > 0 || destUsers.length > 0) {
      await ctx.db.insert("transfers", {
        eventId: event.id,
        transferredFrom: sourceUsers,
        transferredTo: destUsers,
        entitlementIds,
        timestamp: event.event_timestamp_ms,
      });
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
      await revokeEntitlements(ctx, event.app_user_id, entitlementIds);
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
    // Store clawed back the refund — clear refund markers so the subscription
    // doesn't stay flagged as refunded. Re-enable auto-renew since the
    // reversal implies the subscription is live again.
    await upsertSubscription(ctx, event, {
      refundedAtMs: undefined,
      cancelReason: undefined,
      autoRenewStatus: true,
    });
    await grantEntitlements(ctx, event);
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

    // Store invoice record - use event.id as invoiceId (no separate invoice_id field)
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

    // VC events carry `purchase_environment` in real RC payloads; the top-level
    // `environment` field is not always present. Accept either.
    const environment = event.environment ?? event.purchase_environment;
    if (!event.adjustments?.length || !event.app_user_id || !environment) {
      return null;
    }

    const transactionId = event.virtual_currency_transaction_id ?? event.id;
    const now = Date.now();

    for (const adjustment of event.adjustments) {
      const currencyCode = adjustment.currency.code;
      const currencyName = adjustment.currency.name;
      const amount = adjustment.amount;

      // Store individual transaction — deduplicate by (transactionId, currencyCode)
      // because a single event can carry adjustments for multiple currencies and
      // they all share the same transactionId.
      const existingTx = await ctx.db
        .query("virtualCurrencyTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("transactionId", transactionId))
        .filter((q) => q.eq(q.field("currencyCode"), currencyCode))
        .first();

      if (!existingTx) {
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
      }

      // Update running balance
      const existingBalance = await ctx.db
        .query("virtualCurrencyBalances")
        .withIndex("by_app_user_currency", (q) =>
          q.eq("appUserId", event.app_user_id!).eq("currencyCode", currencyCode),
        )
        .first();

      if (existingBalance) {
        await ctx.db.patch(existingBalance._id, {
          balance: existingBalance.balance + amount,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("virtualCurrencyBalances", {
          appUserId: event.app_user_id,
          currencyCode,
          currencyName,
          balance: amount,
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
      // Preserve A/B test enrollment across login. Without this, conversion
      // attribution resets when an anonymous user logs in.
      await aliasExperiments(ctx, fromUserId, toUserId);
      // Match iOS/Android SDK behavior: anonymous IDs are dead after merge.
      await purgeAnonymousCustomerIfEmpty(ctx, fromUserId);
    }

    return null;
  },
});
