// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { WorkOrderHeader } from "@/app/(app)/app/[organization]/work-orders/work-order-header";

afterEach(cleanup);

function renderHeader() {
  return render(
    <WorkOrderHeader
      number="RO-2101"
      organizationId="org-1"
      statusBadge={<span>status-badge</span>}
      customerId="cust-1"
      customerName="Paul Seo"
      vehicleName="2019 F-150"
      locationName="Raleigh Shop"
      estimateMinor={81250n}
      authorizedMinor={65000n}
      invoiceMinor={null}
      paidMinor={null}
      currency="USD"
    >
      <div>management-controls</div>
    </WorkOrderHeader>,
  );
}

describe("WorkOrderHeader", () => {
  it("always shows identity, status, and the money snapshot when collapsed", () => {
    renderHeader();

    expect(screen.getByText("RO-2101")).toBeVisible();
    expect(screen.getByText("status-badge")).toBeVisible();
    expect(screen.getByText("Paul Seo")).toBeVisible();
    expect(screen.getByText("2019 F-150")).toBeVisible();
    expect(screen.getByText("$812.50")).toBeVisible();
    expect(screen.getByText("$650.00")).toBeVisible();
    expect(screen.getByText("not invoiced")).toBeVisible();
    // Management controls are unmounted while collapsed.
    expect(screen.queryByText("management-controls")).toBeNull();
  });

  it("expands to reveal the management controls", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Show work order details" }));

    expect(screen.getByText("management-controls")).toBeVisible();
  });
});
