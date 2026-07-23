export type CurrencyCode = string & { readonly __currencyCode: unique symbol };

export type Money = Readonly<{
  amountMinor: number;
  currency: CurrencyCode;
}>;

export type PricedLineKind = "labor" | "part" | "fee";
export type AuthorizationState = "pending" | "approved" | "declined" | "not_required";

export type PricedLineInput = Readonly<{
  id: string;
  kind: PricedLineKind;
  quantityMilli: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxable: boolean;
  taxRateBasisPoints: number;
  authorization: AuthorizationState;
}>;

export type CalculatedLine = PricedLineInput &
  Readonly<{
    grossMinor: number;
    netMinor: number;
    taxMinor: number;
    totalMinor: number;
  }>;

export type EstimateTotals = Readonly<{
  currency: CurrencyCode;
  lines: readonly CalculatedLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  approvedTotalMinor: number;
}>;

const ISO_CURRENCY = /^[A-Z]{3}$/;

export function currencyCode(value: string): CurrencyCode {
  if (!ISO_CURRENCY.test(value)) {
    throw new MoneyError("currency_invalid", "Currency must be a three-letter uppercase ISO code.");
  }

  return value as CurrencyCode;
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  assertSafeInteger(amountMinor, "amountMinor");
  return { amountMinor, currency };
}

export function calculateEstimate(
  currency: CurrencyCode,
  inputs: readonly PricedLineInput[],
): EstimateTotals {
  const lines = inputs.map(calculateLine);

  const totals = lines.reduce(
    (result, line) => {
      result.subtotalMinor = safeAdd(result.subtotalMinor, line.grossMinor);
      result.discountMinor = safeAdd(result.discountMinor, line.discountMinor);
      result.taxMinor = safeAdd(result.taxMinor, line.taxMinor);
      result.totalMinor = safeAdd(result.totalMinor, line.totalMinor);

      if (line.authorization === "approved" || line.authorization === "not_required") {
        result.approvedTotalMinor = safeAdd(result.approvedTotalMinor, line.totalMinor);
      }

      return result;
    },
    {
      subtotalMinor: 0,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      approvedTotalMinor: 0,
    },
  );

  return { currency, lines, ...totals };
}

export function calculateLine(input: PricedLineInput): CalculatedLine {
  assertNonNegativeSafeInteger(input.quantityMilli, "quantityMilli");
  assertNonNegativeSafeInteger(input.unitPriceMinor, "unitPriceMinor");
  assertNonNegativeSafeInteger(input.discountMinor, "discountMinor");
  assertNonNegativeSafeInteger(input.taxRateBasisPoints, "taxRateBasisPoints");

  const grossMinor = ratioRounded(
    BigInt(input.quantityMilli) * BigInt(input.unitPriceMinor),
    1_000n,
  );

  if (input.discountMinor > grossMinor) {
    throw new MoneyError("discount_exceeds_line", "A discount cannot exceed its line gross.");
  }

  const netMinor = grossMinor - input.discountMinor;
  const taxMinor = input.taxable
    ? ratioRounded(BigInt(netMinor) * BigInt(input.taxRateBasisPoints), 10_000n)
    : 0;
  const totalMinor = safeAdd(netMinor, taxMinor);

  return { ...input, grossMinor, netMinor, taxMinor, totalMinor };
}

function ratioRounded(numerator: bigint, denominator: bigint): number {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const direction = numerator < 0n ? -1n : 1n;
  const rounded = absoluteRemainder * 2n >= denominator ? quotient + direction : quotient;
  const value = Number(rounded);

  assertSafeInteger(value, "calculated money");
  return value;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  assertSafeInteger(result, "money total");
  return result;
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  assertSafeInteger(value, field);
  if (value < 0) {
    throw new MoneyError("negative_value", `${field} cannot be negative.`);
  }
}

function assertSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError("unsafe_integer", `${field} must be a safe integer.`);
  }
}

export class MoneyError extends Error {
  readonly code: "currency_invalid" | "discount_exceeds_line" | "negative_value" | "unsafe_integer";

  constructor(
    code: "currency_invalid" | "discount_exceeds_line" | "negative_value" | "unsafe_integer",
    message: string,
  ) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}
