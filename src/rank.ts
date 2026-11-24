// Which plants are kept when a square is thinned, and where each stands: the plain arithmetic, with no
// three.js in it, so that the shaders' placement has a twin here that a test can run and set against what
// the graphics card works out (`checkPlacement` in the lab).
//
// A square of plants is a grid of cells, one plant to a cell, scattered within it. Thinning keeps a
// share of them. Keeping each by a coin of its own (white noise) leaves clumps and holes wherever the
// share is less than all; so each cell has a rank instead, from a blue-noise matrix, and a cell is kept
// while its rank is below the share. Whatever the share, the kept cells are spread evenly: the first
// tenth are a tenth of the cells as far from each other as they can be, and the next tenth fill the
// gaps between them, and so on. (Ulichney's void-and-cluster, 1993; the way bevy-grass ranks its blades.)

/** The rank matrix's side, in cells: it repeats every this many cells either way. */
export const RANK_SIDE = 64;

/** A seeded generator of numbers 0..1 (mulberry32): the same matrix every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A blue-noise rank for each cell of an `n` by `n` square that repeats (rows along x), each 0..1: the
 * cells with ranks below any share are spread as evenly as can be. Void-and-cluster with a Gaussian of
 * `sigma` cells, wrapping round the square's edges.
 */
export function rankMatrix(n = RANK_SIDE, sigma = 1.5, seed = 7): Float32Array {
  const count = n * n;
  const reach = Math.ceil(sigma * 4);
  const kernel: [number, number, number][] = [];
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) kernel.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))]);
  const energy = new Float64Array(count);
  const on = new Uint8Array(count);
  const touch = (i: number, sign: number) => {
    const x = i % n;
    const y = (i / n) | 0;
    for (const [dx, dy, w] of kernel) energy[((y + dy + n) % n) * n + ((x + dx + n) % n)] += sign * w;
  };
  /** The cell that is on (or off) where the others crowd it most (least). */
  const most = (want: number) => {
    let best = -1;
    let at = 0;
    for (let i = 0; i < count; i++) if (on[i] === want && (best < 0 || energy[i] > energy[best])) (best = i), (at = i);
    return at;
  };
  const least = (want: number) => {
    let best = -1;
    let at = 0;
    for (let i = 0; i < count; i++) if (on[i] === want && (best < 0 || energy[i] < energy[best])) (best = i), (at = i);
    return at;
  };
  // A first scatter, a tenth of the cells, settled: the most crowded moved to the emptiest until it stays.
  const random = seeded(seed);
  const first = Math.floor(count / 10);
  for (let placed = 0; placed < first; ) {
    const i = Math.floor(random() * count);
    if (on[i]) continue;
    on[i] = 1;
    touch(i, 1);
    placed++;
  }
  for (let guard = 0; guard < count * 4; guard++) {
    const crowded = most(1);
    on[crowded] = 0;
    touch(crowded, -1);
    const empty = least(0);
    on[empty] = 1;
    touch(empty, 1);
    if (empty === crowded) break;
  }
  const settled = on.slice();
  const settledEnergy = energy.slice();
  const rank = new Int32Array(count).fill(-1);
  // Its cells ranked from the last: the most crowded taken off first.
  for (let r = first - 1; r >= 0; r--) {
    const crowded = most(1);
    on[crowded] = 0;
    touch(crowded, -1);
    rank[crowded] = r;
  }
  // The rest ranked from the first scatter on: each into the emptiest place left.
  on.set(settled);
  energy.set(settledEnergy);
  for (let r = first; r < count; r++) {
    const empty = least(0);
    on[empty] = 1;
    touch(empty, 1);
    rank[empty] = r;
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = (rank[i] + 0.5) / count;
  return out;
}

let shared: Float32Array | null = null;
/** The rank matrix the grass uses, made once. */
export function grassRanks(): Float32Array {
  shared ??= rankMatrix();
  return shared;
}

/** A cell's rank, 0..1, from the matrix (cells counted from anywhere, below nothing too). */
export function rankOf(ranks: Float32Array, cx: number, cz: number): number {
  const ix = cx - RANK_SIDE * Math.floor(cx / RANK_SIDE);
  const iz = cz - RANK_SIDE * Math.floor(cz / RANK_SIDE);
  return ranks[iz * RANK_SIDE + ix];
}

const f = Math.fround;
const fract = (v: number) => f(v - Math.floor(v));

/**
 * The shaders' hash of a place (`hashCell` in placement.ts: Hoskins' hash without sine), in 32-bit floats as
 * the graphics card works it. Its dot product is worked as the card's compiler does, as a chain of fused
 * multiply-adds, each rounding once (an f32 times an f32 is exact in a double, so a double sum rounded is a
 * fused one): so it was found to be on Apple's Metal, where the twin and the card agree to the last bit on
 * every plant. A card that fuses otherwise differs in the last bits, which the hash's last step, the
 * fraction of a number in the hundreds, makes a thousandth of a cell, and now and then a whole one
 * (`checkPlacement` in the lab says how many).
 */
export function hashCell(x: number, y: number): number {
  let px = fract(f(x * f(0.1031)));
  let py = fract(f(y * f(0.1031)));
  let pz = fract(f(x * f(0.1031)));
  const k = f(33.33);
  let d = f(px * f(py + k));
  d = f(py * f(pz + k) + d);
  d = f(pz * f(px + k) + d);
  px = f(px + d);
  py = f(py + d);
  pz = f(pz + d);
  return fract(f(f(px + py) * pz));
}

/**
 * Where a fine square's plant `index` stands (m), as the shaders place it: its cell, counted from the
 * square's corner about `focus` (m), and scattered within it by the hash of its cell (within a repeat of
 * 1024 cells, as the shaders keep it). `count` cells a side, `spacing` m apart.
 */
export function finePlace(index: number, count: number, spacing: number, focusX: number, focusZ: number): { cx: number; cz: number; x: number; z: number; r0: number; r1: number } {
  const gx = index % count;
  const gz = Math.floor(index / count);
  const cx = Math.floor(f(f(focusX) / f(spacing))) + gx - count * 0.5;
  const cz = Math.floor(f(f(focusZ) / f(spacing))) + gz - count * 0.5;
  const hx = cx - 1024 * Math.floor(cx / 1024);
  const hz = cz - 1024 * Math.floor(cz / 1024);
  const r0 = hashCell(hx, hz);
  const r1 = hashCell(f(hx + f(31.7)), f(hz + f(31.7)));
  return { cx, cz, x: f(f(cx + r0) * f(spacing)), z: f(f(cz + r1) * f(spacing)), r0, r1 };
}
