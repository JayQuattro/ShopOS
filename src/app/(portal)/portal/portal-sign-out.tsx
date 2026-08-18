"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { authClient } from "@/modules/identity/client/auth-client";

export function PortalSignOut() {
  const router = useRouter();

  return (
    <Button
      variant="outline"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
