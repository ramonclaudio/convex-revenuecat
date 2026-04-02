import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

function createSubscriber(
  overrides: {
    entitlements?: Record<string, any>;
    subscriptions?: Record<string, any>;
    subscriber_attributes?: Record<string, any>;
    first_seen?: string;
    last_seen?: string;
    original_app_user_id?: string;
  } = {},
) {
  return {
    first_seen: overrides.first_seen ?? "2024-01-01T00:00:00Z",
    last_seen: overrides.last_seen ?? "2024-06-01T00:00:00Z",
    original_app_user_id: overrides.original_app_user_id,
    subscriber_attributes: overrides.subscriber_attributes,
    entitlements: overrides.entitlements ?? {
      premium: {
        expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
        product_identifier: "monthly_premium",
        purchase_date: "2024-01-01T00:00:00Z",
      },
    },
    subscriptions: overrides.subscriptions ?? {
      monthly_premium: {
        store: "APP_STORE",
        is_sandbox: false,
        period_type: "normal",
        expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
        purchase_date: "2024-01-01T00:00:00Z",
        original_purchase_date: "2024-01-01T00:00:00Z",
        store_transaction_id: "txn_abc123",
        ownership_type: "PURCHASED",
      },
    },
  };
}

describe("sync.ingest", () => {
  test("creates customer, subscription, and entitlement", async () => {
    const t = initConvexTest();

    const result = await t.mutation(api.sync.ingest, {
      appUserId: "user_sync_1",
      subscriber: createSubscriber(),
    });

    expect(result.subscriptions).toBe(1);
    expect(result.entitlements).toBe(1);

    const hasPremium = await t.query(api.entitlements.check, {
      appUserId: "user_sync_1",
      entitlementId: "premium",
    });
    expect(hasPremium).toBe(true);

    const customer = await t.query(api.customers.get, {
      appUserId: "user_sync_1",
    });
    expect(customer).not.toBeNull();

    const subs = await t.query(api.subscriptions.getActive, {
      appUserId: "user_sync_1",
    });
    expect(subs).toHaveLength(1);
    expect(subs[0].productId).toBe("monthly_premium");
    expect(subs[0].store).toBe("APP_STORE");
  });

  test("expired subscription marks entitlement inactive", async () => {
    const t = initConvexTest();

    await t.mutation(api.sync.ingest, {
      appUserId: "user_expired",
      subscriber: createSubscriber({
        entitlements: {
          premium: {
            expires_date: "2023-01-01T00:00:00Z",
            product_identifier: "monthly_premium",
            purchase_date: "2022-12-01T00:00:00Z",
          },
        },
        subscriptions: {
          monthly_premium: {
            store: "APP_STORE",
            is_sandbox: false,
            period_type: "normal",
            expires_date: "2023-01-01T00:00:00Z",
            purchase_date: "2022-12-01T00:00:00Z",
            original_purchase_date: "2022-12-01T00:00:00Z",
            store_transaction_id: "txn_expired",
            ownership_type: "PURCHASED",
          },
        },
      }),
    });

    const hasPremium = await t.query(api.entitlements.check, {
      appUserId: "user_expired",
      entitlementId: "premium",
    });
    expect(hasPremium).toBe(false);
  });

  test("updates existing records on re-sync", async () => {
    const t = initConvexTest();

    // First sync
    await t.mutation(api.sync.ingest, {
      appUserId: "user_resync",
      subscriber: createSubscriber(),
    });

    // Re-sync with updated expiration
    const newExpiry = new Date(Date.now() + 60 * 86400000).toISOString();
    await t.mutation(api.sync.ingest, {
      appUserId: "user_resync",
      subscriber: createSubscriber({
        entitlements: {
          premium: {
            expires_date: newExpiry,
            product_identifier: "monthly_premium",
            purchase_date: "2024-01-01T00:00:00Z",
          },
        },
        subscriptions: {
          monthly_premium: {
            store: "APP_STORE",
            is_sandbox: false,
            period_type: "normal",
            expires_date: newExpiry,
            purchase_date: "2024-01-01T00:00:00Z",
            original_purchase_date: "2024-01-01T00:00:00Z",
            store_transaction_id: "txn_abc123",
            ownership_type: "PURCHASED",
          },
        },
      }),
    });

    // Should still have exactly 1 subscription and 1 entitlement (not duplicated)
    const subs = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_resync",
    });
    expect(subs).toHaveLength(1);

    const ents = await t.query(api.entitlements.list, {
      appUserId: "user_resync",
    });
    expect(ents).toHaveLength(1);
  });

  test("multiple entitlements from different products", async () => {
    const t = initConvexTest();

    await t.mutation(api.sync.ingest, {
      appUserId: "user_multi",
      subscriber: createSubscriber({
        entitlements: {
          premium: {
            expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
            product_identifier: "monthly_premium",
            purchase_date: "2024-01-01T00:00:00Z",
          },
          pro_tools: {
            expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
            product_identifier: "pro_addon",
            purchase_date: "2024-02-01T00:00:00Z",
          },
        },
        subscriptions: {
          monthly_premium: {
            store: "APP_STORE",
            is_sandbox: false,
            period_type: "normal",
            expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
            purchase_date: "2024-01-01T00:00:00Z",
            original_purchase_date: "2024-01-01T00:00:00Z",
            store_transaction_id: "txn_1",
          },
          pro_addon: {
            store: "APP_STORE",
            is_sandbox: false,
            period_type: "normal",
            expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
            purchase_date: "2024-02-01T00:00:00Z",
            original_purchase_date: "2024-02-01T00:00:00Z",
            store_transaction_id: "txn_2",
          },
        },
      }),
    });

    const hasPremium = await t.query(api.entitlements.check, {
      appUserId: "user_multi",
      entitlementId: "premium",
    });
    const hasProTools = await t.query(api.entitlements.check, {
      appUserId: "user_multi",
      entitlementId: "pro_tools",
    });
    expect(hasPremium).toBe(true);
    expect(hasProTools).toBe(true);

    const subs = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_multi",
    });
    expect(subs).toHaveLength(2);
  });

  test("subscriber attributes are stored correctly", async () => {
    const t = initConvexTest();

    // Client SDK encodes $ keys via transformPayload before calling the mutation.
    // Tests call the mutation directly, so use pre-encoded keys.
    await t.mutation(api.sync.ingest, {
      appUserId: "user_attrs",
      subscriber: createSubscriber({
        subscriber_attributes: {
          __dollar__email: {
            value: "test@example.com",
            updated_at_ms: 1704067200000,
          },
          __dollar__displayName: {
            value: "Test User",
            updated_at_ms: 1704067200000,
          },
          custom_field: { value: "custom", updated_at_ms: 1704067200000 },
        },
      }),
    });

    const customer = await t.query(api.customers.get, {
      appUserId: "user_attrs",
    });
    expect(customer).not.toBeNull();
    expect(customer!.attributes).toBeDefined();
    expect(customer!.attributes!.__dollar__email.value).toBe(
      "test@example.com",
    );
    expect(customer!.attributes!.__dollar__displayName.value).toBe(
      "Test User",
    );
    expect(customer!.attributes!.custom_field.value).toBe("custom");
  });

  test("sandbox subscription sets isSandbox on entitlements", async () => {
    const t = initConvexTest();

    await t.mutation(api.sync.ingest, {
      appUserId: "user_sandbox",
      subscriber: createSubscriber({
        entitlements: {
          premium: {
            expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
            product_identifier: "monthly_premium",
            purchase_date: "2024-01-01T00:00:00Z",
          },
        },
        subscriptions: {
          monthly_premium: {
            store: "APP_STORE",
            is_sandbox: true,
            period_type: "trial",
            expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
            purchase_date: "2024-01-01T00:00:00Z",
            original_purchase_date: "2024-01-01T00:00:00Z",
            store_transaction_id: "txn_sandbox",
          },
        },
      }),
    });

    const ents = await t.query(api.entitlements.list, {
      appUserId: "user_sandbox",
    });
    expect(ents).toHaveLength(1);
    expect(ents[0].isSandbox).toBe(true);

    const subs = await t.query(api.subscriptions.getActive, {
      appUserId: "user_sandbox",
    });
    expect(subs).toHaveLength(1);
    expect(subs[0].periodType).toBe("TRIAL");
    expect(subs[0].environment).toBe("SANDBOX");
  });

  test("empty subscriber creates customer only", async () => {
    const t = initConvexTest();

    const result = await t.mutation(api.sync.ingest, {
      appUserId: "user_empty",
      subscriber: createSubscriber({
        entitlements: {},
        subscriptions: {},
      }),
    });

    expect(result.subscriptions).toBe(0);
    expect(result.entitlements).toBe(0);

    const customer = await t.query(api.customers.get, {
      appUserId: "user_empty",
    });
    expect(customer).not.toBeNull();
  });

  test("lifetime entitlement (no expires_date) is active", async () => {
    const t = initConvexTest();

    await t.mutation(api.sync.ingest, {
      appUserId: "user_lifetime",
      subscriber: createSubscriber({
        entitlements: {
          premium: {
            expires_date: null,
            product_identifier: "lifetime_premium",
            purchase_date: "2024-01-01T00:00:00Z",
          },
        },
        subscriptions: {
          lifetime_premium: {
            store: "APP_STORE",
            is_sandbox: false,
            period_type: "normal",
            expires_date: null,
            purchase_date: "2024-01-01T00:00:00Z",
            original_purchase_date: "2024-01-01T00:00:00Z",
            store_transaction_id: "txn_lifetime",
          },
        },
      }),
    });

    const hasPremium = await t.query(api.entitlements.check, {
      appUserId: "user_lifetime",
      entitlementId: "premium",
    });
    expect(hasPremium).toBe(true);
  });
});
