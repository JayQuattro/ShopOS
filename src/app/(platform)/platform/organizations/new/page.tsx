import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PlatformOrganizationForm } from "./platform-organization-form";

export default function NewPlatformOrganizationPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Button asChild variant="link" className="justify-self-start">
        <Link href="/platform">← Back to organizations</Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Provision an organization</CardTitle>
          <CardDescription>
            Creates the tenant, first location, founding Owner membership, built-in roles, audit
            history, and provisioning event in one transaction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlatformOrganizationForm />
        </CardContent>
      </Card>
    </div>
  );
}
