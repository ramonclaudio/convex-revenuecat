/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
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

    await t.mutation(api.entitlements.grant, {
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

    await t.mutation(api.entitlements.grant, {
      appUserId: "user_revoke",
      entitlementId: "premium",
      isSandbox: false,
    });

    await t.mutation(api.entitlements.revoke, {
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

    await t.mutation(api.entitlements.grant, {
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

    await t.mutation(api.entitlements.grant, {
      appUserId: "user_list",
      entitlementId: "premium",
      isSandbox: false,
    });

    await t.mutation(api.entitlements.grant, {
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

    // Active entitlement
    await t.mutation(api.entitlements.grant, {
      appUserId: "user_active",
      entitlementId: "premium",
      isSandbox: false,
    });

    // Expired entitlement
    await t.mutation(api.entitlements.grant, {
      appUserId: "user_active",
      entitlementId: "trial",
      expiresAtMs: Date.now() - 1000,
      isSandbox: false,
    });

    // Revoked entitlement
    await t.mutation(api.entitlements.grant, {
      appUserId: "user_active",
      entitlementId: "promo",
      isSandbox: false,
    });
    await t.mutation(api.entitlements.revoke, {
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

    const id1 = await t.mutation(api.entitlements.grant, {
      appUserId: "user_update",
      entitlementId: "premium",
      isSandbox: true,
    });

    const id2 = await t.mutation(api.entitlements.grant, {
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

    const result = await t.mutation(api.entitlements.revoke, {
      appUserId: "nonexistent",
      entitlementId: "premium",
    });

    expect(result).toBe(false);
  });
});
