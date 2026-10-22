"use client";

// 3D warehouse (§11): a bright, lit digital twin of WH-01 at real scale. Blue-and-orange pallet racking, pallets
// of pharma and kraft cartons sized by each bin's fill, ONE invisible InstancedMesh for all 240 bins (click and
// hover), glowing frames and floor outlines on at-risk bins in the mode colour, staged cyan glass pallets for
// proposed stock, rack labels, aisle signs, docks, a cold room and a forklift. Camera: zoom follows the cursor,
// right-drag pans anywhere, WASD walks, "Visit rack" flies to the shelf. Everything is procedural.
// frameloop="demand": nothing renders while the scene is idle.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Environment, Lightformer } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { ChevronDown, Eye, Footprints, Map as MapIcon, Maximize2, Minimize2, MapPin, RotateCcw } from "lucide-react";
import { cn } from "cn";
import type { BinHeat, HeatmapMode } from "@/lib/business-logic/heatmap";
import type { HeatmapView, WarehouseLayout } from "@/lib/services/warehouse";
import { MODE_BY_ID, STORAGE_LABEL } from "./modes";
import { RACK_HEIGHT, type Slot, WALK, buildBays, buildSlots, hallBounds, walkwayX } from "./scene/layout3d";
import { BinHitboxes, HeatOverlay, Loads, SCENE_TONE, Selection, StagedProposed, labelAnchor } from "./scene/stock";
import { AisleSigns, ColdRoom, Hall, RackLabels, Racks, Staging } from "./scene/structure";

const BG = "#070b14";
type Controls = React.ComponentRef<typeof CameraControls>;
type Shot = { kind: "overview" | "top" | "aisle" | "visit"; nonce: number; binId?: string };
type Heatmaps = Partial<Record<HeatmapMode, HeatmapView>>;

export type Scene3DProps = {
  layout: WarehouseLayout;
  heat: Map<string, BinHeat>;
  mode: HeatmapMode;
  /** Every loaded heatmap, for the rack card's counts. */
  heatmaps: Heatmaps;
  selectedBinId: string | null;
  matchBinIds: Set<string>;
  /** Changes when the camera should fly to a bin (e.g. a ?sku= search); null = stay. */
  focus: { binId: string; nonce: number } | null;
  placements: HeatmapView["placements"];
  onSelect: (binId: string) => void;
};

