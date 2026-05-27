import type { FunctionHandle, GenericMutationCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel.js";

type MutationCtx = GenericMutationCtx<DataModel>;
type EntitlementDoc = Doc<"entitlements">;

/**
 * Arguments delivered to `onEntitlementActivated`. The hook fires once per
 * (appUserId, entitlementId) transition from not-active to active, regardless
 * of the triggering event type (INITIAL_PURCHASE, RENEWAL, REFUND_REVERSED,
 * TRANSFER onto a user, SUBSCRIBER_ALIAS, sync-driven activation, etc).
 *
 * `sourceEventType` is the RC webhook `event.type` that caused the
 * transition (e.g., `"INITIAL_PURCHASE"`), or `"SYNC"` when the transition
 * was detected by `syncSubscriber`.
 */
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

/**
 * Arguments delivered to `onEntitlementDeactivated`. Fires once per
 * (appUserId, entitlementId) transition from active to not-active, whether
 * caused by EXPIRATION, refund CANCELLATION, TRANSFER off a user, or sync.
 *
 * Fields reflect the entitlement's state BEFORE deactivation so consumers
 * can log/attribute/notify with the product that the user just lost.
 */
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

// Hooks cross the boundary as opaque `FunctionHandle` strings, symbol-keyed
// markers on `FunctionReference` are stripped through mutation args.
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

/** Every appUserId the payload could affect: `app_user_id`,
 * `original_app_user_id`, `transferred_from/to`, plus `aliases`. */
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

/** Active entitlements per user, keyed by entitlementId. Diff before/after
 * drives hook scheduling. */
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
        .collect(),
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

/** Schedule hooks for each before→after transition. Atomic with the
 * enclosing mutation. */
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

/** Hook arg shape on `webhooks.process` / `sync.ingest`. */
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
