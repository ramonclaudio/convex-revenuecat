import { expect, test } from "vitest";
import { RevenueCat } from "./index.js";
import type { FunctionReference } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

type Expect<T extends true> = T;

// 1. A deployed consumer's `components.revenuecat` resolves to
//    `ComponentApi<"revenuecat">`, which must satisfy the `RevenueCat`
//    constructor so the documented `new RevenueCat(components.revenuecat, ...)`
//    call typechecks.
type CtorAcceptsComponentApi = Expect<
  ComponentApi<"revenuecat"> extends ConstructorParameters<typeof RevenueCat>[0]
    ? true
    : false
>;

// 2. `component.ts` is real `npx convex codegen` output. Convex omits a
//    component's internalMutation/internalQuery from ComponentApi entirely and
//    emits the PUBLIC ones with "internal" visibility. Lock the
//    parent/consumer-called functions: if any is switched to internalMutation
//    it vanishes from ComponentApi and this typecheck fails, which is exactly
//    the break that left the client unable to call `webhooks.process`.
type IsInternal<T> =
  T extends FunctionReference<any, "internal", any, any, any> ? true : false;
type Api = ComponentApi<"revenuecat">;
type AllTrue<_T extends readonly true[]> = true;
type ParentCallableArePresent = AllTrue<
  [
    // Called by the client (src/client/index.ts).
    IsInternal<Api["webhooks"]["process"]>,
    IsInternal<Api["webhooks"]["recordFailure"]>,
    IsInternal<Api["customers"]["get"]>,
    IsInternal<Api["customers"]["purge"]>,
    IsInternal<Api["entitlements"]["check"]>,
    IsInternal<Api["sync"]["ingest"]>,
    // Called by the consumer's upgrade action (see README).
    IsInternal<Api["subscriptions"]["backfillKind"]>,
    IsInternal<Api["transfers"]["backfillTransferParticipants"]>,
  ]
>;

test("ComponentApi: ctor contract + parent-callable functions present", () => {
  const ctor: CtorAcceptsComponentApi = true;
  const present: ParentCallableArePresent = true;
  expect(ctor && present).toBe(true);
});
