import { ConvexError, v } from "convex/values";
import type { FunctionHandle } from "convex/server";
import { mutation, query } from "./_generated/server.js";
import schema from "./schema.js";

const customerDoc = schema.tables.customers.validator.extend({
  _id: v.id("customers"),
  _creationTime: v.number(),
});

// Per-transaction write budget safety (Convex mutations cap ~8k writes).
const PURGE_SAFETY_CAP = 500;

export const get = query({
  args: {
    appUserId: v.string(),
  },
  returns: v.union(v.null(), customerDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customers")
      .withIndex("by_app_user_id", (q) => q.eq("appUserId", args.appUserId))
      .first();
  },
});

export const getByOriginalId = query({
  args: {
    originalAppUserId: v.string(),
  },
  returns: v.union(v.null(), customerDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customers")
      .withIndex("by_original_app_user_id", (q) =>
        q.eq("originalAppUserId", args.originalAppUserId),
      )
      .first();
  },
});

/**
 * Purge all component-local data for an appUserId.
 *
 * Deletes: customer, subscriptions, entitlements, experiments, invoices,
 * virtual currency balances/transactions, and webhookEvents keyed to this
 * user. Returns deletion counts per table.
 *
 * Does not call RevenueCat's REST API. Consumers wanting to also purge
 * from RC should call `DELETE /v1/subscribers/{app_user_id}` from an
 * action with a secret API key.
 *
 * Throws `PURGE_SAFETY_CAP_EXCEEDED` if any table holds more than 500
 * rows for this user — fails loudly rather than silently truncating.
 */
export const purge = mutation({
  args: {
    appUserId: v.string(),
    // Optional FunctionHandle (from `createFunctionHandle`) fired after the
    // purge commits. Receives `{ appUserId }`. Scheduling is atomic with the
    // purge — if any write throws, the hook doesn't fire.
    onCustomerDeleted: v.optional(v.string()),
  },
  returns: v.object({
    customer: v.number(),
    subscriptions: v.number(),
    entitlements: v.number(),
    experiments: v.number(),
    invoices: v.number(),
    virtualCurrencyBalances: v.number(),
    virtualCurrencyTransactions: v.number(),
    webhookEvents: v.number(),
    transfers: v.number(),
  }),
  handler: async (ctx, args) => {
    const { appUserId } = args;

    type Purgeable =
      | "subscriptions"
      | "entitlements"
      | "experiments"
      | "invoices"
      | "virtualCurrencyBalances"
      | "virtualCurrencyTransactions"
      | "webhookEvents";

    const purgeTable = async (table: Purgeable): Promise<number> => {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
        .take(PURGE_SAFETY_CAP + 1);
      if (rows.length > PURGE_SAFETY_CAP) {
        throw new ConvexError({
          code: "PURGE_SAFETY_CAP_EXCEEDED",
          message: `purge aborted: ${table} has more than ${PURGE_SAFETY_CAP} rows for ${appUserId}`,
        });
      }
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      return rows.length;
    };

    const counts = {
      customer: 0,
      subscriptions: await purgeTable("subscriptions"),
      entitlements: await purgeTable("entitlements"),
      experiments: await purgeTable("experiments"),
      invoices: await purgeTable("invoices"),
      virtualCurrencyBalances: await purgeTable("virtualCurrencyBalances"),
      virtualCurrencyTransactions: await purgeTable("virtualCurrencyTransactions"),
      webhookEvents: await purgeTable("webhookEvents"),
      transfers: 0,
    };

    // Transfers: no `appUserId` column (keyed on transferredFrom/transferredTo
    // string arrays). Filter in-memory. For GDPR, any transfer involving this
    // user must be deleted — the arrays contain the app_user_id verbatim.
    // Bounded by PURGE_SAFETY_CAP against runaway pathological users.
    const allTransfers = await ctx.db
      .query("transfers")
      .order("desc")
      .take(PURGE_SAFETY_CAP + 1);
    if (allTransfers.length > PURGE_SAFETY_CAP) {
      throw new ConvexError({
        code: "PURGE_SAFETY_CAP_EXCEEDED",
        message: `purge aborted: transfers table exceeds ${PURGE_SAFETY_CAP} rows for scan`,
      });
    }
    for (const transfer of allTransfers) {
      if (
        transfer.transferredFrom.includes(appUserId) ||
        transfer.transferredTo.includes(appUserId)
      ) {
        await ctx.db.delete(transfer._id);
        counts.transfers++;
      }
    }

    const customer = await ctx.db
      .query("customers")
      .withIndex("by_app_user_id", (q) => q.eq("appUserId", appUserId))
      .first();
    if (customer) {
      await ctx.db.delete(customer._id);
      counts.customer = 1;
    }

    if (args.onCustomerDeleted) {
      await ctx.scheduler.runAfter(
        0,
        args.onCustomerDeleted as FunctionHandle<"mutation" | "action",
          { appUserId: string },
          unknown
        >,
        { appUserId },
      );
    }

    return counts;
  },
});
