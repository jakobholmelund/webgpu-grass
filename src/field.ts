// What the grass grows on, as two things it can ask at any place: how high
// the ground is there, and which species grows there (and how far that
// species' ground goes on before something else starts).
//
// Each is a source: an object the shaders sample. The two made here read
// plain grids. A host with its own terrain (a noise function, its own
// distance fields) writes a source of its own with the same `sample`.

import * as THREE from "three/webgpu";
import { abs, clamp, cos, dot, float, floor, fract, int, max, min, mix, normalize, sin, smoothstep, step, storage, texture, uniform, vec2, vec3 } from "three/tsl";

type Vec2 = THREE.Node<"vec2">;
type Float = THREE.Node<"float">;
type Vec3 = THREE.Node<"vec3">;

/** A map's number for ground where nothing grows. */
export const NO_GRASS = 255;

/** The ground's height (m) and its normal at a place. Sampled in the compute pass. */
export interface HeightSource {
  sample(xz: Vec2): { height: Float; normal: Vec3 };
  dispose(): void;
}

/**
 * The species at a place (its row in the table, or `NO_GRASS`) and the
 * metres from there to the nearest ground of another species. Sampled in
 * the compute pass and, for the ground's colour, in a fragment shader.
 */
export interface MapSource {
  sample(xz: Vec2): { species: Float; edge: Float };
  /**
   * The ground the map covers (m), if it says: the grass keeps a picture of
   * how tall it stands over that ground, for its shadows. Without it nothing
   * shades anything.
   */
  bounds?: { x0: number; z0: number; x1: number; z1: number };
  dispose(): void;
}

/** Heights (m) on a square grid: `nx` by `nz` posts `cell` metres apart, the first at (`x0`, `z0`), rows along x. */
export interface HeightGrid {
  heights: Float32Array;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  cell: number;
}

/** The height of a grid at a place, as the shaders have it (for the host's own use: a camera that walks the ground). */
export function heightAt(g: HeightGrid, x: number, z: number): number {
  const fx = Math.min(g.nx - 1.001, Math.max(0, (x - g.x0) / g.cell));
  const fz = Math.min(g.nz - 1.001, Math.max(0, (z - g.z0) / g.cell));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const h = g.heights;
  const a = h[j * g.nx + i];
  const b = h[j * g.nx + i + 1];
  const c = h[(j + 1) * g.nx + i];
  const d = h[(j + 1) * g.nx + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** A height source from a grid of heights. The normals are worked out here. */
export function heightGrid(g: HeightGrid): HeightSource {
  const { nx, nz, cell } = g;
  if (g.heights.length !== nx * nz) throw new Error(`heights holds ${g.heights.length} numbers, not ${nx} x ${nz}`);
  const data = new Float32Array(nx * nz * 4);
  const at = (i: number, j: number) => g.heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
      const dz = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
      const len = Math.hypot(dx, 1, dz);
      data.set([at(i, j), -dx / len, 1 / len, -dz / len], (j * nx + i) * 4);
    }
  }
  const attr = new THREE.StorageBufferAttribute(data, 4);
  const posts = storage(attr, "vec4", nx * nz).toReadOnly();
  return {
    sample(xz) {
      const p = clamp(xz.sub(vec2(g.x0, g.z0)).div(cell), vec2(0), vec2(nx - 1.001, nz - 1.001));
      const pi = floor(p);
      const pf = fract(p);
      const i0 = int(pi.x);
      const j0 = int(pi.y);
      const i1 = int(min(pi.x.add(1), float(nx - 1)));
      const j1 = int(min(pi.y.add(1), float(nz - 1)));
      const a = posts.element(j0.mul(nx).add(i0));
      const b = posts.element(j0.mul(nx).add(i1));
      const c = posts.element(j1.mul(nx).add(i0));
      const d = posts.element(j1.mul(nx).add(i1));
      const height = mix(mix(a.x, b.x, pf.x), mix(c.x, d.x, pf.x), pf.y);
      const n = mix(mix(vec3(a.y, a.z, a.w), vec3(b.y, b.z, b.w), pf.x), mix(vec3(c.y, c.z, c.w), vec3(d.y, d.z, d.w), pf.x), pf.y);
      return { height, normal: normalize(n) };
    },
    dispose() {
      attr.dispose();
    },
  };
}

/** A species number to a cell: `nx` by `nz` cells of `cell` metres, the first cell's corner at (`x0`, `z0`), rows along x. */
export interface GrassMap {
  ids: Uint8Array;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  cell: number;
}

/** A map's cells are blurred over about this many of them to either side, which is what rounds its steps into a line. */
const SMOOTH_CELLS = 1.5;
/** Channels: one to each species' row, and one for ground where nothing grows. */
const CHANNELS = 9;

export interface SpeciesMapSource extends MapSource {
  /** Replace the map's species numbers (the same size of map), as after painting on it. */
  set(ids: Uint8Array): void;
}

/**
 * A map source from a grid of species numbers.
 *
 * A grid's borders are steps a cell wide. So the grid is not looked up as
 * it is: each species' cells are spread into a smooth field of how much of
 * the ground about a place is that species', and a place belongs to
 * whichever species has most of it. Where two have as much as each other is
 * the border, which is then a clean line that cuts the grid's corners, the
 * same from any distance; and how far ahead the leader is says how far off
 * the border is. Features narrower than three or four cells are smoothed
 * away with the steps.
 */
