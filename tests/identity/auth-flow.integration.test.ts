import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";

/**
 * Integration test exercising real Better Auth flows against a throwaway
 * PostgreSQL database.
 *
 * Requires SHOPOS_TEST_DATABASE_URL (defaults to the compose `shopos_test`
 * database) and the reviewed migrations already applied. When Postgres is
 * unreachable the suite skips cleanly so `pnpm test` stays green in environments
 * without Docker. Run `docker compose up postgres` and apply migrations with
 * `DATABASE_URL=…shopos_test pnpm db:migrate` to exercise it locally.
 */

const TEST_DATABASE_URL =
  process.env.SHOPOS_TEST_DATABASE_URL ?? "postgres://shopos:shopos@localhost:5432/shopos_test";
assertDedicatedTestDatabase(TEST_DATABASE_URL);

const TEST_SECRET = "integration-test-secret-at-least-32-characters-long";

// Set the env vars BEFORE importing any module that reads them at load time
// (db/client.ts, auth.ts, config.ts). Without this the import graph throws.
const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = TEST_DATABASE_URL;
env.BETTER_AUTH_URL = "http://localhost:3000";
env.BETTER_AUTH_SECRET = TEST_SECRET;
env.NODE_ENV = "test";
env.AUTH_EMAIL_DELIVERY = "console";

function isPostgresReachable(url: string): boolean {
  try {
    // Delegate the TCP probe to a child process and read its exit code. This is
    // genuinely synchronous (unlike an in-process async socket connect, whose
    // callback cannot fire while the main thread blocks), so the result is
    // available at describe-registration time and keeps `pnpm test` green when
    // Docker is absent.
    process.env.SHOPOS_PROBE_URL = url;
    const probePath = new URL("./_probe-postgres.cjs", import.meta.url);
    execFileSync(process.execPath, [fileURLToPath(probePath)], {
      timeout: 3_000,
      stdio: "ignore",
      env: { ...process.env, SHOPOS_PROBE_URL: url },
    });
    return true;
  } catch {
    return false;
  }
}

const RUN = isPostgresReachable(TEST_DATABASE_URL);

type DbModule = typeof import("@/db/client");
type AuthModule = typeof import("@/modules/identity/auth");
type DeliveryModule = typeof import("@/modules/identity/delivery/console-auth-delivery-provider");

let dbModule: DbModule;
let authModule: AuthModule;
let deliveryModule: DeliveryModule;

beforeAll(async () => {
  if (!RUN) return;
  dbModule = await import("@/db/client");
  authModule = await import("@/modules/identity/auth");
  deliveryModule = await import("@/modules/identity/delivery/console-auth-delivery-provider");
}, 30_000);

afterAll(async () => {
  if (!RUN) return;
  const { resetAuthConfigCache } = await import("@/modules/identity/config");
  resetAuthConfigCache();
  await dbModule.db.$disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  deliveryModule.getConsoleAuthDeliveryProvider().reset();
  await resetTestDatabase(dbModule.db);
});

const shouldSkip = !RUN;

async function signUpAndVerify(email: string, password: string, name: string): Promise<void> {
  await authModule.auth.api.signUpEmail({
    body: { email, password, name },
    headers: new Headers(),
  });

  const token = extractVerificationToken();
  expect(token, "expected a verification token in the captured delivery").toBeTruthy();
  await authModule.auth.api.verifyEmail({
    query: { token: token ?? "" },
    headers: new Headers(),
  });
}

/**
 * Extracts the email-verification token from the most recent verification email
 * captured by the console delivery adapter. The adapter redacts logs; the full
 * message (with URL) is retained only in the test environment and read here.
 */
function extractVerificationToken(): string | undefined {
  const verification = deliveryModule
    .getConsoleAuthDeliveryProvider()
    .latestFullMessage("verification-email");
  if (!verification) {
    return undefined;
  }
  const message = verification.message;
  if (message.kind !== "verification-email") {
    return undefined;
  }
  const url = new URL(message.url);
  return url.searchParams.get("token") ?? undefined;
}

describe("Better Auth credential flow", { skip: shouldSkip }, () => {
  it("signs up, sends a verification email, verifies, and signs in", async () => {
    const email = `flow-${Date.now()}@example.test`;
    const password = "integration-test-password-1234";

    await authModule.auth.api.signUpEmail({
      body: { email, password, name: "Integration Tester" },
      headers: new Headers(),
    });

    expect(
      deliveryModule
        .getConsoleAuthDeliveryProvider()
        .capturedMessages()
        .some((message) => message.kind === "verification-email"),
    ).toBe(true);

    await signUpAndVerify(email, password, "Integration Tester");

    const signedIn = await authModule.auth.api.signInEmail({
      body: { email, password },
      headers: new Headers(),
    });
    expect(signedIn.user.email).toBe(email);
    expect(signedIn.user.emailVerified).toBe(true);
    // Better Auth establishes the session via a cookie; the server API returns
    // the session token rather than a session object.
    expect(signedIn.token).toBeDefined();
  });

  it("denies sign-in before the email is verified", async () => {
    const email = `unverified-${Date.now()}@example.test`;
    const password = "integration-test-password-1234";

    await authModule.auth.api.signUpEmail({
      body: { email, password, name: "Unverified Tester" },
      headers: new Headers(),
    });

    await expect(
      authModule.auth.api.signInEmail({
        body: { email, password },
        headers: new Headers(),
      }),
    ).rejects.toThrowError();
  });

  it("denies sign-in with a wrong password after verification", async () => {
    const email = `wrongpw-${Date.now()}@example.test`;
    const password = "integration-test-password-1234";

    await signUpAndVerify(email, password, "Wrong Password Tester");

    await expect(
      authModule.auth.api.signInEmail({
        body: { email, password: "definitely-not-the-password-1234" },
        headers: new Headers(),
      }),
    ).rejects.toThrowError();
  });
});

describe("Better Auth SSO and implicit provisioning remain disabled", { skip: shouldSkip }, () => {
  it("does not allow organization creation or deletion through Better Auth", () => {
    const orgPlugin = authModule.auth.options.plugins?.find(
      (plugin) => plugin.id === "organization",
    );
    expect(orgPlugin).toBeDefined();
    const options = (orgPlugin as { options?: Record<string, unknown> }).options;
    expect(options).toMatchObject({
      allowUserToCreateOrganization: false,
      disableOrganizationDeletion: true,
    });
  });

  it("keeps SSO isolated, domain-verified, and provisioning disabled", () => {
    const ssoPlugin = authModule.auth.options.plugins?.find((plugin) => plugin.id === "sso");
    expect(ssoPlugin).toBeDefined();
    const options = (ssoPlugin as { options?: Record<string, unknown> }).options;
    expect(options).toMatchObject({
      disableImplicitSignUp: true,
      organizationProvisioning: { disabled: true },
      domainVerification: { enabled: true },
    });
  });
});
