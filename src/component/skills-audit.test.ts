import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

describe("PURCHASE_REDEEMED", () => {
  test("grants entitlements for a non-transfer redemption", async () => {
    const t = initConvexTest();
    const payload = {
      type: "PURCHASE_REDEEMED",
      id: "evt_redeem_grant",
      app_id: "app_123",
      app_user_id: "user_redeem_grant",
      event_timestamp_ms: Date.now(),
      product_id: "premium_monthly",
      entitlement_ids: ["premium"],
      store: "RC_BILLING",
      environment: "PRODUCTION",
      expiration_at_ms: Date.now() + MONTH_MS,
    };

    await t.mutation(internal.webhooks.process, {
      event: {
        id: payload.id,
        type: payload.type,
        app_id: payload.app_id,
        app_user_id: payload.app_user_id,
        environment: "PRODUCTION" as const,
        store: "RC_BILLING" as const,
      },
      payload,
    });

    expect(
      await t.query(api.entitlements.check, {
        appUserId: "user_redeem_grant",
        entitlementId: "premium",
      }),
    ).toBe(true);
  });

  test("skips the grant for a transfer outcome (companion TRANSFER moves entitlements)", async () => {
    const t = initConvexTest();
    const payload = {
      type: "PURCHASE_REDEEMED",
      id: "evt_redeem_transfer",
      app_id: "app_123",
      app_user_id: "user_redeem_dest",
      event_timestamp_ms: Date.now(),
      product_id: "premium_monthly",
      entitlement_ids: ["premium"],
      redemption_outcome: "transfer",
      store: "RC_BILLING",
      environment: "PRODUCTION",
      expiration_at_ms: Date.now() + MONTH_MS,
    };

    await t.mutation(internal.webhooks.process, {
      event: {
        id: payload.id,
        type: payload.type,
        app_id: payload.app_id,
        app_user_id: payload.app_user_id,
        environment: "PRODUCTION" as const,
        store: "RC_BILLING" as const,
      },
      payload,
    });

    expect(
      await t.query(api.entitlements.check, {
        appUserId: "user_redeem_dest",
        entitlementId: "premium",
      }),
    ).toBe(false);
  });
});

describe("virtual currency replay", () => {
  test("balance is not double-applied when a transaction id replays under a new event id", async () => {
    const t = initConvexTest();
    const userId = "user_vc_replay";
    const adjustment = {
      type: "VIRTUAL_CURRENCY_TRANSACTION",
      app_user_id: userId,
      environment: "PRODUCTION",
      virtual_currency_transaction_id: "vct_replay",
      event_timestamp_ms: Date.now(),
      adjustments: [{ amount: 100, currency: { code: "COINS", name: "Coins" } }],
    };

    // Same tx id, two distinct event ids (RC at-least-once delivery edge).
    for (const eventId of ["evt_vc_replay_a", "evt_vc_replay_b"]) {
      await t.mutation(internal.webhooks.process, {
        event: {
          id: eventId,
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: userId,
          environment: "PRODUCTION" as const,
        },
        payload: { ...adjustment, id: eventId },
      });
    }

    const balance = await t.query(api.virtualCurrency.getBalance, {
      appUserId: userId,
      currencyCode: "COINS",
    });
    expect(balance?.balance).toBe(100);

    const txns = await t.query(api.virtualCurrency.listTransactions, {
      appUserId: userId,
    });
    expect(txns.length).toBe(1);
  });
});

