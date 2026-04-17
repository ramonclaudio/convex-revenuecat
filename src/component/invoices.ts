import { v } from "convex/values";
import { query } from "./_generated/server.js";
import schema from "./schema.js";

const invoiceDoc = schema.tables.invoices.validator.extend({
  _id: v.id("invoices"),
  _creationTime: v.number(),
});

export const get = query({
  args: { invoiceId: v.string() },
  returns: v.union(invoiceDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invoices")
      .withIndex("by_invoice_id", (q) => q.eq("invoiceId", args.invoiceId))
      .first();
  },
});

export const listByUser = query({
  args: { appUserId: v.string() },
  returns: v.array(invoiceDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invoices")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();
  },
});
