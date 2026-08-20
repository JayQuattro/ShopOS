import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

export type ListSearchProps = Readonly<{
  /** Form target — the current path, so the page re-renders with `?q=`. */
  action: string;
  /** Current filter value, echoed back into the field. */
  query?: string;
  placeholder?: string;
  /** Query params to preserve on submit (e.g. the inventory location filter). */
  hiddenParams?: Readonly<Record<string, string | undefined>>;
}>;

/**
 * Server-rendered list search: a plain GET form, no client JavaScript. The
 * search input is 16px on touch sizes (via `Input`), so iPad Safari does not
 * zoom on focus, and WebKit supplies its own clear button.
 */
export function ListSearch({
  action,
  query,
  placeholder = "Search",
  hiddenParams,
}: ListSearchProps) {
  return (
    <form role="search" action={action} method="get" className="relative w-full sm:max-w-sm">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        name="q"
        defaultValue={query}
        placeholder={placeholder}
        className="pl-9"
        aria-label={placeholder}
      />
      {hiddenParams
        ? Object.entries(hiddenParams)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)
        : null}
    </form>
  );
}
