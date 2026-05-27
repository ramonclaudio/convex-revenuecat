import { expect, test } from "vitest";
import { RevenueCat } from "./index.js";
import type { FunctionReference } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

type Expect<T extends true> = T;

type CtorAcceptsComponentApi = Expect<
  ComponentApi<"revenuecat"> extends ConstructorParameters<typeof RevenueCat>[0]
    ? true
    : false
>;

type IsInternal<T> =
  T extends FunctionReference<any, "internal", any, any, any> ? true : false;
type Api = ComponentApi<"revenuecat">;
type AllTrue<_T extends readonly true[]> = true;
type ParentCallableArePresent = AllTrue<
  [
    IsInternal<Api["webhooks"]["process"]>,
    IsInternal<Api["webhooks"]["recordFailure"]>,
    IsInternal<Api["customers"]["get"]>,
    IsInternal<Api["customers"]["purge"]>,
    IsInternal<Api["entitlements"]["check"]>,
    IsInternal<Api["sync"]["ingest"]>,
    IsInternal<Api["subscriptions"]["backfillKind"]>,
    IsInternal<Api["transfers"]["backfillTransferParticipants"]>,
  ]
>;

test("ComponentApi: ctor contract + parent-callable functions present", () => {
  const ctor: CtorAcceptsComponentApi = true;
  const present: ParentCallableArePresent = true;
  expect(ctor && present).toBe(true);
});
