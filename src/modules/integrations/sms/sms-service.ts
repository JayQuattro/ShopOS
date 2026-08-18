import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TenantContext } from "@/modules/tenancy/policy";
import { assertTenantAccess } from "@/modules/tenancy/policy";
import { resolveSmsAdapter } from "@/modules/integrations/sms/sms-adapters";

export type SmsServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class SmsFailed extends Error {
  constructor(
    public readonly reason:
      | "customer_not_found"
      | "invalid_phone"
      | "invalid_body"
      | "work_order_not_found"
      | "sms_not_configured"
      | "conversation_not_found",
  ) {
    super("The SMS operation could not be completed.");
    this.name = "SmsFailed";
  }
}

const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s()-]/g, "");
  return PHONE_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Sends an outbound text to a customer (E.164 number), creating or reusing
 * the conversation thread. Optionally attaches the message to a work order
 * for context. Fails closed when no SMS adapter is configured in production.
 */
export async function sendCustomerSms(
  input: SmsServiceInput & {
    customerId: string;
    to: string;
    body: string;
    workOrderId?: string;
  },
): Promise<Readonly<{ messageId: string; conversationId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "customers.write",
  );

  const text = input.body.trim();
  if (text.length < 1 || text.length > 1600) throw new SmsFailed("invalid_body");
  const to = normalizePhone(input.to);
  if (!to) throw new SmsFailed("invalid_phone");

  const customer = await input.db.customer.findFirst({
    where: { id: input.customerId, organizationId: input.context.organizationId },
    select: { id: true },
  });
  if (!customer) throw new SmsFailed("customer_not_found");

  if (input.workOrderId) {
    const workOrder = await input.db.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!workOrder) throw new SmsFailed("work_order_not_found");
  }

  const adapter = await resolveSmsAdapter(input.db, input.context.organizationId);
  if (!adapter) throw new SmsFailed("sms_not_configured");

  const conversation = await input.db.smsConversation.upsert({
    where: {
      organizationId_customerId_customerPhone: {
        organizationId: input.context.organizationId,
        customerId: customer.id,
        customerPhone: to,
      },
    },
    update: {},
    create: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      customerId: customer.id,
      customerPhone: to,
    },
  });

  const result = await adapter.send({ to, body: text });

  const message = await input.db.smsMessage.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      conversationId: conversation.id,
      direction: "outbound",
      body: text,
      status: "sent",
      ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
      sentByUserId: input.context.actorId,
    },
  });
  await input.db.smsConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: message.createdAt },
  });

  return { messageId: message.id, conversationId: conversation.id };
}

/**
 * Records an inbound customer text (called from the verified webhook) and
 * matches it to a conversation by phone number. Unknown numbers are matched
 * against customer contacts and primary phones to find (or create) the thread.
 */
export async function recordInboundSms(
  db: PrismaClient,
  input: Readonly<{
    organizationId: string;
    from: string;
    body: string;
    providerMessageId?: string;
  }>,
): Promise<Readonly<{ conversationId: string }>> {
  const from = normalizePhone(input.from);
  if (!from) throw new SmsFailed("invalid_phone");
  const body = input.body.trim();
  if (!body || body.length > 1600) throw new SmsFailed("invalid_body");

  // Existing thread with this number?
  const existing = await db.smsConversation.findFirst({
    where: { organizationId: input.organizationId, customerPhone: from },
    orderBy: { lastMessageAt: "desc" },
  });
  let conversationId = existing?.id;
  let customerId = existing?.customerId;

  if (!conversationId) {
    // Match a customer by contact phone or primary phone.
    const contactMatch = await db.customerContact.findFirst({
      where: { organizationId: input.organizationId, phone: from },
      select: { customerId: true },
    });
    if (!contactMatch) {
      const primaryMatch = await db.customer.findFirst({
        where: { organizationId: input.organizationId, primaryPhone: from },
        select: { id: true },
      });
      customerId = primaryMatch?.id;
    } else {
      customerId = contactMatch.customerId;
    }
    if (!customerId) {
      // Unmatched number: create a lightweight customer so the thread exists.
      const created = await db.customer.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          kind: "INDIVIDUAL",
          displayName: `Text ${from.slice(-4)}`,
          primaryPhone: from,
        },
      });
      customerId = created.id;
    }
    const conversation = await db.smsConversation.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        customerId,
        customerPhone: from,
      },
    });
    conversationId = conversation.id;
  }

  const message = await db.smsMessage.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      conversationId,
      direction: "inbound",
      body,
      status: "received",
      ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
    },
  });
  await db.smsConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: message.createdAt },
  });

  return { conversationId };
}

export type SmsThreadMessage = Readonly<{
  id: string;
  direction: "outbound" | "inbound";
  body: string;
  createdAt: Date;
  workOrderId: string | null;
  sentByDisplayName: string | null;
}>;

export type SmsConversationSummary = Readonly<{
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastDirection: "outbound" | "inbound" | null;
  messageCount: number;
}>;

/** Lists conversation threads newest-activity-first. */
export async function listConversations(
  input: SmsServiceInput,
): Promise<readonly SmsConversationSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "customers.read",
  );

  const conversations = await input.db.smsConversation.findMany({
    where: { organizationId: input.context.organizationId },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    select: {
      id: true,
      customerId: true,
      customerPhone: true,
      lastMessageAt: true,
      customer: { select: { displayName: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, direction: true },
      },
      _count: { select: { messages: true } },
    },
  });

  return conversations.map((conversation) => ({
    id: conversation.id,
    customerId: conversation.customerId,
    customerName: conversation.customer.displayName,
    customerPhone: conversation.customerPhone,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.messages[0]?.body.slice(0, 80) ?? null,
    lastDirection: (conversation.messages[0]?.direction as "outbound" | "inbound") ?? null,
    messageCount: conversation._count.messages,
  }));
}

/** Full message thread for one conversation. */
export async function listMessages(
  input: SmsServiceInput & { conversationId: string },
): Promise<readonly SmsThreadMessage[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "customers.read",
  );

  const conversation = await input.db.smsConversation.findFirst({
    where: {
      id: input.conversationId,
      organizationId: input.context.organizationId,
    },
    select: { id: true },
  });
  if (!conversation) throw new SmsFailed("conversation_not_found");

  const messages = await input.db.smsMessage.findMany({
    where: { organizationId: input.context.organizationId, conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      direction: true,
      body: true,
      createdAt: true,
      workOrderId: true,
      sentBy: { select: { displayName: true } },
    },
  });

  return messages.map((message) => ({
    id: message.id,
    direction: message.direction as "outbound" | "inbound",
    body: message.body,
    createdAt: message.createdAt,
    workOrderId: message.workOrderId,
    sentByDisplayName: message.sentBy?.displayName ?? null,
  }));
}
