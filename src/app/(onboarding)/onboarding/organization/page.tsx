import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { OrganizationOnboardingForm } from "./organization-onboarding-form";

export default function OrganizationOnboardingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Create your organization</CardTitle>
          <CardDescription>
            Set up the business and first operating location. You will become the founding Owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationOnboardingForm />
        </CardContent>
      </Card>
    </main>
  );
}
