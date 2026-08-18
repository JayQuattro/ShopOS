/** One-line shop contact rendering for letterheads and signatures. */
export function orgContactLine(organization: {
  contactPhone?: string | null;
  contactEmail?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
}): string | null {
  const address = [
    organization.addressLine1,
    [organization.city, organization.stateProvince, organization.postalCode]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const contact = [organization.contactPhone, organization.contactEmail]
    .filter(Boolean)
    .join(" · ");
  return [address, contact].filter(Boolean).join(" — ") || null;
}
