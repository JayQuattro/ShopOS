import type { AuthDeliveryProvider } from "@/modules/identity/delivery/auth-delivery-provider";

/**
 * Email adapter types and registry (ADR 0008).
 *
 * Each adapter declares a configuration schema (non-secret fields typed
 * separately from the encrypted secret) and implements the pre-tenant
 * AuthDeliveryProvider interface for auth emails. Transactional org-scoped
 * email will use the same connector instance but the org-scoped
 * EmailProvider contract.
 *
 * SMTP presets let users pick a provider name to pre-fill host/port, while
 * still allowing custom SMTP servers.
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
    type: "text" | "number" | "boolean" | "email" | "select";
    required: boolean;
    placeholder?: string;
    options?: ReadonlyArray<{ value: string; label: string }>;
  }>;
  secretFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "password";
    required: boolean;
    placeholder?: string;
  }>;
}>;

export type SmtpPreset = Readonly<{
  key: string;
  displayName: string;
  host: string;
  port: number;
  secure: boolean;
}>;

export const SMTP_PRESETS: ReadonlyArray<SmtpPreset> = [
  { key: "gmail", displayName: "Gmail", host: "smtp.gmail.com", port: 587, secure: false },
  {
    key: "outlook",
    displayName: "Microsoft 365 / Outlook",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
  },
  { key: "zoho", displayName: "Zoho Mail", host: "smtp.zoho.com", port: 587, secure: false },
  {
    key: "zoho-zepto-smtp",
    displayName: "Zoho ZeptoMail (SMTP)",
    host: "smtp.zeptomail.com",
    port: 587,
    secure: false,
  },
  {
    key: "sendgrid-smtp",
    displayName: "SendGrid (SMTP)",
    host: "smtp.sendgrid.net",
    port: 587,
    secure: false,
  },
  {
    key: "mailgun-smtp",
    displayName: "Mailgun (SMTP)",
    host: "smtp.mailgun.org",
    port: 587,
    secure: false,
  },
  {
    key: "postmark-smtp",
    displayName: "Postmark (SMTP)",
    host: "smtp.postmarkapp.com",
    port: 587,
    secure: false,
  },
  {
    key: "mailjet-smtp",
    displayName: "Mailjet (SMTP)",
    host: "in-v3.mailjet.com",
    port: 587,
    secure: false,
  },
  {
    key: "brevo-smtp",
    displayName: "Brevo (SMTP)",
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
  },
  { key: "smtp2go", displayName: "SMTP2GO", host: "mail.smtp2go.com", port: 587, secure: false },
  {
    key: "elastic",
    displayName: "Elastic Email",
    host: "smtp.elasticemail.com",
    port: 2525,
    secure: false,
  },
  { key: "smtpcom", displayName: "SMTP.com", host: "send.smtp.com", port: 587, secure: false },
  {
    key: "ses-smtp",
    displayName: "AWS SES (SMTP)",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    secure: false,
  },
  { key: "custom", displayName: "Custom SMTP", host: "", port: 587, secure: false },
];

const COMMON_FROM_FIELDS = [
  {
    name: "fromAddress",
    label: "From Email",
    type: "email" as const,
    required: true,
    placeholder: "noreply@yourdomain.com",
  },
  {
    name: "fromName",
    label: "From Name",
    type: "text" as const,
    required: false,
    placeholder: "Your Shop",
  },
] satisfies EmailAdapterDefinition["configFields"];

export const EMAIL_ADAPTER_DEFINITIONS: ReadonlyArray<EmailAdapterDefinition> = [
  {
    key: "smtp",
    displayName: "SMTP",
    description:
      "Universal SMTP adapter. Works with Gmail, M365, Zoho, SendGrid, Mailgun, Postmark, Mailjet, Brevo, SMTP2GO, Elastic, SMTP.com, SES, and any custom SMTP server.",
    configFields: [
      {
        name: "preset",
        label: "Provider Preset",
        type: "select",
        required: false,
        options: SMTP_PRESETS.map((p) => ({ value: p.key, label: p.displayName })),
      },
      {
        name: "host",
        label: "SMTP Host",
        type: "text",
        required: true,
        placeholder: "smtp.gmail.com",
      },
      { name: "port", label: "Port", type: "number", required: true, placeholder: "587" },
      { name: "secure", label: "Use TLS (port 465)", type: "boolean", required: false },
      ...COMMON_FROM_FIELDS,
    ],
    secretFields: [
      { name: "username", label: "SMTP Username", type: "text", required: true },
      { name: "password", label: "SMTP Password", type: "password", required: true },
    ],
  },
  {
    key: "resend",
    displayName: "Resend",
    description: "Modern email API with generous free tier. Simple setup.",
    configFields: COMMON_FROM_FIELDS,
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
  {
    key: "sendgrid",
    displayName: "SendGrid",
    description: "Twilio SendGrid HTTP API. Better deliverability metrics than SMTP.",
    configFields: COMMON_FROM_FIELDS,
    secretFields: [
      {
        name: "apiKey",
        label: "SendGrid API Key",
        type: "password",
        required: true,
        placeholder: "SG...",
      },
    ],
  },
  {
    key: "postmark",
    displayName: "Postmark",
    description: "Postmark HTTP API. Excellent transactional email deliverability.",
    configFields: COMMON_FROM_FIELDS,
    secretFields: [
      {
        name: "serverToken",
        label: "Postmark Server Token",
        type: "password",
        required: true,
        placeholder: "...",
      },
    ],
  },
  {
    key: "mailgun",
    displayName: "Mailgun",
    description: "Mailgun HTTP API with EU region support.",
    configFields: [
      {
        name: "domain",
        label: "Mailgun Domain",
        type: "text",
        required: true,
        placeholder: "mg.yourdomain.com",
      },
      {
        name: "region",
        label: "Region",
        type: "select",
        required: false,
        options: [
          { value: "us", label: "US (default)" },
          { value: "eu", label: "EU" },
        ],
      },
      ...COMMON_FROM_FIELDS,
    ],
    secretFields: [
      {
        name: "apiKey",
        label: "Mailgun API Key",
        type: "password",
        required: true,
        placeholder: "key-...",
      },
    ],
  },
  {
    key: "mailjet",
    displayName: "Mailjet",
    description: "Mailjet HTTP API.",
    configFields: COMMON_FROM_FIELDS,
    secretFields: [
      { name: "apiKey", label: "API Key", type: "text", required: true },
      { name: "apiSecret", label: "API Secret", type: "password", required: true },
    ],
  },
  {
    key: "brevo",
    displayName: "Brevo",
    description: "Brevo (formerly Sendinblue) HTTP API.",
    configFields: COMMON_FROM_FIELDS,
    secretFields: [
      {
        name: "apiKey",
        label: "Brevo API Key",
        type: "password",
        required: true,
        placeholder: "xkeysib-...",
      },
    ],
  },
  {
    key: "zoho-zepto",
    displayName: "Zoho Zepto",
    description: "Zoho ZeptoMail HTTP API for transactional emails.",
    configFields: COMMON_FROM_FIELDS,
    secretFields: [
      { name: "sendMailToken", label: "Send Mail Token", type: "password", required: true },
    ],
  },
  {
    key: "ses",
    displayName: "AWS SES",
    description:
      "Amazon SES HTTP API. Requires SigV4 signing — consider using the SES SMTP relay via the SMTP adapter instead.",
    configFields: [
      {
        name: "region",
        label: "AWS Region",
        type: "text",
        required: true,
        placeholder: "us-east-1",
      },
      ...COMMON_FROM_FIELDS,
    ],
    secretFields: [
      { name: "accessKeyId", label: "AWS Access Key ID", type: "text", required: true },
      { name: "secretAccessKey", label: "AWS Secret Access Key", type: "password", required: true },
    ],
  },
  {
    key: "azure-acs",
    displayName: "Azure Communication Services",
    description:
      "Azure Communication Services email. Consider using the Azure SMTP relay via the SMTP adapter.",
    configFields: COMMON_FROM_FIELDS,
    secretFields: [
      {
        name: "connectionString",
        label: "ACS Connection String",
        type: "password",
        required: true,
      },
    ],
  },
];

export function getAdapterDefinition(key: string): EmailAdapterDefinition | undefined {
  return EMAIL_ADAPTER_DEFINITIONS.find((a) => a.key === key);
}

export type { AuthDeliveryProvider };
