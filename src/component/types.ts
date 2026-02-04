import type { Infer } from "convex/values";
import {
  storeValidator,
  environmentValidator,
  periodTypeValidator,
  ownershipTypeValidator,
  subscriberAttributesValidator,
} from "./schema.js";

export type Store = Infer<typeof storeValidator>;
export type Environment = Infer<typeof environmentValidator>;
export type PeriodType = Infer<typeof periodTypeValidator>;
export type OwnershipType = Infer<typeof ownershipTypeValidator>;
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
  // PURCHASED = direct purchase, FAMILY_SHARED = received via Family Sharing
  ownershipType?: OwnershipType;
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

export type Experiment = {
  _id: string;
  _creationTime: number;
  appUserId: string;
  experimentId: string;
  variant: string;
  offeringId?: string;
  enrolledAtMs: number;
  updatedAt: number;
};

export type Transfer = {
  _id: string;
  _creationTime: number;
  eventId: string;
  transferredFrom: string[];
  transferredTo: string[];
  entitlementIds?: string[];
  timestamp: number;
};

export type Invoice = {
  _id: string;
  _creationTime: number;
  invoiceId: string;
  appUserId: string;
  productId?: string;
  store?: Store;
  environment: Environment;
  priceUsd?: number;
  currency?: string;
  priceInPurchasedCurrency?: number;
  issuedAt: number;
};

export type VirtualCurrencyBalance = {
  _id: string;
  _creationTime: number;
  appUserId: string;
  currencyCode: string;
  currencyName: string;
  balance: number;
  updatedAt: number;
};

export type VirtualCurrencyTransaction = {
  _id: string;
  _creationTime: number;
  transactionId: string;
  appUserId: string;
  currencyCode: string;
  amount: number;
  source?: string;
  productId?: string;
  environment: Environment;
  timestamp: number;
};
