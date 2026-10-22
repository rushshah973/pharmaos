"use client";

// SKU search: type a SKU code, brand or generic name; picking a result highlights every bin holding it.
import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "cn";
import type { ProductSearchHit } from "@/lib/services/warehouse";

const MIN_CHARS = 2;

export function SkuSearch({ selected, onPick, onClear }: { selected: ProductSearchHit | null; onPick: (hit: ProductSearchHit) => void; onClear: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ProductSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_CHARS) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/products/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j: { results?: ProductSearchHit[] }) => {
          setResults(j.results ?? []);
          setActive(0);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const pick = (hit: ProductSearchHit) => {
    onPick(hit);
    setQ("");
    setResults(null);
    setOpen(false);
  };
  const shown = q.trim().length >= MIN_CHARS ? results : null;

  if (selected) {
    return (
      <div className="flex h-8 max-w-full items-center gap-2 rounded-lg border border-brand/40 bg-brand-glow pr-1 pl-3 text-[12.5px]">
        <Search className="size-3.5 shrink-0 text-brand" aria-hidden />
        <span className="font-mono text-fg-1">{selected.sku}</span>
        <span className="truncate text-fg-2">
          {selected.brandName} {selected.strength}
        </span>
        <button type="button" onClick={onClear} className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-white/[0.04] hover:text-fg-1" aria-label="Clear search">
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={box} className="relative w-full sm:w-[260px]">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!shown?.length) return;
          if (e.key === "Escape") return setOpen(false);
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
          e.preventDefault();
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, shown.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else pick(shown[active]);
        }}
        placeholder="Find a SKU, brand or generic name"
        aria-label="Search SKUs"
        role="combobox"
        aria-expanded={open && !!shown}
        aria-controls="sku-search-results"
        className="h-8 w-full rounded-lg border border-border-strong bg-surface-2 pr-8 pl-8 text-[13px] text-fg-1 outline-none placeholder:text-fg-3 focus-visible:border-brand/60 focus-visible:ring-2 focus-visible:ring-brand/30"
      />
      {loading && <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-fg-3" aria-hidden />}
      {open && shown && (
        <ul
          id="sku-search-results"
          role="listbox"
          className="absolute top-[calc(100%+6px)] right-0 z-30 max-h-80 w-full min-w-[320px] overflow-auto rounded-lg border border-border-strong bg-surface-2 p-1 shadow-[var(--shadow-pop)]"
        >
          {shown.length === 0 && <li className="px-3 py-2.5 text-[12.5px] text-fg-3">No active SKU matches “{q.trim()}”.</li>}
          {shown.map((h, i) => (
            <li key={h.productId} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(h)}
                className={cn("flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left", i === active && "bg-surface-3")}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[12.5px] text-fg-1">{h.sku}</span>
                  <span className="block truncate text-[12px] text-fg-2">
                    {h.brandName} {h.strength} · {h.genericName}
                  </span>
                </span>
                <span className="num shrink-0 text-[11.5px] text-fg-3">
                  {h.bins.length > 0 ? `${h.bins.length} bin${h.bins.length === 1 ? "" : "s"}` : h.unmappedPacks > 0 ? "unmapped" : "no stock"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
