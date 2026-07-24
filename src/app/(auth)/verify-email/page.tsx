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

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.emailOtp.verifyEmail({ email, otp: code });
      if (result.error) {
        setError(authStrings.errors.generic);
      } else {
        router.push("/sign-in");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    if (!email) {
      return;
    }
    await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{authStrings.verifyEmail.title}</CardTitle>
        <CardDescription>{authStrings.verifyEmail.description}</CardDescription>
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
          <Field label={authStrings.verifyEmail.codeLabel} htmlFor="code">
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
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {authStrings.verifyEmail.submit}
          </Button>
          <button
            type="button"
            onClick={handleResend}
            className="text-sm text-link underline-offset-4 hover:underline disabled:opacity-50"
            disabled={pending || !email}
          >
            {authStrings.verifyEmail.resend}
          </button>
          <Link
            href="/sign-in"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {authStrings.verifyEmail.backToSignIn}
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
