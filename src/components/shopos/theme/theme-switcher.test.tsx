// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSwitcher } from "@/components/shopos/theme/theme-switcher";
import { THEME_STORAGE_KEY } from "@/components/shopos/theme/theme";

const mediaListeners = new Set<() => void>();

function installMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: prefersDark,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) =>
        mediaListeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mediaListeners.clear();
  installMatchMedia(false);
});

afterEach(cleanup);

describe("ThemeSwitcher", () => {
  it("applies and persists an explicit preset", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Appearance" }), "dusk");

    expect(document.documentElement.dataset.theme).toBe("dusk");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dusk");
  });

  it("resolves System from the device preference", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Appearance" }), "system");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("system");
  });
});
