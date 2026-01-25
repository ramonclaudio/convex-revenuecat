import { v } from "convex/values";
import { query } from "./_generated/server.js";
import schema from "./schema.js";

const experimentDoc = schema.tables.experiments.validator.extend({
  _id: v.id("experiments"),
  _creationTime: v.number(),
});

/**
 * Get all experiments for a customer
 */
export const list = query({
  args: {
    appUserId: v.string(),
  },
  returns: v.array(experimentDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("experiments")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();
  },
});

/**
 * Get a specific experiment enrollment for a customer
 */
export const get = query({
  args: {
    appUserId: v.string(),
    experimentId: v.string(),
  },
  returns: v.union(v.null(), experimentDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("experiments")
      .withIndex("by_app_user_experiment", (q) =>
        q.eq("appUserId", args.appUserId).eq("experimentId", args.experimentId),
      )
      .first();
  },
});

/**
 * Get all customers enrolled in a specific experiment
 */
export const listByExperiment = query({
  args: {
    experimentId: v.string(),
  },
  returns: v.array(experimentDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("experiments")
      .withIndex("by_experiment", (q) => q.eq("experimentId", args.experimentId))
      .collect();
  },
});
