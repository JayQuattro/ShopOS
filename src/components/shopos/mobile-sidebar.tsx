"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Permission } from "@/modules/tenancy/policy";
import { Sidebar } from "./sidebar";

export type MobileSidebarProps = Readonly<{
  organizationId: string;
  permissions: ReadonlySet<Permission>;
}>;

/**
 * Mobile navigation drawer. Wraps the same {@link Sidebar} component in a Sheet
 * triggered by a hamburger button, visible only on narrow screens. The desktop
 * sidebar is hidden via CSS when this is shown.
 */
export function MobileSidebar({ organizationId, permissions }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" />
        </Button>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto" onClick={() => setOpen(false)}>
            <Sidebar organizationId={organizationId} permissions={permissions} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
