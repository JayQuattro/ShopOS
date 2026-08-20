// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RecordList, RecordListRow } from "@/components/shopos/record-list";

afterEach(cleanup);

describe("RecordListRow", () => {
  it("renders a link covering the whole row when href is provided", () => {
    render(
      <RecordList>
        <RecordListRow
          href="/app/org/work-orders/1"
          title="Dana Smith"
          description="#1001 · 2019 F-150"
          trailing={<span>Authorized</span>}
        />
      </RecordList>,
    );

    const link = screen.getByRole("link", { name: /Dana Smith/ });
    expect(link).toHaveAttribute("href", "/app/org/work-orders/1");
    expect(link).toHaveTextContent("#1001 · 2019 F-150");
    expect(link).toHaveTextContent("Authorized");
  });

  it("renders an informational row without a link when href is omitted", () => {
    render(
      <RecordList>
        <RecordListRow title="Brake pads" description="PF-1234 · BIN A2" />
      </RecordList>,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Brake pads")).toBeTruthy();
    expect(screen.getByText("PF-1234 · BIN A2")).toBeTruthy();
  });

  it("omits the description line when no description is given", () => {
    render(
      <RecordList>
        <RecordListRow href="/app/org/customers/1" title="Dana Smith" />
      </RecordList>,
    );

    const link = screen.getByRole("link", { name: "Dana Smith" });
    expect(link).toHaveTextContent("Dana Smith");
  });
});
