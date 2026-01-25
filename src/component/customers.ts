import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import schema from "./schema.js";

const customerDoc = schema.tables.customers.validator.extend({
  _id: v.id("customers"),
  _creationTime: v.number(),
});

export const get = query({
  args: {
    appUserId: v.string(),
  },
  returns: v.union(v.null(), customerDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customers")
      .withIndex("by_app_user_id", (q) => q.eq("appUserId", args.appUserId))
      .first();
  },
});

export const getByOriginalId = query({
  args: {
    originalAppUserId: v.string(),
  },
  returns: v.union(v.null(), customerDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customers")
      .withIndex("by_original_app_user_id", (q) =>
        q.eq("originalAppUserId", args.originalAppUserId),
      )
      .first();
  },
});

export const upsert = mutation({
  args: {
    appUserId: v.string(),
    originalAppUserId: v.string(),
    aliases: v.array(v.string()),
    firstSeenAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    attributes: v.optional(v.any()),
  },
  returns: v.id("customers"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_app_user_id", (q) => q.eq("appUserId", args.appUserId))
      .first();

    const now = Date.now();

    if (existing) {
      // Merge aliases
      const mergedAliases = [...new Set([...existing.aliases, ...args.aliases])];

      await ctx.db.patch(existing._id, {
        originalAppUserId: args.originalAppUserId,
        aliases: mergedAliases,
        lastSeenAt: args.lastSeenAt ?? now,
        attributes: args.attributes ?? existing.attributes,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("customers", {
      appUserId: args.appUserId,
      originalAppUserId: args.originalAppUserId,
      aliases: args.aliases,
      firstSeenAt: args.firstSeenAt ?? now,
      lastSeenAt: args.lastSeenAt,
      attributes: args.attributes,
      updatedAt: now,
    });
  },
});
