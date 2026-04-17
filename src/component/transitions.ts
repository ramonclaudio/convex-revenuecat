import type { FunctionHandle, GenericMutationCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel.js";

type MutationCtx = GenericMutationCtx<DataModel>;
type EntitlementDoc = Doc<"entitlements">;

/**
 * Arguments delivered to `onEntitlementActivated`. The hook fires once per
 * (appUserId, entitlementId) transition from not-active to active, regardless
 * of the triggering event type (INITIAL_PURCHASE, RENEWAL, REFUND_REVERSED,
 * TRANSFER onto a user, SUBSCRIBER_ALIAS, sync-driven activation, etc).
 */
export type EntitlementActivatedArgs = {
  appUserId: string;
  entitlementId: string;
  productId?: string;
  expiresAtMs?: number;
  store?: EntitlementDoc["store"];
};

/**
 * Arguments delivered to `onEntitlementDeactivated`. Fires once per
 * (appUserId, entitlementId) transition from active to not-active, whether
 * caused by EXPIRATION, refund CANCELLATION, TRANSFER off a user, or sync.
 */
export type EntitlementDeactivatedArgs = {
  appUserId: string;
  entitlementId: string;
  productId?: string;
};

// Hooks cross the component boundary as `FunctionHandle` strings (produced via
// `createFunctionHandle` in the client SDK) because `FunctionReference`
// internal markers are symbol-keyed and get stripped by JSON serialization
// through mutation args. The component side treats them as opaque handles and
// hands them directly to `ctx.scheduler.runAfter`.
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

/**
 * Collect every appUserId the payload could have modified. Most events carry
 * `app_user_id`; SUBSCRIBER_ALIAS carries `original_app_user_id`; TRANSFER
 * carries `transferred_from` and `transferred_to` arrays.
 */
export function affectedUserIds(payload: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.length > 0) ids.add(v);
  };
  add(payload.app_user_id);
  add(payload.original_app_user_id);
  for (const key of ["transferred_from", "transferred_to"] as const) {
    const arr = payload[key];
    if (Array.isArray(arr)) for (const v of arr) add(v);
  }
  return [...ids];
}

/**
 * Snapshot each user's currently-active entitlements keyed by entitlementId.
 * Called before and after the event handler runs; the diff drives hook
 * scheduling.
 */
export async function snapshotEntitlements(
  ctx: MutationCtx,
  appUserIds: string[],
): Promise<Map<string, Map<string, EntitlementDoc>>> {
  const now = Date.now();
  const result = new Map<string, Map<string, EntitlementDoc>>();
  for (const userId of appUserIds) {
    const ents = await ctx.db
      .query("entitlements")
      .withIndex("by_app_user", (q) => q.eq("appUserId", userId))
      .collect();
    const active = new Map<string, EntitlementDoc>();
    for (const ent of ents) {
      if (isEffectivelyActive(ent, now)) {
        active.set(ent.entitlementId, ent);
      }
    }
    result.set(userId, active);
  }
  return result;
}

/**
 * Diff two snapshots and schedule the registered hooks for each transition.
 * Scheduling is atomic with the enclosing mutation — if the mutation rolls
 * back, the scheduled jobs never materialize. If a consumer registered both
 * hooks and both are no-op, this is effectively free (returns early on an
 * empty hooks object).
 */
export async function fireTransitionHooks(
  ctx: MutationCtx,
  hooks: LifecycleHooks | undefined,
  before: Map<string, Map<string, EntitlementDoc>>,
  after: Map<string, Map<string, EntitlementDoc>>,
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
            expiresAtMs: ent.expiresAtMs,
            store: ent.store,
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
          });
        }
      }
    }
  }
}

/**
 * Validator shape for the optional hooks arg on `webhooks.process` and
 * `sync.ingest`. FunctionReferences serialize opaquely across the wire so we
 * accept `v.any()` for each entry; the scheduler resolves them at runtime.
 */
export type HooksArg = {
  onEntitlementActivated?: string;
  onEntitlementDeactivated?: string;
};

/**
 * Cast opaque FunctionHandle strings to their typed `LifecycleHooks` form for
 * the scheduler.
 */
export function resolveHooks(hooks: HooksArg | undefined): LifecycleHooks | undefined {
  if (!hooks) return undefined;
  const resolved: LifecycleHooks = {};
  if (hooks.onEntitlementActivated) {
    resolved.onEntitlementActivated = hooks.onEntitlementActivated as
      | EntitlementActivatedHook;
  }
  if (hooks.onEntitlementDeactivated) {
    resolved.onEntitlementDeactivated = hooks.onEntitlementDeactivated as
      | EntitlementDeactivatedHook;
  }
  if (!resolved.onEntitlementActivated && !resolved.onEntitlementDeactivated) {
    return undefined;
  }
  return resolved;
}
