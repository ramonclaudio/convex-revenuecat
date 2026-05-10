/**
 * Access-gate invariant: `expiresAtMs` is the single source of truth for when
 * access ends. Every code path that affects whether an entitlement is active
 * must honor `isActive && (expiresAtMs === undefined || expiresAtMs > now)`.
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
 *     and refund-CANCELLATION. The expiry check is the second line of defense.
 *
 * Do NOT short-circuit `hasEntitlement` on auxiliary flags (e.g. a bare
 * `billingIssueDetectedAt` check). That historically leaked access
 * indefinitely if EXPIRATION was delayed or dropped. Mirror the iOS SDK's
 * `EntitlementInfo.isActive`: pure expiry-date comparison.
 */
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import schema from "./schema.js";

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

    if (!entitlement || !entitlement.isActive) return false;
    if (!entitlement.expiresAtMs) return true;
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

    return entitlements.filter(
      (e) => e.isActive && (!e.expiresAtMs || e.expiresAtMs > now),
    );
  },
});

