import { randomUUID } from "node:crypto";

import { db } from "../src/db/client";
import type { PlatformOperatorRole } from "../src/generated/prisma/client";

const args = parseArgs(process.argv.slice(2));

async function main(): Promise<void> {
  const email = args.get("email")?.trim().toLowerCase();
  const role = (args.get("role")?.trim().toUpperCase() ?? "ADMIN") as PlatformOperatorRole;
  const reason =
    args.get("reason")?.trim() ?? "Initial platform operator bootstrap from the trusted console.";

  if (!email || !["VIEWER", "OPERATOR", "ADMIN"].includes(role)) {
    throw new Error(
      "Usage: pnpm platform:bootstrap-operator --email user@example.com [--role admin] [--reason text]",
    );
  }
  if (reason.length < 10 || reason.length > 500) {
    throw new Error("The bootstrap reason must contain between 10 and 500 characters.");
  }

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      twoFactorEnabled: true,
      disabledAt: true,
    },
  });
  if (!user || !user.emailVerified || !user.twoFactorEnabled || user.disabledAt) {
    throw new Error(
      "The operator must be an enabled, email-verified ShopOS user with two-factor authentication enabled.",
    );
  }

  const grant = await db.$transaction(async (transaction) => {
    const existing = await transaction.platformOperatorGrant.findFirst({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      select: { id: true, role: true },
    });
    if (existing) {
      throw new Error(`This user already has a current ${existing.role.toLowerCase()} grant.`);
    }

    const created = await transaction.platformOperatorGrant.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        role,
        reason,
      },
    });
    await transaction.platformAuditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: user.id,
        action: "platform.operator.bootstrapped",
        targetType: "user",
        targetId: user.id,
        requestId: `bootstrap:${randomUUID()}`,
        reason,
        metadata: { role },
      },
    });
    return created;
  });

  console.log(`Created ${grant.role.toLowerCase()} platform grant ${grant.id} for ${user.email}.`);
}

function parseArgs(values: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value) {
      continue;
    }
    parsed.set(key.slice(2), value);
  }
  return parsed;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Platform bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
