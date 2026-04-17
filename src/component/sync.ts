import { v, type Infer } from "convex/values";
import { mutation } from "./_generated/server.js";
import { storeValidator } from "./schema.js";

type Store = Infer<typeof storeValidator>;

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

// Normalize `store` values from RC's REST `/v1/subscribers` response
// (lowercase: `app_store`, `unknown`, etc.) to the uppercase form used by
// webhook payloads and our schema. The `unknown` → `UNKNOWN_STORE` mapping
// mirrors the RC iOS/Android SDK Store enum, which uses `unknown` as the
// wire value for `UNKNOWN_STORE`. Unknown future values fall back to
// `UNKNOWN_STORE` rather than failing validation, matching SDK behavior.
const mapStore = (s: string): Store => {
  const upper = s.toUpperCase();
  const candidate = upper === "UNKNOWN" ? "UNKNOWN_STORE" : upper;
  return KNOWN_STORES.has(candidate as Store) ? (candidate as Store) : "UNKNOWN_STORE";
};
const mapEnvironment = (sandbox: boolean) =>
  sandbox ? ("SANDBOX" as const) : ("PRODUCTION" as const);
const mapPeriodType = (s: string) => s.toUpperCase() as "NORMAL";
const mapOwnership = (s?: string) => s?.toUpperCase() as "PURCHASED" | undefined;

function parseDate(d: string | null | undefined): number | undefined {
  if (!d) return undefined;
  const ms = new Date(d).getTime();
  return isNaN(ms) ? undefined : ms;
}

/**
 * Ingest a RevenueCat v1 subscriber snapshot.
 *
 * Accepts the `subscriber` object from `GET /v1/subscribers/{app_user_id}`.
 * Upserts customer, subscriptions, and entitlements to match RevenueCat's
 * source of truth. All writes are idempotent.
 */
export const ingest = mutation({
  args: {
    appUserId: v.string(),
    subscriber: v.object({
      entitlements: v.optional(v.any()),
      subscriptions: v.optional(v.any()),
      non_subscriptions: v.optional(v.any()),
      subscriber_attributes: v.optional(v.any()),
      first_seen: v.optional(v.string()),
      last_seen: v.optional(v.string()),
      original_app_user_id: v.optional(v.string()),
    }),
  },
  returns: v.object({
    subscriptions: v.number(),
    entitlements: v.number(),
    nonSubscriptions: v.number(),
  }),
  handler: async (ctx, args) => {
    const { appUserId, subscriber } = args;
    const now = Date.now();
    let subscriptionCount = 0;
    let entitlementCount = 0;
    let nonSubscriptionCount = 0;

    // --- Customer ---
    const existingCustomer = await ctx.db
      .query("customers")
      .withIndex("by_app_user_id", (q) => q.eq("appUserId", appUserId))
      .first();

    // subscriber_attributes $-keys are encoded by the client SDK (transformPayload)
    const rawAttrs = subscriber.subscriber_attributes as
      | Record<string, { value: string; updated_at_ms: number }>
      | undefined;
    const mergedAttrs: Record<string, { value: string; updated_at_ms: number }> =
      { ...(existingCustomer?.attributes ?? {}) };
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
      attributes:
        Object.keys(mergedAttrs).length > 0 ? mergedAttrs : undefined,
      lastSeenAt: parseDate(subscriber.last_seen) ?? now,
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

    // --- Build product→entitlement mapping ---
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
        // Fold grace period into effective expiry so downstream queries can
        // rely on a single `expiresAtMs` field. Matches how BILLING_ISSUE
        // webhook handler extends the entitlement during grace.
        const effectiveExpiresAtMs =
          gracePeriodExpiresAtMs &&
          (!expiresAtMs || gracePeriodExpiresAtMs > expiresAtMs)
            ? gracePeriodExpiresAtMs
            : expiresAtMs;
        const isActive =
          !effectiveExpiresAtMs || effectiveExpiresAtMs > now;

        entitlementState.set(entId, {
          productId,
          isActive,
          expiresAtMs: effectiveExpiresAtMs,
          purchasedAtMs: parseDate(ent.purchase_date),
          isSandbox: false,
        });
      }
    }

    // --- Subscriptions ---
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
        };

        const store = mapStore(s.store);
        const environment = mapEnvironment(s.is_sandbox);
        const periodType = mapPeriodType(s.period_type);
        const transactionId = s.store_transaction_id ?? productId;
        const entIds = productEntitlements.get(productId) ?? [];
        const ownershipType = mapOwnership(s.ownership_type);

        const existing = await ctx.db
          .query("subscriptions")
          .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
          .filter((q) => q.eq(q.field("productId"), productId))
          .first();

        const data = {
          appUserId,
          productId,
          entitlementIds: entIds.length > 0 ? entIds : undefined,
          store,
          environment,
          periodType,
          purchasedAtMs: parseDate(s.purchase_date) ?? now,
          originalPurchasedAtMs: parseDate(s.original_purchase_date),
          expirationAtMs: parseDate(s.expires_date),
          isFamilyShare: s.ownership_type === "FAMILY_SHARED",
          ownershipType,
          billingIssueDetectedAt: parseDate(s.billing_issues_detected_at),
          gracePeriodExpirationAtMs: parseDate(s.grace_period_expires_date),
          autoResumeAtMs: parseDate(s.auto_resume_date),
          refundedAtMs: parseDate(s.refunded_at),
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

        // Propagate store/sandbox/ownership info to entitlements.
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

    // --- Non-subscription (one-time) purchases ---
    // Each product_id maps to an array of individual purchases; one row per
    // purchase, deduped by originalTransactionId. Period type NORMAL, no expiry.
    if (subscriber.non_subscriptions) {
      for (const [productId, rawPurchases] of Object.entries(
        subscriber.non_subscriptions as Record<string, any>,
      )) {
        const purchases = rawPurchases as Array<{
          id: string;
          is_sandbox?: boolean;
          purchase_date?: string;
          store?: string;
          store_transaction_id?: string;
          price?: { amount: number; currency: string };
        }>;
        const entIds = productEntitlements.get(productId) ?? [];

        for (const p of purchases) {
          const transactionId = p.store_transaction_id ?? p.id;
          const isSandbox = p.is_sandbox ?? false;

          const existing = await ctx.db
            .query("subscriptions")
            .withIndex("by_original_transaction", (q) =>
              q.eq("originalTransactionId", transactionId),
            )
            .first();

          const data = {
            appUserId,
            productId,
            entitlementIds: entIds.length > 0 ? entIds : undefined,
            store: p.store ? mapStore(p.store) : ("APP_STORE" as const),
            environment: mapEnvironment(isSandbox),
            periodType: "NORMAL" as const,
            purchasedAtMs: parseDate(p.purchase_date) ?? now,
            expirationAtMs: undefined,
            isFamilyShare: false,
            priceUsd: p.price?.currency === "USD" ? p.price.amount : undefined,
            currency: p.price?.currency,
            priceInPurchasedCurrency: p.price?.amount,
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

          // Propagate store/sandbox info to entitlements linked to this product.
          for (const entId of entIds) {
            const d = entitlementState.get(entId);
            if (d) {
              d.store = data.store;
              d.isSandbox = isSandbox;
            }
          }
        }
      }
    }

    // --- Entitlements ---
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

    return {
      subscriptions: subscriptionCount,
      entitlements: entitlementCount,
      nonSubscriptions: nonSubscriptionCount,
    };
  },
});
