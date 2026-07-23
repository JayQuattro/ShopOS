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
import { Input } from "@/components/ui/input";
import { authClient } from "@/modules/identity/client/auth-client";
import { Field } from "@/modules/identity/ui/field";
import { authStrings } from "@/modules/identity/ui/strings";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError(authStrings.errors.generic);
      return;
    }
    setPending(true);
    try {
      const result = await authClient.resetPassword(
        { newPassword: password, token },
        {
          onError: (context) => {
            setError(
              context.error.status === 429
                ? authStrings.errors.rateLimited
                : authStrings.errors.generic,
            );
          },
        },
      );

      if (!result.error) {
        router.push("/sign-in");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{authStrings.resetPassword.title}</CardTitle>
        <CardDescription>{authStrings.resetPassword.description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {!token ? (
            <Alert variant="warning">
              <AlertDescription>{authStrings.resetPassword.description}</AlertDescription>
            </Alert>
          ) : null}
          <Field
            label={authStrings.resetPassword.passwordLabel}
            htmlFor="password"
            hint={authStrings.resetPassword.passwordHint}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending || !token}
            />
          </Field>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending || !token}>
            {authStrings.resetPassword.submit}
          </Button>
          <Link href="/sign-in" className="text-sm text-link underline-offset-4 hover:underline">
            {authStrings.resetPassword.backToSignIn}
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
