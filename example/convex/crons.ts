import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";

// Component functions are reached across the component boundary via
// ctx.runMutation, so wrap them in an app-side internal mutation and schedule
// that. Scheduling `components.revenuecat.cleanup.*` directly from a cron fails
// the push: crons serialize the target by name, and a component reference has
// no same-deployment name.
export const pruneRevenueCat = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(components.revenuecat.cleanup.rateLimits, {});
    await ctx.runMutation(components.revenuecat.cleanup.webhookEvents, {});
    return null;
  },
});

const crons = cronJobs();
crons.interval(
  "prune revenuecat bookkeeping",
  { hours: 1 },
  internal.crons.pruneRevenueCat,
  {},
);

export default crons;
