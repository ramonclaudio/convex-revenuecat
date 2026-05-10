import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import schema from "./schema.js";

const transferDoc = schema.tables.transfers.validator.extend({
  _id: v.id("transfers"),
  _creationTime: v.number(),
});

const TRANSFER_LIMIT_DEFAULT = 100;
const TRANSFER_LIMIT_MAX = 1000;

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
    const limit = Math.min(args.limit ?? TRANSFER_LIMIT_DEFAULT, TRANSFER_LIMIT_MAX);
    return await ctx.db
      .query("transfers")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
  },
});

/** Backfill `transferParticipants` for pre-0.3.0 `transfers` rows. Run once
 * after upgrading. Idempotent. Loop until `nextCursor` is null. */
export const backfillTransferParticipants = mutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    written: v.number(),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.pageSize ?? 256, 1000);
    const page = await ctx.db
      .query("transfers")
      .paginate({ cursor: args.cursor ?? null, numItems: pageSize });
    let written = 0;
    for (const transfer of page.page) {
      const existing = await ctx.db
        .query("transferParticipants")
        .withIndex("by_transfer", (q) => q.eq("transferId", transfer._id))
        .first();
      if (existing) continue;
      for (const userId of transfer.transferredFrom) {
        await ctx.db.insert("transferParticipants", {
          transferId: transfer._id,
          appUserId: userId,
          role: "from",
        });
        written++;
      }
      for (const userId of transfer.transferredTo) {
        await ctx.db.insert("transferParticipants", {
          transferId: transfer._id,
          appUserId: userId,
          role: "to",
        });
        written++;
      }
    }
    return {
      scanned: page.page.length,
      written,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
