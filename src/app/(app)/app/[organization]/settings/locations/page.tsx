import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { resolveRegionalSettings } from "@/modules/organizations/regional-settings";
import { LocationRegionalRow } from "./location-regional-row";
import { HolidaysManager } from "./holidays-manager";

export const dynamic = "force-dynamic";

/**
 * Regional defaults: the organization's default currency and display locale,
 * overridable per location (a Canadian branch of a US shop, a Portuguese
 * location of a Spanish one). Locale drives customer-facing formatting;
 * currency is the default for new money records at that location.
 */
export default async function LocationsSettingsPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const [org, locations] = await Promise.all([
    db.organization.findUnique({
      where: { id: context.organizationId },
      select: { defaultCurrency: true, defaultLocale: true, defaultPhoneCountry: true },
    }),
    db.location.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        timeZone: true,
        currency: true,
        locale: true,
        invoiceNumberPrefix: true,
        phoneCountry: true,
      },
    }),
  ]);

  const effective = await Promise.all(
    locations.map((location) => resolveRegionalSettings(db, context.organizationId, location.id)),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Locations & formats"
        description={`Currency and customer-facing formats. Organization default: ${org?.defaultCurrency ?? "USD"} · ${org?.defaultLocale ?? "en-US"} — leave a location blank to inherit it.`}
        breadcrumbs={[{ label: "Settings" }, { label: "Locations" }]}
      />
      <div className="grid gap-4">
        {locations.map((location, index) => (
          <div key={location.id} className="grid gap-4 md:grid-cols-2">
            <LocationRegionalRow
              organizationId={context.organizationId}
              location={{
                id: location.id,
                name: location.name,
                code: location.code,
                timeZone: location.timeZone,
                currency: location.currency,
                locale: location.locale,
                invoiceNumberPrefix: location.invoiceNumberPrefix,
                phoneCountry: location.phoneCountry,
              }}
              effectiveCurrency={effective[index]!.currency}
              effectiveLocale={effective[index]!.locale}
            />
            <HolidaysManager
              organizationId={context.organizationId}
              locationId={location.id}
              locationName={location.name}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
