import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

// Clean up old rate limit entries every hour
// Entries older than the rate limit window (1 minute) are no longer needed
crons.interval("cleanup rate limits", { hours: 1 }, internal.cleanup.rateLimits, {});

// Clean up old webhook events daily
// Events older than 30 days are deleted to prevent unbounded growth
crons.interval("cleanup webhook events", { hours: 24 }, internal.cleanup.webhookEvents, {});

export default crons;
