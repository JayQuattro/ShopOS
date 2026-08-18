import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  listConversations,
  listMessages,
  sendCustomerSms,
  SmsFailed,
} from "@/modules/integrations/sms/sms-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ organization: string }> },
): Promise<Response> {
  try {
    const { organization } = await context.params;
    const tenantContext = await getRequestContext(organization);
    const conversationId = new URL(request.url).searchParams.get("conversationId");

    if (conversationId) {
      const messages = await listMessages({
        db,
        context: tenantContext,
        conversationId,
      });
      return Response.json(
        {
          messages: messages.map((message) => ({
            ...message,
            createdAt: message.createdAt.toISOString(),
          })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const conversations = await listConversations({ db, context: tenantContext });
    return Response.json(
      {
        conversations: conversations.map((conversation) => ({
          ...conversation,
          lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return smsError(error);
  }
}

const sendSchema = z.object({
  customerId: z.string().uuid(),
  to: z.string().min(7).max(40),
  body: z.string().trim().min(1).max(1600),
  workOrderId: z.string().uuid().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ organization: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { organization } = await context.params;
    const tenantContext = await getRequestContext(organization);
    const result = await sendCustomerSms({
      db,
      context: tenantContext,
      customerId: parsed.data.customerId,
      to: parsed.data.to,
      body: parsed.data.body,
      ...(parsed.data.workOrderId ? { workOrderId: parsed.data.workOrderId } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return smsError(error);
  }
}

function smsError(error: unknown): Response {
  if (error instanceof SmsFailed) {
    const statusMap: Record<string, number> = {
      customer_not_found: 404,
      conversation_not_found: 404,
      work_order_not_found: 404,
      sms_not_configured: 503,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