describe("invoice priceUsd currency gate", () => {
  test("priceUsd is set only when the invoice currency is USD", async () => {
    const t = initConvexTest();

    const issue = async (id: string, user: string, currency: string, price: number) => {
      await t.mutation(internal.webhooks.process, {
        event: {
          id,
          type: "INVOICE_ISSUANCE",
          app_user_id: user,
          environment: "PRODUCTION" as const,
        },
        payload: {
          id,
          type: "INVOICE_ISSUANCE",
          app_user_id: user,
          environment: "PRODUCTION",
          event_timestamp_ms: Date.now(),
          price,
          currency,
          price_in_purchased_currency: price,
        },
      });
    };

    await issue("inv_eur", "user_inv_eur", "EUR", 9.99);
    await issue("inv_usd", "user_inv_usd", "USD", 4.99);

    const { eur, usd } = await t.run(async (ctx) => ({
      eur: await ctx.db
        .query("invoices")
        .withIndex("by_invoice_id", (q) => q.eq("invoiceId", "inv_eur"))
        .first(),
      usd: await ctx.db
        .query("invoices")
        .withIndex("by_invoice_id", (q) => q.eq("invoiceId", "inv_usd"))
        .first(),
    }));

    expect(eur?.priceUsd).toBeUndefined();
    expect(eur?.priceInPurchasedCurrency).toBe(9.99);
    expect(eur?.currency).toBe("EUR");
    expect(usd?.priceUsd).toBe(4.99);
  });
});

describe("GDPR purge of transfer audit rows", () => {
  test("removes the TRANSFER webhookEvent (stored with a null appUserId)", async () => {
    const t = initConvexTest();

    await t.mutation(internal.webhooks.process, {
      event: {
        id: "evt_transfer_purge",
        type: "TRANSFER",
        environment: "PRODUCTION" as const,
      },
      payload: {
        id: "evt_transfer_purge",
        type: "TRANSFER",
        environment: "PRODUCTION",
        event_timestamp_ms: Date.now(),
        transferred_from: ["user_transfer_src"],
        transferred_to: ["user_transfer_dst"],
        entitlement_ids: ["premium"],
      },
    });

    const result = await t.mutation(api.customers.purge, {
      appUserId: "user_transfer_dst",
    });
    expect(result.transfers).toBe(1);
    expect(result.webhookEvents).toBe(1);

    const auditRow = await t.run(async (ctx) =>
      ctx.db
        .query("webhookEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", "evt_transfer_purge"))
        .first(),
    );
    expect(auditRow).toBeNull();
  });
});

describe("grace period sub/entitlement consistency", () => {
  test("subscription and entitlement agree during a billing-issue grace period", async () => {
    const t = initConvexTest();
    const userId = "user_grace_consistency";
    const now = Date.now();
    const past = now - 60_000; // original period just ended
    const graceEnd = now + 7 * 24 * 60 * 60 * 1000;
    const base = {
      app_id: "app_123",
      app_user_id: userId,
      event_timestamp_ms: now,
      product_id: "premium_monthly",
      entitlement_ids: ["premium"],
      period_type: "NORMAL",
      store: "APP_STORE",
      environment: "SANDBOX",
      original_transaction_id: "txn_grace",
      transaction_id: "txn_grace",
      expiration_at_ms: past,
    };
    const event = (id: string, type: string) => ({
      id,
      type,
      app_user_id: userId,
      environment: "SANDBOX" as const,
      store: "APP_STORE" as const,
    });

    await t.mutation(internal.webhooks.process, {
      event: event("evt_grace_init", "INITIAL_PURCHASE"),
      payload: { ...base, id: "evt_grace_init", type: "INITIAL_PURCHASE" },
    });
    await t.mutation(internal.webhooks.process, {
      event: event("evt_grace_billing", "BILLING_ISSUE"),
      payload: {
        ...base,
        id: "evt_grace_billing",
        type: "BILLING_ISSUE",
        grace_period_expiration_at_ms: graceEnd,
      },
    });

    // The entitlement gate (expiry pushed to grace-end at write time) and the
    // subscription grace-fold (Math.max(expiry, graceEnd) live) must agree:
    // both active through grace even though the original period has ended.
    expect(
      await t.query(api.entitlements.check, {
        appUserId: userId,
        entitlementId: "premium",
      }),
    ).toBe(true);
    expect(
      await t.query(api.subscriptions.getActive, { appUserId: userId }),
    ).toHaveLength(1);
    const grace = await t.query(api.subscriptions.isInGracePeriod, {
      originalTransactionId: "txn_grace",
    });
    expect(grace.inGracePeriod).toBe(true);
  });
});
