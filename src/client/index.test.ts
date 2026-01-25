import { describe, expect, test } from "vitest";
import { RevenueCat } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";

// Helper to create a valid event payload
function createEventPayload(
  overrides: Partial<{
    type: string;
    id: string;
    app_user_id: string;
    original_app_user_id: string;
    product_id: string;
    entitlement_ids: string[];
    expiration_at_ms: number;
  }> = {},
) {
  return {
    type: overrides.type ?? "INITIAL_PURCHASE",
    id: overrides.id ?? `evt_${Date.now()}`,
    app_id: "app_123",
    app_user_id: overrides.app_user_id ?? "user_123",
    original_app_user_id: overrides.original_app_user_id ?? overrides.app_user_id ?? "user_123",
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

describe("RevenueCat client", () => {
  describe("hasEntitlement", () => {
    test("returns false when no entitlement exists", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      const result = await t.run(async (ctx) => {
        return await revenuecat.hasEntitlement(ctx, {
          appUserId: "user_nonexistent",
          entitlementId: "premium",
        });
      });

      expect(result).toBe(false);
    });

    test("returns true when active entitlement exists", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      // Create entitlement via webhook
      const payload = createEventPayload({
        id: "evt_client_1",
        app_user_id: "user_client_1",
        entitlement_ids: ["premium"],
      });

      await t.run(async (ctx) => {
        await ctx.runMutation(components.revenuecat.webhooks.process, {
          event: {
            id: payload.id,
            type: payload.type,
            app_user_id: payload.app_user_id,
            environment: payload.environment,
            store: payload.store,
          },
          payload,
        });
      });

      const result = await t.run(async (ctx) => {
        return await revenuecat.hasEntitlement(ctx, {
          appUserId: "user_client_1",
          entitlementId: "premium",
        });
      });

      expect(result).toBe(true);
    });
  });

  describe("getActiveEntitlements", () => {
    test("returns empty array when no entitlements exist", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      const result = await t.run(async (ctx) => {
        return await revenuecat.getActiveEntitlements(ctx, {
          appUserId: "user_no_ent",
        });
      });

      expect(result).toEqual([]);
    });

    test("returns active entitlements", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      // Create entitlement via webhook
      const payload = createEventPayload({
        id: "evt_client_2",
        app_user_id: "user_client_2",
        entitlement_ids: ["premium", "pro"],
      });

      await t.run(async (ctx) => {
        await ctx.runMutation(components.revenuecat.webhooks.process, {
          event: {
            id: payload.id,
            type: payload.type,
            app_user_id: payload.app_user_id,
            environment: payload.environment,
            store: payload.store,
          },
          payload,
        });
      });

      const result = await t.run(async (ctx) => {
        return await revenuecat.getActiveEntitlements(ctx, {
          appUserId: "user_client_2",
        });
      });

      expect(result.length).toBe(2);
      expect(result.map((e) => e.entitlementId).sort()).toEqual(["premium", "pro"]);
    });
  });

  describe("getActiveSubscriptions", () => {
    test("returns active subscriptions", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      // Create subscription via webhook
      const payload = createEventPayload({
        id: "evt_client_3",
        app_user_id: "user_client_3",
        product_id: "yearly_premium",
      });

      await t.run(async (ctx) => {
        await ctx.runMutation(components.revenuecat.webhooks.process, {
          event: {
            id: payload.id,
            type: payload.type,
            app_user_id: payload.app_user_id,
            environment: payload.environment,
            store: payload.store,
          },
          payload,
        });
      });

      const result = await t.run(async (ctx) => {
        return await revenuecat.getActiveSubscriptions(ctx, {
          appUserId: "user_client_3",
        });
      });

      expect(result.length).toBe(1);
      expect(result[0].productId).toBe("yearly_premium");
    });
  });

  describe("getAllEntitlements", () => {
    test("returns all entitlements including inactive", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      // Grant an entitlement
      await t.run(async (ctx) => {
        await revenuecat.grantEntitlement(ctx, {
          appUserId: "user_all_ent",
          entitlementId: "premium",
        });
      });

      // Grant another then revoke it
      await t.run(async (ctx) => {
        await revenuecat.grantEntitlement(ctx, {
          appUserId: "user_all_ent",
          entitlementId: "pro",
        });
      });

      await t.run(async (ctx) => {
        await revenuecat.revokeEntitlement(ctx, {
          appUserId: "user_all_ent",
          entitlementId: "pro",
        });
      });

      // getAllEntitlements should return both
      const all = await t.run(async (ctx) => {
        return await revenuecat.getAllEntitlements(ctx, {
          appUserId: "user_all_ent",
        });
      });

      expect(all.length).toBe(2);

      // getActiveEntitlements should only return active one
      const active = await t.run(async (ctx) => {
        return await revenuecat.getActiveEntitlements(ctx, {
          appUserId: "user_all_ent",
        });
      });

      expect(active.length).toBe(1);
      expect(active[0].entitlementId).toBe("premium");
    });
  });

  describe("getAllSubscriptions", () => {
    test("returns all subscriptions including expired", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      // Create active subscription
      const activePayload = createEventPayload({
        id: "evt_all_subs_1",
        app_user_id: "user_all_subs",
        product_id: "monthly_premium",
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      await t.run(async (ctx) => {
        await ctx.runMutation(components.revenuecat.webhooks.process, {
          event: {
            id: activePayload.id,
            type: activePayload.type,
            app_user_id: activePayload.app_user_id,
            environment: activePayload.environment,
            store: activePayload.store,
          },
          payload: activePayload,
        });
      });

      // Create expired subscription (different transaction)
      const expiredPayload = {
        ...createEventPayload({
          id: "evt_all_subs_2",
          app_user_id: "user_all_subs",
          product_id: "yearly_basic",
          expiration_at_ms: Date.now() - 1000, // expired
        }),
        original_transaction_id: "txn_expired_123",
        transaction_id: "txn_expired_123",
      };

      await t.run(async (ctx) => {
        await ctx.runMutation(components.revenuecat.webhooks.process, {
          event: {
            id: expiredPayload.id,
            type: expiredPayload.type,
            app_user_id: expiredPayload.app_user_id,
            environment: expiredPayload.environment,
            store: expiredPayload.store,
          },
          payload: expiredPayload,
        });
      });

      // getAllSubscriptions should return both
      const all = await t.run(async (ctx) => {
        return await revenuecat.getAllSubscriptions(ctx, {
          appUserId: "user_all_subs",
        });
      });

      expect(all.length).toBe(2);

      // getActiveSubscriptions should only return active one
      const active = await t.run(async (ctx) => {
        return await revenuecat.getActiveSubscriptions(ctx, {
          appUserId: "user_all_subs",
        });
      });

      expect(active.length).toBe(1);
      expect(active[0].productId).toBe("monthly_premium");
    });
  });

  describe("getCustomer", () => {
    test("returns null when customer does not exist", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      const result = await t.run(async (ctx) => {
        return await revenuecat.getCustomer(ctx, {
          appUserId: "user_not_found",
        });
      });

      expect(result).toBeNull();
    });

    test("returns customer when exists", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      // Create customer via webhook
      const payload = createEventPayload({
        id: "evt_client_4",
        app_user_id: "user_client_4",
      });

      await t.run(async (ctx) => {
        await ctx.runMutation(components.revenuecat.webhooks.process, {
          event: {
            id: payload.id,
            type: payload.type,
            app_user_id: payload.app_user_id,
            environment: payload.environment,
            store: payload.store,
          },
          payload,
        });
      });

      const result = await t.run(async (ctx) => {
        return await revenuecat.getCustomer(ctx, {
          appUserId: "user_client_4",
        });
      });

      expect(result).not.toBeNull();
      expect(result?.appUserId).toBe("user_client_4");
    });
  });

  describe("grantEntitlement (local)", () => {
    test("grants entitlement to user", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      await t.run(async (ctx) => {
        await revenuecat.grantEntitlement(ctx, {
          appUserId: "user_grant_1",
          entitlementId: "premium",
        });
      });

      const result = await t.run(async (ctx) => {
        return await revenuecat.hasEntitlement(ctx, {
          appUserId: "user_grant_1",
          entitlementId: "premium",
        });
      });

      expect(result).toBe(true);
    });
  });

  describe("revokeEntitlement (local)", () => {
    test("revokes entitlement from user", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      // First grant
      await t.run(async (ctx) => {
        await revenuecat.grantEntitlement(ctx, {
          appUserId: "user_revoke_1",
          entitlementId: "premium",
        });
      });

      // Verify granted
      let result = await t.run(async (ctx) => {
        return await revenuecat.hasEntitlement(ctx, {
          appUserId: "user_revoke_1",
          entitlementId: "premium",
        });
      });
      expect(result).toBe(true);

      // Revoke
      await t.run(async (ctx) => {
        await revenuecat.revokeEntitlement(ctx, {
          appUserId: "user_revoke_1",
          entitlementId: "premium",
        });
      });

      // Verify revoked
      result = await t.run(async (ctx) => {
        return await revenuecat.hasEntitlement(ctx, {
          appUserId: "user_revoke_1",
          entitlementId: "premium",
        });
      });
      expect(result).toBe(false);
    });
  });

  describe("API methods", () => {
    // Note: These tests use `ctx as any` because they test validation errors
    // that occur BEFORE ctx.runAction() would be called. The MutationCtx from
    // t.run() is sufficient since runAction is never reached.

    test("grantEntitlementViaApi throws without API key", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      await expect(
        t.run(async (ctx) => {
          await revenuecat.grantEntitlementViaApi(ctx as any, {
            appUserId: "user_api",
            entitlementId: "premium",
          });
        }),
      ).rejects.toThrow("REVENUECAT_API_KEY is required");
    });

    test("revokeEntitlementViaApi throws without API key", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      await expect(
        t.run(async (ctx) => {
          await revenuecat.revokeEntitlementViaApi(ctx as any, {
            appUserId: "user_api",
            entitlementId: "premium",
          });
        }),
      ).rejects.toThrow("REVENUECAT_API_KEY is required");
    });

    test("getCustomerFromApi throws without API key", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      await expect(
        t.run(async (ctx) => {
          await revenuecat.getCustomerFromApi(ctx as any, {
            appUserId: "user_api",
          });
        }),
      ).rejects.toThrow("REVENUECAT_API_KEY is required");
    });

    test("getCustomerFromApi throws without project ID", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat, {
        REVENUECAT_API_KEY: "sk_test_key",
      });

      await expect(
        t.run(async (ctx) => {
          await revenuecat.getCustomerFromApi(ctx as any, {
            appUserId: "user_api",
          });
        }),
      ).rejects.toThrow("REVENUECAT_PROJECT_ID is required");
    });

    test("deleteCustomerViaApi throws without API key", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      await expect(
        t.run(async (ctx) => {
          await revenuecat.deleteCustomerViaApi(ctx as any, {
            appUserId: "user_api",
          });
        }),
      ).rejects.toThrow("REVENUECAT_API_KEY is required");
    });

    test("updateAttributesViaApi throws without API key", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      await expect(
        t.run(async (ctx) => {
          await revenuecat.updateAttributesViaApi(ctx as any, {
            appUserId: "user_api",
            attributes: {
              custom_field: { value: "test" },
            },
          });
        }),
      ).rejects.toThrow("REVENUECAT_API_KEY is required");
    });

    test("getOfferingsViaApi throws without API key", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      await expect(
        t.run(async (ctx) => {
          await revenuecat.getOfferingsViaApi(ctx as any, {
            appUserId: "user_api",
          });
        }),
      ).rejects.toThrow("REVENUECAT_API_KEY is required");
    });
  });
});
