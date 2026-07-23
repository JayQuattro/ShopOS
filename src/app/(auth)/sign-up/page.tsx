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

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signUp.email(
        { email, password, name },
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
        router.push("/verify-email");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{authStrings.signUp.title}</CardTitle>
        <CardDescription>{authStrings.signUp.description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field label={authStrings.signUp.nameLabel} htmlFor="name">
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={pending}
            />
          </Field>
          <Field label={authStrings.signUp.emailLabel} htmlFor="email">
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
          <Field
            label={authStrings.signUp.passwordLabel}
            htmlFor="password"
            hint={authStrings.signUp.passwordHint}
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
              disabled={pending}
            />
          </Field>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {authStrings.signUp.submit}
          </Button>
          <p className="text-sm text-muted-foreground">
            {authStrings.signUp.haveAccount}{" "}
            <Link href="/sign-in" className="text-link underline-offset-4 hover:underline">
              {authStrings.signUp.signIn}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
