"use client";

// The building and the racking (§11), all procedural: no external models, textures or fonts. Textures that need
// detail (wire decks, signs, dock door) are drawn on small canvases in code.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import * as THREE from "three";
import type { LayoutBin, WarehouseLayout } from "@/lib/services/warehouse";

export const SHELF_STEP = 0.7;
const RACK_TOP = 2.85;
const POST = 0.06;

/** One rack column = one side of one aisle: its x centre, bay z range and shelf levels. */
export type RackColumn = { key: string; aisle: string; side: "L" | "R"; x: number; zMin: number; zMax: number; zs: number[]; levels: number[] };

export function rackColumns(bins: LayoutBin[]): RackColumn[] {
  const groups = new Map<string, LayoutBin[]>();
  for (const b of bins) groups.set(`${b.aisle}${b.side}`, [...(groups.get(`${b.aisle}${b.side}`) ?? []), b]);
  return [...groups.entries()].map(([key, g]) => {
    const zs = [...new Set(g.map((b) => b.z))].sort((a, b) => a - b);
    const levels = [...new Set(g.map((b) => b.y))].sort((a, b) => a - b);
    return { key, aisle: g[0].aisle, side: g[0].side, x: g[0].x, zMin: zs[0] - 0.6, zMax: zs[zs.length - 1] + 0.6, zs, levels };
  });
}

/** Fills an instanced mesh from a list of [position, scale] pairs. */
function useInstances(ref: React.RefObject<THREE.InstancedMesh | null>, items: { p: THREE.Vector3Tuple; s: THREE.Vector3Tuple }[]) {
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    items.forEach((it, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...it.p), q, new THREE.Vector3(...it.s))));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [ref, items, invalidate]);
}

/** Steel pallet racking: uprights, beams, wire-mesh decks and end-frame bracing for every rack column. */
export function Racks({ columns }: { columns: RackColumn[] }) {
  const uprightRef = useRef<THREE.InstancedMesh>(null);
  const beamRef = useRef<THREE.InstancedMesh>(null);
  const deckRef = useRef<THREE.InstancedMesh>(null);

  const { uprights, beams, decks, bracing } = useMemo(() => {
    const uprights: { p: THREE.Vector3Tuple; s: THREE.Vector3Tuple }[] = [];
    const beams: { p: THREE.Vector3Tuple; s: THREE.Vector3Tuple }[] = [];
    const decks: { p: THREE.Vector3Tuple; s: THREE.Vector3Tuple }[] = [];
    const pts: number[] = [];
    for (const c of columns) {
      const frames = [c.zMin, ...c.zs.slice(1).map((z) => z - 0.6), c.zMax];
      const x0 = c.x - 0.48;
      const x1 = c.x + 0.48;
      const len = c.zMax - c.zMin;
      const zc = (c.zMin + c.zMax) / 2;
      for (const z of frames) {
        uprights.push({ p: [x0, RACK_TOP / 2, z], s: [POST, RACK_TOP, POST] }, { p: [x1, RACK_TOP / 2, z], s: [POST, RACK_TOP, POST] });
        // Bracing zig-zag on the two end frames only, as on real racking (inner frames are hidden by stock).
        if (z !== c.zMin && z !== c.zMax) continue;
        for (let y = 0.15; y < RACK_TOP - 0.3; y += 0.55) pts.push(x0, y, z, x1, y + 0.5, z, x1, y + 0.5, z, x0, Math.min(y + 1.0, RACK_TOP - 0.1), z);
      }
      for (const level of [...c.levels.filter((l) => l > 0), RACK_TOP - 0.05]) {
        beams.push({ p: [x0, level - 0.05, zc], s: [0.05, 0.09, len] }, { p: [x1, level - 0.05, zc], s: [0.05, 0.09, len] });
      }
      for (const level of c.levels) decks.push({ p: [c.x, level + 0.012, zc], s: [0.94, 0.024, len] });
    }
    const bracing = new THREE.BufferGeometry();
    bracing.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return { uprights, beams, decks, bracing };
  }, [columns]);

  useInstances(uprightRef, uprights);
  useInstances(beamRef, beams);
  useInstances(deckRef, decks);
  const deckTexture = useMemo(() => wireDeckTexture(), []);
  useEffect(() => () => deckTexture.dispose(), [deckTexture]);

  return (
    <group>
      <instancedMesh ref={uprightRef} args={[undefined, undefined, uprights.length]} castShadow receiveShadow>
        <boxGeometry />
        <meshStandardMaterial color="#6b7383" metalness={0.75} roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={beamRef} args={[undefined, undefined, beams.length]} castShadow>
        <boxGeometry />
        <meshStandardMaterial color="#7c8494" metalness={0.7} roughness={0.28} />
      </instancedMesh>
      <instancedMesh ref={deckRef} args={[undefined, undefined, decks.length]} receiveShadow castShadow>
        <boxGeometry />
        <meshStandardMaterial color="#8796b0" metalness={0.8} roughness={0.35} alphaMap={deckTexture} alphaTest={0.4} transparent side={THREE.DoubleSide} />
      </instancedMesh>
      <lineSegments geometry={bracing}>
        <lineBasicMaterial color="#4b5263" transparent opacity={0.9} />
      </lineSegments>
    </group>
  );
}

