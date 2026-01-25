/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("subscriptions", () => {
  test("getByUser returns empty array when no subscriptions", async () => {
    const t = initConvexTest();

    const result = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_123",
    });

    expect(result).toEqual([]);
  });

  test("upsert creates new subscription", async () => {
    const t = initConvexTest();

    const id = await t.mutation(api.subscriptions.upsert, {
      appUserId: "user_123",
      productId: "premium_monthly",
      store: "APP_STORE",
      environment: "SANDBOX",
      periodType: "NORMAL",
      purchasedAtMs: Date.now(),
      expirationAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
      originalTransactionId: "txn_123",
      transactionId: "txn_123",
      isFamilyShare: false,
    });

    expect(id).toBeDefined();

    const subs = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_123",
    });

    expect(subs).toHaveLength(1);
    expect(subs[0].productId).toBe("premium_monthly");
  });

  test("upsert updates existing subscription by originalTransactionId", async () => {
    const t = initConvexTest();

    await t.mutation(api.subscriptions.upsert, {
      appUserId: "user_456",
      productId: "premium_monthly",
      store: "APP_STORE",
      environment: "SANDBOX",
      periodType: "TRIAL",
      purchasedAtMs: Date.now(),
      originalTransactionId: "txn_456",
      transactionId: "txn_456",
      isFamilyShare: false,
    });

    // Update with renewal
    await t.mutation(api.subscriptions.upsert, {
      appUserId: "user_456",
      productId: "premium_monthly",
      store: "APP_STORE",
      environment: "SANDBOX",
      periodType: "NORMAL",
      purchasedAtMs: Date.now(),
      expirationAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
      originalTransactionId: "txn_456",
      transactionId: "txn_456_renewal",
      isFamilyShare: false,
      isTrialConversion: true,
    });

    const subs = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_456",
    });

    expect(subs).toHaveLength(1);
    expect(subs[0].periodType).toBe("NORMAL");
    expect(subs[0].isTrialConversion).toBe(true);
  });

  test("getActive filters expired subscriptions", async () => {
    const t = initConvexTest();

    // Create active subscription
    await t.mutation(api.subscriptions.upsert, {
      appUserId: "user_789",
      productId: "premium_monthly",
      store: "APP_STORE",
      environment: "SANDBOX",
      periodType: "NORMAL",
      purchasedAtMs: Date.now(),
      expirationAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
      originalTransactionId: "txn_active",
      transactionId: "txn_active",
      isFamilyShare: false,
    });

    // Create expired subscription
    await t.mutation(api.subscriptions.upsert, {
      appUserId: "user_789",
      productId: "basic_monthly",
      store: "APP_STORE",
      environment: "SANDBOX",
      periodType: "NORMAL",
      purchasedAtMs: Date.now() - 60 * 24 * 60 * 60 * 1000,
      expirationAtMs: Date.now() - 1000,
      originalTransactionId: "txn_expired",
      transactionId: "txn_expired",
      isFamilyShare: false,
    });

    const active = await t.query(api.subscriptions.getActive, {
      appUserId: "user_789",
    });

    expect(active).toHaveLength(1);
    expect(active[0].productId).toBe("premium_monthly");
  });

  test("getByOriginalTransaction finds subscription", async () => {
    const t = initConvexTest();

    await t.mutation(api.subscriptions.upsert, {
      appUserId: "user_lookup",
      productId: "premium_monthly",
      store: "PLAY_STORE",
      environment: "PRODUCTION",
      periodType: "NORMAL",
      purchasedAtMs: Date.now(),
      originalTransactionId: "GPA.1234-5678",
      transactionId: "GPA.1234-5678",
      isFamilyShare: false,
    });

    const sub = await t.query(api.subscriptions.getByOriginalTransaction, {
      originalTransactionId: "GPA.1234-5678",
    });

    expect(sub).not.toBeNull();
    expect(sub?.appUserId).toBe("user_lookup");
  });

  test("getByOriginalTransaction returns null when not found", async () => {
    const t = initConvexTest();

    const sub = await t.query(api.subscriptions.getByOriginalTransaction, {
      originalTransactionId: "nonexistent",
    });

    expect(sub).toBeNull();
  });
});
