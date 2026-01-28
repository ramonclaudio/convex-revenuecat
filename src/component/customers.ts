import { v } from "convex/values";
import { query } from "./_generated/server.js";
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
