import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import { environmentValidator, storeValidator } from "./schema.js";

const invoiceValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  invoiceId: v.string(),
  appUserId: v.string(),
  productId: v.optional(v.string()),
  store: v.optional(storeValidator),
  environment: environmentValidator,
  priceUsd: v.optional(v.number()),
  currency: v.optional(v.string()),
  priceInPurchasedCurrency: v.optional(v.number()),
  issuedAt: v.number(),
});

export const get = internalQuery({
  args: { invoiceId: v.string() },
  returns: v.union(invoiceValidator, v.null()),
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_invoice_id", (q) => q.eq("invoiceId", args.invoiceId))
      .first();

    if (!invoice) return null;

    return {
      _id: invoice._id,
      _creationTime: invoice._creationTime,
      invoiceId: invoice.invoiceId,
      appUserId: invoice.appUserId,
      productId: invoice.productId,
      store: invoice.store,
      environment: invoice.environment,
      priceUsd: invoice.priceUsd,
      currency: invoice.currency,
      priceInPurchasedCurrency: invoice.priceInPurchasedCurrency,
      issuedAt: invoice.issuedAt,
    };
  },
});

export const listByUser = internalQuery({
  args: { appUserId: v.string() },
  returns: v.array(invoiceValidator),
  handler: async (ctx, args) => {
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();

    return invoices.map((i) => ({
      _id: i._id,
      _creationTime: i._creationTime,
      invoiceId: i.invoiceId,
      appUserId: i.appUserId,
      productId: i.productId,
      store: i.store,
      environment: i.environment,
      priceUsd: i.priceUsd,
      currency: i.currency,
      priceInPurchasedCurrency: i.priceInPurchasedCurrency,
      issuedAt: i.issuedAt,
    }));
  },
});
