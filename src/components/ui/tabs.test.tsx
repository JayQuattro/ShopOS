// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

afterEach(cleanup);

describe("Tabs accessibility", () => {
  it("renders tablist, tab, and tabpanel roles", () => {
    render(
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Account settings</TabsContent>
        <TabsContent value="password">Password settings</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Password" })).toHaveAttribute("aria-selected", "false");
  });

  it("activates a tab on click and shows its content", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Account settings</TabsContent>
        <TabsContent value="password">Password settings</TabsContent>
      </Tabs>,
    );

    await user.click(screen.getByRole("tab", { name: "Password" }));
    expect(screen.getByRole("tab", { name: "Password" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Password settings")).toBeInTheDocument();
  });
});
