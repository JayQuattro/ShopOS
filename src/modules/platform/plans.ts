/**
 * Code-owned plan definitions for ShopOS SaaS.
 *
 * Plans are versioned by this catalog, not stored in the database. When a plan
 * is applied to an organization, its entitlement keys and default limits are
 * materialized as `OrganizationEntitlement` rows with source `"plan:<key>"`.
 * Operator overrides use source `"platform"` and take precedence in resolution.
 *
 * Adding a plan or changing limits is a code change here; existing orgs keep
 * their materialized entitlements until a plan re-application or manual
 * override updates them.
 */

export type PlanKey = "free" | "starter" | "growth" | "enterprise";

export type EntitlementKey =
  | "members.max"
  | "locations.max"
  | "work_orders.max_active"
  | "integrations.custom"
  | "support.priority"
  | "api_access";

export type PlanEntitlement = Readonly<{
  key: EntitlementKey;
  enabled: boolean;
  /** null means unlimited. */
  limitValue: bigint | null;
}>;

export type PlanDefinition = Readonly<{
  key: PlanKey;
  name: string;
  description: string;
  entitlements: readonly PlanEntitlement[];
}>;

export const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  {
    key: "free",
    name: "Free",
    description: "For small shops getting started.",
    entitlements: [
      { key: "members.max", enabled: true, limitValue: 2n },
      { key: "locations.max", enabled: true, limitValue: 1n },
      { key: "work_orders.max_active", enabled: true, limitValue: 25n },
      { key: "integrations.custom", enabled: false, limitValue: null },
      { key: "support.priority", enabled: false, limitValue: null },
      { key: "api_access", enabled: false, limitValue: null },
    ],
  },
  {
    key: "starter",
    name: "Starter",
    description: "For growing shops with multiple locations.",
    entitlements: [
      { key: "members.max", enabled: true, limitValue: 10n },
      { key: "locations.max", enabled: true, limitValue: 3n },
      { key: "work_orders.max_active", enabled: true, limitValue: 200n },
      { key: "integrations.custom", enabled: false, limitValue: null },
      { key: "support.priority", enabled: false, limitValue: null },
      { key: "api_access", enabled: true, limitValue: null },
    ],
  },
  {
    key: "growth",
    name: "Growth",
    description: "For established multi-location operations.",
    entitlements: [
      { key: "members.max", enabled: true, limitValue: 50n },
      { key: "locations.max", enabled: true, limitValue: 10n },
      { key: "work_orders.max_active", enabled: true, limitValue: null },
      { key: "integrations.custom", enabled: true, limitValue: 3n },
      { key: "support.priority", enabled: true, limitValue: null },
      { key: "api_access", enabled: true, limitValue: null },
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "Unlimited scale with custom integrations.",
    entitlements: [
      { key: "members.max", enabled: true, limitValue: null },
      { key: "locations.max", enabled: true, limitValue: null },
      { key: "work_orders.max_active", enabled: true, limitValue: null },
      { key: "integrations.custom", enabled: true, limitValue: null },
      { key: "support.priority", enabled: true, limitValue: null },
      { key: "api_access", enabled: true, limitValue: null },
    ],
  },
];

const PLAN_MAP: ReadonlyMap<string, PlanDefinition> = new Map(
  PLAN_DEFINITIONS.map((plan) => [plan.key, plan]),
);

export function getPlanDefinition(key: string): PlanDefinition | undefined {
  return PLAN_MAP.get(key);
}

export function isPlanKey(value: string): value is PlanKey {
  return PLAN_MAP.has(value);
}

export function resolvePlanEntitlements(key: PlanKey): readonly PlanEntitlement[] {
  const plan = PLAN_MAP.get(key);
  if (!plan) {
    throw new Error(`Unknown plan key: ${key}`);
  }
  return plan.entitlements;
}

export const PLAN_KEYS: readonly PlanKey[] = PLAN_DEFINITIONS.map((p) => p.key);
