// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListSearch } from "@/components/shopos/list-search";

function hiddenInput(name: string): HTMLInputElement {
  const input = document.querySelector(`input[type="hidden"][name="${name}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing hidden input ${name}`);
  return input;
}

afterEach(cleanup);

describe("ListSearch", () => {
  it("renders a GET search form targeting the current path", () => {
    render(<ListSearch action="/app/org/work-orders" placeholder="Search work orders" />);

    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("action", "/app/org/work-orders");
    expect(form).toHaveAttribute("method", "get");

    const input = screen.getByLabelText("Search work orders");
    expect(input).toHaveAttribute("type", "search");
    expect(input).toHaveAttribute("name", "q");
  });

  it("echoes the active query back into the field", () => {
    render(<ListSearch action="/app/org/customers" query="dana" placeholder="Search" />);

    expect(screen.getByLabelText("Search")).toHaveValue("dana");
  });

  it("preserves extra query params as hidden inputs and skips undefined ones", () => {
    render(
      <ListSearch
        action="/app/org/inventory"
        placeholder="Search parts"
        hiddenParams={{ location: "loc-1", q: undefined }}
      />,
    );

    const hidden = hiddenInput("location");
    expect(hidden).toHaveAttribute("type", "hidden");
    expect(hidden.value).toBe("loc-1");
    expect(document.querySelector('input[type="hidden"][name="q"]')).toBeNull();
  });
});
