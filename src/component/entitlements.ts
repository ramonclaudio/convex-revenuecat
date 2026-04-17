/**
 * Access-gate invariant: `expiresAtMs` is the single source of truth for when
 * access ends. Every code path that affects whether an entitlement is active
 * must honor this — `isActive && (expiresAtMs === undefined || expiresAtMs > now)`.
 *
 * Contracts that maintain it:
 *   - `handlers.ts:processBillingIssue` extends `expiresAtMs` to the grace
 *     period end so grace is folded into the expiry check. Lifetime
 *     entitlements (expiresAtMs === undefined) stay lifetime.
 *   - `sync.ts:ingest` folds `grace_period_expires_date` into the effective
 *     expiry for the same reason.
 *   - `handlers.ts:extendEntitlements` and `grantEntitlements` push
 *     `expiresAtMs` forward on RENEWAL / INITIAL_PURCHASE / REFUND_REVERSED.
 *   - `handlers.ts:revokeEntitlements` sets `isActive: false` on EXPIRATION
 *     and refund-CANCELLATION; the expiry check is the second line of defense.
 *
 * Do NOT short-circuit `hasEntitlement` on auxiliary flags (e.g. a bare
 * `billingIssueDetectedAt` check) — that historically leaked access
 * indefinitely if EXPIRATION was delayed or dropped. Mirror the iOS SDK's
 * `EntitlementInfo.isActive`: pure expiry-date comparison.
 */
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server.js";
import schema, { storeValidator } from "./schema.js";

const entitlementDoc = schema.tables.entitlements.validator.extend({
  _id: v.id("entitlements"),
  _creationTime: v.number(),
});

export const check = query({
  args: {
    appUserId: v.string(),
    entitlementId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q.eq("appUserId", args.appUserId).eq("entitlementId", args.entitlementId),
      )
      .first();

    if (!entitlement || !entitlement.isActive) {
      return false;
    }
    // Lifetime (no expiry) stays active forever.
    if (!entitlement.expiresAtMs) {
      return true;
    }
    // Grace period is encoded into expiresAtMs via processBillingIssue/sync.
    // Do NOT short-circuit on billingIssueDetectedAt — if EXPIRATION fails to
    // arrive after grace ends, that would leak access indefinitely. Mirror
    // the iOS SDK's EntitlementInfo.isActive: pure expiration-date check.
    return entitlement.expiresAtMs > Date.now();
  },
});

export const list = query({
  args: {
    appUserId: v.string(),
  },
  returns: v.array(entitlementDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("entitlements")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();
  },
});

export const getActive = query({
  args: {
    appUserId: v.string(),
  },
  returns: v.array(entitlementDoc),
  handler: async (ctx, args) => {
    const now = Date.now();
    const entitlements = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();

    // Grace period is encoded into expiresAtMs. See `check` for rationale.
    return entitlements.filter((e) => {
      if (!e.isActive) return false;
      return !e.expiresAtMs || e.expiresAtMs > now;
    });
  },
});

export const grant = internalMutation({
  args: {
    appUserId: v.string(),
    entitlementId: v.string(),
    productId: v.optional(v.string()),
    expiresAtMs: v.optional(v.number()),
    purchasedAtMs: v.optional(v.number()),
    store: v.optional(storeValidator),
    isSandbox: v.boolean(),
  },
  returns: v.id("entitlements"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q.eq("appUserId", args.appUserId).eq("entitlementId", args.entitlementId),
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isActive: true,
        productId: args.productId,
        expiresAtMs: args.expiresAtMs,
        purchasedAtMs: args.purchasedAtMs ?? now,
        store: args.store,
        isSandbox: args.isSandbox,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("entitlements", {
      appUserId: args.appUserId,
      entitlementId: args.entitlementId,
      productId: args.productId,
      isActive: true,
      expiresAtMs: args.expiresAtMs,
      purchasedAtMs: args.purchasedAtMs ?? now,
      store: args.store,
      isSandbox: args.isSandbox,
      updatedAt: now,
    });
  },
});

export const revoke = internalMutation({
  args: {
    appUserId: v.string(),
    entitlementId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q.eq("appUserId", args.appUserId).eq("entitlementId", args.entitlementId),
      )
      .first();

    if (!entitlement) {
      return false;
    }

    await ctx.db.patch(entitlement._id, {
      isActive: false,
      updatedAt: Date.now(),
    });

    return true;
  },
});
