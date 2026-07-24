import type { PrismaClient } from "@/generated/prisma/client";

export function assertDedicatedTestDatabase(databaseUrl: string): void {
  const databaseName = new URL(databaseUrl).pathname.split("/").filter(Boolean).at(-1);
  if (databaseName !== "shopos_test") {
    throw new Error(
      `Integration tests require the dedicated shopos_test database; received ${databaseName ?? "none"}.`,
    );
  }
}

export async function resetTestDatabase(
  db: Pick<PrismaClient, "$executeRawUnsafe">,
): Promise<void> {
  // Static SQL against a database whose name is checked above. Cascading from
  // the two aggregate roots also clears auth, tenant, platform, audit, and
  // outbox records without maintaining a fragile hand-ordered delete list.
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "organizations", "auth_verifications" RESTART IDENTITY CASCADE',
  );
}
