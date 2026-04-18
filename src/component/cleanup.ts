import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

const RATE_LIMIT_WINDOW_MS = 60000;
const WEBHOOK_EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Cap deletes per invocation to stay well under Convex's per-transaction
// write limit. If the cutoff isn't reached, schedule a continuation so the
// backlog drains faster than the 24h cron cadence would allow.
const WEBHOOK_EVENTS_MAX_DELETES = 4000;
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

    return oldEntries.length;
  },
});

export const webhookEvents = internalMutation({
  args: {},
  returns: v.object({
    deleted: v.number(),
    scheduledContinuation: v.boolean(),
  }),
  handler: async (ctx) => {
    const cutoff = Date.now() - WEBHOOK_EVENTS_RETENTION_MS;
    let deleted = 0;
    let moreWork = false;

    while (deleted < WEBHOOK_EVENTS_MAX_DELETES) {
      const batch = await ctx.db
        .query("webhookEvents")
        .order("asc")
        .take(WEBHOOK_EVENTS_BATCH_SIZE);

      if (batch.length === 0) break;

      let deletedThisBatch = 0;
      let hitNewerEvent = false;
      for (const event of batch) {
        if (event.processedAt >= cutoff) {
          hitNewerEvent = true;
          break;
        }
        await ctx.db.delete(event._id);
        deleted++;
        deletedThisBatch++;
        if (deleted >= WEBHOOK_EVENTS_MAX_DELETES) {
          moreWork = true;
          break;
        }
      }

      // Ascending scan hit a record newer than cutoff — rest are newer too.
      if (hitNewerEvent) break;

      // Batch was smaller than BATCH_SIZE, so no more records exist.
      if (deletedThisBatch < WEBHOOK_EVENTS_BATCH_SIZE) break;
    }

    if (moreWork) {
      await ctx.scheduler.runAfter(0, internal.cleanup.webhookEvents, {});
    }

    return { deleted, scheduledContinuation: moreWork };
  },
});
