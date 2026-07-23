import type { Metadata } from "next";
import type { ReactNode } from "react";

import { themeBootstrapScript } from "@/components/shopos/theme/theme";

import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "ShopOS",
    template: "%s · ShopOS",
  },
  description: "Open shop operations, built around the work.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="warm" data-theme-preference="warm" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
