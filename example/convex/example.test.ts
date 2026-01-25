import { describe, expect, test } from "vitest";
import { initConvexTest } from "./setup.test";
import { api, components } from "./_generated/api";

// Helper to create a valid event payload
function createEventPayload(
  overrides: Partial<{
    type: string;
    id: string;
    app_user_id: string;
    entitlement_ids: string[];
    product_id: string;
    expiration_at_ms: number;
  }> = {},
) {
  return {
    type: overrides.type ?? "INITIAL_PURCHASE",
    id: overrides.id ?? `evt_${Date.now()}`,
    app_id: "app_123",
    app_user_id: overrides.app_user_id ?? "user_123",
    original_app_user_id: overrides.app_user_id ?? "user_123",
    aliases: [],
    event_timestamp_ms: Date.now(),
    product_id: overrides.product_id ?? "premium_monthly",
    entitlement_ids: overrides.entitlement_ids ?? ["premium"],
    period_type: "NORMAL" as const,
    purchased_at_ms: Date.now(),
    expiration_at_ms: overrides.expiration_at_ms ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
    transaction_id: `txn_${Date.now()}`,
    original_transaction_id: `txn_original_${Date.now()}`,
    store: "APP_STORE" as const,
    environment: "SANDBOX" as const,
    is_family_share: false,
  };
}

describe("subscriptions", () => {
  describe("checkPremium", () => {
    test("returns false when no entitlement", async () => {
      const t = initConvexTest();

      const result = await t.query(api.subscriptions.checkPremium, {
        appUserId: "user_no_premium",
      });

      expect(result).toBe(false);
    });

    test("returns true when premium entitlement exists", async () => {
      const t = initConvexTest();

      // Create entitlement via webhook
      const payload = createEventPayload({
        id: "evt_example_1",
        app_user_id: "user_example_1",
        entitlement_ids: ["premium"],
      });

      await t.mutation(components.revenuecat.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const result = await t.query(api.subscriptions.checkPremium, {
        appUserId: "user_example_1",
      });

      expect(result).toBe(true);
    });
  });

  describe("getActiveEntitlements", () => {
    test("returns active entitlements", async () => {
      const t = initConvexTest();

      // Create entitlements via webhook
      const payload = createEventPayload({
        id: "evt_example_2",
        app_user_id: "user_example_2",
        entitlement_ids: ["premium", "pro"],
      });

      await t.mutation(components.revenuecat.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const result = await t.query(api.subscriptions.getActiveEntitlements, {
        appUserId: "user_example_2",
      });

      expect(result.length).toBe(2);
    });
  });

  describe("grantPromoEntitlement", () => {
    test("grants promotional entitlement", async () => {
      const t = initConvexTest();

      await t.mutation(api.subscriptions.grantPromoEntitlement, {
        appUserId: "user_promo_1",
        entitlementId: "trial",
      });

      const result = await t.query(api.subscriptions.checkPremium, {
        appUserId: "user_promo_1",
      });

      // This returns false because we granted "trial", not "premium"
      expect(result).toBe(false);
    });
  });

  describe("revokeEntitlement", () => {
    test("revokes entitlement", async () => {
      const t = initConvexTest();

      // Grant first
      await t.mutation(api.subscriptions.grantPromoEntitlement, {
        appUserId: "user_revoke_1",
        entitlementId: "premium",
      });

      // Check it's granted
      let result = await t.query(api.subscriptions.checkPremium, {
        appUserId: "user_revoke_1",
      });
      expect(result).toBe(true);

      // Revoke
      await t.mutation(api.subscriptions.revokeEntitlement, {
        appUserId: "user_revoke_1",
        entitlementId: "premium",
      });

      // Check it's revoked
      result = await t.query(api.subscriptions.checkPremium, {
        appUserId: "user_revoke_1",
      });
      expect(result).toBe(false);
    });
  });
});
