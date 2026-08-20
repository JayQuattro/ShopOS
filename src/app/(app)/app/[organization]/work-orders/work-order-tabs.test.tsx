// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { WorkOrderTabs } from "@/app/(app)/app/[organization]/work-orders/work-order-tabs";

afterEach(cleanup);

describe("WorkOrderTabs", () => {
  it("shows only the active tab but keeps every tab mounted", async () => {
    const user = userEvent.setup();
    render(
      <WorkOrderTabs
        tabs={[
          { id: "jobs", label: "Jobs & estimate", content: <div>jobs-content</div> },
          { id: "parts", label: "Parts", content: <div>parts-content</div> },
          { id: "money", label: "Money", content: <div>money-content</div> },
        ]}
      />,
    );

    expect(screen.getByText("jobs-content")).toBeVisible();
    expect(screen.getByText("parts-content")).not.toBeVisible();
    expect(screen.getByText("money-content")).not.toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Parts" }));

    expect(screen.getByText("parts-content")).toBeVisible();
    expect(screen.getByText("jobs-content")).not.toBeVisible();
    // Mounted while hidden — in-progress panel state survives switches.
    expect(screen.getByText("jobs-content")).toBeInTheDocument();
  });
});
