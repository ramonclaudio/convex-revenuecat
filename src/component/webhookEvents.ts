import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { environmentValidator, storeValidator } from "./schema.js";

const webhookEventDoc = v.object({
  _id: v.id("webhookEvents"),
  _creationTime: v.number(),
  eventId: v.string(),
  eventType: v.string(),
  appId: v.optional(v.string()),
  appUserId: v.optional(v.string()),
  environment: environmentValidator,
  store: v.optional(storeValidator),
  payload: v.any(),
  processedAt: v.number(),
  status: v.union(v.literal("processed"), v.literal("failed"), v.literal("ignored")),
  error: v.optional(v.string()),
});

export const getByEventId = query({
  args: {
    eventId: v.string(),
  },
  returns: v.union(v.null(), webhookEventDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
  },
});

export const listByUser = query({
  args: {
    appUserId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(webhookEventDoc),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .order("desc")
      .take(limit);
  },
});

export const listByType = query({
  args: {
    eventType: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(webhookEventDoc),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_type", (q) => q.eq("eventType", args.eventType))
      .order("desc")
      .take(limit);
  },
});

export const listFailed = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(webhookEventDoc),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(limit);
  },
});
