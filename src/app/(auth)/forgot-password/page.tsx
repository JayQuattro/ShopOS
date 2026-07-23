"use client";

import Link from "next/link";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      // Always shows the generic success message regardless of outcome, so the
      // endpoint never reveals whether an address exists. The core password-reset
      // link flow is handled by the Better Auth handler under /api/auth; the
      // email-OTP variant is triggered here so the reset can also complete by code.
      await authClient.emailOtp.requestPasswordReset({ email });
      setSubmitted(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{authStrings.forgotPassword.title}</CardTitle>
        <CardDescription>{authStrings.forgotPassword.description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="grid gap-4">
          {submitted ? (
            <Alert variant="info">
              <AlertDescription>{authStrings.forgotPassword.success}</AlertDescription>
            </Alert>
          ) : null}
          <Field label={authStrings.forgotPassword.emailLabel} htmlFor="email">
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
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {authStrings.forgotPassword.submit}
          </Button>
          <Link href="/sign-in" className="text-sm text-link underline-offset-4 hover:underline">
            {authStrings.forgotPassword.backToSignIn}
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
