// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceShell } from "@/app/(app)/app/[organization]/work-orders/workspace/workspace-shell";

afterEach(cleanup);

function renderShell(overrides?: { active?: string | null }) {
  return render(
    <WorkspaceShell
      organizationId="org-1"
      initialActiveId={overrides?.active === undefined ? "wo-2" : overrides.active}
      tabs={[
        { id: "wo-1", label: "RO 1001", node: <div>pane-one</div> },
        { id: "wo-2", label: "RO 1002", node: <div>pane-two</div> },
        { id: "wo-3", label: "RO 1003", node: <div>pane-three</div> },
      ]}
    />,
  );
}

describe("WorkspaceShell", () => {
  it("shows the active pane and hides the others without unmounting them", () => {
    renderShell();

    expect(screen.getByText("pane-two")).toBeVisible();
    expect(screen.getByText("pane-one")).not.toBeVisible();
    expect(screen.getByText("pane-three")).not.toBeVisible();
  });

  it("switches tabs on click, keeping every pane mounted", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "RO 1003" }));

    expect(screen.getByText("pane-three")).toBeVisible();
    expect(screen.getByText("pane-two")).not.toBeVisible();
    // Still mounted — state in the hidden pane survives.
    expect(screen.getByText("pane-two")).toBeInTheDocument();
  });

  it("closing the active tab activates its neighbor", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Close RO 1002" }));

    expect(screen.queryByText("pane-two")).toBeNull();
    expect(screen.getByText("pane-one").closest("div")?.hidden).toBe(false);
    expect(screen.getByText("pane-three")).not.toBeVisible();
  });

  it("syncs the open tab set to the URL so refresh restores it", async () => {
    const user = userEvent.setup();
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderShell();

    await user.click(screen.getByRole("button", { name: "Close RO 1002" }));

    const calls = replaceState.mock.calls.filter(([, , url]) => typeof url === "string");
    const last = calls[calls.length - 1]?.[2] as string;
    expect(last).toContain("wo=wo-1%2Cwo-3");
    expect(last).toContain("active=wo-1");
    replaceState.mockRestore();
  });

  it("shows the empty state when every tab is closed", async () => {
    const user = userEvent.setup();
    renderShell({ active: "wo-2" });

    await user.click(screen.getByRole("button", { name: "Close RO 1002" }));
    await user.click(screen.getByRole("button", { name: "Close RO 1001" }));
    await user.click(screen.getByRole("button", { name: "Close RO 1003" }));

    expect(screen.getByText("No work orders open")).toBeVisible();
  });
});
