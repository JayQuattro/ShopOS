import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

import {
  BrevoAdapter,
  MailgunAdapter,
  MailjetAdapter,
  PostmarkAdapter,
  SendGridAdapter,
  SesAdapter,
  ZohoZeptoAdapter,
  AzureAcsAdapter,
} from "@/modules/integrations/email/adapters/api-adapters";
import { ResendAuthDeliveryProvider } from "@/modules/integrations/email/adapters/resend-auth-delivery";
import { SmtpAuthDeliveryProvider } from "@/modules/integrations/email/adapters/smtp-auth-delivery";
import {
  EMAIL_ADAPTER_DEFINITIONS,
  SMTP_PRESETS,
  getAdapterDefinition,
} from "@/modules/integrations/email/adapters/adapter-types";
import { instantiateAdapter } from "@/modules/integrations/email/email-delivery-resolver";
import { encryptSecret, generateMasterKey } from "@/modules/integrations/crypto/secret-cipher";

/** Minimal Response-like object: only what the adapters read. */
function jsonResponse(ok = true): Response {
  return { ok, json: () => Promise.resolve({}) } as unknown as Response;
}

type RecordedCall = { url: string; init: RequestInit };

const fetchCalls: RecordedCall[] = [];
let fetchResult: Response = jsonResponse();

beforeEach(() => {
  fetchCalls.length = 0;
  fetchResult = jsonResponse();
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit): Promise<Response> => {
    fetchCalls.push({ url: String(url), init: init ?? {} });
    return fetchResult;
  });
});

function lastCall(): RecordedCall {
  const call = fetchCalls.at(-1);
  if (!call) throw new Error("no fetch call recorded");
  return call;
}

