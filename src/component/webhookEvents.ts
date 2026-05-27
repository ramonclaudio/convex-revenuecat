import { v } from "convex/values";
import { query } from "./_generated/server.js";
import schema from "./schema.js";

const webhookEventDoc = schema.tables.webhookEvents.validator.extend({
  _id: v.id("webhookEvents"),
  _creationTime: v.number(),
});

const LIMIT_DEFAULT = 100;
const LIMIT_MAX = 1000;
const clamp = (n: number | undefined): number =>
  Math.min(n ?? LIMIT_DEFAULT, LIMIT_MAX);

export const listByUser = query({
  args: { appUserId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(webhookEventDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .order("desc")
      .take(clamp(args.limit));
  },
});
