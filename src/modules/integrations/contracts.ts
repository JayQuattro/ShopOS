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
