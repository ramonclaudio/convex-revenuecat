import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";

const RATE_LIMIT_WINDOW_MS = 60000;
const WEBHOOK_EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const WEBHOOK_EVENTS_BATCH_SIZE = 500;

export const rateLimits = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;

    const oldEntries = await ctx.db
      .query("rateLimits")
      .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
      .collect();

    for (const entry of oldEntries) {
      await ctx.db.delete(entry._id);
    }

    if (oldEntries.length > 0) {
      console.log(`[cleanup:rateLimits] Deleted ${oldEntries.length} stale entries`);
    }

    return oldEntries.length;
  },
});

export const webhookEvents = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - WEBHOOK_EVENTS_RETENTION_MS;

    const oldEvents = await ctx.db
      .query("webhookEvents")
      .order("asc")
      .take(WEBHOOK_EVENTS_BATCH_SIZE);

    let deleted = 0;
    for (const event of oldEvents) {
      if (event.processedAt < cutoff) {
        await ctx.db.delete(event._id);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[cleanup:webhookEvents] Deleted ${deleted} events older than 30 days`);
    }

    return deleted;
  },
});
