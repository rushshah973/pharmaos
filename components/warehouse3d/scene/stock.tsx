"use client";

// What sits on the shelves: one open plastic tote per bin (ONE InstancedMesh, per-instance colour from the
// heatmap severity; high severities glow through bloom), kraft cartons inside each tote sized by the bin's fill,
// see-through cyan cartons for proposed stock, outlines for search matches and a light beam on the selected bin.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { BinHeat, HeatmapMode, Severity } from "@/lib/business-logic/heatmap";
import type { HeatmapView, LayoutBin } from "@/lib/services/warehouse";

export const TOTE = { w: 0.86, h: 0.34, d: 1.0 };
const TONE: Record<HeatmapMode, string> = { stockout: "#f87171", expiry: "#fbbf24", excess: "#a78bfa", normal: "#94a3b8", proposed: "#22d3ee" };
/** Brightness multipliers: values above 1 (with toneMapped off) cross the bloom threshold and glow. */
const GLOW: Record<HeatmapMode, Record<Severity, number>> = {
  stockout: { 0: 0, 1: 1.05, 2: 2.0, 3: 3.4 },
  expiry: { 0: 0, 1: 0.95, 2: 1.8, 3: 3.0 },
  excess: { 0: 0, 1: 1.0, 2: 1.9, 3: 3.0 },
  normal: { 0: 0, 1: 0.45, 2: 0.7, 3: 0.95 },
  proposed: { 0: 0, 1: 1.1, 2: 1.6, 3: 2.2 },
};
const BASE = new THREE.Color("#33446a");
const INACTIVE = new THREE.Color("#10172a");
const WHITE = new THREE.Color("#ffffff");

export const toteCenter = (b: LayoutBin) => new THREE.Vector3(b.x, b.y + 0.03 + TOTE.h / 2, b.z);

/** An open-top box (the top face removed), so the cartons inside are visible from above. */
function openToteGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(TOTE.w, TOTE.h, TOTE.d);
  const index = g.getIndex()!;
  const keep: number[] = [];
  g.groups.forEach((group, i) => {
    if (i === 2) return; // +y face
    for (let k = group.start; k < group.start + group.count; k++) keep.push(index.getX(k));
  });
  g.setIndex(keep);
  g.clearGroups();
  return g;
}

export function Totes({
  bins,
  heat,
  mode,
  hovered,
  onSelect,
  onHover,
}: {
  bins: LayoutBin[];
  heat: Map<string, BinHeat>;
  mode: HeatmapMode;
  hovered: number | null;
  onSelect: (binId: string) => void;
  onHover: (index: number | null, x: number, y: number) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => openToteGeometry(), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    bins.forEach((b, i) => mesh.setMatrixAt(i, m.makeTranslation(toteCenter(b))));
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
      const sev = heat.get(b.id)?.severity ?? 0;
      if (b.status !== "active") c.copy(INACTIVE);
      else if (sev === 0) c.copy(BASE);
      else c.copy(tone).multiplyScalar(GLOW[mode][sev]);
      if (i === hovered) c.lerp(WHITE, 0.28);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [bins, heat, mode, hovered, invalidate]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, undefined, bins.length]}
      castShadow
      receiveShadow
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 4 || e.instanceId === undefined) return; // a drag, not a click
        onSelect(bins[e.instanceId].id);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) onHover(e.instanceId, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
      }}
      onPointerOut={() => onHover(null, 0, 0)}
    >
      <meshStandardMaterial roughness={0.42} metalness={0.05} side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  );
}

/** Kraft cartons inside each tote: 1–3 boxes, taller and more of them the fuller the bin. Empty bins stay empty. */
export function Cartons({ bins }: { bins: LayoutBin[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const items = useMemo(() => {
    const out: { p: THREE.Vector3; s: THREE.Vector3; shade: number }[] = [];
    bins.forEach((b, bi) => {
      if (b.used <= 0 || b.status !== "active") return;
      const fill = Math.min(1, b.used / b.capacityUnits);
      const n = fill < 0.25 ? 1 : fill < 0.6 ? 2 : 3;
      const h = 0.1 + 0.3 * Math.min(1, fill * 1.4);
      const slot = (TOTE.d - 0.1) / 3;
      for (let k = 0; k < n; k++) {
        const z = b.z - (TOTE.d - 0.1) / 2 + slot * (k + 0.5);
        // Small, fixed per-carton variation so a shelf does not look cloned.
        const jitter = ((bi * 7 + k * 13) % 10) / 10;
        out.push({
          p: new THREE.Vector3(b.x + (jitter - 0.5) * 0.06, b.y + 0.05 + (h * (0.92 + jitter * 0.08)) / 2, z),
          s: new THREE.Vector3(TOTE.w - 0.18 - jitter * 0.06, h * (0.92 + jitter * 0.08), slot - 0.04),
          shade: 0.82 + jitter * 0.3,
        });
      }
    });
    return out;
  }, [bins]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const kraft = new THREE.Color("#a07d50");
    const c = new THREE.Color();
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, m.compose(it.p, q, it.s));
      mesh.setColorAt(i, c.copy(kraft).multiplyScalar(it.shade));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [items, invalidate]);

  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow raycast={() => null}>
      <boxGeometry />
      <meshStandardMaterial roughness={0.9} metalness={0} />
    </instancedMesh>
  );
}

