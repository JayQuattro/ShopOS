import { describe, expect, it } from "vitest";

import { buildEstimateAuthorizationEmail } from "@/modules/estimates/estimate-email-handler";

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
