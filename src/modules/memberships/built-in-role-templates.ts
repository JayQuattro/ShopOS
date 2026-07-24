import type { Permission } from "@/modules/tenancy/policy";

export type BuiltInRoleTemplate = Readonly<{
  key: "owner" | "manager" | "advisor" | "technician" | "parts" | "administrator";
  name: string;
  permissions: readonly Permission[];
}>;

export const ALL_TENANT_PERMISSIONS: readonly Permission[] = [
  "organizations.manage",
  "memberships.manage",
  "customers.read",
  "customers.write",
  "assets.read",
  "assets.write",
  "work_orders.read",
  "work_orders.write",
  "estimates.present",
  "authorizations.record",
  "invoices.issue",
  "payments.record",
];

export const BUILT_IN_ROLE_TEMPLATES: readonly BuiltInRoleTemplate[] = [
  {
    key: "owner",
    name: "Owner",
    permissions: ALL_TENANT_PERMISSIONS,
  },
  {
    key: "manager",
    name: "Manager",
    permissions: [
      "memberships.manage",
      "customers.read",
      "customers.write",
      "assets.read",
      "assets.write",
      "work_orders.read",
      "work_orders.write",
      "estimates.present",
      "authorizations.record",
      "invoices.issue",
      "payments.record",
    ],
  },
  {
    key: "advisor",
    name: "Advisor",
    permissions: [
      "customers.read",
      "customers.write",
      "assets.read",
      "assets.write",
      "work_orders.read",
      "work_orders.write",
      "estimates.present",
      "authorizations.record",
      "invoices.issue",
      "payments.record",
    ],
  },
  {
    key: "technician",
    name: "Technician",
    permissions: ["customers.read", "assets.read", "work_orders.read", "work_orders.write"],
  },
  {
    key: "parts",
    name: "Parts",
    permissions: ["customers.read", "assets.read", "work_orders.read", "work_orders.write"],
  },
  {
    key: "administrator",
    name: "Administrator",
    permissions: ALL_TENANT_PERMISSIONS,
  },
];
