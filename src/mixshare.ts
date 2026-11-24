// A mix's arithmetic, with no three.js in it: where each of a mix's grasses grows, as plain numbers, so a
// test can run it and a host can ask it (the shaders' half is `mixedMap` in mix.ts, kept in step with this).
//
// No stand of grass nobody mows is one grass. One grass is the stand's body (the mix's lead) and the others
// grow in patches in it, each in patches of its own size: sheep's fescue in tufts a stride across in a red
// fescue, Yorkshire fog in drifts a few strides across in a meadow. A patch is a colony grown out from where a
// seed landed or a runner rooted, roughly round (as the library's own patches are, `Species.patchKind`):
// the ground is squared off at a member's patch size, each square has at most one colony somewhere in its
// middle, of a size drawn so that most are about the patch size and a few half or half again as big, and
// whether a square has one at all goes by a chance worked out so that the member takes its share of the
// stand. Where colonies of two members overlap, the one listed first has the place.

import { hashCell } from "./rank.ts";

/** One of a mix's grasses after its lead: its row in the species table (or `NO_GRASS`, 255, for bare ground), its share of the stand, how far across its patches are (m). */
export interface MixMember {
  species: number;
  share: number;
  patchSize: number;
  /**
   * The chance that a square of its has a colony, if the host knows it already: from a twin of this
   * arithmetic elsewhere (a physics that plays the same patches, say), so both have the very same
   * colonies and not two numbers a rounding apart. Left out: worked out here from `share` (`mixChances`).
   */
  chance?: number;
}

/** A stand of several grasses: where the map says `species` (the lead), its members take their shares of the ground in patches. */
export interface GrassMix {
  species: number;
  members: MixMember[];
}

/** A colony's reach as a share of its square, at its middle size; and how much the sizes spread (its exponent's span). */
const REACH = 0.5;
const SIZE_SPREAD = 0.8;
/** Where in its square a colony stands: from this share in from each side, over the rest. */
const INSET = 0.15;
/** Squares hash their numbers within a repeat of this many: the hash loses its evenness on large ones. */
const REPEAT = 1024;
/**
 * A colony is not a disc: its edge goes in and out round it (two lobes and a bulge, each turned its own
 * way: shares of its reach), and plant by plant at its edge some stand in and some out (`FRAY`, a share of
 * its reach either way), as a patch grown from runners and seed has a ragged edge.
 */
const LOBES = 0.2;
const BULGE = 0.12;
const FRAY = 0.16;
/** The scale of the fray's noise: finer than a plant's spacing, so it is a plant's own. */
const FRAY_SCALE = 29.7;

const f = Math.fround;

/** Salts that keep each member's squares apart from the others': the shaders' are the same. */
export function memberSalt(j: number): number {
  return 11 + j * 17;
}

/**
 * Whether a place is in one of a member's colonies, given the chance that a square has one (`kept`): the
 * twin of the shaders' `inColony` (mix.ts). The shaders' numbers are 32-bit; these are rounded to them where
 * the hash reads them, which is where a difference would move a colony.
 */
export function inColony(x: number, z: number, size: number, kept: number, salt: number): boolean {
  const gx = Math.floor(x / size);
  const gz = Math.floor(z / size);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx;
      const cz = gz + dz;
      const hx = f(f(((cx % REPEAT) + REPEAT) % REPEAT) + f(salt * 0.731));
      const hz = f(f(((cz % REPEAT) + REPEAT) % REPEAT) + f(salt * 0.317));
      if (hashCell(f(hx + f(2.9)), f(hz + f(2.9))) >= kept) continue;
      const ox = hashCell(f(hx + f(1.3)), f(hz + f(1.3)));
      const oz = hashCell(f(hx + f(7.9)), f(hz + f(7.9)));
      const centreX = (cx + INSET + ox * (1 - 2 * INSET)) * size;
      const centreZ = (cz + INSET + oz * (1 - 2 * INSET)) * size;
      const reach = size * REACH * Math.exp((hashCell(f(hx + f(4.1)), f(hz + f(4.1))) - 0.5) * SIZE_SPREAD);
      const d = Math.hypot(x - centreX, z - centreZ);
      if (d > reach * (1 + LOBES + BULGE + FRAY)) continue;
      if (d <= reach * (1 - LOBES - BULGE - FRAY)) return true;
      if (edgeAt(x, z, (x - centreX) / d, (z - centreZ) / d, hashCell(f(hx + f(5.3)), f(hz + f(5.3))), hashCell(f(hx + f(6.7)), f(hz + f(6.7)))) * reach >= d) return true;
    }
  }
  return false;
}

