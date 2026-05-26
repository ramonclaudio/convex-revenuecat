import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

describe("PURCHASE_REDEEMED", () => {
  test("alias outcome merges the original purchaser's access onto the redeemer", async () => {
    const t = initConvexTest();
    const anon = "$RCAnonymousID:redeem_anon";
    const redeemer = "user_redeemer";
    const future = Date.now() + MONTH_MS;

    // Seed the original Web Billing purchase under the anonymous purchaser.
    await t.mutation(api.webhooks.process, {
      event: {
        id: "evt_redeem_seed",
        type: "INITIAL_PURCHASE",
        app_user_id: anon,
        environment: "PRODUCTION" as const,
        store: "RC_BILLING" as const,
      },
      payload: {
        id: "evt_redeem_seed",
        type: "INITIAL_PURCHASE",
        app_user_id: anon,
        event_timestamp_ms: Date.now(),
        product_id: "premium_monthly",
        entitlement_ids: ["premium"],
        period_type: "NORMAL",
        store: "RC_BILLING",
        environment: "PRODUCTION",
        original_transaction_id: "txn_redeem",
        transaction_id: "txn_redeem",
        expiration_at_ms: future,
      },
    });

    // Redeem: the redeemer is aliased to the anonymous purchaser. No top-level
    // app_user_id; redeemer in redeemed_by, original in redeemed_from.
    await t.mutation(api.webhooks.process, {
      event: {
        id: "evt_redeem_alias",
        type: "PURCHASE_REDEEMED",
        environment: "PRODUCTION" as const,
      },
      payload: {
        id: "evt_redeem_alias",
        type: "PURCHASE_REDEEMED",
        event_timestamp_ms: Date.now(),
        environment: "PRODUCTION",
        redeemed_from: [anon],
        redeemed_by: [redeemer],
        redemption_outcome: "alias",
        entitlement_ids: ["premium"],
      },
    });

    // Access moved to the redeemer carrying the original expiry, and the
    // anonymous source no longer holds it. (No lifetime grant was minted.)
    expect(
      await t.query(api.entitlements.check, {
        appUserId: redeemer,
        entitlementId: "premium",
      }),
    ).toBe(true);
    expect(
      await t.query(api.entitlements.check, {
        appUserId: anon,
        entitlementId: "premium",
      }),
    ).toBe(false);
  });

  test("transfer outcome defers to the companion TRANSFER (no grant here)", async () => {
    const t = initConvexTest();
    const redeemer = "user_xfer_dest";

    await t.mutation(api.webhooks.process, {
      event: {
        id: "evt_redeem_xfer",
        type: "PURCHASE_REDEEMED",
        environment: "PRODUCTION" as const,
      },
      payload: {
        id: "evt_redeem_xfer",
        type: "PURCHASE_REDEEMED",
        event_timestamp_ms: Date.now(),
        environment: "PRODUCTION",
        redeemed_from: ["$RCAnonymousID:xfer_src"],
        redeemed_by: [redeemer],
        redemption_outcome: "transfer",
        entitlement_ids: ["premium"],
      },
    });

    // PURCHASE_REDEEMED alone grants nothing on a transfer outcome; the
    // companion TRANSFER (not sent here) carries the real movement.
    expect(
      await t.query(api.entitlements.check, {
        appUserId: redeemer,
        entitlementId: "premium",
      }),
    ).toBe(false);
  });
});

describe("virtual currency", () => {
  test("balance is not double-applied when a transaction id replays under a new event id", async () => {
    const t = initConvexTest();
    const userId = "user_vc_replay";
    const adjustment = {
      type: "VIRTUAL_CURRENCY_TRANSACTION",
      app_user_id: userId,
      environment: "PRODUCTION",
      virtual_currency_transaction_id: "vct_replay",
      event_timestamp_ms: Date.now(),
      adjustments: [
        { amount: 100, currency: { code: "COINS", name: "Coins" } },
      ],
    };

    // Same tx id, two distinct event ids (RC at-least-once delivery edge).
    for (const eventId of ["evt_vc_replay_a", "evt_vc_replay_b"]) {
      await t.mutation(api.webhooks.process, {
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

  test("balance is clamped at 0 to mirror RC (no negative balances)", async () => {
    const t = initConvexTest();
    const userId = "user_vc_clamp";
    const adjust = (id: string, amount: number) => ({
      event: {
        id,
        type: "VIRTUAL_CURRENCY_TRANSACTION",
        app_user_id: userId,
        environment: "PRODUCTION" as const,
      },
      payload: {
        id,
        type: "VIRTUAL_CURRENCY_TRANSACTION",
        app_user_id: userId,
        environment: "PRODUCTION",
        virtual_currency_transaction_id: `vct_${id}`,
        event_timestamp_ms: Date.now(),
        adjustments: [{ amount, currency: { code: "COINS", name: "Coins" } }],
      },
    });

    await t.mutation(api.webhooks.process, adjust("clamp_grant", 50));
    await t.mutation(api.webhooks.process, adjust("clamp_spend", -80));

    const balance = await t.query(api.virtualCurrency.getBalance, {
      appUserId: userId,
      currencyCode: "COINS",
    });
    expect(balance?.balance).toBe(0); // not -30
  });
});

describe("invoice price fields", () => {
  test("priceUsd holds RC's USD-normalized price regardless of purchase currency", async () => {
    const t = initConvexTest();

    await t.mutation(api.webhooks.process, {
      event: {
        id: "inv_eur",
        type: "INVOICE_ISSUANCE",
        app_user_id: "user_inv_eur",
        environment: "PRODUCTION" as const,
      },
      payload: {
        id: "inv_eur",
        type: "INVOICE_ISSUANCE",
        app_user_id: "user_inv_eur",
        environment: "PRODUCTION",
        event_timestamp_ms: Date.now(),
        price: 10.5, // RC `price` is the USD price of the transaction
        currency: "EUR",
        price_in_purchased_currency: 9.99,
      },
    });

    const inv = await t.run(async (ctx) =>
      ctx.db
        .query("invoices")
        .withIndex("by_invoice_id", (q) => q.eq("invoiceId", "inv_eur"))
        .first(),
    );
    expect(inv?.priceUsd).toBe(10.5);
    expect(inv?.priceInPurchasedCurrency).toBe(9.99);
    expect(inv?.currency).toBe("EUR");
  });
});

describe("GDPR purge of transfer audit rows", () => {
  test("removes the TRANSFER webhookEvent (stored with a null appUserId)", async () => {
    const t = initConvexTest();

    await t.mutation(api.webhooks.process, {
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

    await t.mutation(api.webhooks.process, {
      event: event("evt_grace_init", "INITIAL_PURCHASE"),
      payload: { ...base, id: "evt_grace_init", type: "INITIAL_PURCHASE" },
    });
    await t.mutation(api.webhooks.process, {
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
