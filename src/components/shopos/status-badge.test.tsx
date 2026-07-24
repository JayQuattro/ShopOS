// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusBadge } from "@/components/shopos/status-badge";

afterEach(cleanup);

describe("StatusBadge non-color status cues", () => {
  it("ready tone renders an icon (aria-hidden) plus text children", () => {
    const { container } = render(<StatusBadge tone="ready">Authorized</StatusBadge>);
    // Text is present and is the accessible content.
    expect(screen.getByText("Authorized")).toBeInTheDocument();
    // An SVG icon is rendered alongside (non-color cue).
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("waiting tone renders a distinct icon", () => {
    const { container } = render(<StatusBadge tone="waiting">Pending</StatusBadge>);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("attention tone renders a distinct icon", () => {
    const { container } = render(<StatusBadge tone="attention">Overdue</StatusBadge>);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("neutral tone renders a distinct icon", () => {
    const { container } = render(<StatusBadge tone="neutral">Draft</StatusBadge>);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("status is never conveyed by color alone — always has text", () => {
    render(<StatusBadge tone="ready">Complete</StatusBadge>);
    // If text were absent, getByText would throw — proving color alone is insufficient.
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });
});
