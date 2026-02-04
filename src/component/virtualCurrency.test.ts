import { describe, expect, test } from "vitest";
import { initConvexTest } from "./setup.test.js";
import { api, internal } from "./_generated/api.js";

describe("virtualCurrency", () => {
  describe("getBalance", () => {
    test("returns null for non-existent balance", async () => {
      const t = initConvexTest();
      const result = await t.query(internal.virtualCurrency.getBalance, {
        appUserId: "user_no_currency",
        currencyCode: "COINS",
      });
      expect(result).toBeNull();
    });

    test("returns balance after VIRTUAL_CURRENCY_TRANSACTION event", async () => {
      const t = initConvexTest();

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_vc_1",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: "user_vc_1",
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_vc_1",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          event_timestamp_ms: Date.now(),
          app_user_id: "user_vc_1",
          environment: "PRODUCTION",
          virtual_currency_transaction_id: "vct_123",
          source: "in_app_purchase",
          adjustments: [
            {
              amount: 100,
              currency: {
                code: "COINS",
                name: "Gold Coins",
                description: "In-game currency",
              },
            },
          ],
        },
      });

      const result = await t.query(internal.virtualCurrency.getBalance, {
        appUserId: "user_vc_1",
        currencyCode: "COINS",
      });

      expect(result).not.toBeNull();
      expect(result?.balance).toBe(100);
      expect(result?.currencyName).toBe("Gold Coins");
    });

    test("accumulates balance from multiple transactions", async () => {
      const t = initConvexTest();
      const userId = "user_vc_accumulate";

      // First transaction: +100
      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_vc_add",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: userId,
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_vc_add",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          event_timestamp_ms: Date.now(),
          app_user_id: userId,
          environment: "PRODUCTION",
          virtual_currency_transaction_id: "vct_add",
          adjustments: [
            {
              amount: 100,
              currency: { code: "GEMS", name: "Gems" },
            },
          ],
        },
      });

      // Second transaction: -30 (refund)
      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_vc_sub",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: userId,
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_vc_sub",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          event_timestamp_ms: Date.now(),
          app_user_id: userId,
          environment: "PRODUCTION",
          virtual_currency_transaction_id: "vct_sub",
          adjustments: [
            {
              amount: -30,
              currency: { code: "GEMS", name: "Gems" },
            },
          ],
        },
      });

      const result = await t.query(internal.virtualCurrency.getBalance, {
        appUserId: userId,
        currencyCode: "GEMS",
      });

      expect(result?.balance).toBe(70);
    });
  });

  describe("listBalances", () => {
    test("returns all currency balances for user", async () => {
      const t = initConvexTest();
      const userId = "user_multi_currency";

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_vc_multi",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: userId,
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_vc_multi",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          event_timestamp_ms: Date.now(),
          app_user_id: userId,
          environment: "PRODUCTION",
          virtual_currency_transaction_id: "vct_multi",
          adjustments: [
            { amount: 100, currency: { code: "COINS", name: "Coins" } },
            { amount: 50, currency: { code: "GEMS", name: "Gems" } },
          ],
        },
      });

      const result = await t.query(internal.virtualCurrency.listBalances, {
        appUserId: userId,
      });

      expect(result.length).toBe(2);
      const codes = result.map((b: { currencyCode: string }) => b.currencyCode);
      expect(codes).toContain("COINS");
      expect(codes).toContain("GEMS");
    });
  });

  describe("listTransactions", () => {
    test("returns all transactions for user", async () => {
      const t = initConvexTest();
      const userId = "user_tx_list";

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_tx_1",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: userId,
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_tx_1",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          event_timestamp_ms: Date.now(),
          app_user_id: userId,
          environment: "PRODUCTION",
          virtual_currency_transaction_id: "vct_1",
          source: "in_app_purchase",
          adjustments: [{ amount: 100, currency: { code: "COINS", name: "Coins" } }],
        },
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_tx_2",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: userId,
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_tx_2",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          event_timestamp_ms: Date.now(),
          app_user_id: userId,
          environment: "PRODUCTION",
          virtual_currency_transaction_id: "vct_2",
          source: "admin_api",
          adjustments: [{ amount: 50, currency: { code: "COINS", name: "Coins" } }],
        },
      });

      const result = await t.query(internal.virtualCurrency.listTransactions, {
        appUserId: userId,
      });

      expect(result.length).toBe(2);
    });

    test("filters transactions by currency code", async () => {
      const t = initConvexTest();
      const userId = "user_tx_filter";

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_tx_coins",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: userId,
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_tx_coins",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          event_timestamp_ms: Date.now(),
          app_user_id: userId,
          environment: "PRODUCTION",
          virtual_currency_transaction_id: "vct_coins",
          adjustments: [{ amount: 100, currency: { code: "COINS", name: "Coins" } }],
        },
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_tx_gems",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: userId,
          environment: "PRODUCTION" as const,
        },
        payload: {
          id: "evt_tx_gems",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          event_timestamp_ms: Date.now(),
          app_user_id: userId,
          environment: "PRODUCTION",
          virtual_currency_transaction_id: "vct_gems",
          adjustments: [{ amount: 50, currency: { code: "GEMS", name: "Gems" } }],
        },
      });

      const coinsOnly = await t.query(internal.virtualCurrency.listTransactions, {
        appUserId: userId,
        currencyCode: "COINS",
      });

      expect(coinsOnly.length).toBe(1);
      expect(coinsOnly[0].currencyCode).toBe("COINS");
    });
  });
});
