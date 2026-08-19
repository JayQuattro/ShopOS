import { describe, expect, it } from "vitest";

import {
  buildCrossIndustryInvoice,
  buildUblInvoice,
  type EInvoiceSource,
} from "@/modules/integrations/einvoicing/einvoice-formats";

const SOURCE: EInvoiceSource = {
  format: "factur-x",
  invoiceNumber: "2026-B-1001",
  issuedAt: new Date("2026-08-25T10:00:00Z"),
  currency: "EUR",
  netSubtotalMinor: 83_33n,
  discountMinor: 0n,
  taxMinor: 16_67n,
  grandMinor: 100_00n,
  vatBreakdown: [{ rateBasisPoints: 2000, basisMinor: 83_33n, amountMinor: 16_67n }],
  seller: {
    name: "Atlas Service Collective",
    taxId: "DE123456789",
    street: "100 Shop Way",
    city: "Berlin",
    postalCode: "10115",
    country: "DE",
  },
  buyer: {
    name: "Müller GmbH",
    taxId: "DE987654321",
    street: "Straße 1",
    city: "Hamburg",
    postalCode: "20095",
    country: "DE",
  },
  lines: [
    {
      description: "Brake service <special> & pads",
      quantityMilli: 1000,
      unitPriceMinor: 100_00n,
      grossMinor: 100_00n,
      discountMinor: 0n,
      taxable: true,
      taxRateBasisPoints: 2000,
      taxInclusive: true,
      taxComponents: [],
      totalMinor: 100_00n,
    },
  ],
};

describe("cross industry invoice (Factur-X/ZUGFeRD)", () => {
  const xml = buildCrossIndustryInvoice(SOURCE);

  it("emits the EN16931 context, document identity, and both tax registrations", () => {
    expect(xml).toContain("urn:cen.eu:en16931:2017");
    expect(xml).toContain("<ram:ID>2026-B-1001</ram:ID>");
    expect(xml).toContain("<ram:TypeCode>380</ram:TypeCode>");
    expect(xml).toContain('<udt:DateTimeString format="102">20260825</udt:DateTimeString>');
    // Seller VAT number with scheme, buyer's too — the B2B reverse-charge inputs.
    expect(xml).toContain('<ram:ID schemeID="VA">123456789</ram:ID>');
    expect((xml.match(/schemeID="VA"/g) ?? []).length).toBe(2);
  });

  it("escapes XML in free text and renders amounts from integer minor units", () => {
    expect(xml).toContain("Brake service &lt;special&gt; &amp; pads");
    expect(xml).toContain("<ram:LineTotalAmount>83.33</ram:LineTotalAmount>");
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">16.67</ram:TaxTotalAmount>');
    expect(xml).toContain("<ram:GrandTotalAmount>100.00</ram:GrandTotalAmount>");
    expect(xml).toContain("<ram:DuePayableAmount>100.00</ram:DuePayableAmount>");
  });

  it("emits a VAT breakdown per rate with basis and category", () => {
    expect(xml).toContain("<ram:BasisAmount>83.33</ram:BasisAmount>");
    expect(xml).toContain("<ram:RateApplicablePercent>20.00</ram:RateApplicablePercent>");
    expect(xml).toContain("<ram:CategoryCode>S</ram:CategoryCode>");
  });
});

describe("xrechnung (UBL)", () => {
  const xml = buildUblInvoice(SOURCE);

  it("emits the XRechnung customization, parties, and totals", () => {
    expect(xml).toContain("urn:xoev-de:kosit:standard:xrechnung_3.0");
    expect(xml).toContain("<cbc:ID>2026-B-1001</cbc:ID>");
    expect(xml).toContain("<cbc:IssueDate>2026-08-25</cbc:IssueDate>");
    expect(xml).toContain("<cbc:CompanyID>123456789</cbc:CompanyID>");
    expect(xml).toContain(
      '<cbc:TaxInclusiveAmount currencyID="EUR">100.00</cbc:TaxInclusiveAmount>',
    );
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">100.00</cbc:PayableAmount>');
  });

  it("renders line net amounts for inclusive lines and tax subtotals per rate", () => {
    expect(xml).toContain(
      '<cbc:LineExtensionAmount currencyID="EUR">83.33</cbc:LineExtensionAmount>',
    );
    expect(xml).toContain('<cbc:TaxableAmount currencyID="EUR">83.33</cbc:TaxableAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="EUR">16.67</cbc:TaxAmount>');
  });
});

describe("determinism and stacked components", () => {
  it("is byte-identical across calls", () => {
    expect(buildCrossIndustryInvoice(SOURCE)).toBe(buildCrossIndustryInvoice(SOURCE));
    expect(buildUblInvoice(SOURCE)).toBe(buildUblInvoice(SOURCE));
  });

  it("emits one breakdown entry per distinct stacked rate", () => {
    const stacked: EInvoiceSource = {
      ...SOURCE,
      currency: "CAD",
      netSubtotalMinor: 123_45n,
      taxMinor: 18_49n,
      grandMinor: 141_94n,
      vatBreakdown: [
        { rateBasisPoints: 500, basisMinor: 123_45n, amountMinor: 6_17n },
        { rateBasisPoints: 998, basisMinor: 123_45n, amountMinor: 12_32n },
      ],
    };
    const xml = buildCrossIndustryInvoice(stacked);
    expect(xml).toContain("<ram:RateApplicablePercent>5.00</ram:RateApplicablePercent>");
    expect(xml).toContain("<ram:RateApplicablePercent>9.98</ram:RateApplicablePercent>");
    // Two header VAT breakdowns (plus one line-level ApplicableTradeTax).
    expect((xml.match(/<ram:CalculatedAmount>/g) ?? []).length).toBe(2);
  });
});
