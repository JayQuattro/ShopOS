import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type CashDrawerServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export class CashDrawerFailed extends Error {
  constructor(
    public readonly reason:
      | "drawer_already_open"
      | "session_not_found"
      | "session_not_open"
      | "invalid_amount"
      | "location_not_found",
  ) {
    super("The cash drawer operation could not be completed.");
    this.name = "CashDrawerFailed";
  }
}

export type MethodTotals = Readonly<Record<string, number>>;

export type OpenDrawerState = Readonly<{
  sessionId: string;
  locationId: string;
  currency: string;
  openingFloatMinor: number;
  openedAt: Date;
  openedByName: string;
  ownerUserId: string | null;
  ownerName: string | null;
  label: string | null;
  note: string | null;
  methodTotals: MethodTotals;
  expectedCashMinor: number;
  paymentCount: number;
}>;

export type ClosedDrawerSummary = Readonly<{
  id: string;
  locationId: string;
  currency: string;
  openingFloatMinor: number;
  label: string | null;
  ownerName: string | null;
  methodTotals: MethodTotals;
  countedCashMinor: number;
  expectedCashMinor: number;
  overShortMinor: number;
  openedAt: Date;
  closedAt: Date;
  openedByName: string;
  closedByName: string;
  note: string | null;
}>;

/** Payment methods counted as cash in the drawer. */
const CASH_METHODS = new Set(["CASH"]);

/**
 * A drawer's totals. Stamped payments are attributed to the till they were
 * recorded into; unstamped payments (recorded before attribution existed,
 * or with no open drawer at the time) reconcile to the shared house
 * drawer's window only — a personal till never inherits them.
 */
async function methodTotalsForDrawer(
  db: PrismaClient | TransactionalClient,
  organizationId: string,
  session: Readonly<{
    id: string;
    locationId: string;
    currency: string;
    openedAt: Date;
    ownerUserId: string | null;
  }>,
): Promise<MethodTotals> {
  const payments = await db.payment.findMany({
    where: {
      organizationId,
      OR: [
        { drawerSessionId: session.id },
        ...(session.ownerUserId === null
          ? [
              {
                drawerSessionId: null,
                locationId: session.locationId,
                currency: session.currency,
                receivedAt: { gte: session.openedAt },
              },
            ]
          : []),
      ],
    },
    select: { method: true, amountMinor: true },
  });

  const totals: Record<string, number> = {};
  for (const payment of payments) {
    totals[payment.method] = (totals[payment.method] ?? 0) + Number(payment.amountMinor);
  }
  return totals;
}

/**
 * The drawer a new payment should land in: the recorder's open personal
 * till at that location, else the shared open drawer. Null when nothing
 * is open — the payment records fine either way.
 */
export async function resolveDrawerForPayment(
  db: PrismaClient | TransactionalClient,
  organizationId: string,
  locationId: string,
  actorUserId: string | null,
): Promise<string | null> {
  const where: Record<string, unknown> = {
    organizationId,
    locationId,
    status: "open",
  };
  if (actorUserId) {
    const personal = await db.cashDrawerSession.findFirst({
      where: { ...where, ownerUserId: actorUserId },
      select: { id: true },
    });
    if (personal) return personal.id;
  }
  const shared = await db.cashDrawerSession.findFirst({
    where: { ...where, ownerUserId: null },
    select: { id: true },
  });
  return shared?.id ?? null;
}

/**
 * Opens the drawer for a location: one open session at a time, with the
 * starting float. Payments recorded after `openedAt` make up the day.
 */
