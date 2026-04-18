import { v, type Infer } from "convex/values";
import { mutation } from "./_generated/server.js";
import { storeValidator } from "./schema.js";
import {
  fireTransitionHooks,
  resolveHooks,
  snapshotEntitlements,
} from "./transitions.js";

type Store = Infer<typeof storeValidator>;

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

const KNOWN_PERIOD_TYPES = new Set(["TRIAL", "INTRO", "NORMAL", "PROMOTIONAL", "PREPAID"]);
// Unknown period_type falls back to NORMAL instead of crashing validation.
// Mirrors Android SDK's `optPeriodType` which defaults unknown values to NORMAL
// (EntitlementInfoFactories.kt). Forward-compat against new period types.
const mapPeriodType = (s: string): "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID" => {
  const upper = s.toUpperCase();
  return (KNOWN_PERIOD_TYPES.has(upper) ? upper : "NORMAL") as
    | "TRIAL"
    | "INTRO"
    | "NORMAL"
    | "PROMOTIONAL"
    | "PREPAID";
};

const KNOWN_OWNERSHIP_TYPES = new Set(["PURCHASED", "FAMILY_SHARED", "UNKNOWN"]);
// Android SDK emits `ownership_type: "UNKNOWN"` as a real wire value when the
// store doesn't report ownership info. Anything outside the known set maps to
// undefined rather than crashing the validator.
const mapOwnership = (s?: string): "PURCHASED" | "FAMILY_SHARED" | "UNKNOWN" | undefined => {
  if (!s) return undefined;
  const upper = s.toUpperCase();
  return (KNOWN_OWNERSHIP_TYPES.has(upper) ? upper : undefined) as
    | "PURCHASED"
    | "FAMILY_SHARED"
    | "UNKNOWN"
    | undefined;
};


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
    // Accept `v.any()` because RC's REST subscriber response carries many
    // top-level fields beyond what we read (management_url, last_purchase_date,
    // first_seen_attribution_network_info, etc.) and RC reserves the right to
    // add more. A strict `v.object` would reject the real response shape.
    // The TypeScript `RevenueCatSubscriber` type documents the fields we consume.
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

    // Snapshot ONLY when hooks are registered — avoids full entitlements
    // reads per ingest for consumers who don't use hooks. Covers activation
    // (previously inactive or missing) and deactivation (e.g. sync catches a
    // refund the webhook missed).
    const beforeSnap = hooks
      ? await snapshotEntitlements(ctx, [appUserId])
      : undefined;

    // --- Customer ---
    const existingCustomer = await ctx.db
      .query("customers")
      .withIndex("by_app_user_id", (q) => q.eq("appUserId", appUserId))
      .first();

    // `subscriber_attributes` $-keys are encoded to `__dollar__*` by the client
    // SDK's `transformPayload` because Convex rejects `$` at every nesting
    // level (document fields AND record keys). We store the encoded form and
    // provide `decodeSubscriberAttributes` in the client SDK for read-time
    // decoding.
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
          auto_renew_status?: boolean | null;
          price?: { amount: number | string; currency: string } | null;
        };

        const store = mapStore(s.store);
        const environment = mapEnvironment(s.is_sandbox);
        const periodType = mapPeriodType(s.period_type);
        const transactionId = s.store_transaction_id ?? productId;
        const entIds = productEntitlements.get(productId) ?? [];
        const ownershipType = mapOwnership(s.ownership_type);

        // Coerce `amount` to number — Android SDK types it `Double` but the
        // wire format has been observed as a string in test fixtures.
        const priceAmount =
          typeof s.price?.amount === "string"
            ? Number(s.price.amount)
            : s.price?.amount;
        const priceCurrency = s.price?.currency;

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
          unsubscribeDetectedAt: parseDate(s.unsubscribe_detected_at),
          refundedAtMs: parseDate(s.refunded_at),
          // REST sync is authoritative: clear `cancelReason` on reconciliation
          // since REST doesn't carry it. A stale CUSTOMER_SUPPORT/UNSUBSCRIBE
          // reason from a prior webhook would otherwise persist across resyncs.
          cancelReason: undefined,
          // `auto_renew_status` is documented but not always present; fall back
          // to undefined rather than forcing a value.
          autoRenewStatus:
            typeof s.auto_renew_status === "boolean" ? s.auto_renew_status : undefined,
          // Price fields from REST. Coerce USD-only into priceUsd; store the
          // purchase-currency amount and ISO code for revenue reporting.
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
          original_purchase_date?: string;
          store?: string;
          store_transaction_id?: string;
          price?: { amount: number | string; currency: string };
        }>;
        const entIds = productEntitlements.get(productId) ?? [];

        for (const p of purchases) {
          const transactionId = p.store_transaction_id ?? p.id;
          const isSandbox = p.is_sandbox ?? false;
          // Unknown store falls back to UNKNOWN_STORE (matches subscription path),
          // not APP_STORE — avoids silently misattributing non-iOS purchases.
          const store = p.store ? mapStore(p.store) : ("UNKNOWN_STORE" as const);
          const priceAmount =
            typeof p.price?.amount === "string" ? Number(p.price.amount) : p.price?.amount;
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
            entitlementIds: entIds.length > 0 ? entIds : undefined,
            store,
            environment: mapEnvironment(isSandbox),
            periodType: "NORMAL" as const,
            purchasedAtMs: parseDate(p.purchase_date) ?? now,
            originalPurchasedAtMs: parseDate(p.original_purchase_date),
            expirationAtMs: undefined,
            isFamilyShare: false,
            // One-time purchases are owned by the purchaser. RC REST doesn't
            // carry ownership_type on non_subscriptions; default to PURCHASED.
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

          // Propagate store/sandbox/ownership info to entitlements linked to
          // this product so single-seat filtering works for lifetime purchases.
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
