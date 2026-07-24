// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/badge";

afterEach(cleanup);

describe("Badge accessibility", () => {
  it("renders its children as the accessible name", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("supports the destructive variant with text", () => {
    render(<Badge variant="destructive">Revoked</Badge>);
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });
});
