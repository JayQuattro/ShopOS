// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

import { ListSearch } from "@/components/shopos/list-search";

function hiddenInput(name: string): HTMLInputElement {
  const input = document.querySelector(`input[type="hidden"][name="${name}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing hidden input ${name}`);
  return input;
}

beforeEach(() => {
  replace.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

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

  it("searches as you type, debounced, and syncs the URL", async () => {
    render(<ListSearch action="/app/org/assets" placeholder="Search vehicles" />);

    const input = screen.getByLabelText("Search vehicles");
    fireEvent.change(input, { target: { value: "hon" } });
    vi.advanceTimersByTime(200);
    expect(replace).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "honda" } });
    vi.advanceTimersByTime(350);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/app/org/assets?q=honda");
  });

  it("clear button resets the field and the results immediately", async () => {
    render(<ListSearch action="/app/org/assets" query="civic" placeholder="Search vehicles" />);

    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(screen.getByLabelText("Search vehicles")).toHaveValue("");
    expect(replace).toHaveBeenCalledWith("/app/org/assets");
  });

  it("Enter searches immediately without waiting for the debounce", async () => {
    render(<ListSearch action="/app/org/assets" placeholder="Search vehicles" />);

    const input = screen.getByLabelText("Search vehicles");
    fireEvent.change(input, { target: { value: "plate" } });
    fireEvent.submit(input.closest("form")!);

    expect(replace).toHaveBeenCalledWith("/app/org/assets?q=plate");
  });

  it("preserves filter params in the live URL", async () => {
    render(
      <ListSearch
        action="/app/org/assets"
        placeholder="Search vehicles"
        hiddenParams={{ cat: "automotive" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search vehicles"), { target: { value: "civic" } });
    vi.advanceTimersByTime(350);

    expect(replace).toHaveBeenCalledWith("/app/org/assets?q=civic&cat=automotive");
  });
});
