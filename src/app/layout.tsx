import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { themeBootstrapScript } from "@/components/shopos/theme/theme";

import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "ShopOS",
    template: "%s · ShopOS",
  },
  description: "Open shop operations, built around the work.",
};

const VALID_THEMES = new Set(["light", "dark", "warm", "dusk"]);
const VALID_DENSITY = new Set(["comfortable", "compact"]);

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Read the persisted theme cookie so the initial server-rendered <html>
  // attributes match the user's preference, preventing a theme flash. The
  // bootstrap script remains as the progressive-enhancement fallback for the
  // OS-sync case and first-visit-before-cookie.
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("shopos-theme-resolved")?.value;
  const densityCookie = cookieStore.get("shopos-density")?.value;

  const resolvedTheme = themeCookie && VALID_THEMES.has(themeCookie) ? themeCookie : "light";
  const density = densityCookie && VALID_DENSITY.has(densityCookie) ? densityCookie : "comfortable";

  return (
    <html
      lang="en"
      data-theme={resolvedTheme}
      data-theme-preference={resolvedTheme}
      data-density={density}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
