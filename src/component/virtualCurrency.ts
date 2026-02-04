import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import { environmentValidator } from "./schema.js";

const balanceValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  appUserId: v.string(),
  currencyCode: v.string(),
  currencyName: v.string(),
  balance: v.number(),
  updatedAt: v.number(),
});

const transactionValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  transactionId: v.string(),
  appUserId: v.string(),
  currencyCode: v.string(),
  amount: v.number(),
  source: v.optional(v.string()),
  productId: v.optional(v.string()),
  environment: environmentValidator,
  timestamp: v.number(),
});

export const getBalance = internalQuery({
  args: { appUserId: v.string(), currencyCode: v.string() },
  returns: v.union(balanceValidator, v.null()),
  handler: async (ctx, args) => {
    const balance = await ctx.db
      .query("virtualCurrencyBalances")
      .withIndex("by_app_user_currency", (q) =>
        q.eq("appUserId", args.appUserId).eq("currencyCode", args.currencyCode),
      )
      .first();

    if (!balance) return null;

    return {
      _id: balance._id,
      _creationTime: balance._creationTime,
      appUserId: balance.appUserId,
      currencyCode: balance.currencyCode,
      currencyName: balance.currencyName,
      balance: balance.balance,
      updatedAt: balance.updatedAt,
    };
  },
});

export const listBalances = internalQuery({
  args: { appUserId: v.string() },
  returns: v.array(balanceValidator),
  handler: async (ctx, args) => {
    const balances = await ctx.db
      .query("virtualCurrencyBalances")
      .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId))
      .collect();

    return balances.map((b) => ({
      _id: b._id,
      _creationTime: b._creationTime,
      appUserId: b.appUserId,
      currencyCode: b.currencyCode,
      currencyName: b.currencyName,
      balance: b.balance,
      updatedAt: b.updatedAt,
    }));
  },
});

export const listTransactions = internalQuery({
  args: { appUserId: v.string(), currencyCode: v.optional(v.string()) },
  returns: v.array(transactionValidator),
  handler: async (ctx, args) => {
    let query;
    if (args.currencyCode) {
      query = ctx.db
        .query("virtualCurrencyTransactions")
        .withIndex("by_app_user_currency", (q) =>
          q.eq("appUserId", args.appUserId).eq("currencyCode", args.currencyCode!),
        );
    } else {
      query = ctx.db
        .query("virtualCurrencyTransactions")
        .withIndex("by_app_user", (q) => q.eq("appUserId", args.appUserId));
    }

    const transactions = await query.collect();

    return transactions.map((t) => ({
      _id: t._id,
      _creationTime: t._creationTime,
      transactionId: t.transactionId,
      appUserId: t.appUserId,
      currencyCode: t.currencyCode,
      amount: t.amount,
      source: t.source,
      productId: t.productId,
      environment: t.environment,
      timestamp: t.timestamp,
    }));
  },
});
