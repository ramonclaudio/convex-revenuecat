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
