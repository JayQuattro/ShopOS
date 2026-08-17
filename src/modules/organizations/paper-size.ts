export type PaperSizeValue = "LETTER" | "A4" | "LEGAL";

export const PAPER_SIZES: ReadonlyArray<Readonly<{ value: PaperSizeValue; label: string }>> = [
  { value: "LETTER", label: "Letter (8.5×11 in)" },
  { value: "A4", label: "A4 (210×297 mm)" },
  { value: "LEGAL", label: "Legal (8.5×14 in)" },
];

export function resolvePaperSize(
  organizationDefault: string | null | undefined,
  override: string | null | undefined,
): PaperSizeValue {
  if (override === "A4" || override === "LETTER" || override === "LEGAL") return override;
  if (organizationDefault === "A4" || organizationDefault === "LEGAL") return organizationDefault;
  return "LETTER";
}
