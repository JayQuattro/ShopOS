/**
 * Clearance-mandate intermediary slots (ADR 0017): organizations bring
 * their own accredited intermediary. Like payments, these are BYO,
 * organization-scoped connector slots — the platform never holds
 * intermediary accreditation. Registered now so shops can see the roadmap
 * and demand can pick the first implementation; no adapter is live yet.
 */
export type ClearanceConnectorDefinition = Readonly<{
  key: string;
  displayName: string;
  country: string;
  mandate: string;
  description: string;
  status: "planned";
}>;

export const CLEARANCE_CONNECTOR_DEFINITIONS: readonly ClearanceConnectorDefinition[] = [
  {
    key: "sdi",
    displayName: "SdI (Agenzia delle Entrate)",
    country: "IT",
    mandate: "FatturaPA clearance",
    description:
      "Italy — transmit FatturaPA through your accredited SDI intermediary; receives the transmission receipt (notification id).",
    status: "planned",
  },
  {
    key: "pac",
    displayName: "PAC (CFDI 4.0)",
    country: "MX",
    mandate: "SAT stamping",
    description: "Mexico — your PAC stamps the CFDI and returns the SAT UUID + original chain.",
    status: "planned",
  },
  {
    key: "ksef",
    displayName: "KSeF",
    country: "PL",
    mandate: "Krajowy System e-Faktur",
    description: "Poland — submit FA(2) invoices to the national e-invoice system.",
    status: "planned",
  },
  {
    key: "irp",
    displayName: "IRP via GSP",
    country: "IN",
    mandate: "e-Invoice IRN",
    description:
      "India — your GSP obtains the Invoice Reference Number and signed QR for B2B invoices above the threshold.",
    status: "planned",
  },
  {
    key: "verifactu",
    displayName: "VeriFactu",
    country: "ES",
    mandate: "invoicing record verification",
    description: "Spain — event-stream invoicing records to the tax agency.",
    status: "planned",
  },
];
