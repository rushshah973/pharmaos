"use client";

// What is on the racks and how risk is shown. ONE invisible InstancedMesh covers all 240 bins (click and hover);
// the stock is pallets with pharma and kraft cartons, as many as the bin's fill; at-risk bins get a tinted,
// glowing frame (bloom) in the mode colour, and their bay a glowing floor outline; proposed stock is staged
// as cyan glass pallets in the walkway in front of its bay ("Proposed — not received").
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BinHeat, HeatmapMode, Severity } from "@/lib/business-logic/heatmap";
import type { HeatmapView } from "@/lib/services/warehouse";
import { BAY, BAY_PITCH, type Bay, RACK_HEIGHT, type Slot, WALK, walkwayX } from "./layout3d";

/** Where the selected bin's label sits in the world: just above the slot, below the rack labels. */
export const labelAnchor = (s: Slot) => new THREE.Vector3(s.center.x, Math.min(s.center.y + 0.95, RACK_HEIGHT + 0.2), s.center.z);
import { type Inst, useInstances } from "./structure";
import { kraftCarton, pharmaCarton } from "./textures";

/** Bright, saturated tones for a lit scene (the legend uses the matching UI tokens). */
export const SCENE_TONE: Record<HeatmapMode, string> = { stockout: "#ef4444", expiry: "#f59e0b", excess: "#8b5cf6", normal: "#64748b", proposed: "#06b6d4" };
/** Tint strength of an at-risk bin (multiplies the mode colour; above 1 glows through bloom). */
const FILL: Record<Severity, number> = { 0: 0, 1: 0.8, 2: 1.2, 3: 1.7 };
const GLOW: Record<Severity, number> = { 0: 0, 1: 1.6, 2: 2.3, 3: 3.2 };
/** Normal mode shows fill through the stock itself; only nearly full bins get a frame. */
const showSeverity = (mode: HeatmapMode, s: Severity) => (mode === "normal" ? s >= 3 : s > 0);

const SLOT = { x: BAY.depth - 0.1, y: 0.95, z: BAY.length - 0.08 };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Big cartons packed straight onto the shelf: 3 across × 2 deep × up to 2 high, more the fuller the bin
 * (front row first, then the back row, then the second layer). Pharma cartons and kraft boxes are mixed.
 */
export function Loads({ slots, located }: { slots: Slot[]; /** Searched SKU's share of each bin's packs (0–1): that many front boxes glow teal. */ located?: Map<string, number> }) {
  const tex = useMemo(
    () => ({ red: pharmaCarton("#dc2626", "Paracetamol"), blue: pharmaCarton("#2563eb", "Amoxicillin"), kraft: kraftCarton(), found: pharmaCarton("#0d9488", "Searched SKU") }),
    [],
  );
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);

  const cartons = useMemo(() => {
    const out: [Inst[], Inst[], Inst[], Inst[]] = [[], [], [], []];
    const across = 3;
    const deep = 2;
    const pitchZ = (BAY.length - 0.1) / across;
    const pitchX = (BAY.depth - 0.12) / deep;
    for (const s of slots) {
      const b = s.bin;
      if (b.used <= 0 || b.status !== "active") continue;
      const fill = Math.min(1, b.used / b.capacityUnits);
      const h = hash(b.id);
      const boxH = 0.36 + ((h >>> 3) % 5) * 0.015;
      // Square-root curve: low fills still read as stocked shelves; fuller bins always show more boxes.
      let n = Math.max(1, Math.ceil(Math.sqrt(fill) * across * deep * 2));
      const share = located?.get(b.id);
      // The searched SKU's boxes: its share of the bin, at least one, front row first.
      let mine = share === undefined ? 0 : Math.max(1, Math.round(share * n));
      for (let layer = 0; layer < 2 && n > 0; layer++) {
        for (let row = 0; row < deep && n > 0; row++) {
          // Row 0 is the front, facing the walkway.
          const x = s.center.x + s.facing * (pitchX / 2) * (row === 0 ? 1 : -1);
          for (let k = 0; k < across && n > 0; k++, n--) {
            const i = layer * 6 + row * 3 + k;
            const z = s.center.z - (BAY.length - 0.1) / 2 + pitchZ * (k + 0.5);
            const jit = (((h >>> (i % 24)) & 7) - 3.5) * 0.006;
            const bucket = mine > 0 ? 3 : ((h >>> (i % 29)) + i) % 3;
            if (mine > 0) mine--;
            out[bucket].push({
              p: [x + jit, s.floorY + boxH / 2 + layer * (boxH + 0.01), z + jit],
              s: [pitchX - 0.03, boxH, pitchZ - 0.04],
              r: new THREE.Euler(0, jit * 2, 0),
            });
          }
        }
      }
    }
    return out;
  }, [slots, located]);

  return (
    <group>
      <Textured items={cartons[0]} map={tex.red} roughness={0.65} />
      <Textured items={cartons[1]} map={tex.blue} roughness={0.65} />
      <Textured items={cartons[2]} map={tex.kraft} roughness={0.85} />
      <Textured items={cartons[3]} map={tex.found} roughness={0.5} glow />
    </group>
  );
}