/** Wire-mesh deck: a grid drawn on a canvas, used as an alpha map so the shelf below shows through. */
function wireDeckTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 6;
  for (let i = 0; i <= 64; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 64);
    ctx.moveTo(0, i);
    ctx.lineTo(64, i);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 24);
  return t;
}

/** The hall: polished concrete floor with reflections, painted aisle lines, two walls, a dock door, columns and light strips. */
export function Building({ layout, walkways }: { layout: WarehouseLayout; walkways: number[] }) {
  const { bounds } = layout;
  const x0 = bounds.min.x - 4.5;
  const x1 = bounds.max.x + 4.5;
  const z0 = bounds.min.z - 3.5;
  const z1 = bounds.max.z + 5;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const wallH = 5.2;
  const door = useMemo(() => dockDoorTexture(), []);
  useEffect(() => () => door.dispose(), [door]);

  const lines = useMemo(() => {
    const pts: number[] = [];
    for (const x of walkways) {
      // Walkway edge lines, stopping short of the hall walls.
      for (const dx of [-0.5, 0.5]) pts.push(x + dx, 0.004, bounds.min.z - 1.0, x + dx, 0.004, bounds.max.z + 1.4);
    }
    // Cross lane in front of the racks.
    pts.push(x0 + 1, 0.004, bounds.max.z + 1.4, x1 - 1, 0.004, bounds.max.z + 1.4, x0 + 1, 0.004, bounds.max.z + 2.6, x1 - 1, 0.004, bounds.max.z + 2.6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [walkways, bounds, x0, x1]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <MeshReflectorMaterial
          resolution={512}
          blur={[400, 120]}
          mixBlur={1}
          mixStrength={2.2}
          mirror={0.35}
          depthScale={0.6}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#0a101c"
          metalness={0.35}
          roughness={0.85}
        />
      </mesh>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#cbd5e1" transparent opacity={0.22} />
      </lineSegments>

      {/* Back wall and left wall, with ribbed cladding. */}
      <mesh position={[cx, wallH / 2, z0]} receiveShadow>
        <boxGeometry args={[w, wallH, 0.2]} />
        <meshStandardMaterial color="#0e1525" roughness={0.92} />
      </mesh>
      <mesh position={[x0, wallH / 2, cz]} receiveShadow>
        <boxGeometry args={[0.2, wallH, d]} />
        <meshStandardMaterial color="#0d1322" roughness={0.92} />
      </mesh>
      <Ribs from={[x0 + 1, z0 + 0.12]} to={[x1 - 0.5, z0 + 0.12]} height={wallH} />
      <Ribs from={[x0 + 0.12, z0 + 1]} to={[x0 + 0.12, z1 - 0.5]} height={wallH} />
      {/* Steel columns along the walls. */}
      {Array.from({ length: Math.floor(w / 6) + 1 }, (_, i) => x0 + 0.3 + i * 6).map((x) => (
        <mesh key={`c${x}`} position={[x, wallH / 2, z0 + 0.3]} castShadow>
          <boxGeometry args={[0.32, wallH, 0.32]} />
          <meshStandardMaterial color="#26324a" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* Loading dock on the left wall: roller door, dock bumpers and a light above. */}
      <group position={[x0 + 0.13, 0, cz + 1]}>
        <mesh position={[0, 1.75, 0]} rotation-y={Math.PI / 2}>
          <planeGeometry args={[4.2, 3.5]} />
          <meshStandardMaterial map={door} metalness={0.5} roughness={0.5} />
        </mesh>
        {[-1.6, 1.6].map((z) => (
          <mesh key={z} position={[0.12, 0.55, z]}>
            <boxGeometry args={[0.16, 0.5, 0.3]} />
            <meshStandardMaterial color="#111827" roughness={0.9} />
          </mesh>
        ))}
        <mesh position={[0.08, 3.75, 0]}>
          <boxGeometry args={[0.06, 0.08, 3.6]} />
          <meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
      </group>

      {/* Overhead LED strips above each walkway, each with a real light below it. */}
      {walkways.map((x) => (
        <pointLight key={`p${x}`} position={[x, 3.9, (bounds.min.z + bounds.max.z) / 2]} intensity={7} distance={9} decay={1.6} color="#e8eefc" />
      ))}
      {walkways.map((x) => (
        <mesh key={`l${x}`} position={[x, 4.4, (bounds.min.z + bounds.max.z) / 2]}>
          <boxGeometry args={[0.05, 0.03, bounds.max.z - bounds.min.z + 1]} />
          <meshStandardMaterial color="#64748b" emissive="#94a3b8" emissiveIntensity={0.5} toneMapped={false} transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function Ribs({ from, to, height }: { from: [number, number]; to: [number, number]; height: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: { p: THREE.Vector3Tuple; s: THREE.Vector3Tuple }[] = [];
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const n = Math.floor(len / 0.9);
    const alongX = from[1] === to[1];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p: THREE.Vector3Tuple = [from[0] + (to[0] - from[0]) * t, height / 2, from[1] + (to[1] - from[1]) * t];
      out.push({ p, s: alongX ? [0.05, height, 0.06] : [0.06, height, 0.05] });
    }
    return out;
  }, [from, to, height]);
  useInstances(ref, items);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
      <boxGeometry />
      <meshStandardMaterial color="#141d31" roughness={0.85} metalness={0.2} />
    </instancedMesh>
  );
}

function dockDoorTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1b2538";
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 12) {
    ctx.fillStyle = "#24304a";
    ctx.fillRect(0, y, 256, 6);
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 22px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("DOCK 1", 128, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Hanging aisle signs at the near end of each walkway, lit like the real thing. */
export function AisleSigns({ signs }: { signs: { aisle: string; x: number; z: number; sub: string }[] }) {
  const textures = useMemo(() => signs.map((s) => signTexture(s.aisle, s.sub)), [signs]);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  return (
    <group>
      {signs.map((s, i) => (
        <group key={s.aisle} position={[s.x, 3.55, s.z]}>
          {[-0.55, 0.55].map((dx) => (
            <mesh key={dx} position={[dx, 0.55, 0]}>
              <cylinderGeometry args={[0.008, 0.008, 1.1]} />
              <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
          <mesh castShadow>
            <boxGeometry args={[1.5, 0.78, 0.05]} />
            <meshStandardMaterial color="#0f172a" metalness={0.4} roughness={0.5} />
          </mesh>
          {[0.027, -0.027].map((dz) => (
            <mesh key={dz} position={[0, 0, dz]} rotation-y={dz < 0 ? Math.PI : 0}>
              <planeGeometry args={[1.42, 0.7]} />
              <meshBasicMaterial map={textures[i]} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function signTexture(aisle: string, sub: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 252;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 252);
  g.addColorStop(0, "#132036");
  g.addColorStop(1, "#0b1424");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 252);
  ctx.fillStyle = "#2dd4bf";
  ctx.fillRect(0, 0, 512, 8);
  ctx.fillStyle = "#e6edf7";
  ctx.font = "700 150px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(aisle, 40, 178);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 30px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("AISLE", 190, 105);
  ctx.fillStyle = "#e6edf7";
  ctx.font = "500 34px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(sub, 190, 160);
  ctx.fillStyle = "#5b6b85";
  ctx.font = "500 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Racks 01–06 · Shelves 1–4", 190, 206);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Glass enclosure around the cold-chain aisle (2–8 °C), with frosted edges. */
export function ColdRoom({ x0, x1, z0, z1, height }: { x0: number; x1: number; z0: number; z1: number; height: number }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(x1 - x0, height, z1 - z0)), [x0, x1, z0, z1, height]);
  return (
    <group position={[(x0 + x1) / 2, height / 2, (z0 + z1) / 2]}>
      <mesh renderOrder={1}>
        <boxGeometry args={[x1 - x0, height, z1 - z0]} />
        <meshPhysicalMaterial color="#7dd3fc" transparent opacity={0.07} roughness={0.15} metalness={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#7dd3fc" transparent opacity={0.45} />
      </lineSegments>
      <mesh position={[0, height / 2 - 0.05, 0]}>
        <boxGeometry args={[x1 - x0 - 0.2, 0.04, 0.12]} />
        <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={0.7} toneMapped={false} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}
