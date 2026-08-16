import type { AuthDeliveryProvider } from "@/modules/identity/delivery/auth-delivery-provider";

/**
 * Email adapter types and registry (ADR 0008).
 *
 * Each adapter declares a configuration schema (non-secret fields typed
 * separately from the encrypted secret) and implements the pre-tenant
 * AuthDeliveryProvider interface for auth emails. Transactional org-scoped
 * email will use the same connector instance but the org-scoped
 * EmailProvider contract.
 */

export type SmtpConfiguration = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  fromAddress: string;
  fromName?: string;
}>;

export type SmtpSecret = Readonly<{
  username: string;
  password: string;
}>;

export type ResendConfiguration = Readonly<{
  fromAddress: string;
  fromName?: string;
}>;

export type ResendSecret = Readonly<{
  apiKey: string;
}>;

export type EmailAdapterDefinition = Readonly<{
  key: string;
  displayName: string;
  description: string;
  configFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "number" | "boolean" | "email";
    required: boolean;
    placeholder?: string;
  }>;
  secretFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "password";
    required: boolean;
    placeholder?: string;
  }>;
}>;

export const EMAIL_ADAPTER_DEFINITIONS: ReadonlyArray<EmailAdapterDefinition> = [
  {
    key: "smtp",
    displayName: "SMTP",
    description:
      "Universal SMTP adapter. Works with Gmail, M365, SendGrid, Mailgun, Postmark, Mailjet, Brevo, Zoho, and any SMTP server.",
    configFields: [
      {
        name: "host",
        label: "SMTP Host",
        type: "text",
        required: true,
        placeholder: "smtp.gmail.com",
      },
      { name: "port", label: "Port", type: "number", required: true, placeholder: "587" },
      { name: "secure", label: "Use TLS (port 465)", type: "boolean", required: false },
      {
        name: "fromAddress",
        label: "From Email",
        type: "email",
        required: true,
        placeholder: "noreply@yourdomain.com",
      },
      {
        name: "fromName",
        label: "From Name",
        type: "text",
        required: false,
        placeholder: "Your Shop",
      },
    ],
    secretFields: [
      { name: "username", label: "SMTP Username", type: "text", required: true },
      { name: "password", label: "SMTP Password", type: "password", required: true },
    ],
  },
  {
    key: "resend",
    displayName: "Resend",
    description: "Modern email API. Simple setup, good deliverability, generous free tier.",
    configFields: [
      {
        name: "fromAddress",
        label: "From Email",
        type: "email",
        required: true,
        placeholder: "noreply@yourdomain.com",
      },
      {
        name: "fromName",
        label: "From Name",
        type: "text",
        required: false,
        placeholder: "Your Shop",
      },
    ],
    secretFields: [
      {
        name: "apiKey",
        label: "Resend API Key",
        type: "password",
        required: true,
        placeholder: "re_...",
      },
    ],
  },
];

export function getAdapterDefinition(key: string): EmailAdapterDefinition | undefined {
  return EMAIL_ADAPTER_DEFINITIONS.find((a) => a.key === key);
}

export type { AuthDeliveryProvider };
