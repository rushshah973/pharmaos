// Warehouse geometry shared by the 2D grid, the 3D scene and the services.
// Bin codes are "<aisle>-<side>-<rack>-<shelf>", e.g. "C-L-03-2" (aisle C, left side, rack 3, shelf 2).

export type BinSide = "L" | "R";
export type BinAddress = { aisle: string; side: BinSide; rack: number; shelf: number };

const BIN_CODE = /^([A-Z])-([LR])-(\d{2})-(\d)$/;

export function parseBinCode(binCode: string): BinAddress | null {
  const m = BIN_CODE.exec(binCode);
  if (!m) return null;
  return { aisle: m[1], side: m[2] as BinSide, rack: Number(m[3]), shelf: Number(m[4]) };
}

export function formatBinCode({ aisle, side, rack, shelf }: BinAddress): string {
  return `${aisle}-${side}-${String(rack).padStart(2, "0")}-${shelf}`;
}

/** Plain-language location for labels: "Aisle C · left · rack 3 · shelf 2". */
export function describeBin(binCode: string): string {
  const a = parseBinCode(binCode);
  if (!a) return binCode;
  return `Aisle ${a.aisle} · ${a.side === "L" ? "left" : "right"} · rack ${a.rack} · shelf ${a.shelf}`;
}

export type Box = { x: number; y: number; z: number; width: number; depth: number; height: number };
export type Bounds = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
};

/**
 * Axis-aligned bounds of a set of bins. A bin's (x, y, z) is its centre on the floor plan (x across aisles,
 * z along racks) and the bottom of the shelf (y up); width runs along x, depth along z, height along y.
 */
export function boundingBox(boxes: Box[]): Bounds {
  if (boxes.length === 0) {
    const zero = { x: 0, y: 0, z: 0 };
    return { min: zero, max: zero, center: zero, size: zero };
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const b of boxes) {
    min.x = Math.min(min.x, b.x - b.width / 2);
    max.x = Math.max(max.x, b.x + b.width / 2);
    min.y = Math.min(min.y, b.y);
    max.y = Math.max(max.y, b.y + b.height);
    min.z = Math.min(min.z, b.z - b.depth / 2);
    max.z = Math.max(max.z, b.z + b.depth / 2);
  }
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  return { min, max, size, center: { x: min.x + size.x / 2, y: min.y + size.y / 2, z: min.z + size.z / 2 } };
}

