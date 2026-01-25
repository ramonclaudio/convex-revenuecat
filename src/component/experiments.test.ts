/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("experiments", () => {
  test("list returns empty array when no experiments", async () => {
    const t = initConvexTest();

    const experiments = await t.query(api.experiments.list, {
      appUserId: "user_no_experiments",
    });

    expect(experiments).toEqual([]);
  });

  test("list returns all experiments for a customer", async () => {
    const t = initConvexTest();

    // Insert experiments directly
    await t.run(async (ctx) => {
      await ctx.db.insert("experiments", {
        appUserId: "user_with_experiments",
        experimentId: "exp_pricing",
        variant: "high_price",
        enrolledAtMs: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("experiments", {
        appUserId: "user_with_experiments",
        experimentId: "exp_onboarding",
        variant: "skip_tutorial",
        enrolledAtMs: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const experiments = await t.query(api.experiments.list, {
      appUserId: "user_with_experiments",
    });

    expect(experiments).toHaveLength(2);
    const experimentIds = experiments.map((e) => e.experimentId);
    expect(experimentIds).toContain("exp_pricing");
    expect(experimentIds).toContain("exp_onboarding");
  });

  test("get returns null when experiment not found", async () => {
    const t = initConvexTest();

    const experiment = await t.query(api.experiments.get, {
      appUserId: "user_123",
      experimentId: "nonexistent_exp",
    });

    expect(experiment).toBeNull();
  });

  test("get returns specific experiment enrollment", async () => {
    const t = initConvexTest();
    const enrolledAt = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("experiments", {
        appUserId: "user_get_test",
        experimentId: "exp_specific",
        variant: "treatment_b",
        enrolledAtMs: enrolledAt,
        updatedAt: Date.now(),
      });
    });

    const experiment = await t.query(api.experiments.get, {
      appUserId: "user_get_test",
      experimentId: "exp_specific",
    });

    expect(experiment).not.toBeNull();
    expect(experiment?.variant).toBe("treatment_b");
    expect(experiment?.enrolledAtMs).toBe(enrolledAt);
  });

  test("listByExperiment returns empty array when no enrollments", async () => {
    const t = initConvexTest();

    const enrollments = await t.query(api.experiments.listByExperiment, {
      experimentId: "exp_no_enrollments",
    });

    expect(enrollments).toEqual([]);
  });

  test("listByExperiment returns all customers in experiment", async () => {
    const t = initConvexTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("experiments", {
        appUserId: "user_a",
        experimentId: "exp_shared",
        variant: "control",
        enrolledAtMs: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("experiments", {
        appUserId: "user_b",
        experimentId: "exp_shared",
        variant: "treatment",
        enrolledAtMs: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("experiments", {
        appUserId: "user_c",
        experimentId: "exp_other",
        variant: "control",
        enrolledAtMs: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const enrollments = await t.query(api.experiments.listByExperiment, {
      experimentId: "exp_shared",
    });

    expect(enrollments).toHaveLength(2);
    const userIds = enrollments.map((e) => e.appUserId);
    expect(userIds).toContain("user_a");
    expect(userIds).toContain("user_b");
    expect(userIds).not.toContain("user_c");
  });
});
