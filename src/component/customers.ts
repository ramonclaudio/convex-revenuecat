import { v } from "convex/values";
import type { FunctionHandle } from "convex/server";
import { mutation, query } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const customerDoc = schema.tables.customers.validator.extend({
  _id: v.id("customers"),
  _creationTime: v.number(),
});

const PURGE_SAFETY_CAP = 500;
const PURGE_BATCH = 2000;

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

export const purge = mutation({
  args: {
    appUserId: v.string(),
    onCustomerDeleted: v.optional(v.string()),
    batchSize: v.optional(v.number()),
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
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { appUserId } = args;
    let budget = Math.min(
      Math.max(args.batchSize ?? PURGE_BATCH, 1),
      PURGE_BATCH,
    );

    const counts = {
      customer: 0,
      subscriptions: 0,
      entitlements: 0,
      experiments: 0,
      invoices: 0,
      virtualCurrencyBalances: 0,
      virtualCurrencyTransactions: 0,
      webhookEvents: 0,
      transfers: 0,
    };

    type Purgeable =
      | "subscriptions"
      | "entitlements"
      | "experiments"
      | "invoices"
      | "virtualCurrencyBalances"
      | "virtualCurrencyTransactions"
      | "webhookEvents";
    const perUserTables: Purgeable[] = [
      "subscriptions",
      "entitlements",
      "experiments",
      "invoices",
      "virtualCurrencyBalances",
      "virtualCurrencyTransactions",
      "webhookEvents",
    ];

    for (const table of perUserTables) {
      if (budget <= 0) break;
      const rows = await ctx.db
        .query(table)
        .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
        .take(budget);
      for (const row of rows) await ctx.db.delete(row._id);
      counts[table] = rows.length;
      budget -= rows.length;
    }
    if (budget <= 0) return { ...counts, done: false };

    const participants = await ctx.db
      .query("transferParticipants")
      .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
      .take(PURGE_SAFETY_CAP + 1);
    const moreParticipants = participants.length > PURGE_SAFETY_CAP;
    const participantBatch = moreParticipants
      ? participants.slice(0, PURGE_SAFETY_CAP)
      : participants;
    const transferIds = new Set<Id<"transfers">>(
      participantBatch.map((p) => p.transferId),
    );
    await Promise.all(participantBatch.map((p) => ctx.db.delete(p._id)));
    for (const transferId of transferIds) {
      const transfer = await ctx.db.get(transferId);
      if (transfer) {
        await ctx.db.delete(transfer._id);
        counts.transfers++;
        if (transfer.eventId) {
          const auditRow = await ctx.db
            .query("webhookEvents")
            .withIndex("by_event_id", (q) => q.eq("eventId", transfer.eventId))
            .first();
          if (auditRow) {
            await ctx.db.delete(auditRow._id);
            counts.webhookEvents++;
          }
        }
      }
      const siblings = await ctx.db
        .query("transferParticipants")
        .withIndex("by_transfer", (q) => q.eq("transferId", transferId))
        .collect();
      await Promise.all(siblings.map((s) => ctx.db.delete(s._id)));
    }
    if (moreParticipants) return { ...counts, done: false };

    const legacyTransfers = await ctx.db
      .query("transfers")
      .order("desc")
      .take(PURGE_SAFETY_CAP);
    let legacyHits = 0;
    for (const transfer of legacyTransfers) {
      if (transferIds.has(transfer._id)) continue;
      if (
        transfer.transferredFrom.includes(appUserId) ||
        transfer.transferredTo.includes(appUserId)
      ) {
        await ctx.db.delete(transfer._id);
        counts.transfers++;
        legacyHits++;
        if (transfer.eventId) {
          const auditRow = await ctx.db
            .query("webhookEvents")
            .withIndex("by_event_id", (q) => q.eq("eventId", transfer.eventId))
            .first();
          if (auditRow) {
            await ctx.db.delete(auditRow._id);
            counts.webhookEvents++;
          }
        }
      }
    }
    if (legacyHits > 0 && legacyTransfers.length === PURGE_SAFETY_CAP) {
      return { ...counts, done: false };
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
        args.onCustomerDeleted as FunctionHandle<
          "mutation" | "action",
          { appUserId: string },
          unknown
        >,
        { appUserId },
      );
    }
    return { ...counts, done: true };
  },
});
