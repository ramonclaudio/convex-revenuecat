import { ConvexError, v } from "convex/values";
import type { FunctionHandle } from "convex/server";
import { mutation, query } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
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

/** Purge all component-local data for an appUserId. Throws
 * `PURGE_SAFETY_CAP_EXCEEDED` if any table holds more than 500 rows.
 * Does not call RC's REST API. Use a separate action with `REVENUECAT_API_KEY`
 * for `DELETE /v1/subscribers/{app_user_id}`. */
export const purge = mutation({
  args: {
    appUserId: v.string(),
    /** FunctionHandle fired atomically with purge commit. */
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
      virtualCurrencyTransactions: await purgeTable(
        "virtualCurrencyTransactions",
      ),
      webhookEvents: await purgeTable("webhookEvents"),
      transfers: 0,
    };

    const participants = await ctx.db
      .query("transferParticipants")
      .withIndex("by_app_user", (q) => q.eq("appUserId", appUserId))
      .take(PURGE_SAFETY_CAP + 1);
    if (participants.length > PURGE_SAFETY_CAP) {
      throw new ConvexError({
        code: "PURGE_SAFETY_CAP_EXCEEDED",
        message: `purge aborted: ${appUserId} participates in more than ${PURGE_SAFETY_CAP} transfers`,
      });
    }
    const transferIdsViaJoin = new Set<Id<"transfers">>(
      participants.map((p) => p.transferId),
    );
    await Promise.all(participants.map((p) => ctx.db.delete(p._id)));
    const transferIdList = [...transferIdsViaJoin];
    const transferRows = await Promise.all(
      transferIdList.map((id) => ctx.db.get(id)),
    );
    const siblingsLists = await Promise.all(
      transferIdList.map((id) =>
        ctx.db
          .query("transferParticipants")
          .withIndex("by_transfer", (q) => q.eq("transferId", id))
          .collect(),
      ),
    );
    // TRANSFER webhookEvents are stored with appUserId undefined (RC TRANSFER
    // events carry no app_user_id), so the by_app_user sweep above can't reach
    // them. Collect the originating event ids to purge those audit rows too.
    const transferEventIds = new Set<string>();
    for (let i = 0; i < transferIdList.length; i++) {
      const transfer = transferRows[i];
      if (!transfer) continue;
      await ctx.db.delete(transfer._id);
      counts.transfers++;
      if (transfer.eventId) transferEventIds.add(transfer.eventId);
      await Promise.all(
        siblingsLists[i].map((sibling) => ctx.db.delete(sibling._id)),
      );
    }

    // Backwards-compat fallback for pre-0.3.0 transfer rows that lack
    // participant entries. After running `backfillTransferParticipants` this
    // scan finds nothing relevant.
    const legacyTransfers = await ctx.db
      .query("transfers")
      .order("desc")
      .take(PURGE_SAFETY_CAP);
    let legacyHits = 0;
    for (const transfer of legacyTransfers) {
      if (transferIdsViaJoin.has(transfer._id)) continue;
      if (
        transfer.transferredFrom.includes(appUserId) ||
        transfer.transferredTo.includes(appUserId)
      ) {
        await ctx.db.delete(transfer._id);
        counts.transfers++;
        legacyHits++;
        if (transfer.eventId) transferEventIds.add(transfer.eventId);
      }
    }
    // Only throw if we hit the cap AND found unbackfilled hits, otherwise
    // the cap is a benign side effect of large but-fully-backfilled tables.
    if (legacyHits > 0 && legacyTransfers.length === PURGE_SAFETY_CAP) {
      throw new ConvexError({
        code: "PURGE_SAFETY_CAP_EXCEEDED",
        message: `purge incomplete: legacy transfers scan capped at ${PURGE_SAFETY_CAP} with hits for ${appUserId}; run backfillTransferParticipants then retry`,
      });
    }

    // Purge the TRANSFER audit rows correlated to the deleted transfers. Each
    // transfer's eventId is the originating TRANSFER webhook's id (see
    // processTransfer), and those webhookEvents have a null appUserId.
    for (const eventId of transferEventIds) {
      const auditRow = await ctx.db
        .query("webhookEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
        .first();
      if (auditRow) {
        await ctx.db.delete(auditRow._id);
        counts.webhookEvents++;
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
        args.onCustomerDeleted as FunctionHandle<
          "mutation" | "action",
          { appUserId: string },
          unknown
        >,
        { appUserId },
      );
    }

    return counts;
  },
});
