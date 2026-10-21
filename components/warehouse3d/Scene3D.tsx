"use client";

// 3D warehouse (§11): one InstancedMesh for all 240 bins (shared geometry and material, per-instance colour from
// the heatmap severity), rack frames as one line geometry, aisle labels drawn on the floor from a canvas (no external
// textures or fonts), proposed stock as a second instanced mesh of see-through cartons, OrbitControls with a reset,
// and an Html label for the selected bin only. frameloop="demand": nothing renders unless something changed.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { RotateCcw } from "lucide-react";
import type { BinHeat, HeatmapMode, Severity } from "@/lib/business-logic/heatmap";
import type { HeatmapView, LayoutBin, WarehouseLayout } from "@/lib/services/warehouse";
import { STORAGE_LABEL } from "./modes";

/** The layout is ~19 × 7 m; the world is drawn 1.2× so it fills the frame from the §11 camera position. */
const WORLD_SCALE = 1.2;
const HOME = { position: new THREE.Vector3(24, 18, 24), target: new THREE.Vector3(8 * WORLD_SCALE, 0.4, 3 * WORLD_SCALE) };
/** Hex tones for the 3D materials (the same colours as the CSS tokens). */
const TONE: Record<HeatmapMode, string> = { stockout: "#f87171", expiry: "#fbbf24", excess: "#a78bfa", normal: "#94a3b8", proposed: "#22d3ee" };
const BASE = new THREE.Color("#25324f");
const INACTIVE = new THREE.Color("#0f1626");
const MIX: Record<Severity, number> = { 0: 0, 1: 0.38, 2: 0.68, 3: 1 };
const BIN_SIZE = { w: 0.86, h: 0.5, d: 0.9 };

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

export default function Scene3D(props: Scene3DProps) {
  const [hover, setHover] = useState<Hover>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const bins = props.layout.bins;
  const cartons = useMemo(() => props.placements.filter((p) => p.binId), [props.placements]);
  const binById = useMemo(() => new Map(bins.map((b) => [b.id, b])), [bins]);

  const hoverBin = hover?.kind === "bin" ? bins[hover.index] : hover?.kind === "carton" ? binById.get(cartons[hover.index]?.binId ?? "") : undefined;
  const hoverHeat = hoverBin ? props.heat.get(hoverBin.id) : undefined;
  const hoverCarton = hover?.kind === "carton" ? cartons[hover.index] : undefined;

  return (
    <div className="relative h-[620px] overflow-hidden rounded-lg border border-border bg-[#080d19] max-xl:h-[520px]" onPointerLeave={() => setHover(null)}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: [24, 18, 24], fov: 45, near: 0.5, far: 200 }}
        gl={{ antialias: true }}
        onPointerMissed={() => setHover(null)}
      >
        <color attach="background" args={["#080d19"]} />
        <fog attach="fog" args={["#080d19", 38, 80]} />
        <ambientLight intensity={0.55} />
        <hemisphereLight args={["#bcd3ff", "#0a1020", 0.45]} />
        <directionalLight position={[14, 22, 10]} intensity={1.1} />
        <group scale={WORLD_SCALE}>
          <Floor layout={props.layout} />
          <RackFrames bins={bins} />
          <Bins {...props} onHover={setHover} />
          {props.mode === "proposed" && cartons.length > 0 && <Cartons cartons={cartons} binById={binById} onHover={setHover} onSelect={props.onSelect} />}
          <Markers bins={bins} matchBinIds={props.matchBinIds} selectedBinId={props.selectedBinId} />
          {props.selectedBinId && binById.get(props.selectedBinId) && <SelectedLabel bin={binById.get(props.selectedBinId)!} heat={props.heat.get(props.selectedBinId)} />}
        </group>
        <CameraRig focus={props.focus} binById={binById} resetNonce={resetNonce} />
      </Canvas>

      <button
        type="button"
        onClick={() => setResetNonce((n) => n + 1)}
        className="absolute top-3 right-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-2/90 px-2.5 text-[12.5px] font-medium text-fg-2 backdrop-blur transition-colors hover:text-fg-1"
      >
        <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden /> Reset camera
      </button>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-2/85 px-2.5 py-1.5 text-[11.5px] text-fg-3 backdrop-blur">
        <span>Drag to orbit · scroll to zoom · right-drag to pan</span>
        {props.mode === "proposed" && (
          <span className="inline-flex items-center gap-1.5 text-fg-2">
            <span className="size-2.5 rounded-[2px] border border-dashed border-[#22d3ee] bg-[#22d3ee]/30" aria-hidden />
            Cyan cartons: Proposed — not received
          </span>
        )}
      </div>

      {hover && hoverBin && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-border-strong bg-surface-2 px-2.5 py-1.5 shadow-[var(--shadow-pop)]"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="font-mono text-[12px] text-fg-1">{hoverBin.binCode}</div>
          {hoverCarton ? (
            <div className="text-[11.5px] leading-4 text-[#67e8f9]">
              Proposed — not received · {hoverCarton.sku} · +{hoverCarton.packs} packs
            </div>
          ) : (
            <div className="text-[11.5px] leading-4 text-fg-2">{hoverBin.status !== "active" ? "Inactive bin" : (hoverHeat?.label ?? "")}</div>
          )}
          <div className="text-[11px] leading-4 text-fg-3">{STORAGE_LABEL[hoverBin.storageClass] ?? hoverBin.storageClass}</div>
        </div>
      )}
    </div>
  );
}

