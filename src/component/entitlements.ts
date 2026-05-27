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
        q
          .eq("appUserId", args.appUserId)
          .eq("entitlementId", args.entitlementId),
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
