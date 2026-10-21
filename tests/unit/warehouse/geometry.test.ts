// Warehouse geometry helpers.
import { describe, expect, it } from "vitest";
import { boundingBox, describeBin, formatBinCode, parseBinCode } from "@/lib/warehouse/geometry";

describe("bin codes", () => {
  it("parse into aisle, side, rack and shelf, and format back", () => {
    expect(parseBinCode("C-L-03-2")).toEqual({ aisle: "C", side: "L", rack: 3, shelf: 2 });
    expect(formatBinCode({ aisle: "E", side: "R", rack: 6, shelf: 4 })).toBe("E-R-06-4");
    expect(describeBin("C-L-03-2")).toBe("Aisle C · left · rack 3 · shelf 2");
  });

  it("rejects anything else", () => {
    expect(parseBinCode("C-X-03-2")).toBeNull();
    expect(parseBinCode("C-L-3-2")).toBeNull();
    expect(describeBin("DOCK")).toBe("DOCK");
  });
});

describe("boundingBox", () => {
  it("covers every bin's full extent", () => {
    const b = boundingBox([
      { x: -1, y: 0, z: 0, width: 1, depth: 1, height: 0.6 },
      { x: 17, y: 2.1, z: 6, width: 1, depth: 1, height: 0.6 },
    ]);
    expect(b.min).toEqual({ x: -1.5, y: 0, z: -0.5 });
    expect(b.max.x).toBe(17.5);
    expect(b.max.y).toBeCloseTo(2.7, 10);
    expect(b.max.z).toBe(6.5);
    expect(b.center.x).toBe(8);
  });

  it("is all zero for no bins", () => {
    expect(boundingBox([]).size).toEqual({ x: 0, y: 0, z: 0 });
  });
});
