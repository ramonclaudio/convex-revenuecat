import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval("cleanup rate limits", { hours: 1 }, internal.cleanup.rateLimits, {});
crons.interval("cleanup webhook events", { hours: 24 }, internal.cleanup.webhookEvents, {});

export default crons;
