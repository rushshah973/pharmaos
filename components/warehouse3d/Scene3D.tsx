"use client";

// 3D warehouse (§11): a lit, shadowed digital twin of WH-01. Steel racking, open totes with cartons sized by fill,
// one InstancedMesh for all 240 bins (per-instance colour from the heatmap; high severities glow through bloom),
// see-through cyan cartons for proposed stock, a reflective concrete floor, signage and a glass cold room.
// Everything is procedural (no external models or textures). frameloop="demand": idle scenes do not render.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { Eye, Footprints, Map as MapIcon, RotateCcw } from "lucide-react";
import { cn } from "cn";
import type { BinHeat, HeatmapMode } from "@/lib/business-logic/heatmap";
import type { HeatmapView, LayoutBin, WarehouseLayout } from "@/lib/services/warehouse";
import { STORAGE_LABEL } from "./modes";
import { AisleSigns, Building, ColdRoom, Racks, rackColumns } from "./scene/structure";
import { Cartons, Markers, ProposedCartons, Selection, Totes, toteCenter } from "./scene/stock";

/** The layout is ~19 × 7 m; the world is drawn 1.2× so it fills the frame from the §11 camera position. */
const S = 1.2;
const HOME = { position: new THREE.Vector3(24, 18, 24), target: new THREE.Vector3(8 * S, 0.6, 3 * S) };
const BG = "#060a12";

type Preset = "overview" | "top" | "aisle";

export type Scene3DProps = {
  layout: WarehouseLayout;
  heat: Map<string, BinHeat>;
  mode: HeatmapMode;
  selectedBinId: string | null;
  matchBinIds: Set<string>;
  /** Changes when the camera should fly to a bin (e.g. a ?sku= search); null = stay. */
  focus: { binId: string; nonce: number } | null;
  placements: HeatmapView["placements"];
  onSelect: (binId: string) => void;
};

type Hover = { kind: "bin" | "carton"; index: number; x: number; y: number } | null;
type Shot = { preset: Preset | "focus"; nonce: number; binId?: string };

