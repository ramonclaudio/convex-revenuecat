import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";

// Rate limit window from webhooks.ts
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

// Webhook events retention (30 days)
const WEBHOOK_EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Max events to delete per cron run (avoid timeout)
const WEBHOOK_EVENTS_BATCH_SIZE = 500;

/**
 * Clean up old rate limit entries
 * Entries older than the rate limit window are no longer needed for rate limiting
 * This runs hourly via cron to prevent unbounded table growth
 */
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

/**
 * Clean up old webhook events
 * Events older than retention period (30 days) are deleted
 * Runs daily via cron to prevent unbounded table growth
 */
export const webhookEvents = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - WEBHOOK_EVENTS_RETENTION_MS;

    // Use _creationTime for cutoff since processedAt might not be indexed
    // Take only batch size to avoid timeout
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
