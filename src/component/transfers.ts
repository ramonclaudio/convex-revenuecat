import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";

export const getByEventId = internalQuery({
  args: { eventId: v.string() },
  returns: v.union(
    v.object({
      _id: v.string(),
      _creationTime: v.number(),
      eventId: v.string(),
      transferredFrom: v.array(v.string()),
      transferredTo: v.array(v.string()),
      entitlementIds: v.optional(v.array(v.string())),
      timestamp: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const transfer = await ctx.db
      .query("transfers")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (!transfer) return null;

    return {
      _id: transfer._id,
      _creationTime: transfer._creationTime,
      eventId: transfer.eventId,
      transferredFrom: transfer.transferredFrom,
      transferredTo: transfer.transferredTo,
      entitlementIds: transfer.entitlementIds,
      timestamp: transfer.timestamp,
    };
  },
});

export const list = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.string(),
      _creationTime: v.number(),
      eventId: v.string(),
      transferredFrom: v.array(v.string()),
      transferredTo: v.array(v.string()),
      entitlementIds: v.optional(v.array(v.string())),
      timestamp: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const transfers = await ctx.db
      .query("transfers")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);

    return transfers.map((t) => ({
      _id: t._id,
      _creationTime: t._creationTime,
      eventId: t.eventId,
      transferredFrom: t.transferredFrom,
      transferredTo: t.transferredTo,
      entitlementIds: t.entitlementIds,
      timestamp: t.timestamp,
    }));
  },
});
