// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

afterEach(cleanup);

describe("Alert accessibility", () => {
  it("destructive variant uses role=alert", () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Something broke.</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Something broke.")).toBeInTheDocument();
  });

  it("info variant uses role=status", () => {
    render(
      <Alert variant="info">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Check your inbox.</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("default variant uses role=status", () => {
    render(
      <Alert>
        <AlertDescription>Neutral message.</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("conveys meaning via text, not color alone", () => {
    render(
      <Alert variant="warning">
        <AlertTitle>Warning</AlertTitle>
        <AlertDescription>This action is irreversible.</AlertDescription>
      </Alert>,
    );
    // Text is present and queryable — status is not conveyed by color alone.
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("This action is irreversible.")).toBeInTheDocument();
  });
});