function Textured({ items, map, roughness, glow = false }: { items: Inst[]; map: THREE.Texture; roughness: number; glow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useInstances(ref, items);
  if (items.length === 0) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      <boxGeometry />
      <meshStandardMaterial
        map={map}
        roughness={roughness}
        metalness={0}
        emissive={glow ? "#2dd4bf" : "#000000"}
        emissiveIntensity={glow ? 0.9 : 0}
        toneMapped={!glow}
      />
    </instancedMesh>
  );
}

/** The ONE instanced mesh for all bins: invisible slot volumes that take clicks and hover. */
export function BinHitboxes({
  slots,
  onSelect,
  onHover,
}: {
  slots: Slot[];
  onSelect: (binId: string) => void;
  onHover: (index: number | null, x: number, y: number) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo<Inst[]>(() => slots.map((s) => ({ p: s.center.toArray() as THREE.Vector3Tuple, s: [SLOT.x, SLOT.y, SLOT.z] })), [slots]);
  useInstances(ref, items);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, slots.length]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 5 || e.instanceId === undefined) return; // a drag, not a click
        onSelect(slots[e.instanceId].bin.id);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) onHover(e.instanceId, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
      }}
      onPointerOut={() => onHover(null, 0, 0)}
    >
      <boxGeometry />
      <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} />
    </instancedMesh>
  );
}

