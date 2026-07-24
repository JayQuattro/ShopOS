"use client";

import { LogOut, Settings, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/modules/identity/client/auth-client";

export type UserMenuProps = Readonly<{
  displayName: string;
  email: string;
}>;

/**
 * Account menu with avatar trigger. Shows the user's identity, links to the
 * security/account page, and provides sign-out. Sign-out calls Better Auth's
 * `signOut` which clears the session cookie.
 */
export function UserMenu({ displayName, email }: UserMenuProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleSignOut() {
    setPending(true);
    try {
      await authClient.signOut();
      router.push("/sign-in");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" disabled={pending}>
          <Avatar>
            <AvatarFallback>{initials || <User className="size-4" />}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/security")}>
          <Settings className="size-4" />
          Account &amp; security
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleSignOut} disabled={pending}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