/**
 * How far a colony's edge is from its middle in a direction (`nx`, `nz`, of length one), as a share of its
 * reach, its lobes and bulge turned by its own two numbers (`a`, `b`, 0..1), frayed by the place itself.
 */
export function edgeAt(x: number, z: number, nx: number, nz: number, a: number, b: number): number {
  const lobes = 2 * (nx * Math.cos(a * 6.2832) + nz * Math.sin(a * 6.2832)) ** 2 - 1;
  const bulge = nx * Math.cos(b * 6.2832) + nz * Math.sin(b * 6.2832);
  const fray = hashCell(f(x * FRAY_SCALE), f(z * FRAY_SCALE)) * 2 - 1;
  return 1 + LOBES * lobes + BULGE * bulge + FRAY * fray;
}

/** The share of the ground a member's colonies cover for a chance `kept`, over a fixed spread of places. */
function coverFor(size: number, kept: number, salt: number): number {
  const n = 96;
  let hit = 0;
  // (Places on a grid 2.37 squares apart, over 96 by 96 of them: far more squares than any colony touches twice.)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (inColony((i * 2.37 + 0.11) * size, (j * 2.37 + 0.53) * size, size, kept, salt)) hit++;
  return hit / (n * n);
}

/** The most of the ground the `j`th member's colonies can cover: every square with one. About 0.6. */
export function mostCover(j: number, size = 1): number {
  return coverFor(size, 1.01, memberSalt(j));
}

/**
 * Each member's chance that a square has a colony, so that the member takes its share of the stand: a member
 * has the ground its colonies cover that no member before it has, so it needs its share of what is left.
 * Worked out by halving on the twin itself. Throws on shares that cannot be had: more than the whole stand
 * between them, or more of what is left than a member's colonies can cover.
 */
export function mixChances(mix: GrassMix): number[] {
  // (Some 70 ms a member: once for each mix a page asks about.)
  const key = JSON.stringify(mix.members.map((m) => [m.share, m.patchSize, m.chance ?? null]));
  const known = worked.get(key);
  if (known) return known.slice();
  let left = 1;
  const chances = mix.members.map((m, j) => {
    if (!(m.share >= 0) || !(m.patchSize > 0)) throw new Error(`A mix's member wants a share of 0 or more and a patch size over 0, not ${m.share} and ${m.patchSize}`);
    const want = m.share / left;
    const most = mostCover(j, m.patchSize);
    if (left - m.share < -1e-9) throw new Error(`The members of a mix take more than the whole stand`);
    if (want > most) throw new Error(`A member can take at most ${Math.round(most * 100)}% of what the members before it leave; this one wants ${Math.round(want * 100)}%`);
    left -= m.share;
    if (m.chance !== undefined) return Math.min(1.01, Math.max(0, m.chance));
    if (want <= 0) return 0;
    let lo = 0;
    let hi = 1.01;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (coverFor(m.patchSize, mid, memberSalt(j)) < want) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  });
  worked.set(key, chances);
  return chances.slice();
}

/** The chances worked out so far, by their members' shares and sizes. */
const worked = new Map<string, number[]>();

/** Which grass of a mix grows at a place: the twin of what `mixedMap` says there. */
export function mixAt(mix: GrassMix, chances: readonly number[], x: number, z: number): number {
  for (let j = 0; j < mix.members.length; j++) {
    const m = mix.members[j];
    if (chances[j] > 0 && inColony(x, z, m.patchSize, chances[j], memberSalt(j))) return m.species;
  }
  return mix.species;
}
