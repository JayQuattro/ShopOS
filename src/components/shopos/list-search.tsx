"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";

export type ListSearchProps = Readonly<{
  /** Base path — the page re-renders with `?q=` (and preserved params). */
  action: string;
  /** Current filter value, echoed back into the field. */
  query?: string;
  placeholder?: string;
  /** Query params to preserve while searching (e.g. the inventory location filter). */
  hiddenParams?: Readonly<Record<string, string | undefined>>;
}>;

const DEBOUNCE_MS = 300;

/**
 * Live list search: results follow typing (debounced), the clear button
 * resets the field AND the results, and Enter still searches immediately.
 * The URL stays the source of truth — refresh and share keep the query —
 * and a plain GET form remains as the no-JavaScript fallback.
 */
export function ListSearch({
  action,
  query,
  placeholder = "Search",
  hiddenParams,
}: ListSearchProps) {
  const router = useRouter();
  const [value, setValue] = useState(query ?? "");
  const lastSent = useRef((query ?? "").trim());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External navigation (back/forward, filter chips) re-syncs the field.
  useEffect(() => {
    const timer = setTimeout(() => {
      setValue(query ?? "");
      lastSent.current = (query ?? "").trim();
    }, 0);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function send(next: string) {
    lastSent.current = next.trim();
    const params = new URLSearchParams();
    if (next.trim()) params.set("q", next.trim());
    for (const [name, val] of Object.entries(hiddenParams ?? {})) {
      if (val !== undefined && !params.has(name)) params.set(name, val);
    }
    const qs = params.toString();
    router.replace(qs ? `${action}?${qs}` : action);
  }

  function schedule(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next.trim() !== lastSent.current) send(next);
    }, DEBOUNCE_MS);
  }

  return (
    <form
      role="search"
      action={action}
      method="get"
      className="relative w-full sm:max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        send(value);
      }}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        name="q"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          schedule(next);
        }}
        placeholder={placeholder}
        className="pr-9 pl-9"
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            setValue("");
            send("");
          }}
          className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
      {hiddenParams
        ? Object.entries(hiddenParams)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([name, val]) => <input key={name} type="hidden" name={name} value={val} />)
        : null}
    </form>
  );
}
