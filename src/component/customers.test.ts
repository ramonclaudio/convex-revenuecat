/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

const makeEventPayload = (overrides: Record<string, unknown> = {}) => ({
  type: "INITIAL_PURCHASE",
  id: `evt_${Date.now()}`,
  app_id: "app_123",
  app_user_id: "user_123",
  original_app_user_id: "user_123",
  aliases: ["user_123"],
  event_timestamp_ms: Date.now(),
  product_id: "premium_monthly",
  entitlement_ids: ["premium"],
  period_type: "NORMAL" as const,
  purchased_at_ms: Date.now(),
  expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
  transaction_id: "txn_123",
  original_transaction_id: "txn_123",
  store: "APP_STORE" as const,
  environment: "SANDBOX" as const,
  is_family_share: false,
  ...overrides,
});

describe("customers", () => {
  test("get returns null when customer not found", async () => {
    const t = initConvexTest();

    const result = await t.query(api.customers.get, {
      appUserId: "nonexistent",
    });

    expect(result).toBeNull();
  });

  test("processInitialPurchase creates customer", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_new",
        original_app_user_id: "user_new",
        aliases: ["user_new"],
      }),
    });

    const customer = await t.query(api.customers.get, {
      appUserId: "user_new",
    });

    expect(customer).not.toBeNull();
    expect(customer?.appUserId).toBe("user_new");
    expect(customer?.aliases).toContain("user_new");
  });

  test("subsequent events update customer and merge aliases", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_456",
        aliases: ["user_456"],
      }),
    });

    await t.mutation(internal.handlers.processRenewal, {
      event: makeEventPayload({
        app_user_id: "user_456",
        aliases: ["alias_1", "alias_2"],
      }),
    });

    const customer = await t.query(api.customers.get, {
      appUserId: "user_456",
    });

    expect(customer?.aliases).toContain("user_456");
    expect(customer?.aliases).toContain("alias_1");
    expect(customer?.aliases).toContain("alias_2");
    expect(customer?.aliases).toHaveLength(3);
  });

  test("getByOriginalId finds customer", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_789",
        original_app_user_id: "original_789",
      }),
    });

    const customer = await t.query(api.customers.getByOriginalId, {
      originalAppUserId: "original_789",
    });

    expect(customer).not.toBeNull();
    expect(customer?.appUserId).toBe("user_789");
  });

  test("getByOriginalId returns null when not found", async () => {
    const t = initConvexTest();

    const customer = await t.query(api.customers.getByOriginalId, {
      originalAppUserId: "nonexistent",
    });

    expect(customer).toBeNull();
  });

  test("firstSeenAt preserved on subsequent events", async () => {
    const t = initConvexTest();

    const firstSeenAt = Date.now() - 1000000;

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_preserve",
        event_timestamp_ms: firstSeenAt,
      }),
    });

    await t.mutation(internal.handlers.processRenewal, {
      event: makeEventPayload({
        app_user_id: "user_preserve",
        event_timestamp_ms: Date.now(),
        aliases: ["new_alias"],
      }),
    });

    const customer = await t.query(api.customers.get, {
      appUserId: "user_preserve",
    });

    expect(customer?.firstSeenAt).toBe(firstSeenAt);
  });

  describe("purge", () => {
    test("deletes customer and all related rows for an appUserId", async () => {
      const t = initConvexTest();
      const userId = "user_to_purge";

      // Seed every table the purge mutation targets.
      await t.mutation(internal.handlers.processInitialPurchase, {
        event: makeEventPayload({
          app_user_id: userId,
          original_app_user_id: userId,
          entitlement_ids: ["premium", "pro"],
          experiments: [
            {
              experiment_id: "exp_a",
              experiment_variant: "b",
              enrolled_at_ms: Date.now(),
            },
          ],
        }),
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("invoices", {
          invoiceId: "inv_1",
          appUserId: userId,
          environment: "PRODUCTION",
          issuedAt: Date.now(),
        });
        await ctx.db.insert("virtualCurrencyBalances", {
          appUserId: userId,
          currencyCode: "GLD",
          currencyName: "Gold",
          balance: 100,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("virtualCurrencyTransactions", {
          transactionId: "vc_tx_1",
          appUserId: userId,
          currencyCode: "GLD",
          amount: 100,
          environment: "PRODUCTION",
          timestamp: Date.now(),
        });
      });

      const result = await t.mutation(api.customers.purge, { appUserId: userId });

      expect(result.customer).toBe(1);
      expect(result.subscriptions).toBe(1);
      expect(result.entitlements).toBe(2);
      expect(result.experiments).toBe(1);
      expect(result.invoices).toBe(1);
      expect(result.virtualCurrencyBalances).toBe(1);
      expect(result.virtualCurrencyTransactions).toBe(1);
      expect(result.webhookEvents).toBe(0); // appUserId not set on the webhook event row for this handler path

      expect(await t.query(api.customers.get, { appUserId: userId })).toBeNull();
      expect(
        await t.query(api.subscriptions.getByUser, { appUserId: userId }),
      ).toHaveLength(0);
      expect(
        await t.query(api.entitlements.list, { appUserId: userId }),
      ).toHaveLength(0);
    });

    test("leaves other users' data intact", async () => {
      const t = initConvexTest();

      await t.mutation(internal.handlers.processInitialPurchase, {
        event: makeEventPayload({ app_user_id: "user_keep", entitlement_ids: ["keep_me"] }),
      });
      await t.mutation(internal.handlers.processInitialPurchase, {
        event: makeEventPayload({
          app_user_id: "user_go",
          original_transaction_id: "txn_go",
          transaction_id: "txn_go",
          entitlement_ids: ["delete_me"],
        }),
      });

      await t.mutation(api.customers.purge, { appUserId: "user_go" });

      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_keep",
          entitlementId: "keep_me",
        }),
      ).toBe(true);
      expect(
        await t.query(api.customers.get, { appUserId: "user_keep" }),
      ).not.toBeNull();
    });

    test("returns zeroes for unknown user", async () => {
      const t = initConvexTest();
      const result = await t.mutation(api.customers.purge, {
        appUserId: "ghost",
      });
      expect(result).toEqual({
        customer: 0,
        subscriptions: 0,
        entitlements: 0,
        experiments: 0,
        invoices: 0,
        virtualCurrencyBalances: 0,
        virtualCurrencyTransactions: 0,
        webhookEvents: 0,
      });
    });
  });

  test("subscriber_attributes merged with updated_at_ms priority", async () => {
    const t = initConvexTest();

    const oldTime = Date.now() - 10000;
    const newTime = Date.now();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_attrs",
        subscriber_attributes: {
          email: { value: "old@test.com", updated_at_ms: oldTime },
          name: { value: "Old Name", updated_at_ms: newTime },
        },
      }),
    });

    await t.mutation(internal.handlers.processRenewal, {
      event: makeEventPayload({
        app_user_id: "user_attrs",
        subscriber_attributes: {
          email: { value: "new@test.com", updated_at_ms: newTime },
          name: { value: "Ignored Name", updated_at_ms: oldTime },
        },
      }),
    });

    const customer = await t.query(api.customers.get, {
      appUserId: "user_attrs",
    });

    expect(customer?.attributes?.email?.value).toBe("new@test.com");
    expect(customer?.attributes?.name?.value).toBe("Old Name");
  });
});
