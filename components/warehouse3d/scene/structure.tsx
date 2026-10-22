"use client";

// The hall and the racking, all procedural: blue-and-orange pallet racking with frame bracing, base plates and
// column guards; a bright epoxy floor with painted safety lines; walls with dock doors; high-bay lights; hanging
// aisle signs; a glass cold room; receiving and dispatch zones with staged pallets and a forklift.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import * as THREE from "three";
import { BAY, BAY_PITCH, type Bay, LEVELS, RACK_HEIGHT, WALK, bayZ, columnX, hallBounds, levelY, walkwayX } from "./layout3d";
import { aisleSign, chip, dockDoor, epoxyFloor, floorText, kraftCarton, palletWood } from "./textures";

export type Inst = { p: THREE.Vector3Tuple; s: THREE.Vector3Tuple; r?: THREE.Euler };

/** Fills an instanced mesh from position / scale / rotation triples. */
export function useInstances(ref: React.RefObject<THREE.InstancedMesh | null>, items: Inst[]) {
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    items.forEach((it, i) => {
      q.setFromEuler(it.r ?? new THREE.Euler());
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...it.p), q, new THREE.Vector3(...it.s)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [ref, items, invalidate]);
}

function Instanced({
  items,
  color,
  metalness = 0.4,
  roughness = 0.5,
  castShadow = true,
  emissive,
  emissiveIntensity,
}: {
  items: Inst[];
  color: string;
  metalness?: number;
  roughness?: number;
  castShadow?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useInstances(ref, items);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow={castShadow} receiveShadow>
      <boxGeometry />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} emissive={emissive ?? "#000000"} emissiveIntensity={emissiveIntensity ?? 0} />
    </instancedMesh>
  );
}

/** Blue uprights, orange beams, frame bracing, base plates and yellow column guards. */
export function Racks({ aisleCount, racks }: { aisleCount: number; racks: number }) {
  const parts = useMemo(() => {
    const uprights: Inst[] = [];
    const beams: Inst[] = [];
    const braces: Inst[] = [];
    const plates: Inst[] = [];
    const guards: Inst[] = [];
    const halfD = BAY.depth / 2 - BAY.post / 2;
    for (let a = 0; a < aisleCount; a++) {
      for (const side of ["L", "R"] as const) {
        const x = columnX(a, side);
        const frames = Array.from({ length: racks + 1 }, (_, i) => bayZ(1) - BAY_PITCH / 2 + i * BAY_PITCH);
        frames.forEach((z, fi) => {
          for (const dx of [-halfD, halfD]) {
            uprights.push({ p: [x + dx, RACK_HEIGHT / 2, z], s: [BAY.post, RACK_HEIGHT, BAY.post * 0.75] });
            plates.push({ p: [x + dx, 0.01, z], s: [0.16, 0.02, 0.16] });
          }
          // Zig-zag bracing in the frame plane (x-y), between the two uprights.
          const span = halfD * 2;
          const step = 0.85;
          for (let y = 0.25, k = 0; y + step < RACK_HEIGHT - 0.1; y += step, k++) {
            const len = Math.hypot(span, step);
            const ang = Math.atan2(step, span) * (k % 2 ? -1 : 1);
            braces.push({ p: [x, y + step / 2, z], s: [len, 0.035, 0.035], r: new THREE.Euler(0, 0, ang) });
          }
          // Column guards on the walkway-facing upright at both aisle ends.
          if (fi === 0 || fi === frames.length - 1) {
            const dx = side === "L" ? halfD : -halfD;
            guards.push({ p: [x + dx + (side === "L" ? 0.06 : -0.06), 0.3, z], s: [0.12, 0.6, 0.2] });
          }
        });
        for (let r = 1; r <= racks; r++) {
          const z = bayZ(r);
          for (let s = 2; s <= LEVELS + 1; s++) {
            const y = s <= LEVELS ? levelY(s) : RACK_HEIGHT - 0.12;
            for (const dx of [-halfD, halfD]) beams.push({ p: [x + dx, y, z], s: [0.05, BAY.beam, BAY_PITCH - BAY.post] });
          }
        }
      }
    }
    return { uprights, beams, braces, plates, guards };
  }, [aisleCount, racks]);

  return (
    <group>
      <Instanced items={parts.uprights} color="#1e4fa8" metalness={0.45} roughness={0.38} />
      <Instanced items={parts.beams} color="#f07a1a" metalness={0.35} roughness={0.42} />
      <Instanced items={parts.braces} color="#2a5cb8" metalness={0.45} roughness={0.4} castShadow={false} />
      <Instanced items={parts.plates} color="#334155" metalness={0.6} roughness={0.4} castShadow={false} />
      <Instanced items={parts.guards} color="#facc15" metalness={0.2} roughness={0.5} />
    </group>
  );
}

