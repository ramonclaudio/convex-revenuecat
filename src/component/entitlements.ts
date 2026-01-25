import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
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

    if (!entitlement) {
      return false;
    }

    if (!entitlement.isActive) {
      return false;
    }

    if (entitlement.expiresAtMs && entitlement.expiresAtMs < Date.now()) {
      return false;
    }

    return true;
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

    return entitlements.filter((e) => {
      if (!e.isActive) return false;
      if (e.expiresAtMs && e.expiresAtMs < now) return false;
      return true;
    });
  },
});

export const grant = mutation({
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

export const revoke = mutation({
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

export const sync = mutation({
  args: {
    appUserId: v.string(),
    entitlementIds: v.array(v.string()),
    productId: v.optional(v.string()),
    expiresAtMs: v.optional(v.number()),
    store: v.optional(storeValidator),
    isSandbox: v.boolean(),
  },
  returns: v.object({
    granted: v.array(v.string()),
    revoked: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();

    const existingIds = new Set(existing.map((e) => e.entitlementId));
    const targetIds = new Set(args.entitlementIds);

    const granted: string[] = [];
    const revoked: string[] = [];

    // Grant new entitlements
    for (const entitlementId of args.entitlementIds) {
      if (!existingIds.has(entitlementId)) {
        await ctx.db.insert("entitlements", {
          appUserId: args.appUserId,
          entitlementId,
          productId: args.productId,
          isActive: true,
          expiresAtMs: args.expiresAtMs,
          purchasedAtMs: now,
          store: args.store,
          isSandbox: args.isSandbox,
          updatedAt: now,
        });
        granted.push(entitlementId);
      } else {
        // Update existing
        const ent = existing.find((e) => e.entitlementId === entitlementId)!;
        await ctx.db.patch(ent._id, {
          isActive: true,
          productId: args.productId,
          expiresAtMs: args.expiresAtMs,
          store: args.store,
          updatedAt: now,
        });
        if (!ent.isActive) {
          granted.push(entitlementId);
        }
      }
    }

    // Revoke entitlements no longer in list
    for (const ent of existing) {
      if (!targetIds.has(ent.entitlementId) && ent.isActive) {
        await ctx.db.patch(ent._id, {
          isActive: false,
          updatedAt: now,
        });
        revoked.push(ent.entitlementId);
      }
    }

    return { granted, revoked };
  },
});
