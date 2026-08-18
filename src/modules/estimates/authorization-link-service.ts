import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type AuthorizationLinkInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class AuthorizationLinkFailed extends Error {
  constructor(
    public readonly reason:
      | "revision_not_found"
      | "revision_not_presented"
      | "link_not_found"
      | "link_expired"
      | "link_revoked"
      | "link_used",
  ) {
    super("The authorization link operation could not be completed.");
    this.name = "AuthorizationLinkFailed";
  }
}

/** Fallback lifetime of authorization links (organization setting overrides). */
export const AUTHORIZATION_LINK_TTL_HOURS = 72;

/** The organization's configured link lifetime, defaulting to 72h. */
export async function resolveLinkTtlHours(
  db: Pick<import("@/generated/prisma/client").PrismaClient, "organization">,
  organizationId: string,
): Promise<number> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { authorizationLinkTtlHours: true },
  });
  return organization?.authorizationLinkTtlHours ?? AUTHORIZATION_LINK_TTL_HOURS;
}

const DEFAULT_TTL_HOURS = AUTHORIZATION_LINK_TTL_HOURS;

/**
 * Creates an expiring, revocable authorization link for a PRESENTED estimate
 * revision. The link contains a cryptographically secure token that the
 * customer uses to approve or decline without a ShopOS account.
 *
 * The link expires after the given TTL (default 72 hours) and can be revoked
 * by shop staff at any time.
 */
export async function createAuthorizationLink(
  input: AuthorizationLinkInput & {
    revisionId: string;
    expiresInHours?: number;
  },
): Promise<Readonly<{ linkId: string; token: string; expiresAt: Date }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "estimates.present",
  );

  const ttlHours = input.expiresInHours ?? DEFAULT_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const token = randomBytes(32).toString("base64url");

  return input.db.$transaction(async (transaction) => {
    const revision = await transaction.estimateRevision.findFirst({
      where: { id: input.revisionId, organizationId: input.context.organizationId },
      select: { id: true, status: true },
    });
    if (!revision) throw new AuthorizationLinkFailed("revision_not_found");
    if (revision.status !== "PRESENTED")
      throw new AuthorizationLinkFailed("revision_not_presented");

    const link = await transaction.authorizationLink.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
        token,
        expiresAt,
      },
    });

    return { linkId: link.id, token: link.token, expiresAt: link.expiresAt };
  });
}

/**
 * Revokes an authorization link, making it immediately unusable.
 */
