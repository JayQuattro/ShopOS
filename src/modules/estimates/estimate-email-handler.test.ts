import { describe, expect, it } from "vitest";

import {
  buildChangeOrderEmail,
  buildEstimateAuthorizationEmail,
} from "@/modules/estimates/estimate-email-handler";

describe("buildEstimateAuthorizationEmail", () => {
  const email = buildEstimateAuthorizationEmail({
    organizationName: "Ridgeline Auto",
    workOrderNumber: "RO-2043",
    revisionNumber: 2,
    totalMinor: "128450",
    currency: "USD",
    authorizeUrl: "http://localhost:3000/authorize/abc123token",
    expiresAt: new Date("2026-08-19T12:00:00Z"),
  });

  it("identifies the shop and work order in the subject", () => {
    expect(email.subject).toContain("RO-2043");
    expect(email.subject).toContain("Ridgeline Auto");
  });

  it("formats the total from the revision's currency", () => {
    expect(email.text).toContain("$1,284.50");
  });

  it("includes the authorize URL and revision number", () => {
    expect(email.text).toContain("http://localhost:3000/authorize/abc123token");
    expect(email.text).toContain("revision 2");
  });

  it("states the expiry as a full date-time in UTC", () => {
    expect(email.text).toMatch(/Wednesday, August 19, 2026/);
    expect(email.text).toContain("UTC");
  });

  it("renders non-USD currencies with the record's ISO code", () => {
    const eur = buildEstimateAuthorizationEmail({
      organizationName: "Atelier",
      workOrderNumber: "RO-1",
      revisionNumber: 1,
      totalMinor: "9900",
      currency: "EUR",
      authorizeUrl: "http://localhost:3000/authorize/x",
      expiresAt: new Date("2026-08-19T12:00:00Z"),
    });
    expect(eur.text).toContain("€99.00");
  });
});

describe("buildChangeOrderEmail", () => {
  const base = {
    organizationName: "Ridgeline Auto",
    workOrderNumber: "RO-2043",
    changeOrderNumber: 1,
    note: "Seized caliper slide pins — rotors scored beyond spec.",
    deltaMinor: "42000",
    currency: "USD",
    previouslyApprovedMinor: "128450",
    newTotalMinor: "170450",
  } as const;

  it("frames the delta and new total cumulatively for approvals", () => {
    const email = buildChangeOrderEmail({
      ...base,
      authorizeUrl: "http://localhost:3000/authorize/tok123",
      expiresAt: new Date("2026-08-20T12:00:00Z"),
    });
    expect(email.subject).toContain("Additional work needs your approval");
    expect(email.text).toContain("Previously authorized: $1,284.50");
    expect(email.text).toContain("This change: +$420.00");
    expect(email.text).toContain("New authorized total: $1,704.50");
    expect(email.text).toContain("http://localhost:3000/authorize/tok123");
    expect(email.text).toContain("Seized caliper slide pins");
  });

  it("notifies without a link when a credit is auto-applied", () => {
    const email = buildChangeOrderEmail({
      ...base,
      deltaMinor: "-6500",
      newTotalMinor: "121950",
      authorizeUrl: null,
      expiresAt: null,
    });
    expect(email.subject).toContain("Price adjustment");
    expect(email.text).toContain("This change: -$65.00");
    expect(email.text).toContain("applied automatically");
    expect(email.text).not.toContain("/authorize/");
    expect(email.text).not.toContain("approve or decline");
  });
});
