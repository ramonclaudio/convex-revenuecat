/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("cleanup", () => {
  describe("rateLimits", () => {
    test("should delete rate limit entries older than 1 minute", async () => {
      const t = initConvexTest();

      const now = Date.now();
      const oldTimestamp = now - 120000;
      const recentTimestamp = now - 30000;

      await t.run(async (ctx) => {
        await ctx.db.insert("rateLimits", {
          key: "old1",
          timestamp: oldTimestamp,
        });
        await ctx.db.insert("rateLimits", {
          key: "old2",
          timestamp: oldTimestamp - 60000,
        });
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("rateLimits", {
          key: "recent1",
          timestamp: recentTimestamp,
        });
        await ctx.db.insert("rateLimits", { key: "recent2", timestamp: now });
      });

      const result = await t.mutation(internal.cleanup.rateLimits, {});
      expect(result.deleted).toBe(2);
      expect(result.scheduledContinuation).toBe(false);

      const remaining = await t.run(async (ctx) => {
        return await ctx.db.query("rateLimits").collect();
      });

      expect(remaining).toHaveLength(2);
      expect(remaining.map((r) => r.key).sort()).toEqual([
        "recent1",
        "recent2",
      ]);
    });

    test("should return 0 when no old entries exist", async () => {
      const t = initConvexTest();

      const now = Date.now();

      await t.run(async (ctx) => {
        await ctx.db.insert("rateLimits", { key: "recent", timestamp: now });
      });

      const result = await t.mutation(internal.cleanup.rateLimits, {});
      expect(result.deleted).toBe(0);

      const remaining = await t.run(async (ctx) => {
        return await ctx.db.query("rateLimits").collect();
      });

      expect(remaining).toHaveLength(1);
    });

    test("should handle empty table", async () => {
      const t = initConvexTest();

      const result = await t.mutation(internal.cleanup.rateLimits, {});
      expect(result.deleted).toBe(0);
    });
  });

  describe("webhookEvents", () => {
    test("should delete events older than 30 days", async () => {
      const t = initConvexTest();

      const now = Date.now();
      const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
      const twentyNineDaysAgo = now - 29 * 24 * 60 * 60 * 1000;

      await t.run(async (ctx) => {
        await ctx.db.insert("webhookEvents", {
          eventId: "old_evt",
          eventType: "TEST",
          environment: "SANDBOX",
          payload: {},
          processedAt: thirtyOneDaysAgo,
          status: "processed",
        });
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("webhookEvents", {
          eventId: "recent_evt",
          eventType: "TEST",
          environment: "SANDBOX",
          payload: {},
          processedAt: twentyNineDaysAgo,
          status: "processed",
        });
      });

      const result = await t.mutation(internal.cleanup.webhookEvents, {});
      expect(result.deleted).toBe(1);
      expect(result.scheduledContinuation).toBe(false);

      const remaining = await t.run(async (ctx) => {
        return await ctx.db.query("webhookEvents").collect();
      });

      expect(remaining).toHaveLength(1);
      expect(remaining[0].eventId).toBe("recent_evt");
    });

    test("should handle empty table", async () => {
      const t = initConvexTest();

      const result = await t.mutation(internal.cleanup.webhookEvents, {});
      expect(result.deleted).toBe(0);
      expect(result.scheduledContinuation).toBe(false);
    });

    test("drains past the prior 500-per-run cap in a single invocation", async () => {
      const t = initConvexTest();
      const now = Date.now();
      const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;

      // Seed more than the old 500-cap worth of stale events to prove the
      // cron no longer stalls under high inflow.
      await t.run(async (ctx) => {
        for (let i = 0; i < 1200; i++) {
          await ctx.db.insert("webhookEvents", {
            eventId: `old_${i}`,
            eventType: "TEST",
            environment: "SANDBOX",
            payload: {},
            processedAt: thirtyOneDaysAgo - i,
            status: "processed",
          });
        }
      });

      const result = await t.mutation(internal.cleanup.webhookEvents, {});
      expect(result.deleted).toBe(1200);
      expect(result.scheduledContinuation).toBe(false);

      const remaining = await t.run(async (ctx) => {
        return await ctx.db.query("webhookEvents").collect();
      });
      expect(remaining).toHaveLength(0);
    });

    test("stops early when encountering a not-yet-expired event", async () => {
      const t = initConvexTest();
      const now = Date.now();
      const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
      const twentyNineDaysAgo = now - 29 * 24 * 60 * 60 * 1000;

      // Two old, one recent interleaved. Ascending scan stops at the recent one.
      await t.run(async (ctx) => {
        await ctx.db.insert("webhookEvents", {
          eventId: "old_1",
          eventType: "TEST",
          environment: "SANDBOX",
          payload: {},
          processedAt: thirtyOneDaysAgo,
          status: "processed",
        });
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("webhookEvents", {
          eventId: "old_2",
          eventType: "TEST",
          environment: "SANDBOX",
          payload: {},
          processedAt: thirtyOneDaysAgo + 1,
          status: "processed",
        });
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("webhookEvents", {
          eventId: "recent_1",
          eventType: "TEST",
          environment: "SANDBOX",
          payload: {},
          processedAt: twentyNineDaysAgo,
          status: "processed",
        });
      });

      const result = await t.mutation(internal.cleanup.webhookEvents, {});
      expect(result.deleted).toBe(2);
      expect(result.scheduledContinuation).toBe(false);
    });
  });
});
