// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

afterEach(cleanup);

describe("Avatar accessibility", () => {
  it("renders fallback initials when no image", () => {
    render(
      <Avatar>
        <AvatarImage src="" />
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("renders the avatar container with fallback when image src is provided", () => {
    const { container } = render(
      <Avatar>
        <AvatarImage src="https://example.com/avatar.png" alt="User avatar" />
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    );
    // In jsdom the image doesn't actually load, so the fallback is shown.
    // Verify the avatar container and fallback are present.
    const avatar = container.querySelector("[data-slot='avatar']");
    expect(avatar).toBeTruthy();
    expect(screen.getByText("JD")).toBeInTheDocument();
  });
});
