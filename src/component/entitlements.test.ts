import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { initConvexTest } from "./setup.test.js";

async function grantEnt(
  t: ReturnType<typeof initConvexTest>,
  args: {
    appUserId: string;
    entitlementId: string;
    productId?: string;
    expiresAtMs?: number;
    purchasedAtMs?: number;
    isSandbox: boolean;
  },
): Promise<Id<"entitlements">> {
  return await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q
          .eq("appUserId", args.appUserId)
          .eq("entitlementId", args.entitlementId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        isActive: true,
        productId: args.productId,
        expiresAtMs: args.expiresAtMs,
        purchasedAtMs: args.purchasedAtMs ?? now,
        isSandbox: args.isSandbox,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("entitlements", {
      appUserId: args.appUserId,
      entitlementId: args.entitlementId,
      productId: args.productId,
      isActive: true,
      expiresAtMs: args.expiresAtMs,
      purchasedAtMs: args.purchasedAtMs ?? now,
      isSandbox: args.isSandbox,
      updatedAt: now,
    });
  });
}

async function revokeEnt(
  t: ReturnType<typeof initConvexTest>,
  args: { appUserId: string; entitlementId: string },
): Promise<void> {
  await t.run(async (ctx) => {
    const ent = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user_entitlement", (q) =>
        q
          .eq("appUserId", args.appUserId)
          .eq("entitlementId", args.entitlementId),
      )
      .first();
    if (ent) {
      await ctx.db.patch(ent._id, { isActive: false, updatedAt: Date.now() });
    }
  });
}

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

    await grantEnt(t, {
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

    await grantEnt(t, {
      appUserId: "user_revoke",
      entitlementId: "premium",
      isSandbox: false,
    });

    await revokeEnt(t, {
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

    await grantEnt(t, {
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

    await grantEnt(t, {
      appUserId: "user_list",
      entitlementId: "premium",
      isSandbox: false,
    });

    await grantEnt(t, {
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

    await grantEnt(t, {
      appUserId: "user_active",
      entitlementId: "premium",
      isSandbox: false,
    });

    await grantEnt(t, {
      appUserId: "user_active",
      entitlementId: "trial",
      expiresAtMs: Date.now() - 1000,
      isSandbox: false,
    });

    await grantEnt(t, {
      appUserId: "user_active",
      entitlementId: "promo",
      isSandbox: false,
    });
    await revokeEnt(t, {
      appUserId: "user_active",
      entitlementId: "promo",
    });

    const active = await t.query(api.entitlements.getActive, {
      appUserId: "user_active",
    });

    expect(active).toHaveLength(1);
    expect(active[0].entitlementId).toBe("premium");
  });

  test("getActive includes entitlement in grace period (expiresAtMs extended to grace end)", async () => {
    const t = initConvexTest();
    const graceEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;

    const entId = await grantEnt(t, {
      appUserId: "user_billing_active",
      entitlementId: "premium",
      expiresAtMs: graceEnd,
      isSandbox: false,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(entId, {
        billingIssueDetectedAt: Date.now() - 500,
      });
    });

    const active = await t.query(api.entitlements.getActive, {
      appUserId: "user_billing_active",
    });

    expect(active).toHaveLength(1);
    expect(active[0].entitlementId).toBe("premium");
    expect(active[0].billingIssueDetectedAt).toBeDefined();
  });

  test("billingIssueDetectedAt alone does NOT keep access past expiresAtMs", async () => {
    const t = initConvexTest();

    const entId = await grantEnt(t, {
      appUserId: "user_billing",
      entitlementId: "premium",
      expiresAtMs: Date.now() - 1000,
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

    expect(result).toBe(false);
  });

  test("grace period access requires expiresAtMs in the future", async () => {
    const t = initConvexTest();
    const graceEnd = Date.now() + 3 * 24 * 60 * 60 * 1000;

    const entId = await grantEnt(t, {
      appUserId: "user_grace",
      entitlementId: "premium",
      expiresAtMs: graceEnd,
      isSandbox: false,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(entId, {
        billingIssueDetectedAt: Date.now() - 500,
      });
    });

    expect(
      await t.query(api.entitlements.check, {
        appUserId: "user_grace",
        entitlementId: "premium",
      }),
    ).toBe(true);
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