export async function openCashDrawer(
  input: CashDrawerServiceInput & {
    locationId: string;
    currency: string;
    openingFloatMinor?: number;
    note?: string;
    label?: string;
    /** Shared house drawer instead of the opener's personal till. */
    shared?: boolean;
  },
): Promise<Readonly<{ sessionId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId, locationId: input.locationId },
    "payments.record",
  );

  if (
    input.openingFloatMinor !== undefined &&
    (!Number.isSafeInteger(input.openingFloatMinor) || input.openingFloatMinor < 0)
  ) {
    throw new CashDrawerFailed("invalid_amount");
  }

  return input.db.$transaction(async (transaction) => {
    const location = await transaction.location.findFirst({
      where: { id: input.locationId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!location) throw new CashDrawerFailed("location_not_found");

    // A personal till belongs to the opener; `shared` opens the house
    // drawer instead. Uniqueness (one shared per location, one personal
    // per owner per location) is enforced by partial unique indexes; a
    // friendly check here keeps the error readable.
    const ownerUserId = input.shared ? null : input.context.actorId;
    const existing = await transaction.cashDrawerSession.findFirst({
      where: {
        organizationId: input.context.organizationId,
        locationId: input.locationId,
        status: "open",
        ...(ownerUserId ? { ownerUserId } : { ownerUserId: null }),
      },
      select: { id: true },
    });
    if (existing) throw new CashDrawerFailed("drawer_already_open");

    const session = await transaction.cashDrawerSession.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: input.locationId,
        currency: input.currency.trim().toUpperCase(),
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(input.label ? { label: input.label.trim() } : {}),
        ...(input.openingFloatMinor !== undefined
          ? { openingFloatMinor: input.openingFloatMinor }
          : {}),
        openedByUserId: input.context.actorId,
        ...(input.note ? { note: input.note.trim() } : {}),
      },
      select: { id: true },
    });
    return { sessionId: session.id };
  });
}

/**
 * The live drawer: the open session for a location plus running totals by
 * payment method since it opened, and the expected cash on hand.
 */
export async function getOpenCashDrawer(
  input: CashDrawerServiceInput & { locationId: string },
): Promise<OpenDrawerState | null> {
  const drawers = await getOpenCashDrawers(input);
  return drawers[0] ?? null;
}

/** Every open till (shared + personal) across the authorized locations. */
export async function getOpenCashDrawers(
  input: CashDrawerServiceInput & { locationId?: string },
): Promise<readonly OpenDrawerState[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  const where: Record<string, unknown> = {
    organizationId: input.context.organizationId,
    status: "open",
  };
  if (input.locationId) {
    where.locationId = input.locationId;
  } else if (
    !input.context.organizationWideLocationAccess &&
    input.context.allowedLocationIds.size > 0
  ) {
    where.locationId = { in: [...input.context.allowedLocationIds] };
  }

  const sessions = await input.db.cashDrawerSession.findMany({
    where,
    orderBy: [{ locationId: "asc" }, { openedAt: "asc" }],
    select: {
      id: true,
      organizationId: true,
      locationId: true,
      currency: true,
      openingFloatMinor: true,
      openedAt: true,
      note: true,
      label: true,
      ownerUserId: true,
      owner: { select: { displayName: true } },
      openedBy: { select: { displayName: true } },
    },
  });

  const states: OpenDrawerState[] = [];
  for (const session of sessions) {
    const [totals, paymentCount] = await Promise.all([
      methodTotalsForDrawer(input.db, session.organizationId, {
        id: session.id,
        locationId: session.locationId,
        currency: session.currency,
        openedAt: session.openedAt,
        ownerUserId: session.ownerUserId,
      }),
      input.db.payment.count({
        where: {
          organizationId: session.organizationId,
          OR: [{ drawerSessionId: session.id }],
        },
      }),
    ]);

    const cashTakenIn = Object.entries(totals)
      .filter(([method]) => CASH_METHODS.has(method))
      .reduce((sum, [, minor]) => sum + minor, 0);

    states.push({
      sessionId: session.id,
      locationId: session.locationId,
      currency: session.currency,
      openingFloatMinor: session.openingFloatMinor,
      openedAt: session.openedAt,
      openedByName: session.openedBy.displayName,
      ownerUserId: session.ownerUserId,
      ownerName: session.owner?.displayName ?? null,
      label: session.label,
      note: session.note,
      methodTotals: totals,
      expectedCashMinor: session.openingFloatMinor + cashTakenIn,
      paymentCount,
    });
  }
  return states;
}

/**
 * Closes the drawer for the night: snapshots method totals, records the
 * counted cash, and keeps over/short for reconciliation. Payments are never
 * modified — the drawer is a windowed projection of them.
 */
