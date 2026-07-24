"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { Input } from "@/components/ui/input";
import { authClient } from "@/modules/identity/client/auth-client";
import { Field } from "@/modules/identity/ui/field";
import { authStrings } from "@/modules/identity/ui/strings";

export default function VerifyTwoFactorPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = useBackup
        ? await authClient.twoFactor.verifyBackupCode({ code: backupCode })
        : await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setError(
          result.error.status === 429 ? authStrings.errors.rateLimited : authStrings.errors.generic,
        );
      } else {
        router.push("/");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{authStrings.verifyTwoFactor.title}</CardTitle>
        <CardDescription>
          {useBackup
            ? authStrings.verifyTwoFactor.backupCodeLabel
            : authStrings.verifyTwoFactor.description}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {useBackup ? (
            <Field label={authStrings.verifyTwoFactor.backupCodeLabel} htmlFor="backup-code">
              <Input
                id="backup-code"
                name="backup-code"
                type="text"
                autoComplete="one-time-code"
                required
                value={backupCode}
                onChange={(event) => setBackupCode(event.target.value)}
                disabled={pending}
              />
            </Field>
          ) : (
            <Field label={authStrings.verifyTwoFactor.codeLabel} htmlFor="code">
              <Input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={pending}
              />
            </Field>
          )}
          <button
            type="button"
            onClick={() => setUseBackup((previous) => !previous)}
            className="text-left text-sm text-link underline-offset-4 hover:underline"
          >
            {authStrings.verifyTwoFactor.useBackupCode}
          </button>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {authStrings.verifyTwoFactor.submit}
          </Button>
          <Link
            href="/sign-in"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {authStrings.verifyTwoFactor.backToSignIn}
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
