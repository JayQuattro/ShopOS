"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { membershipStrings } from "@/modules/memberships/ui/strings";

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitationForm />
    </Suspense>
  );
}

function AcceptInvitationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitationId = searchParams.get("invitation");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    if (!invitationId) {
      setError(membershipStrings.errors.generic);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/invitations/${invitationId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: window.location.origin },
      });
      if (response.status === 401) {
        // Not signed in — redirect to sign-in with a return to this page.
        router.push(`/sign-in?redirect=/accept-invitation?invitation=${invitationId}`);
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? membershipStrings.errors.generic);
        return;
      }
      const result = (await response.json()) as { organizationId: string };
      router.push(`/app/${result.organizationId}/members`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{membershipStrings.acceptTitle}</CardTitle>
        <CardDescription>{membershipStrings.acceptDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!invitationId ? (
          <Alert variant="warning">
            <AlertDescription>{membershipStrings.errors.generic}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <Button
          type="button"
          className="w-full"
          onClick={handleAccept}
          disabled={pending || !invitationId}
        >
          {membershipStrings.acceptInvitation}
        </Button>
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {membershipStrings.decline}
        </Link>
      </CardFooter>
    </Card>
  );
}