/** Proposed stock: glowing see-through cartons standing on top of their candidate totes ("Proposed — not received"). */
export function ProposedCartons({
  cartons,
  binById,
  onHover,
  onSelect,
}: {
  cartons: HeatmapView["placements"];
  binById: Map<string, LayoutBin>;
  onHover: (index: number | null, x: number, y: number) => void;
  onSelect: (binId: string) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.66, 0.3, 0.8)), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    cartons.forEach((p, i) => {
      const b = binById.get(p.binId!)!;
      mesh.setMatrixAt(i, m.makeTranslation(b.x, b.y + 0.03 + TOTE.h + 0.17, b.z));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [cartons, binById, invalidate]);
  return (
    <group>
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
          if (e.instanceId !== undefined) onHover(e.instanceId, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        }}
        onPointerOut={() => onHover(null, 0, 0)}
      >
        <boxGeometry args={[0.66, 0.3, 0.8]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.9} transparent opacity={0.38} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {cartons.map((p) => {
        const b = binById.get(p.binId!)!;
        return (
          <lineSegments key={p.lineId} geometry={edges} position={[b.x, b.y + 0.03 + TOTE.h + 0.17, b.z]}>
            <lineBasicMaterial color="#67e8f9" transparent opacity={0.9} toneMapped={false} />
          </lineSegments>
        );
      })}
    </group>
  );
}

/** Teal outlines on search matches and a white one on the selection, drawn through other bins (depthTest off). */
export function Markers({ bins, matchBinIds, selectedBinId }: { bins: LayoutBin[]; matchBinIds: Set<string>; selectedBinId: string | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(TOTE.w + 0.1, TOTE.h + 0.1, TOTE.d + 0.1)), []);
  const marked = bins.filter((b) => matchBinIds.has(b.id) || b.id === selectedBinId);
  useEffect(() => invalidate(), [marked.length, selectedBinId, invalidate]);
  return (
    <>
      {marked.map((b) => (
        <lineSegments key={b.id} geometry={edges} position={toteCenter(b)} renderOrder={3}>
          <lineBasicMaterial color={b.id === selectedBinId ? "#f8fafc" : "#2dd4bf"} depthTest={false} transparent toneMapped={false} />
        </lineSegments>
      ))}
    </>
  );
}

/** A soft column of light rising from the selected bin, a glowing ring on its shelf, and its label. */
export function Selection({ bin, heat }: { bin: LayoutBin; heat: BinHeat | undefined }) {
  const p = toteCenter(bin);
  const beam = useMemo(() => {
    // Vertical gradient (bright at the bin, fading upwards) baked into vertex colours.
    const g = new THREE.CylinderGeometry(0.42, 0.5, 4, 32, 8, true);
    const colors: number[] = [];
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + 2) / 4; // 0 at the bottom, 1 at the top
      const a = Math.pow(1 - t, 1.6);
      colors.push(0.18 * a, 0.83 * a, 0.75 * a);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={beam} position={[p.x, p.y + 2 + TOTE.h / 2, p.z]} renderOrder={4} raycast={() => null}>
        <meshBasicMaterial vertexColors transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[p.x, bin.y + 0.035, p.z]} rotation-x={-Math.PI / 2} renderOrder={4} raycast={() => null}>
        <ringGeometry args={[0.55, 0.66, 48]} />
        <meshBasicMaterial color="#5eead4" transparent opacity={0.9} toneMapped={false} depthWrite={false} />
      </mesh>
      <Html position={[p.x, p.y + 0.62, p.z]} center zIndexRange={[20, 0]} pointerEvents="none">
        <div className="rounded-lg border border-brand/40 bg-surface-2/95 px-2.5 py-1.5 text-center whitespace-nowrap shadow-[0_8px_24px_rgba(0,0,0,0.5),0_0_0_1px_rgba(45,212,191,0.15)] backdrop-blur">
          <div className="font-mono text-[12.5px] font-medium text-fg-1">{bin.binCode}</div>
          {heat && <div className="text-[11px] leading-4 text-fg-2">{bin.status !== "active" ? "Inactive bin" : heat.label}</div>}
        </div>
      </Html>
    </group>
  );
}
