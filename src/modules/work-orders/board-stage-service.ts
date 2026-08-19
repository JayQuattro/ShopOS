import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type BoardStageServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class BoardStageFailed extends Error {
  constructor(
    public readonly reason:
      | "invalid_label"
      | "invalid_key"
      | "duplicate_key"
      | "stage_not_found"
      | "work_order_not_found",
  ) {
    super("The board stage operation could not be completed.");
    this.name = "BoardStageFailed";
  }
}

export type BoardStageSummary = Readonly<{
  id: string;
  key: string;
  label: string;
  colorHint: string | null;
  sortOrder: number;
}>;

const KEY_PATTERN = /^[a-z0-9_-]{1,40}$/;

/** Active stages in board order. */
export async function listBoardStages(
  input: BoardStageServiceInput,
): Promise<readonly BoardStageSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const stages = await input.db.boardStage.findMany({
    where: { organizationId: input.context.organizationId, active: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, key: true, label: true, colorHint: true, sortOrder: true },
  });
  return stages;
}

/** Creates a stage; key derived from the label when absent. */
export async function createBoardStage(
  input: BoardStageServiceInput & { label: string; key?: string; colorHint?: string },
): Promise<Readonly<{ stageId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );

  const label = input.label.trim();
  if (label.length < 1 || label.length > 60) throw new BoardStageFailed("invalid_label");

  const key = (input.key?.trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(
    /^-+|-+$/g,
    "",
  );
  if (!KEY_PATTERN.test(key)) throw new BoardStageFailed("invalid_key");

  return input.db.$transaction(async (transaction) => {
    const existing = await transaction.boardStage.findFirst({
      where: { organizationId: input.context.organizationId, key },
      select: { id: true },
    });
    if (existing) throw new BoardStageFailed("duplicate_key");

    const maxOrder = await transaction.boardStage.aggregate({
      where: { organizationId: input.context.organizationId },
      _max: { sortOrder: true },
    });

    const stage = await transaction.boardStage.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        key,
        label,
        ...(input.colorHint ? { colorHint: input.colorHint.trim() } : {}),
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
      select: { id: true },
    });
    return { stageId: stage.id };
  });
}

/** Renames or recolors; reordering happens through the dedicated endpoint. */
export async function updateBoardStage(
  input: BoardStageServiceInput & {
    stageId: string;
    label?: string;
    colorHint?: string | null;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (label.length < 1 || label.length > 60) throw new BoardStageFailed("invalid_label");
  }

  const updated = await input.db.boardStage.updateMany({
    where: { id: input.stageId, organizationId: input.context.organizationId },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.colorHint !== undefined ? { colorHint: input.colorHint } : {}),
    },
  });
  if (updated.count !== 1) throw new BoardStageFailed("stage_not_found");
}

/** Deactivates; work orders on it fall back to their vehicle stage. */
export async function deactivateBoardStage(
  input: BoardStageServiceInput & { stageId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );

  const deactivated = await input.db.boardStage.updateMany({
    where: { id: input.stageId, organizationId: input.context.organizationId, active: true },
    data: { active: false },
  });
  if (deactivated.count !== 1) throw new BoardStageFailed("stage_not_found");

  await input.db.workOrder.updateMany({
    where: { organizationId: input.context.organizationId, boardStageId: input.stageId },
    data: { boardStageId: null },
  });
}

/**
 * Moves a work order to a board stage. Null clears the custom stage — the
 * work order falls back to its built-in vehicle stage on the board.
 */
export async function setWorkOrderBoardStage(
  input: BoardStageServiceInput & { workOrderId: string; stageId: string | null },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!workOrder) throw new BoardStageFailed("work_order_not_found");

    if (input.stageId) {
      const stage = await transaction.boardStage.findFirst({
        where: { id: input.stageId, organizationId: input.context.organizationId, active: true },
        select: { id: true },
      });
      if (!stage) throw new BoardStageFailed("stage_not_found");
    }

    await transaction.workOrder.update({
      where: { id: workOrder.id },
      data: { boardStageId: input.stageId },
    });
  });
}