export default function Scene3D(props: Scene3DProps) {
  const { layout, heat, mode } = props;
  const racks = useMemo(() => Math.max(...layout.bins.map((b) => b.rackNumber)), [layout.bins]);
  const slots = useMemo(() => buildSlots(layout.bins, layout.aisles), [layout]);
  const bays = useMemo(() => buildBays(slots), [slots]);
  const slotById = useMemo(() => new Map(slots.map((s) => [s.bin.id, s])), [slots]);
  const bounds = useMemo(() => hallBounds(layout.aisles.length, racks), [layout.aisles.length, racks]);
  const coldAisle = layout.aisles.findIndex((a) => layout.bins.some((b) => b.aisle === a && b.storageClass !== "ambient"));
  const subs = useMemo(
    () =>
      layout.aisles.map((a) => {
        const cls = [...new Set(layout.bins.filter((b) => b.aisle === a).map((b) => b.storageClass))];
        return cls.map((c) => (c === "cold_chain" ? "Cold chain" : c === "cool" ? "Cool" : "Ambient")).join(" · ");
      }),
    [layout],
  );

  const [hover, setHover] = useState<{ index: number; x: number; y: number; flip: boolean } | null>(null);
  const [shot, setShot] = useState<Shot>({ kind: "overview", nonce: 0 });
  const [full, setFull] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const moveLabel = useCallback((x: number, y: number, visible: boolean) => {
    const el = labelRef.current;
    if (!el) return;
    el.style.visibility = visible ? "visible" : "hidden";
    el.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  // ?sku= and search picks fly the camera to the bin.
  const [lastFocus, setLastFocus] = useState(props.focus?.nonce ?? null);
  if (props.focus && props.focus.nonce !== lastFocus) {
    setLastFocus(props.focus.nonce);
    setShot({ kind: "visit", nonce: props.focus.nonce, binId: props.focus.binId });
  }

  const selected = props.selectedBinId ? slotById.get(props.selectedBinId) : undefined;
  const hovered = hover ? slots[hover.index] : undefined;
  const hoverHeat = hovered ? heat.get(hovered.bin.id) : undefined;
  const tone = SCENE_TONE[mode];
  const hotBays = useMemo(() => {
    const s = new Set<string>();
    for (const slot of slots) {
      const sev = heat.get(slot.bin.id)?.severity ?? 0;
      if (sev > 0 && (mode !== "normal" || sev >= 3)) s.add(slot.bayKey);
    }
    return s;
  }, [slots, heat, mode]);

  const go = (kind: Shot["kind"], binId?: string) => setShot((s) => ({ kind, nonce: s.nonce + 1, binId }));

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen();
  };

  // Walk with the keyboard while the scene has focus.
  const onKey = (e: React.KeyboardEvent) => {
    const c = controls.current;
    if (!c) return;
    const k = e.key.toLowerCase();
    const step = e.shiftKey ? 2.4 : 1.0;
    const moves: Record<string, () => void> = {
      w: () => void c.forward(step, true),
      arrowup: () => void c.forward(step, true),
      s: () => void c.forward(-step, true),
      arrowdown: () => void c.forward(-step, true),
      a: () => void c.truck(-step, 0, true),
      arrowleft: () => void c.truck(-step, 0, true),
      d: () => void c.truck(step, 0, true),
      arrowright: () => void c.truck(step, 0, true),
      q: () => void c.elevate(-0.6, true),
      e: () => void c.elevate(0.6, true),
    };
    if (moves[k]) {
      e.preventDefault();
      moves[k]();
    }
  };

  return (
    <div
      ref={box}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={() => box.current?.focus({ preventScroll: true })}
      onPointerLeave={() => setHover(null)}
      aria-label="3D warehouse. Drag to orbit, scroll to zoom towards the cursor, right-drag to pan, W A S D to walk."
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-[#070b14] outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
        full ? "h-screen rounded-none border-0" : "h-[680px] max-xl:h-[560px]",
      )}
    >
      <Canvas
        frameloop="demand"
        shadows
        dpr={[1, 2]}
        camera={{ position: [24, 18, 24], fov: 45, near: 0.2, far: 400 }}
        gl={{ antialias: false, powerPreference: "high-performance", toneMappingExposure: 1.05 }}
        onPointerMissed={() => setHover(null)}
      >
        <color attach="background" args={[BG]} />
        <Lights center={bounds.center} />
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.4} color="#ffffff" scale={[40, 6, 1]} position={[0, 14, 0]} rotation-x={Math.PI / 2} />
          <Lightformer form="rect" intensity={1.0} color="#e0f2fe" scale={[30, 8, 1]} position={[-20, 6, 0]} rotation-y={Math.PI / 2} />
          <Lightformer form="rect" intensity={0.8} color="#fff7ed" scale={[30, 8, 1]} position={[20, 6, 10]} rotation-y={-Math.PI / 2} />
        </Environment>

        <Hall aisleCount={layout.aisles.length} racks={racks} aisles={layout.aisles} />
        <Racks aisleCount={layout.aisles.length} racks={racks} />
        <Loads slots={slots} />
        <HeatOverlay slots={slots} bays={bays} heat={heat} mode={mode} />
        <RackLabels bays={bays} hot={hotBays} tone={tone} />
        <AisleSigns aisles={layout.aisles} subs={subs} z={bounds.racks.z1 + 1.2} />
        {coldAisle >= 0 && <ColdRoom aisleIndex={coldAisle} racks={racks} />}
        <Staging aisleCount={layout.aisles.length} racks={racks} />
        {mode === "proposed" && <StagedProposed slots={slots} placements={props.placements} onSelect={props.onSelect} />}
        <SearchMarkers slots={slots} matchBinIds={props.matchBinIds} />
        <Selection slot={selected} hover={hovered} />
        <LabelTracker slot={selected} onMove={moveLabel} />
        <BinHitboxes
          slots={slots}
          onSelect={props.onSelect}
          onHover={(index, x, y) => setHover(index === null ? null : { index, x, y, flip: x > (box.current?.clientWidth ?? 0) - 310 })}
        />

        <CameraRig controlsRef={controls} shot={shot} slotById={slotById} bounds={bounds} aisleOf={selected?.aisleIndex ?? 0} />
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.9} radius={0.65} />
          <Vignette eskil={false} offset={0.25} darkness={0.45} />
        </EffectComposer>
      </Canvas>

      {/* Camera presets and window controls */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className={glass("pointer-events-auto flex h-9 items-center p-0.5")}>
          {(
            [
              ["overview", "Overview", Eye],
              ["top", "Floor plan", MapIcon],
              ["aisle", `Walk aisle ${layout.aisles[selected?.aisleIndex ?? 0]}`, Footprints],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => go(k)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150",
                shot.kind === k ? "bg-white/12 text-fg-1" : "text-fg-3 hover:text-fg-1",
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div className="pointer-events-auto flex gap-2">
          <button
            type="button"
            onClick={() => go("overview")}
            className={glass("inline-flex h-9 items-center gap-1.5 px-3 text-[12px] font-medium text-fg-2 hover:text-fg-1")}
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden /> Reset
          </button>
          <button
            type="button"
            onClick={toggleFull}
            aria-label={full ? "Exit full screen" : "Full screen"}
            className={glass("inline-flex size-9 items-center justify-center text-fg-2 hover:text-fg-1")}
          >
            {full ? <Minimize2 className="size-4" strokeWidth={1.75} /> : <Maximize2 className="size-4" strokeWidth={1.75} />}
          </button>
        </div>
      </div>

      {selected && (
        <div ref={labelRef} className="pointer-events-none absolute top-0 left-0 z-[5]" style={{ visibility: "hidden" }}>
          <BinLabel slot={selected} heat={heat.get(selected.bin.id)} tone={tone} />
        </div>
      )}

      {selected && (
        <RackCard
          key={selected.bayKey}
          slot={selected}
          bays={bays}
          heatmaps={props.heatmaps}
          mode={mode}
          collapsed={shot.kind === "visit"}
          onVisit={() => go("visit", selected.bin.id)}
          onOverview={() => go("overview")}
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 px-3 pb-3">
        <span className={glass("inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] text-fg-2")}>
          <span className="relative mr-0.5 flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          Drag to orbit · scroll zooms to the cursor · right-drag to pan ·<Kbd>W</Kbd>
          <Kbd>A</Kbd>
          <Kbd>S</Kbd>
          <Kbd>D</Kbd> walk ·<Kbd>Q</Kbd>
          <Kbd>E</Kbd> down / up
        </span>
        {mode === "proposed" && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#22d3ee]/40 bg-[#082f3a]/85 px-2.5 py-1.5 text-[11.5px] text-[#a5f3fc] backdrop-blur-md">
            <span className="size-2.5 rounded-[2px] border border-[#67e8f9] bg-[#22d3ee]/40" aria-hidden />
            Cyan glass pallets in the walkway: Proposed — not received
          </span>
        )}
      </div>

      {hover && hovered && (
        <div
          role="tooltip"
          className={glass("pointer-events-none absolute z-10 max-w-[280px] px-3 py-2")}
          style={{ left: hover.flip ? hover.x - 16 : hover.x + 16, top: hover.y + 16, transform: hover.flip ? "translateX(-100%)" : undefined }}
        >
          <div className="font-mono text-[12.5px] text-fg-1">
            {hovered.bin.binCode} <span className="text-fg-3">· shelf {hovered.bin.shelf}</span>
          </div>
          <div className="text-[11.5px] leading-4 text-fg-2">{hovered.bin.status !== "active" ? "Inactive bin" : (hoverHeat?.label ?? "")}</div>
          <div className="mt-0.5 text-[11px] leading-4 text-fg-3">
            {STORAGE_LABEL[hovered.bin.storageClass] ?? hovered.bin.storageClass} · {hovered.bin.used} of {hovered.bin.capacityUnits} packs · click to open
          </div>
        </div>
      )}
    </div>
  );
}

const glass = (extra: string) => cn("rounded-lg border border-white/10 bg-[#0d1424]/85 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md", extra);

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-white/15 bg-white/5 px-1 font-mono text-[10.5px] text-fg-1">{children}</kbd>;
}

/** Rack card (top right): utilisation and SKU counts for the selected bin's rack, with Visit and Overview. */
function RackCard({
  slot,
  bays,
  heatmaps,
  mode,
  collapsed: collapsedByShot,
  onVisit,
  onOverview,
}: {
  slot: Slot;
  bays: ReturnType<typeof buildBays>;
  heatmaps: Heatmaps;
  mode: HeatmapMode;
  /** Collapses to its header while visiting the rack, so the shelf stays in view. */
  collapsed: boolean;
  onVisit: () => void;
  onOverview: () => void;
}) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [lastShot, setLastShot] = useState(collapsedByShot);
  if (collapsedByShot !== lastShot) {
    setLastShot(collapsedByShot);
    setExpanded(null); // a new camera shot resets the user's choice
  }
  const collapsed = expanded === null ? collapsedByShot : !expanded;
  const bay = bays.find((b) => b.key === slot.bayKey);
  const stats = useMemo(() => {
    if (!bay) return null;
    const ids = new Set(bay.slots.map((s) => s.bin.id));
    const skusIn = (m: HeatmapMode, hotOnly: boolean) => {
      const out = new Set<string>();
      for (const b of heatmaps[m]?.bins ?? []) if (ids.has(b.binId) && (!hotOnly || b.severity > 0)) b.skus.forEach((s) => out.add(s));
      return out;
    };
    const all = skusIn("normal", false);
    const stockout = skusIn("stockout", true);
    const expiry = skusIn("expiry", true);
    const excess = skusIn("excess", true);
    const risky = new Set([...stockout, ...expiry, ...excess]);
    const used = bay.slots.reduce((n, s) => n + s.bin.used, 0);
    const cap = bay.slots.reduce((n, s) => n + s.bin.capacityUnits, 0);
    return {
      total: all.size,
      stockout: stockout.size,
      expiry: expiry.size,
      excess: excess.size,
      healthy: Math.max(0, all.size - risky.size),
      util: cap ? Math.round((used / cap) * 100) : 0,
      used,
      cap,
    };
  }, [bay, heatmaps]);
  if (!bay || !stats) return null;
  const rows = [
    { label: "Total SKUs", value: stats.total, dot: "#94a3b8" },
    { label: "Stockout risk", value: stats.stockout, dot: "#f87171" },
    { label: "Near expiry", value: stats.expiry, dot: "#fbbf24" },
    { label: "Excess stock", value: stats.excess, dot: "#a78bfa" },
    { label: "Healthy", value: stats.healthy, dot: "#34d399" },
  ];
  return (
    <div className={glass(cn("absolute top-14 right-3 z-10 w-[260px]", collapsed ? "px-4 py-2.5" : "p-4"))}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {!collapsed && <div className="micro-label">Rack · {MODE_BY_ID[mode].label}</div>}
          <div className="mt-0.5 font-mono text-[17px] font-semibold text-fg-1">
            {bay.key}
            {collapsed && <span className="ml-2 font-sans text-[12px] font-normal text-fg-3">{stats.util}% utilised</span>}
          </div>
          {!collapsed && (
            <div className="text-[11.5px] text-fg-3">
              Aisle {bay.aisle} · {bay.side === "L" ? "left" : "right"} side · bin {slot.bin.binCode}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(collapsed)}
          aria-label={collapsed ? "Show rack details" : "Hide rack details"}
          aria-expanded={!collapsed}
          className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-white/10 hover:text-fg-1"
        >
          <ChevronDown className={cn("size-4 transition-transform duration-150", !collapsed && "rotate-180")} strokeWidth={1.75} />
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="mt-3 flex items-baseline justify-between text-[12px]">
            <span className="text-fg-2">{stats.util}% utilised</span>
            <span className="num text-fg-3">
              {stats.used.toLocaleString("en-IN")} / {stats.cap.toLocaleString("en-IN")} packs
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className={cn("h-full rounded-full", stats.util >= 90 ? "bg-expiry" : "bg-brand")} style={{ width: `${Math.max(2, stats.util)}%` }} />
          </div>
          <ul className="mt-3 space-y-1.5">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between text-[12.5px]">
                <span className="inline-flex items-center gap-2 text-fg-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: r.dot }} aria-hidden />
                  {r.label}
                </span>
                <span className="num font-semibold text-fg-1">{r.value}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onVisit}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand-strong text-[12.5px] font-semibold text-[#04221d] hover:bg-brand"
            >
              <MapPin className="size-3.5" aria-hidden /> Visit rack
            </button>
            <button
              type="button"
              onClick={onOverview}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/12 text-[12.5px] font-medium text-fg-2 hover:bg-white/5 hover:text-fg-1"
            >
              <Eye className="size-3.5" aria-hidden /> Overview
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Teal frames around search matches (drawn through other stock so a match is never hidden). */
function SearchMarkers({ slots, matchBinIds }: { slots: Slot[]; matchBinIds: Set<string> }) {
  const invalidate = useThree((s) => s.invalidate);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 1.02, 2.02)), []);
  const marked = slots.filter((s) => matchBinIds.has(s.bin.id));
  useEffect(() => invalidate(), [marked.length, invalidate]);
  return (
    <>
      {marked.map((s) => (
        <lineSegments key={s.bin.id} geometry={edges} position={s.center} renderOrder={5}>
          <lineBasicMaterial color={new THREE.Color("#2dd4bf").multiplyScalar(2.5)} depthTest={false} transparent toneMapped={false} />
        </lineSegments>
      ))}
    </>
  );
}

function Lights({ center }: { center: THREE.Vector3 }) {
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.copy(center);
    return o;
  }, [center]);
  return (
    <>
      <hemisphereLight args={["#ffffff", "#8b95a7", 1.15]} />
      <ambientLight intensity={0.25} />
      <primitive object={target} />
      <directionalLight
        position={[center.x + 16, 32, center.z + 12]}
        intensity={2.3}
        color="#ffffff"
        target={target}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={5}
        shadow-camera-far={90}
      />
    </>
  );
}

