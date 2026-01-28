
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("entitlements", () => {
  test("check returns false when no entitlement exists", async () => {
    const t = initConvexTest();

    const result = await t.query(api.entitlements.check, {
      appUserId: "user_123",
      entitlementId: "premium",
    });

    expect(result).toBe(false);
  });

  test("check returns true when active entitlement exists", async () => {
    const t = initConvexTest();

    await t.mutation(internal.entitlements.grant, {
      appUserId: "user_123",
      entitlementId: "premium",
      isSandbox: false,
    });

    const result = await t.query(api.entitlements.check, {
      appUserId: "user_123",
      entitlementId: "premium",
    });

    expect(result).toBe(true);
  });

  test("check returns false when entitlement is revoked", async () => {
    const t = initConvexTest();

    await t.mutation(internal.entitlements.grant, {
      appUserId: "user_revoke",
      entitlementId: "premium",
      isSandbox: false,
    });

    await t.mutation(internal.entitlements.revoke, {
      appUserId: "user_revoke",
      entitlementId: "premium",
    });

    const result = await t.query(api.entitlements.check, {
      appUserId: "user_revoke",
      entitlementId: "premium",
    });

    expect(result).toBe(false);
  });

  test("check returns false when entitlement is expired", async () => {
    const t = initConvexTest();

    await t.mutation(internal.entitlements.grant, {
      appUserId: "user_expired",
      entitlementId: "premium",
      expiresAtMs: Date.now() - 1000,
      isSandbox: false,
    });

    const result = await t.query(api.entitlements.check, {
      appUserId: "user_expired",
      entitlementId: "premium",
    });

    expect(result).toBe(false);
  });

  test("list returns all entitlements for user", async () => {
    const t = initConvexTest();

    await t.mutation(internal.entitlements.grant, {
      appUserId: "user_list",
      entitlementId: "premium",
      isSandbox: false,
    });

    await t.mutation(internal.entitlements.grant, {
      appUserId: "user_list",
      entitlementId: "pro",
      isSandbox: false,
    });

    const entitlements = await t.query(api.entitlements.list, {
      appUserId: "user_list",
    });

    expect(entitlements).toHaveLength(2);
  });

  test("getActive returns only active non-expired entitlements", async () => {
    const t = initConvexTest();

    await t.mutation(internal.entitlements.grant, {
      appUserId: "user_active",
      entitlementId: "premium",
      isSandbox: false,
    });

    await t.mutation(internal.entitlements.grant, {
      appUserId: "user_active",
      entitlementId: "trial",
      expiresAtMs: Date.now() - 1000,
      isSandbox: false,
    });

    await t.mutation(internal.entitlements.grant, {
      appUserId: "user_active",
      entitlementId: "promo",
      isSandbox: false,
    });
    await t.mutation(internal.entitlements.revoke, {
      appUserId: "user_active",
      entitlementId: "promo",
    });

    const active = await t.query(api.entitlements.getActive, {
      appUserId: "user_active",
    });

    expect(active).toHaveLength(1);
    expect(active[0].entitlementId).toBe("premium");
  });

  test("grant updates existing entitlement", async () => {
    const t = initConvexTest();

    const id1 = await t.mutation(internal.entitlements.grant, {
      appUserId: "user_update",
      entitlementId: "premium",
      isSandbox: true,
    });

    const id2 = await t.mutation(internal.entitlements.grant, {
      appUserId: "user_update",
      entitlementId: "premium",
      productId: "new_product",
      isSandbox: false,
    });

    expect(id1).toBe(id2);

    const entitlements = await t.query(api.entitlements.list, {
      appUserId: "user_update",
    });

    expect(entitlements).toHaveLength(1);
    expect(entitlements[0].productId).toBe("new_product");
    expect(entitlements[0].isSandbox).toBe(false);
  });

  test("revoke returns false when entitlement not found", async () => {
    const t = initConvexTest();

    const result = await t.mutation(internal.entitlements.revoke, {
      appUserId: "nonexistent",
      entitlementId: "premium",
    });

    expect(result).toBe(false);
  });

  test("billing issue keeps entitlement active past expiresAtMs", async () => {
    const t = initConvexTest();

    const entId = await t.mutation(internal.entitlements.grant, {
      appUserId: "user_billing",
      entitlementId: "premium",
      expiresAtMs: Date.now() - 1000, // Past expiration
      isSandbox: false,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(entId, {
        billingIssueDetectedAt: Date.now() - 500,
      });
    });

    const result = await t.query(api.entitlements.check, {
      appUserId: "user_billing",
      entitlementId: "premium",
    });

    expect(result).toBe(true);
  });

  test("EXPIRATION clears billingIssueDetectedAt - no dirty state", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: {
        type: "INITIAL_PURCHASE",
        id: "evt_1",
        app_user_id: "user_revoke_clean",
        original_app_user_id: "user_revoke_clean",
        aliases: [],
        event_timestamp_ms: Date.now(),
        product_id: "premium",
        entitlement_ids: ["premium"],
        period_type: "NORMAL" as const,
        purchased_at_ms: Date.now(),
        expiration_at_ms: Date.now() + 1000,
        transaction_id: "txn_1",
        original_transaction_id: "txn_revoke",
        store: "APP_STORE" as const,
        environment: "SANDBOX" as const,
      },
    });

    await t.mutation(internal.handlers.processBillingIssue, {
      event: {
        type: "BILLING_ISSUE",
        id: "evt_2",
        app_user_id: "user_revoke_clean",
        original_app_user_id: "user_revoke_clean",
        aliases: [],
        event_timestamp_ms: Date.now(),
        product_id: "premium",
        entitlement_ids: ["premium"],
        period_type: "NORMAL" as const,
        purchased_at_ms: Date.now(),
        expiration_at_ms: Date.now() + 1000,
        transaction_id: "txn_1",
        original_transaction_id: "txn_revoke",
        store: "APP_STORE" as const,
        environment: "SANDBOX" as const,
        grace_period_expiration_at_ms: Date.now() + 7 * 24 * 60 * 60 * 1000,
      },
    });

    await t.mutation(internal.handlers.processExpiration, {
      event: {
        type: "EXPIRATION",
        id: "evt_3",
        app_user_id: "user_revoke_clean",
        original_app_user_id: "user_revoke_clean",
        aliases: [],
        event_timestamp_ms: Date.now(),
        product_id: "premium",
        entitlement_ids: ["premium"],
        period_type: "NORMAL" as const,
        purchased_at_ms: Date.now(),
        expiration_at_ms: Date.now() - 1000,
        transaction_id: "txn_1",
        original_transaction_id: "txn_revoke",
        store: "APP_STORE" as const,
        environment: "SANDBOX" as const,
        expiration_reason: "BILLING_ERROR",
      },
    });

    const ents = await t.query(api.entitlements.list, {
      appUserId: "user_revoke_clean",
    });

    expect(ents[0].isActive).toBe(false);
    expect(ents[0].billingIssueDetectedAt).toBeUndefined();
  });

  test("RENEWAL after billing issue clears state", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: {
        type: "INITIAL_PURCHASE",
        id: "evt_1",
        app_user_id: "user_recovered",
        original_app_user_id: "user_recovered",
        aliases: [],
        event_timestamp_ms: Date.now() - 10000,
        product_id: "premium",
        entitlement_ids: ["premium"],
        period_type: "NORMAL" as const,
        purchased_at_ms: Date.now() - 10000,
        expiration_at_ms: Date.now() - 1000,
        transaction_id: "txn_1",
        original_transaction_id: "txn_recovered",
        store: "APP_STORE" as const,
        environment: "SANDBOX" as const,
      },
    });

    await t.mutation(internal.handlers.processBillingIssue, {
      event: {
        type: "BILLING_ISSUE",
        id: "evt_2",
        app_user_id: "user_recovered",
        original_app_user_id: "user_recovered",
        aliases: [],
        event_timestamp_ms: Date.now() - 500,
        product_id: "premium",
        entitlement_ids: ["premium"],
        period_type: "NORMAL" as const,
        purchased_at_ms: Date.now() - 10000,
        expiration_at_ms: Date.now() - 1000,
        transaction_id: "txn_1",
        original_transaction_id: "txn_recovered",
        store: "APP_STORE" as const,
        environment: "SANDBOX" as const,
        grace_period_expiration_at_ms: Date.now() + 7 * 24 * 60 * 60 * 1000,
      },
    });

    await t.mutation(internal.handlers.processRenewal, {
      event: {
        type: "RENEWAL",
        id: "evt_3",
        app_user_id: "user_recovered",
        original_app_user_id: "user_recovered",
        aliases: [],
        event_timestamp_ms: Date.now(),
        product_id: "premium",
        entitlement_ids: ["premium"],
        period_type: "NORMAL" as const,
        purchased_at_ms: Date.now(),
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
        transaction_id: "txn_2",
        original_transaction_id: "txn_recovered",
        store: "APP_STORE" as const,
        environment: "SANDBOX" as const,
      },
    });

    const ents = await t.query(api.entitlements.list, {
      appUserId: "user_recovered",
    });

    expect(ents[0].billingIssueDetectedAt).toBeUndefined();
    expect(ents[0].isActive).toBe(true);
    expect(ents[0].expiresAtMs).toBeGreaterThan(Date.now());
  });
});
