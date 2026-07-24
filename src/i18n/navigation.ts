import { createNavigation } from "next-intl/navigation";

import { routing } from "@/i18n/routing";

/**
 * Locale-aware navigation utilities. Use these instead of `next/link` and
 * `next/navigation` in components that should produce locale-prefixed links
 * once route prefixing is enabled. Today they pass through without a prefix
 * (the locale is resolved server-side); when `[locale]` route segments land,
 * these automatically prefix.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
