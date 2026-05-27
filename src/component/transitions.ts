import type { FunctionHandle, GenericMutationCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel.js";

type MutationCtx = GenericMutationCtx<DataModel>;
type EntitlementDoc = Doc<"entitlements">;

export type EntitlementActivatedArgs = {
  appUserId: string;
  entitlementId: string;
  productId?: string;
  purchasedAtMs?: number;
  expiresAtMs?: number;
  store?: EntitlementDoc["store"];
  ownershipType?: EntitlementDoc["ownershipType"];
  isSandbox: boolean;
  sourceEventType: string;
};

export type EntitlementDeactivatedArgs = {
  appUserId: string;
  entitlementId: string;
  productId?: string;
  purchasedAtMs?: number;
  expiresAtMs?: number;
  store?: EntitlementDoc["store"];
  ownershipType?: EntitlementDoc["ownershipType"];
  isSandbox: boolean;
  sourceEventType: string;
};

export type EntitlementActivatedHook = FunctionHandle<
  "mutation" | "action",
  EntitlementActivatedArgs,
  unknown
>;

export type EntitlementDeactivatedHook = FunctionHandle<
  "mutation" | "action",
  EntitlementDeactivatedArgs,
  unknown
>;

export type LifecycleHooks = {
  onEntitlementActivated?: EntitlementActivatedHook;
  onEntitlementDeactivated?: EntitlementDeactivatedHook;
};

function isEffectivelyActive(ent: EntitlementDoc, now: number): boolean {
  if (!ent.isActive) return false;
  if (ent.expiresAtMs === undefined) return true;
  return ent.expiresAtMs > now;
}

export function affectedUserIds(payload: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.length > 0) ids.add(v);
  };
  add(payload.app_user_id);
  add(payload.original_app_user_id);
  for (const key of [
    "transferred_from",
    "transferred_to",
    "aliases",
  ] as const) {
    const arr = payload[key];
    if (Array.isArray(arr)) for (const v of arr) add(v);
  }
  return [...ids];
}

const SNAPSHOT_ENTITLEMENT_CAP = 500;

export async function snapshotEntitlements(
  ctx: MutationCtx,
  appUserIds: string[],
): Promise<Map<string, Map<string, EntitlementDoc>>> {
  const now = Date.now();
  const perUser = await Promise.all(
    appUserIds.map((userId) =>
      ctx.db
        .query("entitlements")
        .withIndex("by_app_user", (q) => q.eq("appUserId", userId))
        .take(SNAPSHOT_ENTITLEMENT_CAP),
    ),
  );
  const result = new Map<string, Map<string, EntitlementDoc>>();
  for (let i = 0; i < appUserIds.length; i++) {
    const active = new Map<string, EntitlementDoc>();
    for (const ent of perUser[i]) {
      if (isEffectivelyActive(ent, now)) {
        active.set(ent.entitlementId, ent);
      }
    }
    result.set(appUserIds[i], active);
  }
  return result;
}

export async function fireTransitionHooks(
  ctx: MutationCtx,
  hooks: LifecycleHooks | undefined,
  before: Map<string, Map<string, EntitlementDoc>>,
  after: Map<string, Map<string, EntitlementDoc>>,
  sourceEventType: string,
): Promise<void> {
  if (!hooks) return;
  const { onEntitlementActivated, onEntitlementDeactivated } = hooks;
  if (!onEntitlementActivated && !onEntitlementDeactivated) return;

  const users = new Set<string>([...before.keys(), ...after.keys()]);
  for (const userId of users) {
    const pre = before.get(userId) ?? new Map();
    const post = after.get(userId) ?? new Map();

    if (onEntitlementActivated) {
      for (const [entId, ent] of post) {
        if (!pre.has(entId)) {
          await ctx.scheduler.runAfter(0, onEntitlementActivated, {
            appUserId: userId,
            entitlementId: entId,
            productId: ent.productId,
            purchasedAtMs: ent.purchasedAtMs,
            expiresAtMs: ent.expiresAtMs,
            store: ent.store,
            ownershipType: ent.ownershipType,
            isSandbox: ent.isSandbox,
            sourceEventType,
          });
        }
      }
    }

    if (onEntitlementDeactivated) {
      for (const [entId, ent] of pre) {
        if (!post.has(entId)) {
          await ctx.scheduler.runAfter(0, onEntitlementDeactivated, {
            appUserId: userId,
            entitlementId: entId,
            productId: ent.productId,
            purchasedAtMs: ent.purchasedAtMs,
            expiresAtMs: ent.expiresAtMs,
            store: ent.store,
            ownershipType: ent.ownershipType,
            isSandbox: ent.isSandbox,
            sourceEventType,
          });
        }
      }
    }
  }
}

export type HooksArg = {
  onEntitlementActivated?: string;
  onEntitlementDeactivated?: string;
};

export function resolveHooks(
  hooks: HooksArg | undefined,
): LifecycleHooks | undefined {
  if (!hooks) return undefined;
  const resolved: LifecycleHooks = {};
  if (hooks.onEntitlementActivated) {
    resolved.onEntitlementActivated =
      hooks.onEntitlementActivated as EntitlementActivatedHook;
  }
  if (hooks.onEntitlementDeactivated) {
    resolved.onEntitlementDeactivated =
      hooks.onEntitlementDeactivated as EntitlementDeactivatedHook;
  }
  if (!resolved.onEntitlementActivated && !resolved.onEntitlementDeactivated) {
    return undefined;
  }
  return resolved;
}
