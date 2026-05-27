import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import type { OwnershipType, PeriodType, Store } from "./types.js";
import {
  fireTransitionHooks,
  resolveHooks,
  snapshotEntitlements,
} from "./transitions.js";
import { deriveWillRenew } from "./handlers.js";

const hooksValidator = v.optional(
  v.object({
    onEntitlementActivated: v.optional(v.string()),
    onEntitlementDeactivated: v.optional(v.string()),
  }),
);

const KNOWN_STORES = new Set<Store>([
  "APP_STORE",
  "MAC_APP_STORE",
  "PLAY_STORE",
  "AMAZON",
  "STRIPE",
  "PROMOTIONAL",
  "RC_BILLING",
  "EXTERNAL",
  "PADDLE",
  "TEST_STORE",
  "GALAXY",
  "ROKU",
  "UNKNOWN_STORE",
]);

// REST returns lowercase store values (`app_store`, `unknown`, etc.). Webhooks
// and our schema use uppercase. Unknown values fall back to UNKNOWN_STORE.
const mapStore = (s: string): Store => {
  const upper = s.toUpperCase();
  const candidate = upper === "UNKNOWN" ? "UNKNOWN_STORE" : upper;
  return KNOWN_STORES.has(candidate as Store)
    ? (candidate as Store)
    : "UNKNOWN_STORE";
};

const mapEnvironment = (sandbox: boolean) =>
  sandbox ? ("SANDBOX" as const) : ("PRODUCTION" as const);

const KNOWN_PERIOD_TYPES = new Set<PeriodType>([
  "TRIAL",
  "INTRO",
  "NORMAL",
  "PROMOTIONAL",
  "PREPAID",
]);
// Unknown period_type defaults to NORMAL. Matches Android SDK's `optPeriodType`.
const mapPeriodType = (s: string): PeriodType => {
  const upper = s.toUpperCase() as PeriodType;
  return KNOWN_PERIOD_TYPES.has(upper) ? upper : "NORMAL";
};

// Android emits `UNKNOWN` as a real wire value. Unknown future values → undefined.
const KNOWN_OWNERSHIP_TYPES = new Set<OwnershipType>([
  "PURCHASED",
  "FAMILY_SHARED",
  "UNKNOWN",
]);
const mapOwnership = (s?: string): OwnershipType | undefined => {
  if (!s) return undefined;
  const upper = s.toUpperCase() as OwnershipType;
  return KNOWN_OWNERSHIP_TYPES.has(upper) ? upper : undefined;
};

function parseDate(d: string | null | undefined): number | undefined {
  if (!d) return undefined;
  const ms = new Date(d).getTime();
  return isNaN(ms) ? undefined : ms;
}

/** Ingest a RevenueCat v1 subscriber snapshot. Idempotent upsert of
 * customer, subscriptions, and entitlements. */
