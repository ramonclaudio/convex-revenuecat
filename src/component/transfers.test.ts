import { describe, expect, test } from "vitest";
import { initConvexTest } from "./setup.test.js";
import { api, internal } from "./_generated/api.js";

describe("transfers", () => {
  describe("getByEventId", () => {
    test("returns null for non-existent transfer", async () => {
      const t = initConvexTest();
      const result = await t.query(internal.transfers.getByEventId, {
        eventId: "nonexistent",
      });
      expect(result).toBeNull();
    });

    test("returns transfer after TRANSFER event", async () => {
      const t = initConvexTest();

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_transfer_1",
          type: "TRANSFER",
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_transfer_1",
          type: "TRANSFER",
          event_timestamp_ms: Date.now(),
          transferred_from: ["user_source"],
          transferred_to: ["user_dest"],
          entitlement_ids: ["premium"],
          environment: "PRODUCTION",
        },
      });

      const result = await t.query(internal.transfers.getByEventId, {
        eventId: "evt_transfer_1",
      });

      expect(result).not.toBeNull();
      expect(result?.transferredFrom).toEqual(["user_source"]);
      expect(result?.transferredTo).toEqual(["user_dest"]);
      expect(result?.entitlementIds).toEqual(["premium"]);
    });
  });

  describe("list", () => {
    test("returns empty array when no transfers", async () => {
      const t = initConvexTest();
      const result = await t.query(internal.transfers.list, {});
      expect(result).toEqual([]);
    });

    test("returns transfers in descending timestamp order", async () => {
      const t = initConvexTest();
      const now = Date.now();

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_transfer_old",
          type: "TRANSFER",
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_transfer_old",
          type: "TRANSFER",
          event_timestamp_ms: now - 1000,
          transferred_from: ["user_a"],
          transferred_to: ["user_b"],
          environment: "PRODUCTION",
        },
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_transfer_new",
          type: "TRANSFER",
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_transfer_new",
          type: "TRANSFER",
          event_timestamp_ms: now,
          transferred_from: ["user_c"],
          transferred_to: ["user_d"],
          environment: "PRODUCTION",
        },
      });

      const result = await t.query(internal.transfers.list, { limit: 10 });

      expect(result.length).toBe(2);
      expect(result[0].eventId).toBe("evt_transfer_new");
      expect(result[1].eventId).toBe("evt_transfer_old");
    });
  });

  describe("subscription transfer", () => {
    test("TRANSFER event moves subscriptions to destination user", async () => {
      const t = initConvexTest();

      // Create subscription for source user
      await t.mutation(internal.handlers.processInitialPurchase, {
        event: {
          type: "INITIAL_PURCHASE",
          id: "evt_init_transfer",
          app_id: "app_123",
          app_user_id: "user_source_sub",
          original_app_user_id: "user_source_sub",
          aliases: ["user_source_sub"],
          event_timestamp_ms: Date.now(),
          product_id: "premium_monthly",
          entitlement_ids: ["premium"],
          period_type: "NORMAL" as const,
          purchased_at_ms: Date.now(),
          expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
          transaction_id: "txn_transfer_sub",
          original_transaction_id: "txn_transfer_sub",
          store: "APP_STORE" as const,
          environment: "PRODUCTION" as const,
          is_family_share: false,
        },
      });

      // Verify source user has subscription
      const sourceSubs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_source_sub",
      });
      expect(sourceSubs).toHaveLength(1);

      // Process TRANSFER event
      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_transfer_sub",
          type: "TRANSFER",
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_transfer_sub",
          type: "TRANSFER",
          event_timestamp_ms: Date.now(),
          transferred_from: ["user_source_sub"],
          transferred_to: ["user_dest_sub"],
          entitlement_ids: ["premium"],
          environment: "PRODUCTION",
        },
      });

      // Verify subscription moved to destination user
      const destSubs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_dest_sub",
      });
      expect(destSubs).toHaveLength(1);
      expect(destSubs[0].productId).toBe("premium_monthly");

      // Verify source user no longer has subscription
      const sourceSubsAfter = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_source_sub",
      });
      expect(sourceSubsAfter).toHaveLength(0);
    });
  });
});
