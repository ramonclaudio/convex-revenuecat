import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";

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
