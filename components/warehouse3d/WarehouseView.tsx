"use client";

// Warehouse view (§11): state for mode, selected bin and SKU search, mirrored in the URL (?mode, ?bin, ?sku, ?view).
// The four status heatmaps arrive with the page, computed from one planning context; Proposed Replenishment
// is fetched from /api/warehouse/heatmap when it is first picked (it needs the plan's put-away).
// 3D is the default view; without WebGL2, or if the scene throws, it falls back to the 2D grid.
import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Box, Grid3x3, Loader2, PackageX, Rows3, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { HEATMAP_MODES, type HeatmapMode } from "@/lib/business-logic/heatmap";
import type { HeatmapView, ProductSearchHit, WarehouseLayout } from "@/lib/services/warehouse";
import { formatDisplayDate } from "@/lib/format/date";
import { BinPanel, BinPanelEmpty } from "./BinPanel";
import { BinTable } from "./BinTable";
import { Grid2D } from "./Grid2D";
import { Legend, ModeSelect } from "./Legend";
import { MODE_BY_ID } from "./modes";
import { SkuSearch } from "./SkuSearch";

const Scene3D = dynamic(() => import("./Scene3D"), {
  ssr: false,
  loading: () => <SceneLoading />,
});

/** Shown while the 3D bundle downloads: a centred card, so the panel never looks like an empty black box. */
function SceneLoading() {
  return (
    <div className="relative flex h-[680px] items-center justify-center overflow-hidden rounded-xl border border-border bg-[radial-gradient(120%_80%_at_50%_30%,#111a2e_0%,#070b14_70%)] max-xl:h-[560px]">
      <div className="flex w-[300px] flex-col items-center rounded-xl border border-white/10 bg-[#0d1424]/85 px-6 py-5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        <Box className="size-6 text-brand" strokeWidth={1.5} aria-hidden />
        <div className="mt-3 text-[13.5px] font-semibold text-fg-1">Building the 3D warehouse</div>
        <div className="mt-1 text-[12px] text-fg-3">Racks, stock and risk for all 240 bins</div>
        <div className="shimmer mt-4 h-1 w-full rounded-full bg-white/10" />
      </div>
    </div>
  );
}

type View = "3d" | "grid" | "table";
const VIEWS: View[] = ["3d", "grid", "table"];

