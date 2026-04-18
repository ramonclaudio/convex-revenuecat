import { v } from "convex/values";
import { query } from "./_generated/server.js";
import schema from "./schema.js";

const transferDoc = schema.tables.transfers.validator.extend({
  _id: v.id("transfers"),
  _creationTime: v.number(),
});

export const getByEventId = query({
  args: { eventId: v.string() },
  returns: v.union(transferDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("transfers")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(transferDoc),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("transfers")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
  },
});
