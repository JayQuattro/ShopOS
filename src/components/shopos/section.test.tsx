// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageSection, SectionNav } from "@/components/shopos/section";

afterEach(cleanup);

describe("SectionNav", () => {
  it("renders anchor links to each section", () => {
    render(
      <SectionNav
        items={[
          { href: "#overview", label: "Overview" },
          { href: "#money", label: "Money" },
        ]}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Sections" });
    const overview = screen.getByRole("link", { name: "Overview" });
    expect(overview).toHaveAttribute("href", "#overview");
    expect(nav).toContainElement(screen.getByRole("link", { name: "Money" }));
  });
});

describe("PageSection", () => {
  it("renders a titled section anchored by id", () => {
    render(
      <PageSection id="jobs" title="Jobs" description="Work to do">
        <p>Task panel</p>
      </PageSection>,
    );

    const heading = screen.getByRole("heading", { level: 2, name: "Jobs" });
    const section = heading.closest("section");
    expect(section).toHaveAttribute("id", "jobs");
    expect(screen.getByText("Work to do")).toBeTruthy();
    expect(screen.getByText("Task panel")).toBeTruthy();
  });
});