function sentBody(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

async function sendRaw(
  adapter: {
    sendRaw: (
      input: Readonly<{
        organizationId: string;
        to: string;
        subject: string;
        text: string;
      }>,
    ) => Promise<void>;
  },
  to = "customer@example.com",
) {
  await adapter.sendRaw({
    organizationId: "00000000-0000-4000-8000-000000000001",
    to,
    subject: "Invoice ready",
    text: "Your invoice is attached.",
  });
}

// ─── Resend ──────────────────────────────────────────────────────────────────

describe("resend adapter", () => {
  const adapter = new ResendAuthDeliveryProvider(
    { fromAddress: "service@shop.example", fromName: "Atlas Service" },
    { apiKey: "re_test_key" },
  );

  it("posts to the Resend API with a bearer key and formatted from", async () => {
    await sendRaw(adapter);

    const call = lastCall();
    expect(call.url).toBe("https://api.resend.com/emails");
    expect(call.init.method).toBe("POST");
    expect(new Headers(call.init.headers).get("Authorization")).toBe("Bearer re_test_key");
    expect(sentBody(call)).toEqual({
      from: "Atlas Service <service@shop.example>",
      to: ["customer@example.com"],
      subject: "Invoice ready",
      text: "Your invoice is attached.",
    });
  });

  it("rejects on a non-ok response so the retry path can engage", async () => {
    fetchResult = jsonResponse(false);
    await expect(sendRaw(adapter)).rejects.toThrow("email adapter resend failed");
  });

  it("verifies connectivity against the domains endpoint", async () => {
    expect(await adapter.verify()).toBe(true);
    expect(lastCall().url).toBe("https://api.resend.com/domains");

    fetchResult = jsonResponse(false);
    expect(await adapter.verify()).toBe(false);

    vi.stubGlobal("fetch", async () => {
      throw new Error("network unreachable");
    });
    expect(await adapter.verify()).toBe(false);
  });
});

// ─── HTTP API adapters (shared base class) ───────────────────────────────────

describe("sendgrid adapter", () => {
  const adapter = new SendGridAdapter(
    { fromAddress: "service@shop.example", fromName: "Atlas" },
    { apiKey: "SG.test" },
  );

  it("sends a v3 personalization body with a bearer key", async () => {
    await sendRaw(adapter);

    const call = lastCall();
    expect(call.url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(new Headers(call.init.headers).get("Authorization")).toBe("Bearer SG.test");
    expect(sentBody(call)).toEqual({
      personalizations: [{ to: [{ email: "customer@example.com" }] }],
      from: { email: "service@shop.example", name: "Atlas" },
      subject: "Invoice ready",
      content: [{ type: "text/plain", value: "Your invoice is attached." }],
    });
  });

  it("verifies against the scopes endpoint and rejects on failure", async () => {
    expect(await adapter.verify()).toBe(true);
    expect(lastCall().url).toBe("https://api.sendgrid.com/v3/scopes");

    fetchResult = jsonResponse(false);
    await expect(sendRaw(adapter)).rejects.toThrow("email adapter sendgrid failed");
  });
});

describe("postmark adapter", () => {
  const adapter = new PostmarkAdapter(
    { fromAddress: "service@shop.example", fromName: "Atlas" },
    { serverToken: "pm-test" },
  );

  it("sends a Postmark server-token body on the outbound stream", async () => {
    await sendRaw(adapter);

    const call = lastCall();
    expect(call.url).toBe("https://api.postmarkapp.com/email");
    expect(new Headers(call.init.headers).get("X-Postmark-Server-Token")).toBe("pm-test");
    expect(sentBody(call)).toEqual({
      From: "Atlas <service@shop.example>",
      To: "customer@example.com",
      Subject: "Invoice ready",
      TextBody: "Your invoice is attached.",
      MessageStream: "outbound",
    });
  });
});

describe("mailgun adapter", () => {
  const adapter = new MailgunAdapter(
    { domain: "shop.example", region: "us", fromAddress: "service@shop.example" },
    { apiKey: "mg-key" },
  );

  it("sends to the domain messages endpoint with basic api-key auth", async () => {
    await sendRaw(adapter);

    const call = lastCall();
    expect(call.url).toBe("https://api.mailgun.net/v3/shop.example/messages");
    const expected = `Basic ${Buffer.from("api:mg-key").toString("base64")}`;
    expect(new Headers(call.init.headers).get("Authorization")).toBe(expected);
    expect(sentBody(call)).toEqual({
      from: "service@shop.example",
      to: "customer@example.com",
      subject: "Invoice ready",
      text: "Your invoice is attached.",
    });
  });

  it("uses the EU host when the region is eu", async () => {
    const eu = new MailgunAdapter(
      { domain: "shop.example", region: "eu", fromAddress: "service@shop.example" },
      { apiKey: "mg-key" },
    );
    await sendRaw(eu);
    expect(lastCall().url).toBe("https://api.eu.mailgun.net/v3/shop.example/messages");
  });

  it("fire-and-forget auth sends stay form-encoded", async () => {
    adapter.send({
      kind: "verification-email",
      to: "newuser@example.com",
      url: "https://shop.example/verify?token=t",
    } as never);

    await vi.waitFor(() => expect(fetchCalls.length).toBe(1));
    const call = lastCall();
    expect(call.url).toBe("https://api.mailgun.net/v3/shop.example/messages");
    expect(call.init.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const params = new URLSearchParams(String(call.init.body));
    expect(params.get("to")).toBe("newuser@example.com");
    expect(params.get("subject")).toBe("Verify your email address");
  });
});

describe("mailjet adapter", () => {
  const adapter = new MailjetAdapter(
    { fromAddress: "service@shop.example" },
    { apiKey: "mj-key", apiSecret: "mj-secret" },
  );

  it("sends a Messages array with basic key:secret auth", async () => {
    await sendRaw(adapter);

    const call = lastCall();
    expect(call.url).toBe("https://api.mailjet.com/v3.1/send");
    const expected = `Basic ${Buffer.from("mj-key:mj-secret").toString("base64")}`;
    expect(new Headers(call.init.headers).get("Authorization")).toBe(expected);
    expect(sentBody(call)).toEqual({
      Messages: [
        {
          From: { Email: "service@shop.example", Name: "" },
          To: [{ Email: "customer@example.com" }],
          Subject: "Invoice ready",
          TextPart: "Your invoice is attached.",
        },
      ],
    });
  });
});

describe("brevo adapter", () => {
  const adapter = new BrevoAdapter(
    { fromAddress: "service@shop.example" },
    { apiKey: "xkeysib-test" },
  );

  it("sends a Brevo smtp/email body with the api-key header", async () => {
    await sendRaw(adapter);

    const call = lastCall();
    expect(call.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(new Headers(call.init.headers).get("api-key")).toBe("xkeysib-test");
    expect(sentBody(call)).toEqual({
      sender: { email: "service@shop.example", name: "service@shop.example" },
      to: [{ email: "customer@example.com" }],
      subject: "Invoice ready",
      textContent: "Your invoice is attached.",
    });
  });
});

describe("provider error detail extraction", () => {
  const adapter = new ZohoZeptoAdapter(
    { fromAddress: "service@shop.example" },
    { sendMailToken: "zepto_token" },
  );

  it("surfaces the provider's own error message on rejection", async () => {
    fetchResult = {
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          error: { code: "SM_303", message: "from address is not allowed for this Mail Agent" },
        }),
    } as unknown as Response;

    await expect(sendRaw(adapter)).rejects.toThrow(
      "email adapter zoho-zepto failed with status 403: from address is not allowed for this Mail Agent",
    );
  });

  it("keeps the plain status message when the body has nothing readable", async () => {
    fetchResult = jsonResponse(false);
    await expect(sendRaw(adapter)).rejects.toThrow("email adapter zoho-zepto failed with status");
  });
});

describe("zoho zepto adapter", () => {
  const adapter = new ZohoZeptoAdapter(
    { fromAddress: "service@shop.example", fromName: "Atlas" },
    { sendMailToken: "zepto_token" },
  );

  it("sends ZeptoMail's address-envelope body with the send mail token", async () => {
    await sendRaw(adapter);

    const call = lastCall();
    expect(call.url).toBe("https://api.zeptomail.com/v1.0/email");
    expect(new Headers(call.init.headers).get("Authorization")).toBe("Bearer zepto_token");
    expect(sentBody(call)).toEqual({
      from: { address: "service@shop.example", name: "Atlas" },
      to: [{ email_address: { address: "customer@example.com" } }],
      subject: "Invoice ready",
      textbody: "Your invoice is attached.",
    });
  });

  it("rejects on a non-ok response", async () => {
    fetchResult = jsonResponse(false);
    await expect(sendRaw(adapter)).rejects.toThrow("email adapter zoho-zepto failed");
  });
});

describe("azure communication services adapter", () => {
  const adapter = new AzureAcsAdapter(
    {
      connectionString: "endpoint=https://shop.communication.azure.com/;accesskey=redacted",
      fromAddress: "DoNotReply@shop.azurecomm.net",
    },
    { connectionString: "endpoint=https://shop.communication.azure.com/;accesskey=redacted" },
  );

  it("derives the send endpoint from the connection string and builds the ACS body", async () => {
    await sendRaw(adapter);

    const call = lastCall();
    expect(call.url).toBe(
      "https://shop.communication.azure.com/emails:send?api-version=2023-03-31",
    );
    expect(sentBody(call)).toEqual({
      senderAddress: "DoNotReply@shop.azurecomm.net",
      content: { subject: "Invoice ready", plainText: "Your invoice is attached." },
      recipients: { to: [{ address: "customer@example.com" }] },
    });
  });

  it("falls back to a placeholder host when the connection string has no endpoint", async () => {
    const broken = new AzureAcsAdapter(
      { connectionString: "accesskey=only", fromAddress: "x@y.example" },
      { connectionString: "accesskey=only" },
    );
    await sendRaw(broken);
    expect(lastCall().url).toContain("https://unknown.communication.azure.com");
  });

  it("does not attempt fire-and-forget auth sends (documented placeholder)", () => {
    adapter.send({ kind: "verification-email", to: "x@example.com" } as never);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("ses adapter", () => {
  const adapter = new SesAdapter(
    { region: "eu-central-1", fromAddress: "service@shop.example" },
    { accessKeyId: "ak", secretAccessKey: "sk" },
  );

  it("targets the regional v2 outbound endpoint with the SES body shape", async () => {
    await sendRaw(adapter);

    const call = lastCall();
    expect(call.url).toBe("https://email.eu-central-1.amazonaws.com/v2/email/outbound-emails");
    expect(sentBody(call)).toEqual({
      FromEmailAddress: "service@shop.example",
      Destination: { ToAddresses: ["customer@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: "Invoice ready", Charset: "UTF-8" },
          Body: { Text: { Data: "Your invoice is attached.", Charset: "UTF-8" } },
        },
      },
    });
  });

  it("does not attempt fire-and-forget auth sends (documented placeholder)", () => {
    adapter.send({ kind: "password-reset-email", to: "x@example.com" } as never);
    expect(fetchCalls).toHaveLength(0);
  });
});

// ─── SMTP (nodemailer mocked; no network) ────────────────────────────────────

const smtp = vi.hoisted(() => {
  const state = {
    transportOptions: null as unknown,
    sentMail: [] as Array<Record<string, unknown>>,
    verifyResult: true,
  };
  return state;
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport(options: unknown) {
      smtp.transportOptions = options;
      return {
        async sendMail(mail: Record<string, unknown>) {
          smtp.sentMail.push(mail);
        },
        async verify() {
          if (!smtp.verifyResult) throw new Error("smtp unreachable");
          return true;
        },
      };
    },
  },
}));

describe("smtp adapter", () => {
  const adapter = new SmtpAuthDeliveryProvider(
    {
      host: "smtp.zeptomail.com",
      port: 587,
      secure: false,
      fromAddress: "service@shop.example",
      fromName: "Atlas",
    },
    { username: "emailapikey", password: "zepto-token" },
  );

  beforeEach(() => {
    // transportOptions is captured once by the constructor above; only the
    // per-send state resets here.
    smtp.sentMail = [];
    smtp.verifyResult = true;
  });

  it("configures the transporter with host, port, TLS mode, and credentials", async () => {
    await sendRaw(adapter);
    expect(smtp.transportOptions).toEqual({
      host: "smtp.zeptomail.com",
      port: 587,
      secure: false,
      auth: { user: "emailapikey", pass: "zepto-token" },
    });
  });

  it("sends the envelope through nodemailer, not fetch", async () => {
    await sendRaw(adapter);
    expect(fetchCalls).toHaveLength(0);
    expect(smtp.sentMail).toEqual([
      {
        from: "Atlas <service@shop.example>",
        to: "customer@example.com",
        subject: "Invoice ready",
        text: "Your invoice is attached.",
      },
    ]);
  });

  it("reports verify() success and failure from the transporter", async () => {
    expect(await adapter.verify()).toBe(true);
    smtp.verifyResult = false;
    expect(await adapter.verify()).toBe(false);
  });
});

// ─── Definitions registry + instantiation ────────────────────────────────────

describe("email adapter definitions", () => {
  it("registers all ten providers with stable keys", () => {
    expect(EMAIL_ADAPTER_DEFINITIONS.map((d) => d.key)).toEqual([
      "smtp",
      "resend",
      "sendgrid",
      "postmark",
      "mailgun",
      "mailjet",
      "brevo",
      "zoho-zepto",
      "ses",
      "azure-acs",
    ]);
  });

  it("keeps SMTP presets unique and includes the Zoho ZeptoMail relay", () => {
    const keys = SMTP_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    const zepto = SMTP_PRESETS.find((p) => p.key === "zoho-zepto-smtp");
    expect(zepto).toMatchObject({ host: "smtp.zeptomail.com", port: 587 });
  });

  it("marks the credential fields each provider actually needs", () => {
    expect(getAdapterDefinition("zoho-zepto")?.secretFields[0]).toMatchObject({
      name: "sendMailToken",
      required: true,
    });
    expect(getAdapterDefinition("smtp")?.secretFields.map((f) => f.name)).toEqual([
      "username",
      "password",
    ]);
    expect(getAdapterDefinition("mailgun")?.configFields.map((f) => f.name)).toContain("domain");
    expect(getAdapterDefinition("nonexistent")).toBeUndefined();
  });
});

describe("email adapter instantiation", () => {
  const masterKeyB64 = generateMasterKey();
  const masterKey = Buffer.from(masterKeyB64, "base64");
  const encrypted = (secret: Record<string, string>) =>
    encryptSecret(JSON.stringify(secret), masterKey);

  beforeAll(() => {
    process.env.CONNECTOR_ENCRYPTION_KEY = masterKeyB64;
  });

  afterAll(() => {
    delete process.env.CONNECTOR_ENCRYPTION_KEY;
  });

  function instantiate(
    adapterKey: string,
    configuration: Record<string, unknown>,
    secret: Record<string, string>,
  ) {
    return instantiateAdapter(adapterKey, configuration, encrypted(secret));
  }

  it("instantiates every registered provider from configuration and secret", () => {
    expect(
      instantiate(
        "smtp",
        { host: "smtp.example", port: "587", fromAddress: "a@b.example" },
        { username: "u", password: "p" },
      ),
    ).toBeInstanceOf(SmtpAuthDeliveryProvider);
    expect(instantiate("resend", { fromAddress: "a@b.example" }, { apiKey: "k" })).toBeInstanceOf(
      ResendAuthDeliveryProvider,
    );
    expect(instantiate("sendgrid", { fromAddress: "a@b.example" }, { apiKey: "k" })).toBeInstanceOf(
      SendGridAdapter,
    );
    expect(
      instantiate("postmark", { fromAddress: "a@b.example" }, { serverToken: "t" }),
    ).toBeInstanceOf(PostmarkAdapter);
    expect(
      instantiate("mailgun", { domain: "d.example", fromAddress: "a@b.example" }, { apiKey: "k" }),
    ).toBeInstanceOf(MailgunAdapter);
    expect(
      instantiate("mailjet", { fromAddress: "a@b.example" }, { apiKey: "k", apiSecret: "s" }),
    ).toBeInstanceOf(MailjetAdapter);
    expect(instantiate("brevo", { fromAddress: "a@b.example" }, { apiKey: "k" })).toBeInstanceOf(
      BrevoAdapter,
    );
    expect(
      instantiate("zoho-zepto", { fromAddress: "a@b.example" }, { sendMailToken: "t" }),
    ).toBeInstanceOf(ZohoZeptoAdapter);
    expect(
      instantiate(
        "ses",
        { region: "us-east-1", fromAddress: "a@b.example" },
        { accessKeyId: "ak", secretAccessKey: "sk" },
      ),
    ).toBeInstanceOf(SesAdapter);
    expect(
      instantiate(
        "azure-acs",
        { fromAddress: "a@b.example" },
        { connectionString: "endpoint=https://x.communication.azure.com/" },
      ),
    ).toBeInstanceOf(AzureAcsAdapter);
  });

  it("refuses adapters with missing sender, config, credentials, or unknown keys", () => {
    const from = { fromAddress: "a@b.example" };

    // No sender configured at all.
    expect(instantiate("resend", {}, { apiKey: "k" })).toBeNull();

    // Provider-specific requirements.
    expect(instantiate("smtp", { host: "" }, { username: "u", password: "p" })).toBeNull();
    expect(instantiate("resend", from, {})).toBeNull();
    expect(instantiate("sendgrid", from, {})).toBeNull();
    expect(instantiate("postmark", from, {})).toBeNull();
    expect(instantiate("mailgun", from, { apiKey: "k" })).toBeNull();
    expect(instantiate("mailgun", { domain: "d.example", ...from }, {})).toBeNull();
    expect(instantiate("mailjet", from, { apiKey: "k" })).toBeNull();
    expect(instantiate("brevo", from, {})).toBeNull();
    expect(instantiate("zoho-zepto", from, {})).toBeNull();
    expect(instantiate("ses", from, { accessKeyId: "ak" })).toBeNull();
    expect(instantiate("azure-acs", from, {})).toBeNull();

    expect(instantiate("carrier-pigeon", from, { token: "coo" })).toBeNull();
  });

  it("returns null when the secret cannot be decrypted", () => {
    const otherMasterKey = Buffer.from(generateMasterKey(), "base64");
    const unreadable = encryptSecret(JSON.stringify({ apiKey: "k" }), otherMasterKey);
    expect(instantiateAdapter("resend", { fromAddress: "a@b.example" }, unreadable)).toBeNull();
  });

  it("returns null without an encryption key or stored secret", () => {
    delete process.env.CONNECTOR_ENCRYPTION_KEY;
    expect(
      instantiateAdapter("resend", { fromAddress: "a@b.example" }, encrypted({ apiKey: "k" })),
    ).toBeNull();
    process.env.CONNECTOR_ENCRYPTION_KEY = masterKeyB64;

    expect(instantiateAdapter("resend", { fromAddress: "a@b.example" }, null)).toBeNull();
  });
});
