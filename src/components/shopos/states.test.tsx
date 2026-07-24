// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  SummaryCard,
} from "@/components/shopos/states";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders title and description with accessible text", () => {
    render(<EmptyState title="No customers" description="Create your first customer." />);
    expect(screen.getByText("No customers")).toBeInTheDocument();
    expect(screen.getByText("Create your first customer.")).toBeInTheDocument();
  });

  it("renders an action when provided", () => {
    render(<EmptyState title="Empty" action={<button>Add</button>} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});

describe("LoadingState", () => {
  it("uses role=status and aria-live=polite for screen readers", () => {
    render(<LoadingState label="Fetching…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Fetching…");
  });
});

describe("ErrorState", () => {
  it("uses role=alert for the destructive variant", () => {
    render(<ErrorState description="Database connection failed." />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Database connection failed.")).toBeInTheDocument();
  });

  it("shows a retry action when provided", () => {
    render(<ErrorState description="Failed." retry={<button>Retry</button>} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("PermissionDeniedState", () => {
  it("uses role=status with a warning variant", () => {
    render(<PermissionDeniedState />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Permission denied")).toBeInTheDocument();
  });
});

describe("DataTable", () => {
  it("renders a table with a screen-reader caption", () => {
    render(
      <DataTable caption="Customer list">
        <tbody>
          <tr>
            <td>Test</td>
          </tr>
        </tbody>
      </DataTable>,
    );
    expect(screen.getByText("Customer list")).toHaveClass("sr-only");
  });

  it("has a focusable scroll region with role=region", () => {
    render(
      <DataTable>
        <tbody>
          <tr>
            <td>X</td>
          </tr>
        </tbody>
      </DataTable>,
    );
    expect(screen.getByRole("region")).toHaveAttribute("tabindex", "0");
  });
});

describe("SummaryCard", () => {
  it("renders label and value", () => {
    render(<SummaryCard label="Total" value="$1,234.56" />);
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("$1,234.56")).toBeInTheDocument();
  });
});
