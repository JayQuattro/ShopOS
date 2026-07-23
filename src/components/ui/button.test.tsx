// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";

afterEach(cleanup);

describe("Button", () => {
  it("preserves its accessible name and click behavior", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<Button onClick={onClick}>Save work order</Button>);
    await user.click(screen.getByRole("button", { name: "Save work order" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("prevents interaction while disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button disabled onClick={onClick}>
        Processing…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Processing…" });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
