import type { Infer } from "convex/values";
import {
  storeValidator,
  environmentValidator,
  periodTypeValidator,
  subscriberAttributesValidator,
} from "./schema.js";

export type Store = Infer<typeof storeValidator>;
export type Environment = Infer<typeof environmentValidator>;
export type PeriodType = Infer<typeof periodTypeValidator>;
export type SubscriberAttributes = Infer<typeof subscriberAttributesValidator>;

export type Entitlement = {
  _id: string;
  _creationTime: number;
  appUserId: string;
  entitlementId: string;
  productId?: string;
  isActive: boolean;
  expiresAtMs?: number;
  purchasedAtMs?: number;
  store?: Store;
  isSandbox: boolean;
  unsubscribeDetectedAt?: number;
  billingIssueDetectedAt?: number;
  updatedAt: number;
};

export type Subscription = {
  _id: string;
  _creationTime: number;
  appUserId: string;
  productId: string;
  entitlementIds?: string[];
  store: Store;
  environment: Environment;
  periodType: PeriodType;
  purchasedAtMs: number;
  expirationAtMs?: number;
  originalTransactionId: string;
  transactionId: string;
  isFamilyShare: boolean;
  isTrialConversion?: boolean;
  autoRenewStatus?: boolean;
  cancelReason?: string;
  expirationReason?: string;
  gracePeriodExpirationAtMs?: number;
  billingIssueDetectedAt?: number;
  autoResumeAtMs?: number;
  priceUsd?: number;
  currency?: string;
  priceInPurchasedCurrency?: number;
  countryCode?: string;
  taxPercentage?: number;
  commissionPercentage?: number;
  offerCode?: string;
  presentedOfferingId?: string;
  renewalNumber?: number;
  newProductId?: string;
  updatedAt: number;
};

export type Customer = {
  _id: string;
  _creationTime: number;
  appUserId: string;
  originalAppUserId: string;
  aliases: string[];
  firstSeenAt: number;
  lastSeenAt?: number;
  attributes?: SubscriberAttributes;
  updatedAt: number;
};

export type WebhookEventStatus = "processed" | "failed" | "ignored";

export type WebhookEvent = {
  _id: string;
  _creationTime: number;
  eventId: string;
  eventType: string;
  appId?: string;
  appUserId?: string;
  environment: Environment;
  store?: Store;
  payload: unknown;
  processedAt: number;
  status: WebhookEventStatus;
  error?: string;
};