/** WebGL2 support, checked once in the browser (the server assumes yes; the client corrects it on hydration). */
let webgl2: boolean | undefined;
function hasWebGL2(): boolean {
  if (webgl2 === undefined) {
    try {
      webgl2 = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}
const noSubscribe = () => () => {};

/** If the 3D scene throws, report it and render nothing; the parent switches to the 2D grid. */
class SceneBoundary extends Component<{ onError: (err: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: Error) {
    console.error("[warehouse 3d]", err);
    this.props.onError(err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
type Heatmaps = Partial<Record<HeatmapMode, HeatmapView>>;

const isMode = (v: string | null): v is HeatmapMode => !!v && (HEATMAP_MODES as readonly string[]).includes(v);

export function WarehouseView({ layout, initial, planId }: { layout: WarehouseLayout; initial: Heatmaps; planId: string | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const urlMode = params.get("mode");
  const urlSku = params.get("sku");

  const [mode, setMode] = useState<HeatmapMode>(isMode(urlMode) && (urlMode !== "proposed" || planId) ? urlMode : "stockout");
  const urlView = params.get("view");
  const [view, setView] = useState<View>(VIEWS.includes(urlView as View) ? (urlView as View) : "3d");
  const webgl = useSyncExternalStore(noSubscribe, hasWebGL2, () => true);
  const [sceneFailed, setSceneFailed] = useState(false);
  const can3d = webgl && !sceneFailed;
  const shown: View = view === "3d" && !can3d ? "grid" : view;
  const [focus, setFocus] = useState<{ binId: string; nonce: number } | null>(null);
  // ?bin= takes a bin id or a bin code (links from Ask PharmaOS use the code, e.g. ?bin=C-L-03-2).
  const [selectedBinId, setSelectedBinId] = useState<string | null>(() => {
    const raw = params.get("bin");
    if (!raw) return null;
    return layout.bins.find((b) => b.id === raw || b.binCode.toUpperCase() === raw.toUpperCase())?.id ?? null;
  });
  const [search, setSearch] = useState<ProductSearchHit | null>(null);
  const [heatmaps, setHeatmaps] = useState<Heatmaps>(initial);
  const [proposedState, setProposedState] = useState<"idle" | "loading" | "error">(mode === "proposed" && !initial.proposed ? "loading" : "idle");

  /** Mirrors state into the URL without a server round trip. */
  const setUrl = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const q = next.toString();
      window.history.replaceState(null, "", q ? `${pathname}?${q}` : pathname);
    },
    [pathname],
  );

  /** Fetches the proposed heatmap once at a time (dev strict mode runs effects twice); the caller sets the loading state. */
  const proposedInFlight = useRef(false);
  const fetchProposed = useCallback(() => {
    if (!planId || proposedInFlight.current) return;
    proposedInFlight.current = true;
    fetch(`/api/warehouse/heatmap?mode=proposed&planId=${planId}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error?.message);
        setHeatmaps((h) => ({ ...h, proposed: j as HeatmapView }));
        setProposedState("idle");
      })
      .catch(() => setProposedState("error"))
      .finally(() => (proposedInFlight.current = false));
  }, [planId]);

  // Opened with ?mode=proposed: fetch it once.
  useEffect(() => {
    if (mode === "proposed" && !initial.proposed) fetchProposed();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first render only
  }, []);

  // ?sku= (from a Locate link): resolve the SKU and highlight its bins; select the first unless ?bin is set.
  useEffect(() => {
    if (!urlSku) return;
    const ctrl = new AbortController();
    fetch(`/api/products/search?q=${encodeURIComponent(urlSku)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j: { results?: ProductSearchHit[] }) => {
        const hit = j.results?.find((h) => h.sku.toUpperCase() === urlSku.toUpperCase()) ?? null;
        setSearch(hit);
        if (hit?.bins[0]) {
          setSelectedBinId((cur) => cur ?? hit.bins[0].binId);
          setFocus({ binId: hit.bins[0].binId, nonce: Date.now() });
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [urlSku]);

  const loadProposed = () => {
    setProposedState("loading");
    fetchProposed();
  };
  const changeMode = (m: HeatmapMode) => {
    setMode(m);
    setUrl({ mode: m === "stockout" ? null : m });
    if (m === "proposed" && !heatmaps.proposed && proposedState !== "loading") loadProposed();
  };
  const panelRef = useRef<HTMLDivElement>(null);
  const select = (binId: string | null) => {
    setSelectedBinId(binId);
    setUrl({ bin: binId });
    // Below xl the panel sits under the map: bring it into view (in 3D the rack card shows the selection instead).
    if (binId && shown !== "3d" && !window.matchMedia("(min-width: 1280px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };
  const pickSku = (hit: ProductSearchHit) => {
    setSearch(hit);
    setUrl({ sku: hit.sku, bin: hit.bins[0]?.binId ?? null });
    setSelectedBinId(hit.bins[0]?.binId ?? null);
    if (hit.bins[0]) setFocus({ binId: hit.bins[0].binId, nonce: Date.now() });
  };
  const clearSku = () => {
    setSearch(null);
    setUrl({ sku: null });
  };
  const changeView = (v: View) => {
    setView(v);
    setUrl({ view: v === "3d" ? null : v });
  };

  const meta = MODE_BY_ID[mode];
  const current = heatmaps[mode];
  const heat = useMemo(() => new Map((current?.bins ?? []).map((b) => [b.binId, b])), [current]);
  const skusByBin = useMemo(() => new Map((heatmaps.normal?.bins ?? []).map((b) => [b.binId, b.skus])), [heatmaps.normal]);
  const matchBinIds = useMemo(() => new Set(search?.bins.map((b) => b.binId) ?? []), [search]);
  const counts = useMemo(() => {
    const c = [0, 0, 0, 0];
    for (const b of layout.bins) if (b.status === "active") c[heat.get(b.id)?.severity ?? 0]++;
    return c;
  }, [heat, layout.bins]);
  const highlighted = counts[1] + counts[2] + counts[3];
  const unmapped = heatmaps.normal?.unmapped ?? [];
  const offShelf = mode === "stockout" ? (current?.offShelf ?? []) : [];
  const asOf = (current ?? heatmaps.normal)?.asOf ?? "";
  const selected = selectedBinId ? layout.bins.find((b) => b.id === selectedBinId) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ModeSelect value={mode} onChange={changeMode} proposedAvailable={!!planId} />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SkuSearch selected={search} onPick={pickSku} onClear={clearSku} />
          <div role="radiogroup" aria-label="View" className="flex h-8 rounded-lg border border-border bg-surface-1 p-0.5">
            {([
              ["3d", "3D", Box],
              ["grid", "2D", Grid3x3],
              ["table", "Table", Rows3],
            ] as const).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={shown === v}
                disabled={v === "3d" && !can3d}
                title={v === "3d" && !can3d ? (webgl ? "The 3D scene failed; showing the 2D grid" : "3D needs WebGL2, which this browser does not offer") : undefined}
                onClick={() => changeView(v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  shown === v ? "bg-surface-3 text-fg-1" : "text-fg-3 hover:text-fg-1",
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {search && (
        <p className="text-[12.5px] text-fg-2" aria-live="polite">
          <span className="font-mono text-fg-1">{search.sku}</span>{" "}
          {search.bins.length > 0
            ? `is in ${search.bins.length} bin${search.bins.length === 1 ? "" : "s"}: ${search.bins.map((b) => `${b.binCode} (${b.packs} packs)`).join(", ")}.`
            : "is not in any bin."}
          {search.unmappedPacks > 0 && <span className="text-expiry"> {search.unmappedPacks} packs are unmapped (no bin recorded).</span>}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="surface min-w-0 p-5" aria-label="Warehouse map">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">
              WH-01 · {meta.label}
            </h2>
            <span className="num text-[12px] text-fg-3">
              {highlighted} of {counts.reduce((a, b) => a + b, 0)} active bins highlighted{asOf ? ` · as of ${formatDisplayDate(asOf)}` : ""}
            </span>
          </div>
          <div className="mb-5">
            <Legend mode={meta} counts={counts} />
          </div>
          {view === "3d" && shown === "grid" && (
            <p role="status" className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2">
              {sceneFailed ? "The 3D scene hit an error, so the 2D grid is shown instead." : "This browser has no WebGL2, so the 2D grid is shown instead of 3D."}
              {sceneFailed && (
                <button type="button" onClick={() => setSceneFailed(false)} className="ml-2 font-medium text-brand hover:underline">
                  Try 3D again
                </button>
              )}
            </p>
          )}

          {mode === "proposed" && proposedState === "error" ? (
            <div role="alert" className="flex flex-col items-center py-16 text-center">
              <TriangleAlert className="size-5 text-stockout" aria-hidden />
              <p className="mt-3 text-fg-1">Proposed stock could not load.</p>
              <button type="button" onClick={loadProposed} className="mt-3 text-[12.5px] font-medium text-brand hover:underline">
                Retry
              </button>
            </div>
          ) : (
            <div className="relative">
              {mode === "proposed" && !current && (
                <div className="absolute inset-0 z-20 flex items-start justify-center bg-surface-1/70 pt-24 backdrop-blur-[1px]">
                  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] text-fg-2">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Placing proposed stock into bins…
                  </span>
                </div>
              )}
              {shown === "3d" ? (
                <SceneBoundary onError={() => setSceneFailed(true)}>
                  <Scene3D
                    layout={layout}
                    heat={heat}
                    mode={mode}
                    heatmaps={heatmaps}
                    selectedBinId={selectedBinId}
                    matchBinIds={matchBinIds}
                    focus={focus}
                    locate={search ? { sku: search.sku, name: `${search.brandName} ${search.strength}`, bins: search.bins, unmappedPacks: search.unmappedPacks } : null}
                    onClearLocate={clearSku}
                    placements={mode === "proposed" ? (current?.placements ?? []) : []}
                    onSelect={select}
                  />
                </SceneBoundary>
              ) : shown === "grid" ? (
                <Grid2D bins={layout.bins} heat={heat} mode={meta} selectedBinId={selectedBinId} matchBinIds={matchBinIds} onSelect={select} />
              ) : (
                <BinTable bins={layout.bins} heat={heat} mode={meta} selectedBinId={selectedBinId} matchBinIds={matchBinIds} skusByBin={skusByBin} onSelect={select} />
              )}
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-4 self-start xl:sticky xl:top-[72px]">
          <div ref={panelRef} className="surface scroll-mt-[72px] overflow-hidden">
            {selected ? (
              <BinPanel key={selected.id} binId={selected.id} heat={heat.get(selected.id)} mode={meta} asOf={asOf} placements={mode === "proposed" ? (current?.placements ?? []) : []} highlightSku={search?.sku ?? null} onClose={() => select(null)} />
            ) : (
              <BinPanelEmpty mode={meta} highlighted={highlighted} />
            )}
          </div>

          {mode === "proposed" && current && current.capacityReview.length > 0 && (
            <div className="surface px-5 py-4">
              <h3 className="micro-label text-expiry">Needs capacity review</h3>
              <p className="mt-1 text-[12px] text-fg-3">No bin of the right storage class has room. No location is invented.</p>
              <ul className="mt-2.5 space-y-1.5">
                {current.capacityReview.map((c) => (
                  <li key={c.productId} className="flex justify-between gap-3 text-[12.5px]">
                    <span className="font-mono text-fg-1">{c.sku}</span>
                    <span className="num text-fg-2">{c.packs.toLocaleString("en-IN")} packs</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mode === "proposed" && planId && (
            <p className="px-1 text-[12px] text-fg-3">
              Proposed stock comes from the counted lines of the{" "}
              <Link href={`/procurement/${planId}`} className="text-brand hover:underline">
                latest open plan
              </Link>
              . It is not received until the POs are delivered.
            </p>
          )}

          {offShelf.length > 0 && (
            <div className="surface-alert px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="micro-label">Out of stock · not on any shelf</h3>
                <span className="num text-[12px] text-fg-3">
                  {offShelf.length} SKU{offShelf.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-fg-3">Stockout risk with no stock in any bin, so nothing to colour on the map. Same engine status as the Command Center.</p>
              <ul className="mt-2.5 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {offShelf.map((u) => (
                  <li key={u.productId} className="flex justify-between gap-3 text-[12.5px]">
                    <span className="font-mono text-fg-1">{u.sku}</span>
                    <span className="num text-stockout">{(u.cover ?? 0) <= 0 ? "out of stock now" : `runs out in ${(u.cover ?? 0).toFixed(1)} d`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="surface px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="micro-label">Unmapped stock</h3>
              <span className="num text-[12px] text-fg-3">{unmapped.length} SKU{unmapped.length === 1 ? "" : "s"}</span>
            </div>
            <p className="mt-1 text-[12px] text-fg-3">Stock with no bin recorded. Shown here, never placed on the map.</p>
            {unmapped.length === 0 ? (
              <p className="mt-2.5 flex items-center gap-2 text-[12.5px] text-fg-2">
                <PackageX className="size-3.5 text-fg-3" aria-hidden /> Every pack has a bin.
              </p>
            ) : (
              <ul className="mt-2.5 space-y-1.5">
                {unmapped.map((u) => (
                  <li key={u.productId} className="flex justify-between gap-3 text-[12.5px]">
                    <span className="font-mono text-fg-1">{u.sku}</span>
                    <span className="num text-fg-2">{u.packs.toLocaleString("en-IN")} packs</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