/** White label chips above every rack bay; hot bays are larger and tinted with the mode colour. */
export function RackLabels({ bays, hot, tone }: { bays: Bay[]; hot: Set<string>; tone: string }) {
  const textures = useMemo(() => new Map(bays.map((b) => [b.key, chip(b.key)])), [bays]);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [hot, tone, invalidate]);
  return (
    <group>
      {bays.map((b) => (
        <sprite key={b.key} position={[b.x, RACK_HEIGHT + 0.75, b.z]} scale={hot.has(b.key) ? [1.15, 0.43, 1] : [0.95, 0.36, 1]} raycast={() => null}>
          <spriteMaterial map={textures.get(b.key)} color={hot.has(b.key) ? tone : "#ffffff"} toneMapped={false} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

/** Hanging signs over the entrance of each walkway. */
export function AisleSigns({ aisles, subs, z }: { aisles: string[]; subs: string[]; z: number }) {
  const textures = useMemo(() => aisles.map((a, i) => aisleSign(a, subs[i] ?? "")), [aisles, subs]);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  return (
    <group>
      {aisles.map((a, i) => (
        <group key={a} position={[walkwayX(i), RACK_HEIGHT + 1.35, z]}>
          {[-0.9, 0.9].map((dx) => (
            <mesh key={dx} position={[dx, 1.2, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 2.4]} />
              <meshStandardMaterial color="#6b7280" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
          <mesh castShadow>
            <boxGeometry args={[2.3, 1.15, 0.06]} />
            <meshStandardMaterial color="#0f2a5c" metalness={0.3} roughness={0.5} />
          </mesh>
          {[0.031, -0.031].map((dz) => (
            <mesh key={dz} position={[0, 0, dz]} rotation-y={dz < 0 ? Math.PI : 0}>
              <planeGeometry args={[2.25, 1.1]} />
              <meshBasicMaterial map={textures[i]} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** The hall: epoxy floor with reflections and safety markings, walls, dock doors, columns and high-bay lights. */
export function Hall({ aisleCount, racks, aisles }: { aisleCount: number; racks: number; aisles: string[] }) {
  const { hall, racks: rk } = useMemo(() => hallBounds(aisleCount, racks), [aisleCount, racks]);
  const w = hall.x1 - hall.x0;
  const d = hall.z1 - hall.z0;
  const cx = (hall.x0 + hall.x1) / 2;
  const cz = (hall.z0 + hall.z1) / 2;
  const wallH = 9;

  const tex = useMemo(() => {
    const floor = epoxyFloor();
    floor.repeat.set(w / 4, d / 4);
    return {
      floor,
      doors: [1, 2, 3, 4].map((n) => dockDoor(n)),
      letters: aisles.map((a) => floorText(a)),
      receiving: floorText("RECEIVING", "INBOUND · QC HOLD"),
      dispatch: floorText("DISPATCH", "OUTBOUND · STAGING"),
    };
  }, [w, d, aisles]);
  useEffect(
    () => () => {
      tex.floor.dispose();
      tex.doors.forEach((t) => t.dispose());
      tex.letters.forEach((t) => t.dispose());
      tex.receiving.dispose();
      tex.dispatch.dispose();
    },
    [tex],
  );

  const zone = { z0: hall.z0 + 1.6, z1: rk.z0 - 4.6 };
  const markings = useMemo(() => {
    const out: Inst[] = [];
    const y = 0.004;
    const lineW = 0.1;
    const frontZ = rk.z1 + 0.4;
    for (let a = 0; a < aisleCount; a++) {
      // Walkway edge lines and a zebra crossing at the walkway entrance.
      for (const dx of [-(WALK / 2 - 0.15), WALK / 2 - 0.15]) out.push({ p: [walkwayX(a) + dx, y, (rk.z0 + frontZ) / 2], s: [lineW, 0.004, frontZ - rk.z0] });
      for (let k = 0; k < 6; k++) out.push({ p: [walkwayX(a) - 1.25 + k * 0.5, y, frontZ + 1.6], s: [0.26, 0.004, 1.6] });
    }
    for (const z of [frontZ, frontZ + 3.2, rk.z0 - 0.6, rk.z0 - 3.8]) out.push({ p: [cx, y, z], s: [w - 3, 0.004, lineW] });
    for (const [x0, x1] of [
      [hall.x0 + 1.5, cx - 1.2],
      [cx + 1.2, hall.x1 - 1.5],
    ]) {
      out.push({ p: [(x0 + x1) / 2, y, zone.z0], s: [x1 - x0, 0.004, lineW] }, { p: [(x0 + x1) / 2, y, zone.z1], s: [x1 - x0, 0.004, lineW] });
      out.push({ p: [x0, y, (zone.z0 + zone.z1) / 2], s: [lineW, 0.004, zone.z1 - zone.z0] }, { p: [x1, y, (zone.z0 + zone.z1) / 2], s: [lineW, 0.004, zone.z1 - zone.z0] });
    }
    return out;
  }, [aisleCount, rk, hall, cx, w, zone.z0, zone.z1]);

  const columns = useMemo(() => {
    const out: Inst[] = [];
    for (let x = hall.x0 + 0.4; x <= hall.x1; x += 7.5) out.push({ p: [x, wallH / 2, hall.z0 + 0.4], s: [0.4, wallH, 0.4] });
    for (let z = hall.z0 + 7.5; z <= hall.z1; z += 7.5) out.push({ p: [hall.x0 + 0.4, wallH / 2, z], s: [0.4, wallH, 0.4] });
    return out;
  }, [hall]);

  const lamps = useMemo(() => {
    const out: Inst[] = [];
    for (let a = 0; a < aisleCount; a++) for (let k = 0; k < 3; k++) out.push({ p: [walkwayX(a), wallH - 0.6, rk.z0 + 2 + k * ((rk.z1 - rk.z0 - 4) / 2)], s: [0.7, 0.12, 0.7] });
    return out;
  }, [aisleCount, rk]);

  const doorX = (i: number) => hall.x0 + 5 + i * ((w - 10) / 3);
  const zoneMid = (zone.z0 + zone.z1) / 2;

  return (
    <group>
      {/* Slab edge, so the hall reads as a model sitting in the dark app canvas. */}
      <mesh position={[cx, -0.26, cz]} receiveShadow>
        <boxGeometry args={[w + 0.4, 0.5, d + 0.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <MeshReflectorMaterial
          map={tex.floor}
          resolution={1024}
          blur={[300, 80]}
          mixBlur={0.9}
          mixStrength={0.9}
          mirror={0.25}
          depthScale={0.5}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.2}
          color="#ffffff"
          metalness={0.05}
          roughness={0.75}
        />
      </mesh>
      <Instanced items={markings} color="#facc15" metalness={0} roughness={0.6} castShadow={false} emissive="#facc15" emissiveIntensity={0.15} />

      {aisles.map((a, i) => (
        <mesh key={a} rotation-x={-Math.PI / 2} position={[walkwayX(i), 0.006, rk.z1 + 3.9]} raycast={() => null}>
          <planeGeometry args={[2.4, 1.2]} />
          <meshBasicMaterial map={tex.letters[i]} transparent toneMapped={false} depthWrite={false} opacity={0.85} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[(hall.x0 + 1.5 + cx - 1.2) / 2, 0.006, zoneMid + 1.6]} raycast={() => null}>
        <planeGeometry args={[6, 3]} />
        <meshBasicMaterial map={tex.receiving} transparent toneMapped={false} depthWrite={false} opacity={0.7} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[(cx + 1.2 + hall.x1 - 1.5) / 2, 0.006, zoneMid + 1.6]} raycast={() => null}>
        <planeGeometry args={[6, 3]} />
        <meshBasicMaterial map={tex.dispatch} transparent toneMapped={false} depthWrite={false} opacity={0.7} />
      </mesh>

      {/* Back and left walls: light insulated panels above a darker dado. */}
      <mesh position={[cx, wallH / 2, hall.z0]} receiveShadow>
        <boxGeometry args={[w, wallH, 0.25]} />
        <meshStandardMaterial color="#d5dae1" roughness={0.85} />
      </mesh>
      <mesh position={[cx, 1, hall.z0 + 0.14]} receiveShadow>
        <boxGeometry args={[w, 2, 0.04]} />
        <meshStandardMaterial color="#5c6676" roughness={0.8} />
      </mesh>
      <mesh position={[hall.x0, wallH / 2, cz]} receiveShadow>
        <boxGeometry args={[0.25, wallH, d]} />
        <meshStandardMaterial color="#cfd5dc" roughness={0.85} />
      </mesh>
      <mesh position={[hall.x0 + 0.14, 1, cz]} receiveShadow>
        <boxGeometry args={[0.04, 2, d]} />
        <meshStandardMaterial color="#5c6676" roughness={0.8} />
      </mesh>
      <Instanced items={columns} color="#9aa4b2" metalness={0.5} roughness={0.4} />

      {[0, 1, 2, 3].map((i) => (
        <group key={i} position={[doorX(i), 0, hall.z0 + 0.14]}>
          <mesh position={[0, 1.9, 0.03]}>
            <planeGeometry args={[3, 3.6]} />
            <meshStandardMaterial map={tex.doors[i]} metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.02, 0.9]} receiveShadow>
            <boxGeometry args={[2.6, 0.04, 1.8]} />
            <meshStandardMaterial color="#6b7280" metalness={0.6} roughness={0.4} />
          </mesh>
          {[-1.6, 1.6].map((dx) => (
            <mesh key={dx} position={[dx, 0.5, 0.1]}>
              <boxGeometry args={[0.25, 0.5, 0.18]} />
              <meshStandardMaterial color="#111827" roughness={0.9} />
            </mesh>
          ))}
          <mesh position={[1.85, 2.6, 0.08]}>
            <sphereGeometry args={[0.09, 16, 16]} />
            <meshStandardMaterial color={i === 1 ? "#ef4444" : "#22c55e"} emissive={i === 1 ? "#ef4444" : "#22c55e"} emissiveIntensity={2.2} toneMapped={false} />
          </mesh>
        </group>
      ))}

      <Instanced items={lamps} color="#f8fafc" metalness={0} roughness={0.2} castShadow={false} emissive="#ffffff" emissiveIntensity={2.4} />
    </group>
  );
}

/** Frosted-glass enclosure around the cold-chain / cool aisle. */
export function ColdRoom({ aisleIndex, racks }: { aisleIndex: number; racks: number }) {
  const x0 = columnX(aisleIndex, "L") - BAY.depth / 2 - 0.25;
  const x1 = columnX(aisleIndex, "R") + BAY.depth / 2 + 0.25;
  const z0 = bayZ(1) - BAY_PITCH / 2 - 0.5;
  const z1 = bayZ(racks) + BAY_PITCH / 2 + 0.5;
  const h = RACK_HEIGHT + 0.6;
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(x1 - x0, h, z1 - z0)), [x0, x1, z0, z1, h]);
  return (
    <group position={[(x0 + x1) / 2, h / 2, (z0 + z1) / 2]}>
      <mesh renderOrder={1} raycast={() => null}>
        <boxGeometry args={[x1 - x0, h, z1 - z0]} />
        <meshPhysicalMaterial color="#bae6fd" transparent opacity={0.13} roughness={0.1} metalness={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#38bdf8" transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}

/** Receiving and dispatch zones: stretch-wrapped pallets and a forklift. Decorative, fixed positions. */
export function Staging({ aisleCount, racks }: { aisleCount: number; racks: number }) {
  const { hall, racks: rk } = useMemo(() => hallBounds(aisleCount, racks), [aisleCount, racks]);
  const cx = (hall.x0 + hall.x1) / 2;
  const zMid = (hall.z0 + 1.6 + rk.z0 - 4.6) / 2 - 1.0;
  const loads = useMemo(() => {
    const out: { x: number; z: number; layers: number; tint: string }[] = [];
    const rows = [
      [hall.x0 + 3, cx - 3],
      [cx + 3, hall.x1 - 3],
    ];
    rows.forEach(([a, b], zi) => {
      for (let x = a, k = 0; x <= b; x += 1.6, k++) {
        out.push({ x, z: zMid - 0.8 + (k % 2) * 1.6, layers: 2 + ((k * 7 + zi) % 3), tint: (k + zi) % 3 === 0 ? "#e8edf3" : "#ffffff" });
      }
    });
    return out;
  }, [hall, cx, zMid]);
  const wood = useMemo(() => palletWood(), []);
  const kraft = useMemo(() => kraftCarton(), []);
  useEffect(
    () => () => {
      wood.dispose();
      kraft.dispose();
    },
    [wood, kraft],
  );
  return (
    <group>
      {loads.map((l, i) => (
        <group key={i} position={[l.x, 0, l.z]}>
          <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.2, 0.14, 1.0]} />
            <meshStandardMaterial map={wood} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.14 + (l.layers * 0.3) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.12, l.layers * 0.3, 0.94]} />
            <meshStandardMaterial map={kraft} color={l.tint} roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.14 + (l.layers * 0.3) / 2, 0]} raycast={() => null}>
            <boxGeometry args={[1.16, l.layers * 0.3 + 0.02, 0.98]} />
            <meshPhysicalMaterial color="#ffffff" transparent opacity={0.18} roughness={0.15} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <Forklift position={[cx + 6, 0, zMid + 2.6]} rotationY={-Math.PI / 2.4} />
    </group>
  );
}

/** A simple counterbalance forklift built from boxes and cylinders. */
function Forklift({ position, rotationY }: { position: THREE.Vector3Tuple; rotationY: number }) {
  const dark = "#1f2937";
  const steel = "#4b5563";
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[1.1, 0.7, 2.0]} />
        <meshStandardMaterial color="#eab308" metalness={0.3} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.75, -0.85]} castShadow>
        <boxGeometry args={[1.12, 0.9, 0.5]} />
        <meshStandardMaterial color="#374151" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.05, -0.1]} castShadow>
        <boxGeometry args={[0.55, 0.12, 0.55]} />
        <meshStandardMaterial color={dark} roughness={0.8} />
      </mesh>
      {[
        [-0.5, -0.45],
        [0.5, -0.45],
        [-0.5, 0.45],
        [0.5, 0.45],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 1.55, z]} castShadow>
          <boxGeometry args={[0.06, 1.3, 0.06]} />
          <meshStandardMaterial color={dark} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 2.2, 0]} castShadow>
        <boxGeometry args={[1.1, 0.05, 1.0]} />
        <meshStandardMaterial color={dark} metalness={0.6} roughness={0.4} />
      </mesh>
      {[-0.35, 0.35].map((x) => (
        <mesh key={x} position={[x, 1.25, 1.1]} castShadow>
          <boxGeometry args={[0.08, 2.5, 0.1]} />
          <meshStandardMaterial color={steel} metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      {[-0.25, 0.25].map((x) => (
        <mesh key={`f${x}`} position={[x, 0.12, 1.65]} castShadow>
          <boxGeometry args={[0.1, 0.05, 1.1]} />
          <meshStandardMaterial color={steel} metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      {[
        [-0.55, 0.6],
        [0.55, 0.6],
        [-0.55, -0.6],
        [0.55, -0.6],
      ].map(([x, z]) => (
        <mesh key={`w${x}${z}`} position={[x, 0.24, z]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.24, 0.24, 0.2, 24]} />
          <meshStandardMaterial color="#111827" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