export async function closeCashDrawer(
  input: CashDrawerServiceInput & { sessionId: string; countedCashMinor: number; note?: string },
): Promise<Readonly<{ overShortMinor: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  if (!Number.isSafeInteger(input.countedCashMinor) || input.countedCashMinor < 0) {
    throw new CashDrawerFailed("invalid_amount");
  }

  return input.db.$transaction(async (transaction) => {
    const session = await transaction.cashDrawerSession.findFirst({
      where: { id: input.sessionId, organizationId: input.context.organizationId },
      select: {
        id: true,
        status: true,
        locationId: true,
        currency: true,
        openingFloatMinor: true,
        openedAt: true,
        ownerUserId: true,
      },
    });
    if (!session) throw new CashDrawerFailed("session_not_found");
    if (session.status !== "open") throw new CashDrawerFailed("session_not_open");

    assertTenantAccess(
      input.context,
      { organizationId: input.context.organizationId, locationId: session.locationId },
      "payments.record",
    );

    const totals = await methodTotalsForDrawer(transaction, input.context.organizationId, {
      id: session.id,
      locationId: session.locationId,
      currency: session.currency,
      openedAt: session.openedAt,
      ownerUserId: session.ownerUserId ?? null,
    });
    const cashTakenIn = Object.entries(totals)
      .filter(([method]) => CASH_METHODS.has(method))
      .reduce((sum, [, minor]) => sum + minor, 0);
    const expectedCash = session.openingFloatMinor + cashTakenIn;
    const overShort = input.countedCashMinor - expectedCash;

    await transaction.cashDrawerSession.update({
      where: { id: session.id },
      data: {
        status: "closed",
        methodTotals: totals,
        countedCashMinor: input.countedCashMinor,
        expectedCashMinor: expectedCash,
        overShortMinor: overShort,
        closedByUserId: input.context.actorId,
        closedAt: new Date(),
        ...(input.note ? { note: input.note.trim() } : {}),
      },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: session.locationId,
        actorUserId: input.context.actorId,
        action: "cash_drawer.closed",
        entityType: "cash_drawer_session",
        entityId: session.id,
        requestId: input.context.requestId,
        after: {
          countedCashMinor: input.countedCashMinor,
          expectedCashMinor: expectedCash,
          overShortMinor: overShort,
        },
      },
    });

    return { overShortMinor: overShort };
  });
}

/** Recent closed sessions — the reconciliation history. */
export async function listClosedCashDrawers(
  input: CashDrawerServiceInput & { locationId?: string },
): Promise<readonly ClosedDrawerSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  const where: Record<string, unknown> = {
    organizationId: input.context.organizationId,
    status: "closed",
  };
  if (!input.context.organizationWideLocationAccess && input.context.allowedLocationIds.size > 0) {
    where.locationId = { in: [...input.context.allowedLocationIds] };
  } else if (input.locationId) {
    where.locationId = input.locationId;
  }

  const sessions = await input.db.cashDrawerSession.findMany({
    where,
    orderBy: { closedAt: "desc" },
    take: 20,
    select: {
      id: true,
      locationId: true,
      currency: true,
      openingFloatMinor: true,
      label: true,
      owner: { select: { displayName: true } },
      methodTotals: true,
      countedCashMinor: true,
      expectedCashMinor: true,
      overShortMinor: true,
      openedAt: true,
      closedAt: true,
      note: true,
      openedBy: { select: { displayName: true } },
      closedBy: { select: { displayName: true } },
    },
  });

  return sessions.map((session) => ({
    id: session.id,
    locationId: session.locationId,
    currency: session.currency,
    openingFloatMinor: session.openingFloatMinor,
    label: session.label,
    ownerName: session.owner?.displayName ?? null,
    methodTotals: (session.methodTotals ?? {}) as MethodTotals,
    countedCashMinor: session.countedCashMinor ?? 0,
    expectedCashMinor: session.expectedCashMinor ?? 0,
    overShortMinor: session.overShortMinor ?? 0,
    openedAt: session.openedAt,
    closedAt: session.closedAt ?? session.openedAt,
    openedByName: session.openedBy.displayName,
    closedByName: session.closedBy?.displayName ?? "",
    note: session.note,
  }));
}
