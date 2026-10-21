// Seeded random helpers for the synthetic data generator.
// Everything random in the seed goes through an Rng; never Math.random().

export type Rng = {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Pick by weight; weights need not sum to 1. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T;
  /** New shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** Poisson-distributed integer (Knuth; fine for the small lambdas used here). */
  poisson(lambda: number): number;
  /** Deterministic v4-format UUID, so generated rows are reproducible. */
  uuid(): string;
};

/** mulberry32: small, fast, good-enough 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);

  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick() on an empty list");
      return items[Math.floor(next() * items.length)];
    },
    weighted: (entries) => {
      const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
      if (total <= 0) throw new Error("weighted() needs at least one positive weight");
      let r = next() * total;
      for (const [value, w] of entries) {
        r -= Math.max(0, w);
        if (r < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > limit);
      return k - 1;
    },
    uuid: () => {
      const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
      hex[12] = "4";
      hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
      const h = hex.join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  };
}