export async function revokeAuthorizationLink(
  input: AuthorizationLinkInput & { linkId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "estimates.present",
  );

  const update = await input.db.authorizationLink.updateMany({
    where: {
      id: input.linkId,
      organizationId: input.context.organizationId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  if (update.count !== 1) throw new AuthorizationLinkFailed("link_not_found");
}

/**
 * Validates an authorization link token. Returns the estimate revision data
 * needed for the customer-facing approval page. Does NOT require a tenant
 * context — this is called from the public customer-facing route with only
 * the token.
 */
export async function validateAuthorizationLink(
  db: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<
  Readonly<{
    linkId: string;
    organizationId: string;
    revisionId: string;
    workOrderId: string;
    locationId: string;
    revisionNumber: number;
    documentKind: "BASELINE" | "CHANGE_ORDER";
    changeOrderNumber: number | null;
    summaryNote: string | null;
    currency: string;
    totalMinor: string;
    /** Cumulative approved total of this work order before this document. */
    previouslyApprovedMinor: string;
    /** What each earlier document contributed, with its approved lines. */
    previousDocuments: ReadonlyArray<
      Readonly<{
        label: string;
        approvedLines: ReadonlyArray<Readonly<{ description: string; amountMinor: string }>>;
        declinedCount: number;
      }>
    >;
    workOrderNumber: string;
    organizationName: string;
    customerName: string;
    lines: ReadonlyArray<
      Readonly<{
        id: string;
        description: string;
        totalMinor: string;
        authorizationRequired: boolean;
      }>
    >;
  }>
> {
  const link = await db.authorizationLink.findUnique({
    where: { token },
    include: {
      estimateRevision: {
        select: {
          id: true,
          workOrderId: true,
          locationId: true,
          revisionNumber: true,
          documentKind: true,
          changeOrderNumber: true,
          summaryNote: true,
          currency: true,
          totalMinor: true,
          workOrder: { select: { number: true, customer: { select: { displayName: true } } } },
          organization: { select: { name: true } },
          lines: {
            orderBy: { position: "asc" },
            select: { id: true, description: true, totalMinor: true, authorizationRequired: true },
          },
        },
      },
    },
  });

  if (!link) throw new AuthorizationLinkFailed("link_not_found");
  if (link.revokedAt) throw new AuthorizationLinkFailed("link_revoked");
  if (link.expiresAt <= now) throw new AuthorizationLinkFailed("link_expired");
  if (link.usedAt) throw new AuthorizationLinkFailed("link_used");

  const rev = link.estimateRevision;

  // Cumulative framing (ADR 0014): approved lines of the other presented
  // documents, with per-document detail so the customer sees exactly what
  // they already authorized.
  const otherRevisions = await db.estimateRevision.findMany({
    where: {
      organizationId: link.organizationId,
      workOrderId: rev.workOrderId,
      status: "PRESENTED",
      id: { not: rev.id },
    },
    orderBy: { revisionNumber: "asc" },
    select: {
      revisionNumber: true,
      documentKind: true,
      changeOrderNumber: true,
      lines: {
        orderBy: { position: "asc" },
        select: {
          description: true,
          totalMinor: true,
          authorizationRequired: true,
          authorizationDecisions: { select: { decision: true }, take: 1 },
        },
      },
    },
  });
  let previouslyApprovedMinor = 0;
  const previousDocuments = otherRevisions.map((other) => {
    const approvedLines: Array<{ description: string; amountMinor: string }> = [];
    let declinedCount = 0;
    for (const line of other.lines) {
      const decision = line.authorizationDecisions[0]?.decision;
      if (decision === "APPROVED" || (!line.authorizationRequired && !decision)) {
        approvedLines.push({
          description: line.description,
          amountMinor: line.totalMinor.toString(),
        });
        previouslyApprovedMinor += Number(line.totalMinor);
      } else if (decision === "DECLINED") {
        declinedCount += 1;
      }
    }
    return {
      label:
        other.documentKind === "CHANGE_ORDER"
          ? `Change order ${other.changeOrderNumber ?? ""}`.trim()
          : `Estimate (revision ${other.revisionNumber})`,
      approvedLines,
      declinedCount,
    };
  });

  return {
    linkId: link.id,
    organizationId: link.organizationId,
    revisionId: rev.id,
    workOrderId: rev.workOrderId,
    locationId: rev.locationId,
    revisionNumber: rev.revisionNumber,
    documentKind: rev.documentKind,
    changeOrderNumber: rev.changeOrderNumber,
    summaryNote: rev.summaryNote,
    currency: rev.currency,
    totalMinor: rev.totalMinor.toString(),
    previouslyApprovedMinor: previouslyApprovedMinor.toString(),
    previousDocuments,
    workOrderNumber: rev.workOrder.number,
    organizationName: rev.organization.name,
    customerName: rev.workOrder.customer.displayName,
    lines: rev.lines.map((l) => ({
      id: l.id,
      description: l.description,
      totalMinor: l.totalMinor.toString(),
      authorizationRequired: l.authorizationRequired,
    })),
  };
}

/**
 * Marks a link as used (after the customer has submitted their decision).
 */
export async function markLinkUsed(db: PrismaClient, linkId: string): Promise<void> {
  await db.authorizationLink.update({
    where: { id: linkId },
    data: { usedAt: new Date() },
  });
}
