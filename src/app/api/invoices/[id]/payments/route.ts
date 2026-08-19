import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  InvoiceFailed,
  recordPayment,
  recordPaymentTenders,
} from "@/modules/invoices/invoice-service";

export const dynamic = "force-dynamic";

const methodEnum = z.enum(["CASH", "CARD_EXTERNAL", "CHECK", "BANK_TRANSFER", "OTHER"]);

const tenderSchema = z.object({
  amountMinor: z.number().int().min(1),
  method: methodEnum,
  reference: z.string().trim().max(160).optional(),
});

const paymentSchema = z.union([
  tenderSchema.extend({
    receivedAt: z.string().datetime().optional(),
  }),
  z.object({
    tenders: z.array(tenderSchema).min(1).max(10),
    receivedAt: z.string().datetime().optional(),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;

    // Split tender: one transaction, several methods, one balance.
    if ("tenders" in parsed.data) {
      const result = await recordPaymentTenders({
        db,
        context: tenantContext,
        invoiceId: id,
        tenders: parsed.data.tenders.map((tender) => ({
          amountMinor: tender.amountMinor,
          method: tender.method,
          ...(tender.reference ? { reference: tender.reference } : {}),
        })),
        ...(parsed.data.receivedAt ? { receivedAt: new Date(parsed.data.receivedAt) } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    const result = await recordPayment({
      db,
      context: tenantContext,
      invoiceId: id,
      amountMinor: parsed.data.amountMinor,
      method: parsed.data.method,
      ...(parsed.data.reference ? { reference: parsed.data.reference } : {}),
      ...(parsed.data.receivedAt ? { receivedAt: new Date(parsed.data.receivedAt) } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvoiceFailed) {
      const statusMap: Record<string, number> = {
        invoice_not_found: 404,
        invalid_tenders: 400,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 409 });
    }
    return mapTenantError(error);
  }
}
