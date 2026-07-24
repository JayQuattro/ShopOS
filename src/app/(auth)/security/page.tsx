"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

const securityStrings = {
  twoFactorTitle: "Two-factor authentication",
  twoFactorDescription: "Add a second verification step to your account.",
  enableTwoFactor: "Enable 2FA",
  disableTwoFactor: "Disable 2FA",
  backupCodesTitle: "Backup codes",
  backupCodesDescription: "Store these one-time codes somewhere safe. Each can be used once.",
  regenerateBackupCodes: "Regenerate backup codes",
  passwordLabel: "Confirm with your password",
  passkeyTitle: "Passkeys",
  passkeyDescription: "Sign in with a trusted device.",
  addPasskey: "Add passkey",
  sessionsTitle: "Sessions",
  sessionsDescription: "Sign out of your other devices.",
  revokeSessions: "Revoke other sessions",
  enabled: "Enabled",
  notEnabled: "Not enabled",
};

export default function SecurityPage() {
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleEnableTwoFactor() {
    setError(null);
    setPending(true);
    try {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error) {
        setError(result.error.message ?? "Unable to enable 2FA.");
      } else {
        setBackupCodes(result.data?.backupCodes ?? []);
        setNotice("2FA enabled. Scan the TOTP URI with your authenticator app.");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleDisableTwoFactor() {
    setError(null);
    setPending(true);
    try {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) {
        setError(result.error.message ?? "Unable to disable 2FA.");
      } else {
        setNotice("2FA disabled.");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleRegenerateBackupCodes() {
    setPending(true);
    try {
      const result = await authClient.twoFactor.generateBackupCodes({ password });
      if (!result.error) {
        setBackupCodes(result.data?.backupCodes ?? []);
      }
    } finally {
      setPending(false);
    }
  }

  async function handleAddPasskey() {
    setPending(true);
    try {
      await authClient.passkey.addPasskey();
    } finally {
      setPending(false);
    }
  }

  async function handleRevokeSessions() {
    setPending(true);
    try {
      await authClient.revokeOtherSessions();
      setNotice("Other sessions revoked.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      {notice ? (
        <Alert variant="info">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{securityStrings.twoFactorTitle}</CardTitle>
          <CardDescription>{securityStrings.twoFactorDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label={securityStrings.passwordLabel} htmlFor="confirm-password">
            <Input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
            />
          </Field>
          {backupCodes && backupCodes.length > 0 ? (
            <Alert variant="warning">
              <AlertTitle>{securityStrings.backupCodesTitle}</AlertTitle>
              <AlertDescription>
                <p>{securityStrings.backupCodesDescription}</p>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
                  {backupCodes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          <Button type="button" onClick={handleEnableTwoFactor} disabled={pending || !password}>
            {securityStrings.enableTwoFactor}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDisableTwoFactor}
            disabled={pending || !password}
          >
            {securityStrings.disableTwoFactor}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRegenerateBackupCodes}
            disabled={pending || !password}
          >
            {securityStrings.regenerateBackupCodes}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{securityStrings.passkeyTitle}</CardTitle>
          <CardDescription>{securityStrings.passkeyDescription}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button type="button" variant="outline" onClick={handleAddPasskey} disabled={pending}>
            {securityStrings.addPasskey}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{securityStrings.sessionsTitle}</CardTitle>
          <CardDescription>{securityStrings.sessionsDescription}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button type="button" variant="outline" onClick={handleRevokeSessions} disabled={pending}>
            {securityStrings.revokeSessions}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
