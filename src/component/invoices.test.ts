import { describe, expect, test } from "vitest";
import { initConvexTest } from "./setup.test.js";
import { api } from "./_generated/api.js";

describe("invoices", () => {
  describe("get", () => {
    test("returns null for non-existent invoice", async () => {
      const t = initConvexTest();
      const result = await t.query(api.invoices.get, {
        invoiceId: "nonexistent",
      });
      expect(result).toBeNull();
    });

    test("returns invoice after INVOICE_ISSUANCE event", async () => {
      const t = initConvexTest();

      // INVOICE_ISSUANCE uses event.id as the invoice identifier (no separate invoice_id field)
      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_invoice_1",
          type: "INVOICE_ISSUANCE",
          app_user_id: "user_invoice_1",
          environment: "PRODUCTION" as const,
          store: "RC_BILLING" as const,
        },
        payload: {
          id: "evt_invoice_1",
          type: "INVOICE_ISSUANCE",
          event_timestamp_ms: Date.now(),
          app_user_id: "user_invoice_1",
          product_id: "pro_monthly",
          store: "RC_BILLING",
          environment: "PRODUCTION",
          price: 9.99,
          currency: "USD",
          price_in_purchased_currency: 9.99,
        },
      });

      const result = await t.query(api.invoices.get, {
        invoiceId: "evt_invoice_1", // Uses event id as invoice id
      });

      expect(result).not.toBeNull();
      expect(result?.invoiceId).toBe("evt_invoice_1");
      expect(result?.appUserId).toBe("user_invoice_1");
      expect(result?.productId).toBe("pro_monthly");
      expect(result?.priceUsd).toBe(9.99);
      expect(result?.currency).toBe("USD");
    });
  });

  describe("listByUser", () => {
    test("returns empty array for user with no invoices", async () => {
      const t = initConvexTest();
      const result = await t.query(api.invoices.listByUser, {
        appUserId: "user_no_invoices",
      });
      expect(result).toEqual([]);
    });

    test("returns all invoices for user", async () => {
      const t = initConvexTest();
      const userId = "user_multi_invoice";

      for (let i = 1; i <= 3; i++) {
        await t.mutation(api.webhooks.process, {
          event: {
            id: `evt_inv_${i}`,
            type: "INVOICE_ISSUANCE",
            app_user_id: userId,
            environment: "PRODUCTION" as const,
            store: "RC_BILLING" as const,
          },
          payload: {
            id: `evt_inv_${i}`,
            type: "INVOICE_ISSUANCE",
            event_timestamp_ms: Date.now() + i,
            app_user_id: userId,
            store: "RC_BILLING",
            environment: "PRODUCTION",
          },
        });
      }

      const result = await t.query(api.invoices.listByUser, {
        appUserId: userId,
      });

      expect(result.length).toBe(3);
    });
  });
});
