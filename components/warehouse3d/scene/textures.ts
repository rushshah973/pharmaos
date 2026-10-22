// Procedural textures for the 3D twin, drawn on canvases in code (no image files are loaded).
import * as THREE from "three";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: [number, number]; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...opts.repeat);
  }
  t.anisotropy = opts.aniso ?? 4;
  return t;
}

const SANS = "ui-sans-serif, system-ui, -apple-system, sans-serif";

/** A white pharma carton with a coloured brand band, product lines and a barcode. */
export function pharmaCarton(band: string, label: string): THREE.CanvasTexture {
  const [c, x] = canvas(256, 256);
  x.fillStyle = "#f3f5f8";
  x.fillRect(0, 0, 256, 256);
  x.fillStyle = band;
  x.fillRect(0, 150, 256, 56);
  x.fillRect(0, 0, 256, 10);
  x.fillStyle = "#1f2937";
  x.font = `700 30px ${SANS}`;
  x.fillText(label, 18, 58);
  x.fillStyle = "#6b7280";
  x.font = `500 17px ${SANS}`;
  x.fillText("Tablets IP · 10 × 10", 18, 86);
  x.fillText("Store below 25 °C", 18, 110);
  x.fillStyle = "#ffffff";
  x.font = `700 22px ${SANS}`;
  x.fillText("Rx", 18, 186);
  // Barcode
  x.fillStyle = "#111827";
  for (let i = 0, px = 150; px < 236; i++) {
    const w = (i * 7) % 3 === 0 ? 3 : 1.5;
    x.fillRect(px, 218, w, 28);
    px += w + 2;
  }
  x.strokeStyle = "rgba(0,0,0,0.12)";
  x.lineWidth = 4;
  x.strokeRect(2, 2, 252, 252);
  return finish(c);
}

/** A kraft shipping carton with tape, a white shipping label and handling marks. */
export function kraftCarton(): THREE.CanvasTexture {
  const [c, x] = canvas(256, 256);
  const g = x.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, "#c49a68");
  g.addColorStop(1, "#b0875a");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  // Fibre noise
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(90,60,30,${((i * 37) % 10) / 120})`;
    x.fillRect((i * 53) % 256, (i * 97) % 256, 2, 1);
  }
  x.fillStyle = "rgba(225,200,160,0.7)";
  x.fillRect(110, 0, 36, 256);
  x.fillStyle = "#f8fafc";
  x.fillRect(22, 150, 84, 62);
  x.fillStyle = "#334155";
  for (let i = 0; i < 4; i++) x.fillRect(30, 160 + i * 12, 60 - i * 8, 4);
  x.strokeStyle = "rgba(60,40,20,0.6)";
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(200, 70);
  x.lineTo(200, 30);
  x.moveTo(188, 44);
  x.lineTo(200, 30);
  x.lineTo(212, 44);
  x.stroke();
  x.strokeStyle = "rgba(0,0,0,0.15)";
  x.lineWidth = 4;
  x.strokeRect(2, 2, 252, 252);
  return finish(c);
}

/** Wooden pallet: light boards with dark gaps. */
export function palletWood(): THREE.CanvasTexture {
  const [c, x] = canvas(128, 128);
  x.fillStyle = "#5b4128";
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 5; i++) {
    x.fillStyle = i % 2 ? "#c79a62" : "#b98b55";
    x.fillRect(0, i * 26 + 2, 128, 21);
  }
  return finish(c);
}

/** Roller-shutter dock door with a number plate. */
export function dockDoor(n: number): THREE.CanvasTexture {
  const [c, x] = canvas(256, 256);
  x.fillStyle = "#a7b0bd";
  x.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 10) {
    x.fillStyle = "#94a0af";
    x.fillRect(0, y, 256, 3);
  }
  x.fillStyle = "#1f2937";
  x.fillRect(88, 12, 80, 30);
  x.fillStyle = "#f8fafc";
  x.font = `700 20px ${SANS}`;
  x.textAlign = "center";
  x.fillText(`DOCK ${n}`, 128, 34);
  return finish(c);
}

/** Painted floor text (white, worn), e.g. an aisle letter or a zone name. */
export function floorText(text: string, sub?: string): THREE.CanvasTexture {
  const [c, x] = canvas(512, 256);
  x.clearRect(0, 0, 512, 256);
  x.fillStyle = "rgba(255,255,255,0.92)";
  x.textAlign = "center";
  x.font = `800 ${sub ? 120 : 150}px ${SANS}`;
  x.fillText(text, 256, sub ? 140 : 190);
  if (sub) {
    x.font = `700 44px ${SANS}`;
    x.fillText(sub, 256, 210);
  }
  return finish(c, { aniso: 8 });
}

/** Rack label chip ("A-L-03"): white rounded plate, dark text. Tint with the sprite colour for hot racks. */
export function chip(text: string): THREE.CanvasTexture {
  const [c, x] = canvas(256, 96);
  x.clearRect(0, 0, 256, 96);
  x.fillStyle = "#ffffff";
  const r = 22;
  x.beginPath();
  x.moveTo(r, 6);
  x.arcTo(250, 6, 250, 90, r);
  x.arcTo(250, 90, 6, 90, r);
  x.arcTo(6, 90, 6, 6, r);
  x.arcTo(6, 6, 250, 6, r);
  x.closePath();
  x.fill();
  x.fillStyle = "#0f172a";
  x.font = `700 46px ui-monospace, SFMono-Regular, Menlo, monospace`;
  x.textAlign = "center";
  x.fillText(text, 128, 64);
  return finish(c, { aniso: 8 });
}

/** Hanging aisle sign face. */
export function aisleSign(aisle: string, sub: string): THREE.CanvasTexture {
  const [c, x] = canvas(512, 256);
  x.fillStyle = "#0f2a5c";
  x.fillRect(0, 0, 512, 256);
  x.fillStyle = "#facc15";
  x.fillRect(0, 0, 512, 12);
  x.fillStyle = "#ffffff";
  x.font = `800 170px ${SANS}`;
  x.fillText(aisle, 34, 200);
  x.font = `700 40px ${SANS}`;
  x.fillText("AISLE", 200, 110);
  x.fillStyle = "#cbd5e1";
  x.font = `600 34px ${SANS}`;
  x.fillText(sub, 200, 162);
  x.fillText("Racks 01–06", 200, 208);
  return finish(c, { aniso: 8 });
}

/** Epoxy floor: light grey with soft mottling, tiled. */
export function epoxyFloor(): THREE.CanvasTexture {
  const [c, x] = canvas(256, 256);
  x.fillStyle = "#c3c9d2";
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = (i * 2654435761) % 1000;
    x.fillStyle = `rgba(${v % 2 ? 255 : 80},${v % 2 ? 255 : 90},${v % 2 ? 255 : 110},${(v % 7) / 140})`;
    x.fillRect((i * 31) % 256, (i * 71) % 256, 3, 3);
  }
  x.strokeStyle = "rgba(90,100,120,0.18)";
  x.lineWidth = 2;
  x.strokeRect(0, 0, 256, 256);
  return finish(c, { repeat: [10, 8], aniso: 8 });
}
