import { v } from "convex/values";
import { query } from "./_generated/server.js";
import schema from "./schema.js";

const balanceDoc = schema.tables.virtualCurrencyBalances.validator.extend({
  _id: v.id("virtualCurrencyBalances"),
  _creationTime: v.number(),
});

const transactionDoc =
  schema.tables.virtualCurrencyTransactions.validator.extend({
    _id: v.id("virtualCurrencyTransactions"),
    _creationTime: v.number(),
  });

export const getBalance = query({
  args: { appUserId: v.string(), currencyCode: v.string() },
  returns: v.union(balanceDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("virtualCurrencyBalances")
      .withIndex("by_app_user_currency", (q) =>
        q.eq("appUserId", args.appUserId).eq("currencyCode", args.currencyCode),
      )
      .first();
  },
});

export const listBalances = query({
  args: { appUserId: v.string() },
  returns: v.array(balanceDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("virtualCurrencyBalances")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();
  },
});

export const listTransactions = query({
  args: { appUserId: v.string(), currencyCode: v.optional(v.string()) },
  returns: v.array(transactionDoc),
  handler: async (ctx, args) => {
    if (args.currencyCode) {
      return await ctx.db
        .query("virtualCurrencyTransactions")
        .withIndex("by_app_user_currency", (q) =>
          q
            .eq("appUserId", args.appUserId)
            .eq("currencyCode", args.currencyCode!),
        )
        .collect();
    }
    return await ctx.db
      .query("virtualCurrencyTransactions")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();
  },
});