/** Camera presets with smooth transitions; zoom goes towards the cursor; the target stays inside the hall. */
function CameraRig({
  controlsRef,
  shot,
  slotById,
  bounds,
  aisleOf,
}: {
  controlsRef: React.RefObject<Controls | null>;
  shot: Shot;
  slotById: Map<string, Slot>;
  bounds: ReturnType<typeof hallBounds>;
  aisleOf: number;
}) {
  const height = useThree((s) => s.size.height);
  const c = bounds.center;
  const home = useCallback(() => {
    const k = Math.max(1, 680 / Math.max(height, 1));
    return { p: new THREE.Vector3(c.x + 17 * k, 19 * k, c.z + 24 * k), t: new THREE.Vector3(c.x, 1.2, c.z + 1) };
  }, [c, height]);

  // Boundaries and the fly-in, once the controls exist.
  const ready = useRef(false);
  useEffect(() => {
    const ctl = controlsRef.current;
    if (!ctl || ready.current) return;
    ready.current = true;
    ctl.setBoundary(new THREE.Box3(new THREE.Vector3(bounds.hall.x0, 0, bounds.hall.z0), new THREE.Vector3(bounds.hall.x1, 10, bounds.hall.z1)));
    const h = home();
    void ctl.setLookAt(h.p.x - 20, h.p.y + 26, h.p.z + 14, h.t.x, h.t.y, h.t.z, false);
    if (shot.kind === "overview") void ctl.setLookAt(h.p.x, h.p.y, h.p.z, h.t.x, h.t.y, h.t.z, true);
  });

  useEffect(() => {
    const ctl = controlsRef.current;
    if (!ctl || shot.nonce === 0) return;
    if (shot.kind === "overview") {
      const h = home();
      void ctl.setLookAt(h.p.x, h.p.y, h.p.z, h.t.x, h.t.y, h.t.z, true);
    } else if (shot.kind === "top") {
      void ctl.setLookAt(c.x, 58, c.z + 3, c.x, 0, c.z, true);
    } else if (shot.kind === "aisle") {
      const x = walkwayX(aisleOf);
      void ctl.setLookAt(x, 1.75, bounds.racks.z1 + 6, x, 1.6, bounds.racks.z0, true);
    } else if (shot.kind === "visit" && shot.binId) {
      const s = slotById.get(shot.binId);
      if (s) {
        // Stand on the far side of the walkway, facing the shelf, slightly off-axis.
        const camX = walkwayX(s.aisleIndex) + s.facing * (WALK / 2 - 0.35);
        void ctl.setLookAt(camX, Math.min(s.center.y + 0.7, RACK_HEIGHT), s.center.z + 2.2, s.center.x, s.center.y, s.center.z, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new shot (nonce) is the trigger
  }, [shot.nonce]);

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      smoothTime={0.35}
      draggingSmoothTime={0.12}
      dollyToCursor
      dollySpeed={0.7}
      truckSpeed={1.6}
      minDistance={0.8}
      maxDistance={110}
      maxPolarAngle={Math.PI / 2 - 0.04}
    />
  );
}

/** The selected bin's label card: a white chip with a pointer, outlined in the mode colour when the bin is hot. */
function BinLabel({ slot, heat, tone }: { slot: Slot; heat: BinHeat | undefined; tone: string }) {
  const border = heat && heat.severity > 0 ? tone : "#2dd4bf";
  return (
    <div className="-translate-x-1/2 -translate-y-full">
      <div
        className="rounded-xl border-2 bg-white px-3 py-1.5 text-center whitespace-nowrap shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
        style={{ borderColor: border }}
      >
        <div className="font-mono text-[13px] font-semibold text-slate-900">
          {slot.bayKey} · Shelf {slot.bin.shelf}
        </div>
        {heat && <div className="text-[11px] leading-4 text-slate-600">{slot.bin.status !== "active" ? "Inactive bin" : heat.label}</div>}
      </div>
      <div className="mx-auto -mt-[7px] size-3 rotate-45 border-r-2 border-b-2 bg-white" style={{ borderColor: border }} />
    </div>
  );
}

/**
 * Keeps the label overlay over the selected bin: projects its anchor to screen space on every rendered frame and
 * reports it; the owner moves its DOM node directly (no extra React root, no re-render per frame).
 */
function LabelTracker({ slot, onMove }: { slot: Slot | undefined; onMove: (x: number, y: number, visible: boolean) => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const anchor = useMemo(() => (slot ? labelAnchor(slot) : null), [slot]);
  const v = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => invalidate(), [anchor, invalidate]);
  useFrame(({ camera, size }) => {
    if (!anchor) return;
    v.copy(anchor).project(camera);
    const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    onMove(((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height, visible);
  });
  return null;
}