export default function Scene3D(props: Scene3DProps) {
  const [hover, setHover] = useState<Hover>(null);
  const [shot, setShot] = useState<Shot>({ preset: "overview", nonce: 0 });
  const bins = props.layout.bins;
  const cartons = useMemo(() => props.placements.filter((p) => p.binId), [props.placements]);
  const binById = useMemo(() => new Map(bins.map((b) => [b.id, b])), [bins]);
  const columns = useMemo(() => rackColumns(bins), [bins]);
  const walkways = useMemo(() => [...new Set(columns.map((c) => c.x + (c.side === "L" ? 1 : -1)))].sort((a, b) => a - b), [columns]);
  const signs = useMemo(
    () =>
      props.layout.aisles.map((aisle) => {
        const inAisle = bins.filter((b) => b.aisle === aisle);
        const classes = [...new Set(inAisle.map((b) => b.storageClass))].map((c) => (c === "cold_chain" ? "Cold chain" : c === "cool" ? "Cool" : "Ambient"));
        return { aisle, x: inAisle.reduce((s, b) => s + b.x, 0) / inAisle.length, z: props.layout.bounds.max.z + 1.1, sub: classes.join(" · ") };
      }),
    [props.layout, bins],
  );
  const cold = useMemo(() => {
    const c = bins.filter((b) => b.storageClass !== "ambient");
    if (c.length === 0) return null;
    return { x0: Math.min(...c.map((b) => b.x)) - 0.75, x1: Math.max(...c.map((b) => b.x)) + 0.75, z0: props.layout.bounds.min.z - 0.4, z1: props.layout.bounds.max.z + 0.4 };
  }, [bins, props.layout.bounds]);

  // ?sku= and search picks fly the camera to the bin.
  const [lastFocus, setLastFocus] = useState(props.focus?.nonce ?? null);
  if (props.focus && props.focus.nonce !== lastFocus) {
    setLastFocus(props.focus.nonce);
    setShot({ preset: "focus", nonce: props.focus.nonce, binId: props.focus.binId });
  }

  const hoverBin = hover?.kind === "bin" ? bins[hover.index] : hover?.kind === "carton" ? binById.get(cartons[hover.index]?.binId ?? "") : undefined;
  const hoverHeat = hoverBin ? props.heat.get(hoverBin.id) : undefined;
  const hoverCarton = hover?.kind === "carton" ? cartons[hover.index] : undefined;
  const selected = props.selectedBinId ? binById.get(props.selectedBinId) : undefined;
  const aisleFor = selected?.aisle ?? props.layout.aisles[0];

  const go = (preset: Preset) => setShot((s) => ({ preset, nonce: s.nonce + 1, binId: preset === "aisle" ? selected?.id : undefined }));

  return (
    <div
      className="relative h-[620px] overflow-hidden rounded-xl border border-border bg-[#060a12] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] max-xl:h-[520px]"
      onPointerLeave={() => setHover(null)}
    >
      <Canvas
        frameloop="demand"
        shadows
        dpr={[1, 2]}
        camera={{ position: [24, 18, 24], fov: 45, near: 0.5, far: 200 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        onPointerMissed={() => setHover(null)}
      >
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, 34, 78]} />
        <Lights />
        <Environment resolution={256} frames={1}>
          {/* A studio of soft light panels, only for reflections on steel and plastic. */}
          <Lightformer form="rect" intensity={2.2} color="#dbeafe" scale={[20, 3, 1]} position={[0, 9, 0]} rotation-x={Math.PI / 2} />
          <Lightformer form="rect" intensity={0.9} color="#99f6e4" scale={[12, 4, 1]} position={[-10, 4, -6]} rotation-y={Math.PI / 4} />
          <Lightformer form="rect" intensity={0.6} color="#c7d2fe" scale={[12, 4, 1]} position={[12, 3, 10]} rotation-y={-Math.PI / 3} />
        </Environment>

        <group scale={S}>
          <Building layout={props.layout} walkways={walkways} />
          <Racks columns={columns} />
          <Totes
            bins={bins}
            heat={props.heat}
            mode={props.mode}
            hovered={hover?.kind === "bin" ? hover.index : null}
            onSelect={props.onSelect}
            onHover={(index, x, y) => setHover(index === null ? null : { kind: "bin", index, x, y })}
          />
          <Cartons bins={bins} />
          {props.mode === "proposed" && cartons.length > 0 && (
            <ProposedCartons
              cartons={cartons}
              binById={binById}
              onSelect={props.onSelect}
              onHover={(index, x, y) => setHover(index === null ? null : { kind: "carton", index, x, y })}
            />
          )}
          <Markers bins={bins} matchBinIds={props.matchBinIds} selectedBinId={props.selectedBinId} />
          {selected && <Selection bin={selected} heat={props.heat.get(selected.id)} />}
          <AisleSigns signs={signs} />
          {cold && <ColdRoom {...cold} height={3.25} />}
          <ContactShadows position={[props.layout.bounds.center.x, 0.006, props.layout.bounds.center.z]} scale={34} blur={2.4} far={3.2} opacity={0.6} resolution={1024} frames={1} />
        </group>

        <CameraRig shot={shot} binById={binById} aisle={aisleFor} layout={props.layout} />
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={1.15} radius={0.75} />
          <Vignette eskil={false} offset={0.22} darkness={0.62} />
        </EffectComposer>
      </Canvas>

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto flex h-8 items-center rounded-lg border border-white/10 bg-[#0d1424]/80 p-0.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md">
          {(
            [
              ["overview", "Overview", Eye],
              ["top", "Floor plan", MapIcon],
              ["aisle", selected ? `Walk aisle ${aisleFor}` : "Walk the aisle", Footprints],
            ] as const
          ).map(([p, label, Icon]) => (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150",
                shot.preset === p ? "bg-white/10 text-fg-1" : "text-fg-3 hover:text-fg-1",
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => go("overview")}
          className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-[#0d1424]/80 px-2.5 text-[12px] font-medium text-fg-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md transition-colors hover:text-fg-1"
        >
          <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden /> Reset camera
        </button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 bg-gradient-to-t from-[#060a12]/85 to-transparent px-3 pt-10 pb-3 text-[11.5px]">
        <span className="inline-flex items-center gap-2 text-fg-3">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          WH-01 digital twin · {bins.length} bins · drag to orbit, scroll to zoom, right-drag to pan
        </span>
        {props.mode === "proposed" && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-[#22d3ee]/30 bg-[#22d3ee]/10 px-2 py-1 text-[#a5f3fc]">
            <span className="size-2.5 rounded-[2px] border border-[#67e8f9] bg-[#22d3ee]/40" aria-hidden />
            Proposed — not received
          </span>
        )}
      </div>

      {hover && hoverBin && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-lg border border-white/10 bg-[#0d1424]/95 px-3 py-2 shadow-[var(--shadow-pop)] backdrop-blur-md"
          style={{ left: hover.x + 16, top: hover.y + 16 }}
        >
          <div className="font-mono text-[12.5px] text-fg-1">{hoverBin.binCode}</div>
          {hoverCarton ? (
            <div className="text-[11.5px] leading-4 text-[#67e8f9]">
              Proposed — not received · {hoverCarton.sku} · +{hoverCarton.packs} packs
            </div>
          ) : (
            <div className="text-[11.5px] leading-4 text-fg-2">{hoverBin.status !== "active" ? "Inactive bin" : (hoverHeat?.label ?? "")}</div>
          )}
          <div className="mt-0.5 text-[11px] leading-4 text-fg-3">
            {STORAGE_LABEL[hoverBin.storageClass] ?? hoverBin.storageClass} · {hoverBin.used} of {hoverBin.capacityUnits} packs
          </div>
        </div>
      )}
    </div>
  );
}

function Lights() {
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(9.6, 0, 3.6);
    return o;
  }, []);
  return (
    <>
      <hemisphereLight args={["#cfe0ff", "#0b1020", 0.55]} />
      <ambientLight intensity={0.12} />
      <primitive object={target} />
      <directionalLight
        position={[22, 26, 16]}
        intensity={1.6}
        color="#f1f5ff"
        target={target}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={5}
        shadow-camera-far={70}
      />
      {/* Cool fill from the dock side and a teal rim from the back. */}
      <pointLight position={[-4, 4, 6]} intensity={18} distance={20} color="#bfdbfe" />
      <pointLight position={[10, 5, -5]} intensity={14} distance={22} color="#5eead4" />
    </>
  );
}

/** Camera shots: overview, floor plan, walk an aisle, fly to a bin; plus a short fly-in on first load. */
function CameraRig({ shot, binById, aisle, layout }: { shot: Shot; binById: Map<string, LayoutBin>; aisle: string; layout: WarehouseLayout }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const goal = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const height = useThree((s) => s.size.height);
  // The §11 position frames the warehouse in a 620 px canvas; a shorter canvas backs off along the same line.
  const home = useMemo(() => {
    const k = Math.max(1, 620 / Math.max(height, 1));
    return HOME.target.clone().add(HOME.position.clone().sub(HOME.target).multiplyScalar(k));
  }, [height]);

  // Fly in from high above on first load (unless a search already asked for a bin).
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || height <= 0) return;
    placed.current = true;
    camera.position.copy(HOME.target.clone().add(home.clone().sub(HOME.target).multiplyScalar(1.9)).add(new THREE.Vector3(-8, 10, 0)));
    if (!goal.current) goal.current = { position: home.clone(), target: HOME.target.clone() };
    invalidate();
  }, [camera, home, height, invalidate]);

  useEffect(() => {
    if (shot.nonce === 0) return;
    if (shot.preset === "overview") goal.current = { position: home.clone(), target: HOME.target.clone() };
    if (shot.preset === "top") {
      const t = HOME.target.clone().setY(0);
      goal.current = { position: t.clone().add(new THREE.Vector3(0, 34, 6)), target: t };
    }
    if (shot.preset === "aisle") {
      const inAisle = layout.bins.filter((b) => b.aisle === aisle);
      const x = (inAisle.reduce((s, b) => s + b.x, 0) / Math.max(inAisle.length, 1)) * S;
      goal.current = {
        position: new THREE.Vector3(x, 1.9, (layout.bounds.max.z + 5.5) * S),
        target: new THREE.Vector3(x, 1.2, layout.bounds.min.z * S),
      };
    }
    const bin = shot.binId ? binById.get(shot.binId) : undefined;
    if (shot.preset === "focus" && bin) {
      const target = toteCenter(bin).multiplyScalar(S);
      const side = bin.side === "L" ? -1 : 1;
      goal.current = { target, position: new THREE.Vector3(target.x + side * 9, target.y + 9, target.z + 11) };
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new shot (nonce) is the trigger
  }, [shot.nonce]);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!goal.current || !c) return;
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * 3.2);
    state.camera.position.lerp(goal.current.position, k);
    c.target.lerp(goal.current.target, k);
    c.update();
    if (state.camera.position.distanceTo(goal.current.position) < 0.02 && c.target.distanceTo(goal.current.target) < 0.02) goal.current = null;
    else invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={HOME.target}
      enableDamping={false}
      minDistance={3}
      maxDistance={70}
      maxPolarAngle={Math.PI / 2.08}
      onStart={() => (goal.current = null)}
    />
  );
}
