import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

const RATE_LIMIT_WINDOW_MS = 60000;
const WEBHOOK_EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMITS_MAX_DELETES = 4000;
const RATE_LIMITS_BATCH_SIZE = 500;
const WEBHOOK_EVENTS_MAX_DELETES = 4000;
const WEBHOOK_EVENTS_BATCH_SIZE = 500;

export const rateLimits = internalMutation({
  args: {},
  returns: v.object({
    deleted: v.number(),
    scheduledContinuation: v.boolean(),
  }),
  handler: async (ctx) => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    let deleted = 0;
    let moreWork = false;

    while (deleted < RATE_LIMITS_MAX_DELETES) {
      const batch = await ctx.db
        .query("rateLimits")
        .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
        .take(RATE_LIMITS_BATCH_SIZE);

      if (batch.length === 0) break;

      for (const entry of batch) {
        await ctx.db.delete(entry._id);
        deleted++;
        if (deleted >= RATE_LIMITS_MAX_DELETES) {
          moreWork = true;
          break;
        }
      }

      if (batch.length < RATE_LIMITS_BATCH_SIZE) break;
    }

    if (moreWork) {
      await ctx.scheduler.runAfter(0, internal.cleanup.rateLimits, {});
    }

    return { deleted, scheduledContinuation: moreWork };
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

      if (hitNewerEvent) break;
      if (deletedThisBatch < WEBHOOK_EVENTS_BATCH_SIZE) break;
    }

    if (moreWork) {
      await ctx.scheduler.runAfter(0, internal.cleanup.webhookEvents, {});
    }

    return { deleted, scheduledContinuation: moreWork };
  },
});