/** Twelve thin bars along the edges of a box (centre, size). */
function edgeBars(c: THREE.Vector3, size: { x: number; y: number; z: number }, t: number): Inst[] {
  const out: Inst[] = [];
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push({ p: [c.x, c.y + sy * hy, c.z + sz * hz], s: [size.x + t, t, t] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push({ p: [c.x + sx * hx, c.y, c.z + sz * hz], s: [t, size.y + t, t] });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push({ p: [c.x + sx * hx, c.y + sy * hy, c.z], s: [t, t, size.z + t] });
  return out;
}

function GlowBars({ items, colors }: { items: Inst[]; colors: THREE.Color[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useInstances(ref, items);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    colors.forEach((c, i) => mesh.setColorAt(i, c));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [colors, invalidate]);
  if (items.length === 0) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} raycast={() => null}>
      <boxGeometry />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** At-risk bins: a solid glowing tint and frame; their rack: a full-height glowing frame and a glowing floor patch. */
export function HeatOverlay({
  slots,
  bays,
  heat,
  mode,
  clearFill,
}: {
  slots: Slot[];
  bays: Bay[];
  heat: Map<string, BinHeat>;
  mode: HeatmapMode;
  /** Bins that keep their frame but lose the tint (the located SKU's bins, so its teal boxes stay visible). */
  clearFill?: Set<string>;
}) {
  const fillRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const built = useMemo(() => {
    const tone = new THREE.Color(SCENE_TONE[mode]);
    const hot = slots.filter((s) => s.bin.status === "active" && showSeverity(mode, heat.get(s.bin.id)?.severity ?? 0));
    const fills: Inst[] = [];
    const fillColors: { c: THREE.Color; o: number }[] = [];
    const bars: Inst[] = [];
    const barColors: THREE.Color[] = [];
    for (const s of hot) {
      const sev = heat.get(s.bin.id)!.severity;
      if (!clearFill?.has(s.bin.id)) {
        fills.push({ p: s.center.toArray() as THREE.Vector3Tuple, s: [SLOT.x + 0.04, SLOT.y + 0.02, SLOT.z + 0.04] });
        fillColors.push({ c: tone.clone(), o: FILL[sev] });
      }
      for (const b of edgeBars(s.center, { x: SLOT.x + 0.06, y: SLOT.y + 0.04, z: SLOT.z + 0.06 }, sev === 3 ? 0.07 : 0.05)) {
        bars.push(b);
        barColors.push(tone.clone().multiplyScalar(GLOW[sev]));
      }
    }
    // Every bay with a highlighted bin: a glowing frame around the whole rack (floor to top) and a glowing
    // outline on the floor, so an at-risk rack reads from across the hall.
    const hotBays = new Set(hot.map((s) => s.bayKey));
    for (const bay of bays) {
      if (!hotBays.has(bay.key)) continue;
      const maxSev = Math.max(...bay.slots.map((s) => heat.get(s.bin.id)?.severity ?? 0)) as Severity;
      const glow = tone.clone().multiplyScalar(GLOW[maxSev]);
      const frameC = new THREE.Vector3(bay.x, (RACK_HEIGHT + 0.1) / 2, bay.z);
      for (const b of edgeBars(frameC, { x: BAY.depth + 0.3, y: RACK_HEIGHT + 0.1, z: BAY_PITCH + 0.05 }, maxSev === 3 ? 0.08 : 0.06)) {
        bars.push(b);
        barColors.push(glow.clone());
      }
      const w = BAY.depth + 0.9;
      const l = BAY_PITCH + 0.5;
      for (const [px, pz, sx, sz] of [
        [bay.x, bay.z - l / 2, w, 0.09],
        [bay.x, bay.z + l / 2, w, 0.09],
        [bay.x - w / 2, bay.z, 0.09, l],
        [bay.x + w / 2, bay.z, 0.09, l],
      ]) {
        bars.push({ p: [px, 0.014, pz], s: [sx, 0.014, sz] });
        barColors.push(glow.clone());
      }
    }
    return { fills, fillColors, bars, barColors, hotBays };
  }, [slots, bays, heat, mode, clearFill]);

  useInstances(fillRef, built.fills);
  useLayoutEffect(() => {
    const mesh = fillRef.current;
    if (!mesh) return;
    built.fillColors.forEach((f, i) => mesh.setColorAt(i, f.c.clone().multiplyScalar(f.o)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [built, invalidate]);

  return (
    <group>
      {built.fills.length > 0 && (
        <instancedMesh key={`f${built.fills.length}`} ref={fillRef} args={[undefined, undefined, built.fills.length]} renderOrder={2} raycast={() => null}>
          <boxGeometry />
          <meshBasicMaterial transparent opacity={0.45} depthWrite={false} toneMapped={false} />
        </instancedMesh>
      )}
      <GlowBars items={built.bars} colors={built.barColors} />
    </group>
  );
}

/** Proposed stock: cyan glass pallets staged on the walkway in front of their candidate bay. */
export function StagedProposed({ slots, placements, onSelect }: { slots: Slot[]; placements: HeatmapView["placements"]; onSelect: (binId: string) => void }) {
  const byId = useMemo(() => new Map(slots.map((s) => [s.bin.id, s])), [slots]);
  const items = useMemo(() => {
    const perBay = new Map<string, number>();
    return placements
      .filter((p) => p.binId && byId.has(p.binId))
      .map((p) => {
        const s = byId.get(p.binId!)!;
        const k = perBay.get(s.bayKey) ?? 0;
        perBay.set(s.bayKey, k + 1);
        const x = walkwayX(s.aisleIndex) - s.facing * (WALK / 2 - 0.85);
        return { p, s, pos: new THREE.Vector3(x, 0, s.center.z - 0.55 + (k % 2) * 1.1) };
      });
  }, [placements, byId]);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.95, 0.8, 0.95)), []);
  return (
    <group>
      {items.map(({ p, s, pos }) => (
        <group
          key={p.lineId}
          position={pos}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(s.bin.id);
          }}
        >
          <mesh position={[0, 0.065, 0]}>
            <boxGeometry args={[1.0, 0.13, 1.0]} />
            <meshStandardMaterial color="#67e8f9" transparent opacity={0.45} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.53, 0]} renderOrder={3}>
            <boxGeometry args={[0.95, 0.8, 0.95]} />
            <meshStandardMaterial color="#22d3ee" emissive="#06b6d4" emissiveIntensity={0.6} transparent opacity={0.32} depthWrite={false} toneMapped={false} />
          </mesh>
          <lineSegments geometry={edges} position={[0, 0.53, 0]}>
            <lineBasicMaterial color={new THREE.Color("#67e8f9").multiplyScalar(2.2)} toneMapped={false} />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

/** Hover frame (white) and selection: glowing teal frame and bay floor outline. The label is a DOM overlay (BinLabel). */
export function Selection({ slot, hover }: { slot: Slot | undefined; hover: Slot | undefined }) {
  const bars = useMemo(() => {
    const items: Inst[] = [];
    const colors: THREE.Color[] = [];
    if (hover && hover !== slot) {
      for (const b of edgeBars(hover.center, { x: SLOT.x + 0.08, y: SLOT.y + 0.06, z: SLOT.z + 0.08 }, 0.025)) {
        items.push(b);
        colors.push(new THREE.Color("#ffffff").multiplyScalar(1.4));
      }
    }
    if (slot) {
      for (const b of edgeBars(slot.center, { x: SLOT.x + 0.1, y: SLOT.y + 0.08, z: SLOT.z + 0.1 }, 0.05)) {
        items.push(b);
        colors.push(new THREE.Color("#2dd4bf").multiplyScalar(2.6));
      }
      const w = BAY.depth + 0.7;
      const l = BAY_PITCH + 0.5;
      for (const [px, pz, sx, sz] of [
        [slot.center.x, slot.center.z - l / 2, w, 0.09],
        [slot.center.x, slot.center.z + l / 2, w, 0.09],
        [slot.center.x - w / 2, slot.center.z, 0.09, l],
        [slot.center.x + w / 2, slot.center.z, 0.09, l],
      ]) {
        items.push({ p: [px, 0.014, pz], s: [sx, 0.014, sz] });
        colors.push(new THREE.Color("#2dd4bf").multiplyScalar(2.4));
      }
    }
    return { items, colors };
  }, [slot, hover]);

  return (
    <group>
      <GlowBars items={bars.items} colors={bars.colors} />
    </group>
  );
}