export const ingest = mutation({
  args: {
    appUserId: v.string(),
    subscriber: v.any(),
    hooks: hooksValidator,
  },
  returns: v.object({
    subscriptions: v.number(),
    entitlements: v.number(),
    nonSubscriptions: v.number(),
  }),
  handler: async (ctx, args) => {
    const { appUserId, subscriber } = args;
    const hooks = resolveHooks(args.hooks);
    const now = Date.now();
    let subscriptionCount = 0;
    let entitlementCount = 0;
    let nonSubscriptionCount = 0;

    const beforeSnap = hooks
      ? await snapshotEntitlements(ctx, [appUserId])
      : undefined;

    const existingCustomer = await ctx.db
      .query("customers")
      .withIndex("by_app_user_id", (q) => q.eq("appUserId", appUserId))
      .first();

    const rawAttrs = subscriber.subscriber_attributes as
      | Record<string, { value: string; updated_at_ms: number }>
      | undefined;
    const mergedAttrs: Record<
      string,
      { value: string; updated_at_ms: number }
    > = { ...(existingCustomer?.attributes ?? {}) };
    if (rawAttrs) {
      for (const [key, attr] of Object.entries(rawAttrs)) {
        const a = attr as { value: string; updated_at_ms: number };
        const existing = mergedAttrs[key];
        if (!existing || a.updated_at_ms > (existing.updated_at_ms ?? 0)) {
          mergedAttrs[key] = a;
        }
      }
    }

    const customerPatch = {
      originalAppUserId: subscriber.original_app_user_id ?? appUserId,
      attributes: Object.keys(mergedAttrs).length > 0 ? mergedAttrs : undefined,
      lastSeenAt: parseDate(subscriber.last_seen) ?? now,
      managementUrl:
        subscriber.management_url ?? existingCustomer?.managementUrl,
      updatedAt: now,
    };

    if (existingCustomer) {
      await ctx.db.patch(existingCustomer._id, customerPatch);
    } else {
      await ctx.db.insert("customers", {
        appUserId,
        aliases: [],
        firstSeenAt: parseDate(subscriber.first_seen) ?? now,
        ...customerPatch,
      });
    }

    const productEntitlements = new Map<string, string[]>();
    const entitlementState = new Map<
      string,
      {
        productId?: string;
        isActive: boolean;
        expiresAtMs?: number;
        purchasedAtMs?: number;
        store?: ReturnType<typeof mapStore>;
        isSandbox: boolean;
        ownershipType?: ReturnType<typeof mapOwnership>;
      }
    >();

    if (subscriber.entitlements) {
      for (const [entId, raw] of Object.entries(
        subscriber.entitlements as Record<string, any>,
      )) {
        const ent = raw as {
          product_identifier?: string;
          expires_date?: string | null;
          purchase_date?: string;
          grace_period_expires_date?: string | null;
        };
        const productId = ent.product_identifier;
        if (productId) {
          if (!productEntitlements.has(productId))
            productEntitlements.set(productId, []);
          productEntitlements.get(productId)!.push(entId);
        }

        const expiresAtMs = parseDate(ent.expires_date);
        const gracePeriodExpiresAtMs = parseDate(ent.grace_period_expires_date);
        // Fold grace into effective expiry, matches BILLING_ISSUE handler.
        const effectiveExpiresAtMs =
          gracePeriodExpiresAtMs &&
          (!expiresAtMs || gracePeriodExpiresAtMs > expiresAtMs)
            ? gracePeriodExpiresAtMs
            : expiresAtMs;
        const isActive = !effectiveExpiresAtMs || effectiveExpiresAtMs > now;

        entitlementState.set(entId, {
          productId,
          isActive,
          expiresAtMs: effectiveExpiresAtMs,
          purchasedAtMs: parseDate(ent.purchase_date),
          isSandbox: false,
        });
      }
    }

    if (subscriber.subscriptions) {
      for (const [productId, raw] of Object.entries(
        subscriber.subscriptions as Record<string, any>,
      )) {
        const s = raw as {
          store: string;
          is_sandbox: boolean;
          period_type: string;
          expires_date?: string | null;
          purchase_date?: string;
          original_purchase_date?: string;
          store_transaction_id?: string;
          ownership_type?: string;
          billing_issues_detected_at?: string | null;
          grace_period_expires_date?: string | null;
          auto_resume_date?: string | null;
          unsubscribe_detected_at?: string | null;
          refunded_at?: string | null;
          price?: { amount: number | string; currency: string } | null;
        };

        const store = mapStore(s.store);
        const environment = mapEnvironment(s.is_sandbox);
        const periodType = mapPeriodType(s.period_type);
        const transactionId = s.store_transaction_id ?? productId;
        const entIds = productEntitlements.get(productId) ?? [];
        const ownershipType = mapOwnership(s.ownership_type);

        // Coerce, Android types `amount` as Double but the wire format
        // has been observed as a string in fixtures.
        const priceAmount =
          typeof s.price?.amount === "string"
            ? Number(s.price.amount)
            : s.price?.amount;
        const priceCurrency = s.price?.currency;

        const existing = await ctx.db
          .query("subscriptions")
          .withIndex("by_app_user_product", (q) =>
            q.eq("appUserId", appUserId).eq("productId", productId),
          )
          .first();

        const billingIssueDetectedAt = parseDate(s.billing_issues_detected_at);
        const unsubscribeDetectedAt = parseDate(s.unsubscribe_detected_at);
        const expirationAtMs = parseDate(s.expires_date);
        // RC v1 REST has no explicit auto-renew field. Derive from primitives
        // so sync and webhook paths converge on the same stored value.
        const autoRenewStatus = deriveWillRenew({
          periodType,
          store,
          expirationAtMs,
          unsubscribeDetectedAt,
          billingIssueDetectedAt,
        });

        const data = {
          appUserId,
          productId,
          kind: "subscription" as const,
          entitlementIds: entIds.length > 0 ? entIds : undefined,
          store,
          environment,
          periodType,
          purchasedAtMs: parseDate(s.purchase_date) ?? now,
          originalPurchasedAtMs: parseDate(s.original_purchase_date),
          expirationAtMs,
          isFamilyShare: s.ownership_type === "FAMILY_SHARED",
          ownershipType,
          billingIssueDetectedAt,
          gracePeriodExpirationAtMs: parseDate(s.grace_period_expires_date),
          autoResumeAtMs: parseDate(s.auto_resume_date),
          unsubscribeDetectedAt,
          refundedAtMs: parseDate(s.refunded_at),
          // REST is authoritative. Clear stale cancelReason from prior webhooks.
          cancelReason: undefined,
          autoRenewStatus,
          priceUsd: priceCurrency === "USD" ? priceAmount : undefined,
          currency: priceCurrency,
          priceInPurchasedCurrency: priceAmount,
          updatedAt: now,
        };

        if (existing) {
          await ctx.db.patch(existing._id, data);
        } else {
          await ctx.db.insert("subscriptions", {
            ...data,
            originalTransactionId: transactionId,
            transactionId,
          });
        }
        subscriptionCount++;

        for (const entId of entIds) {
          const d = entitlementState.get(entId);
          if (d) {
            d.store = store;
            d.isSandbox = s.is_sandbox;
            d.ownershipType = ownershipType;
          }
        }
      }
    }

    // One-shot purchases, one row per transaction, deduped by id, no expiry.
    if (subscriber.non_subscriptions) {
      for (const [productId, rawPurchases] of Object.entries(
        subscriber.non_subscriptions as Record<string, any>,
      )) {
        const purchases = rawPurchases as Array<{
          id: string;
          is_sandbox?: boolean;
          purchase_date?: string;
          original_purchase_date?: string;
          store?: string;
          store_transaction_id?: string;
          price?: { amount: number | string; currency: string };
        }>;
        const entIds = productEntitlements.get(productId) ?? [];

        for (const p of purchases) {
          const transactionId = p.store_transaction_id ?? p.id;
          const isSandbox = p.is_sandbox ?? false;
          // Unknown store → UNKNOWN_STORE. Never silently default to APP_STORE.
          const store = p.store
            ? mapStore(p.store)
            : ("UNKNOWN_STORE" as const);
          const priceAmount =
            typeof p.price?.amount === "string"
              ? Number(p.price.amount)
              : p.price?.amount;
          const priceCurrency = p.price?.currency;

          const existing = await ctx.db
            .query("subscriptions")
            .withIndex("by_original_transaction", (q) =>
              q.eq("originalTransactionId", transactionId),
            )
            .first();

          const data = {
            appUserId,
            productId,
            kind: "consumable" as const,
            entitlementIds: entIds.length > 0 ? entIds : undefined,
            store,
            environment: mapEnvironment(isSandbox),
            periodType: "NORMAL" as const,
            purchasedAtMs: parseDate(p.purchase_date) ?? now,
            originalPurchasedAtMs: parseDate(p.original_purchase_date),
            expirationAtMs: undefined,
            isFamilyShare: false,
            // RC REST doesn't carry ownership_type on non_subscriptions.
            ownershipType: "PURCHASED" as const,
            priceUsd: priceCurrency === "USD" ? priceAmount : undefined,
            currency: priceCurrency,
            priceInPurchasedCurrency: priceAmount,
            updatedAt: now,
          };

          if (existing) {
            await ctx.db.patch(existing._id, data);
          } else {
            await ctx.db.insert("subscriptions", {
              ...data,
              originalTransactionId: transactionId,
              transactionId,
            });
          }
          nonSubscriptionCount++;

          for (const entId of entIds) {
            const d = entitlementState.get(entId);
            if (d) {
              d.store = data.store;
              d.isSandbox = isSandbox;
              d.ownershipType = d.ownershipType ?? "PURCHASED";
            }
          }
        }
      }
    }

    for (const [entitlementId, data] of entitlementState) {
      const existing = await ctx.db
        .query("entitlements")
        .withIndex("by_app_user_entitlement", (q) =>
          q.eq("appUserId", appUserId).eq("entitlementId", entitlementId),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          productId: data.productId ?? existing.productId,
          isActive: data.isActive,
          expiresAtMs: data.expiresAtMs,
          purchasedAtMs: data.purchasedAtMs ?? existing.purchasedAtMs,
          store: data.store ?? existing.store,
          isSandbox: data.isSandbox,
          ownershipType: data.ownershipType ?? existing.ownershipType,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("entitlements", {
          appUserId,
          entitlementId,
          productId: data.productId,
          isActive: data.isActive,
          expiresAtMs: data.expiresAtMs,
          purchasedAtMs: data.purchasedAtMs,
          store: data.store,
          isSandbox: data.isSandbox,
          ownershipType: data.ownershipType,
          updatedAt: now,
        });
      }
      entitlementCount++;
    }

    if (hooks && beforeSnap) {
      const afterSnap = await snapshotEntitlements(ctx, [appUserId]);
      // Sync-initiated transitions report a synthetic `"SYNC"` event type so
      // consumers can distinguish webhook-driven from REST-driven flips.
      await fireTransitionHooks(ctx, hooks, beforeSnap, afterSnap, "SYNC");
    }

    return {
      subscriptions: subscriptionCount,
      entitlements: entitlementCount,
      nonSubscriptions: nonSubscriptionCount,
    };
  },
});