/** Bin centre in world space (layout x/z are the floor position, y the shelf bottom). */
const binCenter = (b: LayoutBin) => new THREE.Vector3(b.x, b.y + BIN_SIZE.h / 2 + 0.05, b.z);

function Bins({
  layout,
  heat,
  mode,
  onSelect,
  onHover,
}: Scene3DProps & { onHover: (h: Hover) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const bins = layout.bins;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    bins.forEach((b, i) => mesh.setMatrixAt(i, m.makeTranslation(binCenter(b))));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [bins, invalidate]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const tone = new THREE.Color(TONE[mode]);
    const c = new THREE.Color();
    bins.forEach((b, i) => {
      if (b.status !== "active") c.copy(INACTIVE);
      else c.copy(BASE).lerp(tone, MIX[heat.get(b.id)?.severity ?? 0]);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [bins, heat, mode, invalidate]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, bins.length]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 4 || e.instanceId === undefined) return; // a drag, not a click
        onSelect(bins[e.instanceId].id);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) onHover({ kind: "bin", index: e.instanceId, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
      }}
      onPointerOut={() => onHover(null)}
    >
      <boxGeometry args={[BIN_SIZE.w, BIN_SIZE.h, BIN_SIZE.d]} />
      <meshStandardMaterial roughness={0.55} metalness={0.05} toneMapped={false} />
    </instancedMesh>
  );
}

function Cartons({
  cartons,
  binById,
  onHover,
  onSelect,
}: {
  cartons: HeatmapView["placements"];
  binById: Map<string, LayoutBin>;
  onHover: (h: Hover) => void;
  onSelect: (binId: string) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    cartons.forEach((p, i) => {
      const b = binById.get(p.binId!)!;
      // Sits on the bin's front half, standing a little proud of it, so it reads as stock not yet put away.
      mesh.setMatrixAt(i, m.makeTranslation(b.x, b.y + 0.05 + 0.2, b.z + 0.18));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [cartons, binById, invalidate]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, cartons.length]}
      renderOrder={2}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 4 || e.instanceId === undefined) return;
        onSelect(cartons[e.instanceId].binId!);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) onHover({ kind: "carton", index: e.instanceId, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
      }}
      onPointerOut={() => onHover(null)}
    >
      <boxGeometry args={[0.62, 0.4, 0.7]} />
      <meshStandardMaterial color="#22d3ee" emissive="#0e7490" emissiveIntensity={0.6} transparent opacity={0.42} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}

/** Teal edges on search matches, white edges on the selected bin (drawn through other bins). A handful, so plain line segments. */
function Markers({ bins, matchBinIds, selectedBinId }: { bins: LayoutBin[]; matchBinIds: Set<string>; selectedBinId: string | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(BIN_SIZE.w + 0.08, BIN_SIZE.h + 0.08, BIN_SIZE.d + 0.08)), []);
  const marked = bins.filter((b) => matchBinIds.has(b.id) || b.id === selectedBinId);
  useEffect(() => invalidate(), [marked.length, selectedBinId, invalidate]);
  return (
    <>
      {marked.map((b) => (
        // depthTest off: the outline shows through the bins in front, so a searched bin is never hidden.
        <lineSegments key={b.id} geometry={edges} position={binCenter(b)} renderOrder={3}>
          <lineBasicMaterial color={b.id === selectedBinId ? "#e6edf7" : "#2dd4bf"} depthTest={false} transparent toneMapped={false} />
        </lineSegments>
      ))}
    </>
  );
}

function SelectedLabel({ bin, heat }: { bin: LayoutBin; heat: BinHeat | undefined }) {
  const p = binCenter(bin);
  return (
    <Html position={[p.x, p.y + 0.55, p.z]} center zIndexRange={[20, 0]} pointerEvents="none">
      <div className="rounded-md border border-border-strong bg-surface-2/95 px-2 py-1 text-center whitespace-nowrap shadow-[var(--shadow-pop)]">
        <div className="font-mono text-[12px] text-fg-1">{bin.binCode}</div>
        {heat && <div className="text-[11px] text-fg-2">{heat.label}</div>}
      </div>
    </Html>
  );
}

