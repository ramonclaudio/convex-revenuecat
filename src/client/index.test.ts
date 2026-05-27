import { describe, expect, test } from "vitest";
import { RevenueCat, willRenew } from "./index.js";
import type { Subscription } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";

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
    original_app_user_id:
      overrides.original_app_user_id ?? overrides.app_user_id ?? "user_123",
    aliases: [],
    event_timestamp_ms: Date.now(),
    product_id: overrides.product_id ?? "premium_monthly",
    entitlement_ids: overrides.entitlement_ids ?? ["premium"],
    period_type: "NORMAL" as const,
    purchased_at_ms: Date.now(),
    expiration_at_ms:
      overrides.expiration_at_ms ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
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
      expect(result.map((e) => e.entitlementId).sort()).toEqual([
        "premium",
        "pro",
      ]);
    });
  });

  describe("getActiveSubscriptions", () => {
    test("returns active subscriptions", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

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
    test("returns all entitlements including inactive via webhook events", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);

      const purchasePayload = createEventPayload({
        id: "evt_all_ent_1",
        app_user_id: "user_all_ent",
        entitlement_ids: ["premium", "pro"],
      });

      await t.run(async (ctx) => {
        await ctx.runMutation(components.revenuecat.webhooks.process, {
          event: {
            id: purchasePayload.id,
            type: purchasePayload.type,
            app_user_id: purchasePayload.app_user_id,
            environment: purchasePayload.environment,
            store: purchasePayload.store,
          },
          payload: purchasePayload,
        });
      });

      const expirationPayload = {
        ...purchasePayload,
        id: "evt_all_ent_2",
        type: "EXPIRATION",
        entitlement_ids: ["pro"],
        expiration_reason: "BILLING_ERROR",
      };

      await t.run(async (ctx) => {
        await ctx.runMutation(components.revenuecat.webhooks.process, {
          event: {
            id: expirationPayload.id,
            type: expirationPayload.type,
            app_user_id: expirationPayload.app_user_id,
            environment: expirationPayload.environment,
            store: expirationPayload.store,
          },
          payload: expirationPayload,
        });
      });

      const all = await t.run(async (ctx) => {
        return await revenuecat.getAllEntitlements(ctx, {
          appUserId: "user_all_ent",
        });
      });

      expect(all.length).toBe(2);

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

      const expiredPayload = {
        ...createEventPayload({
          id: "evt_all_subs_2",
          app_user_id: "user_all_subs",
          product_id: "yearly_basic",
          expiration_at_ms: Date.now() - 1000,
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

      const all = await t.run(async (ctx) => {
        return await revenuecat.getAllSubscriptions(ctx, {
          appUserId: "user_all_subs",
        });
      });

      expect(all.length).toBe(2);

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

  describe("willRenew helper", () => {
    function sub(overrides: Partial<Subscription> = {}): Subscription {
      return {
        _id: "x" as Subscription["_id"],
        _creationTime: 0,
        appUserId: "u",
        productId: "p",
        store: "APP_STORE",
        environment: "PRODUCTION",
        periodType: "NORMAL",
        purchasedAtMs: 0,
        expirationAtMs: Date.now() + 86400000,
        originalTransactionId: "otxn",
        transactionId: "txn",
        isFamilyShare: false,
        updatedAt: 0,
        ...overrides,
      };
    }

    test("returns true for a normal active sub", () => {
      expect(willRenew(sub())).toBe(true);
    });

    test("returns false for lifetime (no expiration)", () => {
      expect(willRenew(sub({ expirationAtMs: undefined }))).toBe(false);
    });

    test("returns false for PREPAID period type", () => {
      expect(willRenew(sub({ periodType: "PREPAID" }))).toBe(false);
    });

    test("returns false for PROMOTIONAL store", () => {
      expect(willRenew(sub({ store: "PROMOTIONAL" }))).toBe(false);
    });

    test("returns false when unsubscribeDetectedAt is set", () => {
      expect(willRenew(sub({ unsubscribeDetectedAt: Date.now() }))).toBe(false);
    });

    test("returns false when billingIssueDetectedAt is set", () => {
      expect(willRenew(sub({ billingIssueDetectedAt: Date.now() }))).toBe(
        false,
      );
    });
  });

  describe("convenience helpers", () => {
    async function setupActiveUser(
      t: ReturnType<typeof initConvexTest>,
      appUserId: string,
    ) {
      await t.mutation(components.revenuecat.webhooks.process, {
        event: {
          id: `evt_setup_${appUserId}`,
          type: "INITIAL_PURCHASE",
          app_user_id: appUserId,
          environment: "SANDBOX" as const,
          store: "APP_STORE" as const,
        },
        payload: createEventPayload({
          id: `evt_setup_${appUserId}`,
          app_user_id: appUserId,
          entitlement_ids: ["premium"],
        }),
      });
    }

    test("getEntitlement returns the matching active entitlement", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);
      await setupActiveUser(t, "user_helper_1");
      const result = await t.run((ctx) =>
        revenuecat.getEntitlement(ctx, {
          appUserId: "user_helper_1",
          entitlementId: "premium",
        }),
      );
      expect(result?.entitlementId).toBe("premium");
      expect(result?.isActive).toBe(true);
    });

    test("getEntitlement returns null for unknown entitlement", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);
      await setupActiveUser(t, "user_helper_2");
      const result = await t.run((ctx) =>
        revenuecat.getEntitlement(ctx, {
          appUserId: "user_helper_2",
          entitlementId: "ultra_pro",
        }),
      );
      expect(result).toBeNull();
    });

    test("hasAnyEntitlement true when active, false when none", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);
      await setupActiveUser(t, "user_helper_3");
      const yes = await t.run((ctx) =>
        revenuecat.hasAnyEntitlement(ctx, { appUserId: "user_helper_3" }),
      );
      const no = await t.run((ctx) =>
        revenuecat.hasAnyEntitlement(ctx, { appUserId: "user_helper_none" }),
      );
      expect(yes).toBe(true);
      expect(no).toBe(false);
    });

    test("isSubscriber tracks active subscriptions", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);
      await setupActiveUser(t, "user_helper_4");
      const yes = await t.run((ctx) =>
        revenuecat.isSubscriber(ctx, { appUserId: "user_helper_4" }),
      );
      expect(yes).toBe(true);
    });

    test("isInTrial true when an active sub is in TRIAL period", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);
      await t.mutation(components.revenuecat.webhooks.process, {
        event: {
          id: "evt_trial",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_trial",
          environment: "SANDBOX" as const,
          store: "APP_STORE" as const,
        },
        payload: {
          ...createEventPayload({ app_user_id: "user_trial" }),
          period_type: "TRIAL",
        },
      });
      const result = await t.run((ctx) =>
        revenuecat.isInTrial(ctx, { appUserId: "user_trial" }),
      );
      expect(result).toBe(true);
    });

    test("getLatestSubscription picks the most recent purchase", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);
      const earlier = Date.now() - 1_000_000;
      const later = Date.now();

      for (const [i, ts] of [earlier, later].entries()) {
        await t.mutation(components.revenuecat.webhooks.process, {
          event: {
            id: `evt_latest_${i}`,
            type: "INITIAL_PURCHASE",
            app_user_id: "user_latest",
            environment: "SANDBOX" as const,
            store: "APP_STORE" as const,
          },
          payload: {
            ...createEventPayload({
              id: `evt_latest_${i}`,
              app_user_id: "user_latest",
              product_id: `product_${i}`,
            }),
            purchased_at_ms: ts,
            original_transaction_id: `otxn_latest_${i}`,
            transaction_id: `txn_latest_${i}`,
          },
        });
      }

      const result = await t.run((ctx) =>
        revenuecat.getLatestSubscription(ctx, { appUserId: "user_latest" }),
      );
      expect(result?.purchasedAtMs).toBe(later);
      expect(result?.productId).toBe("product_1");
    });

    test("getRenewsAtMs returns expiry only when willRenew is true", async () => {
      const t = initConvexTest();
      const revenuecat = new RevenueCat(components.revenuecat);
      await setupActiveUser(t, "user_renews");
      const result = await t.run((ctx) =>
        revenuecat.getRenewsAtMs(ctx, {
          appUserId: "user_renews",
          entitlementId: "premium",
        }),
      );
      expect(typeof result).toBe("number");
    });
  });
});
