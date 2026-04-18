import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";

/**
 * Internal no-op mutation whose args schema matches the lifecycle hook
 * payloads. Purely a test/demo target: lets the test suite register a
 * valid `FunctionHandle` scheduler target for `onEntitlementActivated`,
 * `onEntitlementDeactivated`, and `onCustomerDeleted` hooks without
 * adding a bespoke helper file to every consumer.
 *
 * Not part of the component's public API — consumers pass their own
 * mutation/action references via `RevenueCatOptions.hooks`.
 */
export const noop = internalMutation({
  args: {
    appUserId: v.optional(v.string()),
    entitlementId: v.optional(v.string()),
    productId: v.optional(v.string()),
    purchasedAtMs: v.optional(v.number()),
    expiresAtMs: v.optional(v.number()),
    store: v.optional(v.string()),
    ownershipType: v.optional(v.string()),
    isSandbox: v.optional(v.boolean()),
    sourceEventType: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async () => null,
});
