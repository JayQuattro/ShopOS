import { describe, expect, it } from "vitest";

import { buildAuthorizationReceiptEmail } from "@/modules/estimates/authorization-receipt-handler";
import {
  buildInvoiceIssuedEmail,
  buildPaymentReceiptEmail,
} from "@/modules/invoices/invoice-email-handlers";

describe("buildAuthorizationReceiptEmail", () => {
  it("lists approved and declined items with the cumulative total for change orders", () => {
    const email = buildAuthorizationReceiptEmail({
      organizationName: "Ridgeline Auto",
      workOrderNumber: "RO-2043",
      documentKind: "CHANGE_ORDER",
      changeOrderNumber: 1,
      currency: "USD",
      approved: [{ description: "Rotor replacement", amountMinor: "21200" }],
      declined: [{ description: "Optional coating", amountMinor: "5000" }],
      cumulativeAuthorizedMinor: "31800",
    });
    expect(email.subject).toContain("RO-2043");
    expect(email.text).toContain("change order 1");
    expect(email.text).toContain("Rotor replacement — $212.00");
    expect(email.text).toContain("Optional coating — $50.00");
    expect(email.text).toContain("will not be performed");
    expect(email.text).toContain("Authorized total for RO-2043: $318.00");
  });

  it("omits the cumulative line for baselines", () => {
    const email = buildAuthorizationReceiptEmail({
      organizationName: "Ridgeline Auto",
      workOrderNumber: "RO-1",
      documentKind: "BASELINE",
      changeOrderNumber: null,
      currency: "USD",
      approved: [{ description: "Brake service", amountMinor: "10600" }],
      declined: [],
      cumulativeAuthorizedMinor: null,
    });
    expect(email.text).toContain("estimate");
    expect(email.text).toContain("Brake service — $106.00");
    expect(email.text).not.toContain("Authorized total");
    expect(email.text).not.toContain("Declined");
  });
});

describe("buildInvoiceIssuedEmail", () => {
  it("states the invoice number and amount due", () => {
    const email = buildInvoiceIssuedEmail({
      organizationName: "Ridgeline Auto",
      workOrderNumber: "RO-2043",
      invoiceNumber: "INV-1001",
      totalMinor: "31800",
      currency: "USD",
    });
    expect(email.subject).toContain("INV-1001");
    expect(email.text).toContain("Amount due: $318.00");
    expect(email.text).toContain("RO-2043");
  });
});

describe("buildPaymentReceiptEmail", () => {
  it("shows the remaining balance for partial payments", () => {
    const email = buildPaymentReceiptEmail({
      organizationName: "Ridgeline Auto",
      workOrderNumber: "RO-2043",
      invoiceNumber: "INV-1001",
      amountMinor: "20000",
      remainingMinor: "11800",
      currency: "USD",
    });
    expect(email.text).toContain("payment of $200.00");
    expect(email.text).toContain("Remaining balance: $118.00");
    expect(email.text).not.toContain("paid in full");
  });

  it("celebrates full payment", () => {
    const email = buildPaymentReceiptEmail({
      organizationName: "Ridgeline Auto",
      workOrderNumber: "RO-2043",
      invoiceNumber: "INV-1001",
      amountMinor: "31800",
      remainingMinor: "0",
      currency: "USD",
    });
    expect(email.text).toContain("paid in full");
    expect(email.text).not.toContain("Remaining balance");
  });
});
