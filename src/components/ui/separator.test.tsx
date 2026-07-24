// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Separator } from "@/components/ui/separator";

afterEach(cleanup);

describe("Separator accessibility", () => {
  it("has role=separator when not decorative", () => {
    render(<Separator decorative={false} orientation="horizontal" />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("is decorative by default (role=none)", () => {
    const { container } = render(<Separator />);
    const sep = container.querySelector("[data-slot='separator']");
    expect(sep).toBeTruthy();
    // Radix decorative separators get role="none" (not role="separator").
    const role = sep?.getAttribute("role");
    expect(role === "none" || role === "presentation").toBe(true);
  });
});
