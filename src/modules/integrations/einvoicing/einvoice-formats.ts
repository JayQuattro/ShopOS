/**
 * E-invoice document builders (ADR 0017): pure transformations from an
 * issued-invoice snapshot to standard EN16931 XML. No network, no
 * credentials, deterministic output — the same invoice always renders the
 * same document, including its tax-mode and component snapshots.
 */

export type EInvoiceLine = Readonly<{
  description: string;
  quantityMilli: number;
  unitPriceMinor: bigint;
  grossMinor: bigint;
  discountMinor: bigint;
  taxable: boolean;
  taxRateBasisPoints: number;
  taxInclusive: boolean;
  taxComponents: ReadonlyArray<Readonly<{ name: string; rateBasisPoints: number }>>;
  totalMinor: bigint;
}>;

export type EInvoiceSource = Readonly<{
  format: "factur-x" | "xrechnung" | "fatturapa";
  invoiceNumber: string;
  issuedAt: Date;
  currency: string;
  /** Net-of-tax subtotal (tax basis) after discounts. */
  netSubtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  /** What the customer owes (invoice totalMinor). */
  grandMinor: bigint;
  /** VAT breakdown by rate: basis and amount per distinct rate. */
  vatBreakdown: ReadonlyArray<
    Readonly<{ rateBasisPoints: number; basisMinor: bigint; amountMinor: bigint }>
  >;
  seller: Readonly<{
    name: string;
    taxId: string | null;
    street: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
  }>;
  buyer: Readonly<{
    name: string;
    taxId: string | null;
    street: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
  }>;
  lines: readonly EInvoiceLine[];
}>;