/** Uprights at every rack edge and a rail under every shelf, for both sides of every aisle: one geometry. */
function RackFrames({ bins }: { bins: LayoutBin[] }) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    const seg = (a: THREE.Vector3Tuple, b: THREE.Vector3Tuple) => pts.push(...a, ...b);
    const groups = new Map<string, LayoutBin[]>();
    for (const b of bins) groups.set(`${b.aisle}${b.side}`, [...(groups.get(`${b.aisle}${b.side}`) ?? []), b]);
    for (const g of groups.values()) {
      const x0 = g[0].x - 0.5;
      const x1 = g[0].x + 0.5;
      const zs = [...new Set(g.map((b) => b.z))].sort((a, b) => a - b);
      const top = Math.max(...g.map((b) => b.y + b.height)) + 0.05;
      const zMin = zs[0] - 0.6;
      const zMax = zs[zs.length - 1] + 0.6;
      // Uprights between racks.
      for (const z of [zMin, ...zs.slice(1).map((z) => z - 0.6), zMax]) {
        seg([x0, 0, z], [x0, top, z]);
        seg([x1, 0, z], [x1, top, z]);
      }
      // Shelf rails.
      for (const y of [...new Set(g.map((b) => b.y))].map((y) => y + 0.04).concat(top)) {
        seg([x0, y, zMin], [x0, y, zMax]);
        seg([x1, y, zMin], [x1, y, zMax]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }, [bins]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#33456a" transparent opacity={0.8} />
    </lineSegments>
  );
}

/** Floor with a faint grid and an aisle label (drawn on a canvas) in front of each aisle. */
function Floor({ layout }: { layout: WarehouseLayout }) {
  const { bounds, bins } = layout;
  const labels = useMemo(() => {
    return layout.aisles.map((aisle) => {
      const inAisle = bins.filter((b) => b.aisle === aisle);
      const x = inAisle.reduce((s, b) => s + b.x, 0) / inAisle.length;
      const classes = [...new Set(inAisle.map((b) => b.storageClass))].map((c) => (c === "cold_chain" ? "COLD CHAIN" : c.toUpperCase()));
      return { aisle, x, texture: labelTexture(aisle, classes.join(" · ")) };
    });
  }, [layout.aisles, bins]);
  useEffect(() => () => labels.forEach((l) => l.texture.dispose()), [labels]);

  const w = bounds.size.x + 10;
  const d = bounds.size.z + 10;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[bounds.center.x, -0.01, bounds.center.z]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#0b1222" roughness={0.95} />
      </mesh>
      <gridHelper args={[Math.max(w, d), Math.round(Math.max(w, d)), "#1c2740", "#121b2f"]} position={[bounds.center.x, 0, bounds.center.z]} />
      {labels.map((l) => (
        <mesh key={l.aisle} rotation-x={-Math.PI / 2} position={[l.x, 0.01, bounds.max.z + 1.4]}>
          <planeGeometry args={[2.4, 1.2]} />
          <meshBasicMaterial map={l.texture} transparent toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function labelTexture(aisle: string, sub: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.fillStyle = "#e6edf7";
  ctx.font = "600 120px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`Aisle ${aisle}`, 256, 140);
  ctx.fillStyle = "#5b6b85";
  ctx.font = "500 40px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(sub, 256, 210);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Smooth camera fly-to (search) and reset. Renders only while moving (frameloop="demand"). */
function CameraRig({ focus, binById, resetNonce }: { focus: Scene3DProps["focus"]; binById: Map<string, LayoutBin>; resetNonce: number }) {
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
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || height <= 0) return;
    placed.current = true;
    camera.position.copy(home);
    invalidate();
  }, [camera, home, height, invalidate]);

  useEffect(() => {
    if (!focus) return;
    const b = binById.get(focus.binId);
    if (!b) return;
    const target = binCenter(b).multiplyScalar(WORLD_SCALE);
    // Look at the bin from the aisle side it faces, a little above and in front.
    const side = b.side === "L" ? -1 : 1;
    goal.current = { target, position: new THREE.Vector3(target.x + side * 9, target.y + 9, target.z + 11) };
    invalidate();
  }, [focus, binById, invalidate]);

  useEffect(() => {
    if (resetNonce === 0) return;
    goal.current = { position: home.clone(), target: HOME.target.clone() };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a reset click
  }, [resetNonce]);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!goal.current || !c) return;
    const k = 1 - Math.exp(-dt * 5);
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
      minDistance={5}
      maxDistance={70}
      maxPolarAngle={Math.PI / 2.1}
      onStart={() => (goal.current = null)}
    />
  );
}
