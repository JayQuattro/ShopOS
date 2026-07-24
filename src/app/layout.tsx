import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { themeBootstrapScript } from "@/components/shopos/theme/theme";
import { isRtl } from "@/i18n/routing";

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
  // Theme/density cookies for flash-free server rendering.
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("shopos-theme-resolved")?.value;
  const densityCookie = cookieStore.get("shopos-density")?.value;
  const resolvedTheme = themeCookie && VALID_THEMES.has(themeCookie) ? themeCookie : "light";
  const density = densityCookie && VALID_DENSITY.has(densityCookie) ? densityCookie : "comfortable";

  // Load next-intl messages and locale for the resolved locale. When route
  // prefixing lands, the locale comes from the [locale] param; today it is
  // resolved from the request config (defaulting to en-US).
  const messages = await getMessages();
  const resolvedLocale = await getLocale();

  return (
    <html
      lang={resolvedLocale}
      dir={isRtl(resolvedLocale) ? "rtl" : "ltr"}
      data-theme={resolvedTheme}
      data-theme-preference={resolvedTheme}
      data-density={density}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <NextIntlClientProvider locale={resolvedLocale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