/** Decimal string with two places from integer minor units. */
function amount(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Splits "DE123456789" into country code and number for tax scheme IDs. */
export function splitTaxId(taxId: string | null): { country: string | null; number: string } {
  if (!taxId) return { country: null, number: "" };
  const match = taxId.match(/^([A-Za-z]{2})(.+)$/);
  if (match) return { country: match[1]!.toUpperCase(), number: match[2]! };
  return { country: null, number: taxId };
}

/**
 * EN16931 Cross Industry Invoice — the Factur-X (FR) and ZUGFeRD (DE)
 * family. Emits the EN16931 profile: header, parties with tax
 * registrations, per-line amounts, and the VAT breakdown by rate.
 */
export function buildCrossIndustryInvoice(source: EInvoiceSource): string {
  const vatBreakdown = source.vatBreakdown.length
    ? source.vatBreakdown
    : [{ rateBasisPoints: 0, basisMinor: source.netSubtotalMinor, amountMinor: 0n }];

  const lines = source.lines
    .map((line, index) => {
      // Inclusive lines: the net is the total minus its embedded tax.
      const net = line.taxInclusive
        ? BigInt(
            Number(line.totalMinor) -
              Math.round(
                (Number(line.totalMinor) * line.taxRateBasisPoints) /
                  (10000 + line.taxRateBasisPoints),
              ),
          )
        : line.totalMinor;
      return `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${index + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${escapeXml(line.description)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:GrossPriceProductTradePrice>
          <ram:ChargeAmount>${amount(line.unitPriceMinor)}</ram:ChargeAmount>
        </ram:GrossPriceProductTradePrice>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${amount(line.unitPriceMinor)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="C62">${(line.quantityMilli / 1000).toFixed(3)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${line.taxable ? "S" : "Z"}</ram:CategoryCode>
          <ram:RateApplicablePercent>${(line.taxRateBasisPoints / 100).toFixed(2)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${amount(net)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join("\n");

  const sellerTax = splitTaxId(source.seller.taxId);
  const buyerTax = splitTaxId(source.buyer.taxId);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(source.invoiceNumber)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${isoDate(source.issuedAt).replaceAll("-", "")}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${escapeXml(source.invoiceNumber)}</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>${escapeXml(source.seller.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>${escapeXml(source.seller.street ?? "")}</ram:LineOne>
          <ram:CityName>${escapeXml(source.seller.city ?? "")}</ram:CityName>
          <ram:PostcodeCode>${escapeXml(source.seller.postalCode ?? "")}</ram:PostcodeCode>
          <ram:CountryID>${escapeXml(source.seller.country ?? "DE")}</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${escapeXml(sellerTax.number)}</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${escapeXml(source.buyer.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>${escapeXml(source.buyer.street ?? "")}</ram:LineOne>
          <ram:CityName>${escapeXml(source.buyer.city ?? "")}</ram:CityName>
          <ram:PostcodeCode>${escapeXml(source.buyer.postalCode ?? "")}</ram:PostcodeCode>
          <ram:CountryID>${escapeXml(source.buyer.country ?? "DE")}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${
          buyerTax.number
            ? `<ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${escapeXml(buyerTax.number)}</ram:ID>
        </ram:SpecifiedTaxRegistration>`
            : ""
        }
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${escapeXml(source.currency)}</ram:InvoiceCurrencyCode>
${vatBreakdown
  .map(
    (vat) => `      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${amount(vat.amountMinor)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:ExemptionReason>${vat.rateBasisPoints === 0 ? "Exempt" : ""}</ram:ExemptionReason>
        <ram:BasisAmount>${amount(vat.basisMinor)}</ram:BasisAmount>
        <ram:CategoryCode>${vat.rateBasisPoints === 0 ? "Z" : "S"}</ram:CategoryCode>
        <ram:RateApplicablePercent>${(vat.rateBasisPoints / 100).toFixed(2)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`,
  )
  .join("\n")}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(source.netSubtotalMinor)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amount(source.netSubtotalMinor)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${escapeXml(source.currency)}">${amount(source.taxMinor)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amount(source.grandMinor)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${amount(source.grandMinor)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

/**
 * XRechnung (UBL Invoice, EN16931) — Germany's B2B format. Same amount
 * semantics as the CII variant expressed in OASIS UBL.
 */
export function buildUblInvoice(source: EInvoiceSource): string {
  const vatBreakdown = source.vatBreakdown.length
    ? source.vatBreakdown
    : [{ rateBasisPoints: 0, basisMinor: source.netSubtotalMinor, amountMinor: 0n }];
  const sellerTax = splitTaxId(source.seller.taxId);
  const buyerTax = splitTaxId(source.buyer.taxId);

  const lines = source.lines
    .map((line, index) => {
      // Inclusive lines: the net is the total minus its embedded tax.
      const net = line.taxInclusive
        ? BigInt(
            Number(line.totalMinor) -
              Math.round(
                (Number(line.totalMinor) * line.taxRateBasisPoints) /
                  (10000 + line.taxRateBasisPoints),
              ),
          )
        : line.totalMinor;
      return `  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${(line.quantityMilli / 1000).toFixed(3)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${escapeXml(source.currency)}">${amount(net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${line.taxable ? "S" : "Z"}</cbc:ID>
        <cbc:Percent>${(line.taxRateBasisPoints / 100).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${escapeXml(source.currency)}">${amount(line.unitPriceMinor)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ID>${escapeXml(source.invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${isoDate(source.issuedAt)}</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>${escapeXml(source.currency)}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(source.seller.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(source.seller.street ?? "")}</cbc:StreetName>
        <cbc:CityName>${escapeXml(source.seller.city ?? "")}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(source.seller.postalCode ?? "")}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(source.seller.country ?? "DE")}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(sellerTax.number)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(source.buyer.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(source.buyer.street ?? "")}</cbc:StreetName>
        <cbc:CityName>${escapeXml(source.buyer.city ?? "")}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(source.buyer.postalCode ?? "")}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(source.buyer.country ?? "DE")}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${
        buyerTax.number
          ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(buyerTax.number)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
          : ""
      }
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(source.currency)}">${amount(source.taxMinor)}</cbc:TaxAmount>
${vatBreakdown
  .map(
    (vat) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(source.currency)}">${amount(vat.basisMinor)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(source.currency)}">${amount(vat.amountMinor)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${vat.rateBasisPoints === 0 ? "Z" : "S"}</cbc:ID>
        <cbc:Percent>${(vat.rateBasisPoints / 100).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`,
  )
  .join("\n")}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(source.currency)}">${amount(source.netSubtotalMinor)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(source.currency)}">${amount(source.netSubtotalMinor)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(source.currency)}">${amount(source.grandMinor)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${escapeXml(source.currency)}">${amount(source.grandMinor)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}

/**
 * FatturaPA 1.2 — Italy's SDI-bound XML. Generation is local; transmission
 * goes through the shop's accredited SDI intermediary (ADR 0017 clearance
 * seam). CodiceDestinatario defaults to the public 0000000 mailbox when the
 * buyer has no dedicated SDI code. Amounts are two-decimal strings per the
 * schema; Italian invoices are tax-exclusive by convention, so inclusive
 * snapshots emit net + explicit VAT like the other builders.
 */
export function buildFatturaPa(
  source: EInvoiceSource & {
    sender: Readonly<{ countryCode: string; vatNumber: string; fiscalCode?: string }>;
    destinationCode: string;
    progressive: string;
  },
): string {
  const vatBreakdown = source.vatBreakdown.length
    ? source.vatBreakdown
    : [{ rateBasisPoints: 0, basisMinor: source.netSubtotalMinor, amountMinor: 0n }];

  const formatRate = (basisPoints: number): string => (basisPoints / 100).toFixed(2);

  const bodyLines = source.lines
    .map((line, index) => {
      // Line net-of-tax in either mode: the total carries the tax in both,
      // differing only in how it was entered.
      const net = line.taxable
        ? (line.totalMinor * 10_000n) / BigInt(10_000 + line.taxRateBasisPoints)
        : line.totalMinor;
      return `        <DettaglioLinee>
          <NumeroLinea>${index + 1}</NumeroLinea>
          <Descrizione>${escapeXml(line.description)}</Descrizione>
          <Quantita>${(line.quantityMilli / 1000).toFixed(3)}</Quantita>
          <PrezzoUnitario>${amount(line.unitPriceMinor)}</PrezzoUnitario>
          <PrezzoTotale>${amount(net)}</PrezzoTotale>
          <AliquotaIVA>${formatRate(line.taxRateBasisPoints)}</AliquotaIVA>
        </DettaglioLinee>`;
    })
    .join("\n");

  const riepilogo = vatBreakdown
    .map(
      (vat) => `        <DatiRiepilogo>
          <ImponibileImporto>${amount(vat.basisMinor)}</ImponibileImporto>
          <Imposta>${amount(vat.amountMinor)}</Imposta>
          <AliquotaIVA>${formatRate(vat.rateBasisPoints)}</AliquotaIVA>
        </DatiRiepilogo>`,
    )
    .join("\n");

  const today = isoDate(source.issuedAt).replaceAll("-", "");

  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>${escapeXml(source.sender.countryCode)}</IdPaese>
        <IdCodice>${escapeXml(source.sender.vatNumber)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${escapeXml(source.progressive)}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${escapeXml(source.destinationCode)}</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>${escapeXml(source.sender.countryCode)}</IdPaese>
          <IdCodice>${escapeXml(source.sender.vatNumber)}</IdCodice>
        </IdFiscaleIVA>
        ${source.sender.fiscalCode ? `<CodiceFiscale>${escapeXml(source.sender.fiscalCode)}</CodiceFiscale>` : ""}
        <Anagrafica>
          <Denominazione>${escapeXml(source.seller.name)}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(source.seller.street ?? "")}</Indirizzo>
        <CAP>${escapeXml(source.seller.postalCode ?? "")}</CAP>
        <Comune>${escapeXml(source.seller.city ?? "")}</Comune>
        <Nazione>${escapeXml(source.seller.country ?? "IT")}</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>${escapeXml(splitTaxId(source.buyer.taxId).country ?? "IT")}</IdPaese>
          <IdCodice>${escapeXml(splitTaxId(source.buyer.taxId).number)}</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>${escapeXml(source.buyer.name)}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(source.buyer.street ?? "")}</Indirizzo>
        <CAP>${escapeXml(source.buyer.postalCode ?? "")}</CAP>
        <Comune>${escapeXml(source.buyer.city ?? "")}</Comune>
        <Nazione>${escapeXml(source.buyer.country ?? "IT")}</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>${escapeXml(source.currency)}</Divisa>
        <Data>${today}</Data>
        <Numero>${escapeXml(source.invoiceNumber)}</Numero>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
${bodyLines}
    </DatiBeniServizi>
    <DatiRiepilogo>
${riepilogo}
    </DatiRiepilogo>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
}
