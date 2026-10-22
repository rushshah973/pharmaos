// View geometry for the 3D twin: real pallet-rack proportions derived from each bin's address (aisle, side,
// rack, shelf). The database layout stays the source of truth for which bin is where; only the drawing scale
// changes, so racks get 2 m bays, 1 m levels and 3.4 m walkways like a real hall.
import * as THREE from "three";
import type { LayoutBin } from "@/lib/services/warehouse";

export const BAY = { length: 2.0, depth: 1.1, level: 1.05, post: 0.09, beam: 0.12 };
export const BAY_PITCH = BAY.length + 0.2;
export const WALK = 3.4;
const BACK_GAP = 0.3;
export const AISLE_PITCH = WALK + 2 * BAY.depth + BACK_GAP;
export const LEVELS = 4;
export const RACK_HEIGHT = LEVELS * BAY.level + 0.25;

export const walkwayX = (aisleIndex: number) => aisleIndex * AISLE_PITCH;
export const columnX = (aisleIndex: number, side: "L" | "R") => walkwayX(aisleIndex) + (side === "L" ? -1 : 1) * (WALK / 2 + BAY.depth / 2);
export const bayZ = (rack: number) => (rack - 1) * BAY_PITCH;
export const levelY = (shelf: number) => (shelf - 1) * BAY.level;
/** Top of the shelf deck a bin's stock stands on (shelf 1 sits just above the floor). */
export const shelfDeckY = (shelf: number) => (shelf === 1 ? 0.14 : levelY(shelf) + 0.05);

export type Slot = {
  bin: LayoutBin;
  index: number;
  aisleIndex: number;
  /** Centre of the slot volume. */
  center: THREE.Vector3;
  /** Floor of the slot (top of the beam, or the floor for shelf 1). */
  floorY: number;
  /** Which way the slot opens onto its walkway (+1 = +x). */
  facing: 1 | -1;
  bayKey: string;
};

export function buildSlots(bins: LayoutBin[], aisles: string[]): Slot[] {
  return bins.map((bin, index) => {
    const aisleIndex = Math.max(0, aisles.indexOf(bin.aisle));
    const x = columnX(aisleIndex, bin.side);
    const floorY = shelfDeckY(bin.shelf) + 0.015;
    return {
      bin,
      index,
      aisleIndex,
      center: new THREE.Vector3(x, floorY + 0.47, bayZ(bin.rackNumber)),
      floorY,
      facing: bin.side === "L" ? 1 : -1,
      bayKey: `${bin.aisle}-${bin.side}-${String(bin.rackNumber).padStart(2, "0")}`,
    };
  });
}

export type Bay = { key: string; aisle: string; aisleIndex: number; side: "L" | "R"; rack: number; x: number; z: number; slots: Slot[] };

export function buildBays(slots: Slot[]): Bay[] {
  const map = new Map<string, Bay>();
  for (const s of slots) {
    let b = map.get(s.bayKey);
    if (!b) {
      b = { key: s.bayKey, aisle: s.bin.aisle, aisleIndex: s.aisleIndex, side: s.bin.side, rack: s.bin.rackNumber, x: s.center.x, z: s.center.z, slots: [] };
      map.set(s.bayKey, b);
    }
    b.slots.push(s);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Rack footprint and hall extents (metres in the view). */
export function hallBounds(aisleCount: number, racks: number) {
  const rx0 = columnX(0, "L") - BAY.depth / 2;
  const rx1 = columnX(aisleCount - 1, "R") + BAY.depth / 2;
  const rz0 = bayZ(1) - BAY_PITCH / 2;
  const rz1 = bayZ(racks) + BAY_PITCH / 2;
  return {
    racks: { x0: rx0, x1: rx1, z0: rz0, z1: rz1 },
    hall: { x0: rx0 - 6, x1: rx1 + 6, z0: rz0 - 11, z1: rz1 + 8 },
    center: new THREE.Vector3((rx0 + rx1) / 2, 0, (rz0 + rz1) / 2),
  };
}
