import { cronJobs } from "convex/server";
import { components } from "./_generated/api";

const crons = cronJobs();

// Prune expired rate-limit rows (60s window) hourly. The mutation deletes in
// batches and self-reschedules when a backlog exceeds the per-run cap.
crons.interval(
  "revenuecat: prune rate limits",
  { hours: 1 },
  components.revenuecat.cleanup.rateLimits,
  {},
);

// Drop webhook audit events past the 30-day retention, daily.
crons.interval(
  "revenuecat: prune webhook events",
  { hours: 24 },
  components.revenuecat.cleanup.webhookEvents,
  {},
);

export default crons;
