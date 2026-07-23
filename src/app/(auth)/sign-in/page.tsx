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

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.email(
        { email, password },
        {
          onError: (context) => {
            if (context.error.status === 403) {
              setError(authStrings.errors.emailUnverified);
            } else if (context.error.status === 429) {
              setError(authStrings.errors.rateLimited);
            } else {
              setError(authStrings.errors.invalidCredentials);
            }
          },
        },
      );

      if (!result.error) {
        const redirect = sanitizeRedirect(searchParams.get("redirect"));
        router.push(redirect);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{authStrings.signIn.title}</CardTitle>
        <CardDescription>{authStrings.signIn.description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field label={authStrings.signIn.emailLabel} htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
            />
          </Field>
          <Field label={authStrings.signIn.passwordLabel} htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
            />
          </Field>
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-sm text-link underline-offset-4 hover:underline"
            >
              {authStrings.signIn.forgotPassword}
            </Link>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {authStrings.signIn.submit}
          </Button>
          <p className="text-sm text-muted-foreground">
            {authStrings.signIn.needAccount}{" "}
            <Link href="/sign-up" className="text-link underline-offset-4 hover:underline">
              {authStrings.signIn.signUp}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

/**
 * Restricts the post-sign-in redirect to a same-origin relative path to avoid
 * open redirects. The Better Auth handler already validates callback URLs
 * against trusted origins; this is defense-in-depth at the UI boundary.
 */
function sanitizeRedirect(raw: string | null): string {
  if (!raw) {
    return "/";
  }
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/";
}