export function speciesMap(m: GrassMap): SpeciesMapSource {
  const { nx, nz, cell } = m;
  const n = nx * nz;
  const data = [0, 1, 2].map(() => new Uint8Array(n * 4));
  const textures = data.map((d) => {
    const tex = new THREE.DataTexture(d, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    return tex;
  });
  /** Three passes of a box three cells wide: near enough a bell 1.4 cells to either side. */
  const smooth = (field: Float32Array) => {
    const other = new Float32Array(n);
    let from: Float32Array = field;
    let to: Float32Array = other;
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          to[k] = (from[j * nx + Math.max(0, i - 1)] + from[k] + from[j * nx + Math.min(nx - 1, i + 1)]) / 3;
        }
      }
      [from, to] = [to, from];
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          to[k] = (from[Math.max(0, j - 1) * nx + i] + from[k] + from[Math.min(nz - 1, j + 1) * nx + i]) / 3;
        }
      }
      [from, to] = [to, from];
    }
    return from;
  };
  const set = (ids: Uint8Array) => {
    if (ids.length !== n) throw new Error(`ids holds ${ids.length} numbers, not ${nx} x ${nz}`);
    for (let c = 0; c < CHANNELS; c++) {
      const out = data[c >> 2];
      const at = c & 3;
      // (A species the map has none of costs nothing to smooth.)
      let any = false;
      const field = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        if ((ids[k] < CHANNELS - 1 ? ids[k] : CHANNELS - 1) === c) {
          field[k] = 1;
          any = true;
        }
      }
      const share = any ? smooth(field) : field;
      for (let k = 0; k < n; k++) out[k * 4 + at] = Math.round(share[k] * 255);
    }
    for (const tex of textures) tex.needsUpdate = true;
  };
  set(m.ids);
  const size = vec2(nx, nz);
  return {
    set,
    bounds: { x0: m.x0, z0: m.z0, x1: m.x0 + nx * cell, z1: m.z0 + nz * cell },
    sample(xz) {
      const t = xz.sub(vec2(m.x0, m.z0)).div(cell);
      const uv = t.div(size);
      const [a, b, c] = textures.map((tex) => texture(tex, uv).level(float(0)));
      const shares = [a.r, a.g, a.b, a.a, b.r, b.g, b.b, b.a, c.r];
      // The species with most of the ground here, and how far ahead of the next it is.
      let most = shares[0];
      let next = float(0) as typeof most;
      let which = float(0) as typeof most;
      for (let k = 1; k < CHANNELS; k++) {
        const leads = step(most, shares[k]);
        next = mix(max(next, shares[k]), most, leads);
        which = mix(which, float(k < CHANNELS - 1 ? k : NO_GRASS), leads);
        most = max(most, shares[k]);
      }
      const inside = step(float(0), t.x).mul(step(float(0), t.y)).mul(step(t.x, float(nx))).mul(step(t.y, float(nz)));
      // (Across a border the lead grows about as the distance over the blur's width does.)
      const edge = most.sub(next).mul(1.25 * SMOOTH_CELLS * cell);
      return { species: mix(float(NO_GRASS), which, inside), edge };
    },
    dispose() {
      for (const tex of textures) tex.dispose();
    },
  };
}

/**
 * How the mower left the grass at a place: the way its leaves were laid
 * over, as a vector along the ground (x, z), its length how fully (0 where
 * nothing was mown, 1 in the middle of a pass). Sampled in the compute pass
 * and, for the ground's colour, in a fragment shader.
 */
export interface MowSource {
  sample(xz: Vec2): Vec2;
}

export interface MowStripes extends MowSource {
  /** A pass's width (m): the mower's. */
  width: number;
  /** The way the first pass was driven, in degrees from +z towards +x. Each pass beside it is driven back the other way. */
  heading: number;
  /** A place on the line between two passes. */
  x: number;
  z: number;
}

/**
 * Straight passes side by side, there and back: a fairway mown up and down.
 * The lay turns over across a hand's width where two passes meet. (Not yet:
 * the laps a mower makes round the edge first, or a second cut across the
 * first.)
 */
export function mowStripes(init: Partial<Pick<MowStripes, "width" | "heading" | "x" | "z">> = {}): MowStripes {
  const pattern = { width: init.width ?? 2.5, heading: init.heading ?? 0, x: init.x ?? 0, z: init.z ?? 0 };
  /** x, z, width, heading (radians). */
  const u = uniform(new THREE.Vector4());
  const put = () => u.value.set(pattern.x, pattern.z, Math.max(0.05, pattern.width), (pattern.heading * Math.PI) / 180);
  put();
  const source: MowSource = {
    sample(xz) {
      const along = vec2(sin(u.w), cos(u.w));
      const across = dot(xz.sub(vec2(u.x, u.y)), vec2(along.y, along.x.negate())).div(u.z);
      // (+1 down one pass, -1 back up the next, turning over between them.)
      const there = smoothstep(float(0.46), float(0.54), abs(fract(across.mul(0.5)).sub(0.5)).mul(2)).mul(2).sub(1);
      return along.mul(there);
    },
  };
  const settable = (key: keyof typeof pattern) => ({
    get: () => pattern[key],
    set: (v: number) => {
      pattern[key] = v;
      put();
    },
    enumerable: true,
  });
  return Object.defineProperties(source, { width: settable("width"), heading: settable("heading"), x: settable("x"), z: settable("z") }) as MowStripes;
}
