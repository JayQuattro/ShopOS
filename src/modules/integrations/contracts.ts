export type ProviderHealth = Readonly<{
  status: "available" | "degraded" | "unavailable" | "not_configured";
  detail?: string;
}>;

export interface Provider {
  readonly key: string;
  health(): Promise<ProviderHealth>;
}

export interface FileStorageProvider extends Provider {
  put(input: {
    organizationId: string;
    objectKey: string;
    contentType: string;
    body: Uint8Array;
  }): Promise<{ objectKey: string; size: number }>;
  get(input: { organizationId: string; objectKey: string }): Promise<Uint8Array>;
  delete(input: { organizationId: string; objectKey: string }): Promise<void>;
}

export interface EmailProvider extends Provider {
  send(input: {
    organizationId: string;
    idempotencyKey: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ providerMessageId?: string }>;
}

export interface SmsProvider extends Provider {
  send(input: {
    organizationId: string;
    idempotencyKey: string;
    to: string;
    text: string;
  }): Promise<{ providerMessageId?: string }>;
}

export interface PaymentProvider extends Provider {
  createCollection(input: {
    organizationId: string;
    invoiceId: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerCollectionId: string; status: "pending" | "succeeded" | "failed" }>;
}

/**
 * Provider-neutral billing adapter for SaaS subscription reconciliation.
 *
 * Implementations sit behind a replaceable adapter boundary (ADR 0008). The
 * adapter syncs subscription state from an external billing provider into
 * ShopOS's authoritative `SubscriptionState` and `OrganizationEntitlement`
 * records. Provider-independent history is mandatory: billing failure never
 * deletes or silently hides existing shop data (ADR 0012).
 */
export interface BillingProvider extends Provider {
  /** Returns the provider's current subscription state for an organization. */
  syncSubscriptionState(input: { organizationId: string; providerCustomerId?: string }): Promise<{
    subscriptionState: "unmanaged" | "trialing" | "active" | "past_due" | "canceled";
    providerCustomerId?: string;
    providerSubscriptionId?: string;
  }>;

  /** Returns billing display info for the organization detail page. */
  getCustomerBillingInfo(input: { organizationId: string; providerCustomerId?: string }): Promise<{
    providerCustomerId?: string;
    providerSubscriptionId?: string;
    currentPeriodEnd?: string;
    planName?: string;
  }>;
}
