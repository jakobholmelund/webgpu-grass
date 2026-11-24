// A flower: what blooms among a species' grass, as plain data. Like a species, it is described and not
// programmed: the shaders name none, and adding one adds an entry.
//
// The way a head is built (each petal a small curved surface about the stem's tip, by how far it
// reaches, how it lifts and how broad it is, with nearer and further drawings of it) follows Inkwell's
// WebGPU flower field (github.com/siliconjungle/inkwell-webgpu-flowers, MIT). Nothing of its code or
// its painted flowers is here.

import * as THREE from "three/webgpu";

export interface Flower {
  name: string;
  /** Petals to a head, as drawn: up to `MAX_PETALS`. (A daisy has thirty-odd rays; half as many, a little broader, read the same from a stride off.) */
  petals: number;
  /** A petal's length and its breadth at its widest (m). */
  petalLength: number;
  petalWidth: number;
  /** How far the petals rise from flat, 0 (a disc: a daisy open in the sun) to 1 (a ball: a clover's head). */
  lift: number;
  /** The breadth of the disc at the head's middle (m). */
  centre: number;
  /** How tall it stands (m). In grass taller than that it stands a little over the grass. */
  stem: number;
  /** Hex colours, sRGB. */
  petalColor: string;
  centreColor: string;
}

/**
 * One flower in a species' grass (`Species.blooms`): which, how many, on how much of the ground, and where.
 */
export interface Bloom {
  /** The flower, by its name in the flowers the grass was given (`FLOWERS`, and the host's own). */
  flower: string;
  /** Flowers to the square metre where they bloom. All a species' blooms together come to at most about 40: further off a flower is a dot, and there are only so many dots. */
  perM2: number;
  /** The share of the stand's ground they bloom on, 0..1: flowers come in drifts, not evenly. Each of a species' flowers has drifts of its own. */
  cover: number;
  /**
   * Where on the ground they take, -1..1: in the hollows, where water gathers and stays (-1: creeping
   * buttercup), on the crowns and banks, which dry first (1: cat's-ear, clover on thin soil), or anywhere
   * (0). By the ground's own shape, as a species' patches are (`Species.patchSite`).
   */
  site: number;
  /**
   * "drifts" (its own drifts, `cover` of the ground), or "patches": it flowers only in the species'
   * patches, as white clover flowers where the clover is (`Species.patch`, which then says how much of
   * the ground that is; `cover` is not used).
   */
  where: "drifts" | "patches";
}

/** The most flowers one species has in it. */
export const MAX_BLOOMS = 4;
/** The most kinds of flower the grass draws at once, all its species' together. */
export const MAX_FLOWERS = 16;
/** The most petals a head is drawn with. */
export const MAX_PETALS = 16;
/** Four numbers to a slot, this many slots to a flower. */
export const FLOWER_SLOTS = 4;

/**
 * Ten that grow in grass. Sizes from the floras (Stace; Clapham, Tutin and Moore): a daisy's head 16 to
 * 25 mm across on a stalk 3 to 12 cm; a creeping buttercup's flower 2 to 3 cm, five glossy petals; a
 * dandelion's head 25 to 40 mm of strap-shaped florets; white clover's a ball 15 to 20 mm across. Those
 * four flower in mown grass, and so do slender speedwell (a pale blue flower 8 to 12 mm across, four
 * petals, on a thread of a stalk: a lawn's) and selfheal (a head 1 to 3 cm of violet two-lipped flowers,
 * on 5 to 30 cm). Grass left long has the taller ones: ox-eye daisy (a head 25 to 50 mm across, on 20 to
 * 70 cm), red clover (a ball 15 to 30 mm, pink-purple, on 10 to 40 cm), cat's-ear (a head 25 to 40 mm, on
 * a branched stalk 20 to 60 cm), common knapweed (a brush of purple florets 2 to 4 cm across on a dark
 * knob, on 30 to 80 cm).
 *
 * Colours by eye. Each is drawn as petals about a centre, which is what a daisy is; the others are as
 * near as that comes: selfheal's head is an oblong spike, not a ball, and a knapweed's dark knob under
 * its florets is not drawn. What it cannot draw at all: an umbel (yarrow), bells (harebell, heather), a
 * pea flower (bird's-foot trefoil), a spike of many (plantain).
 */
export const FLOWERS: Record<string, Flower> = {
  daisy: { name: "Daisy", petals: 16, petalLength: 0.0085, petalWidth: 0.003, lift: 0.1, centre: 0.007, stem: 0.07, petalColor: "#f1f1ea", centreColor: "#e3bd1c" },
  buttercup: { name: "Creeping buttercup", petals: 5, petalLength: 0.0105, petalWidth: 0.0105, lift: 0.4, centre: 0.006, stem: 0.18, petalColor: "#f0cf12", centreColor: "#c7a90c" },
  dandelion: { name: "Dandelion", petals: 16, petalLength: 0.015, petalWidth: 0.0038, lift: 0.18, centre: 0.011, stem: 0.11, petalColor: "#f2c90f", centreColor: "#e8b70a" },
  clover: { name: "White clover", petals: 16, petalLength: 0.0075, petalWidth: 0.0034, lift: 0.95, centre: 0.006, stem: 0.06, petalColor: "#ece8dc", centreColor: "#d9d2bd" },
  speedwell: { name: "Slender speedwell", petals: 4, petalLength: 0.0045, petalWidth: 0.0042, lift: 0.12, centre: 0.0018, stem: 0.045, petalColor: "#93a6e4", centreColor: "#ecedf4" },
  selfheal: { name: "Selfheal", petals: 12, petalLength: 0.0075, petalWidth: 0.0042, lift: 1, centre: 0.008, stem: 0.07, petalColor: "#7058ad", centreColor: "#4f3d78" },
  oxeye: { name: "Ox-eye daisy", petals: 16, petalLength: 0.014, petalWidth: 0.0042, lift: 0.08, centre: 0.014, stem: 0.45, petalColor: "#f3f3ec", centreColor: "#e0b014" },
  redClover: { name: "Red clover", petals: 16, petalLength: 0.0095, petalWidth: 0.0038, lift: 0.95, centre: 0.008, stem: 0.22, petalColor: "#c45d8f", centreColor: "#a5487a" },
  catsear: { name: "Cat's-ear", petals: 16, petalLength: 0.0125, petalWidth: 0.003, lift: 0.22, centre: 0.008, stem: 0.32, petalColor: "#f0c41a", centreColor: "#d9a612" },
  knapweed: { name: "Common knapweed", petals: 16, petalLength: 0.009, petalWidth: 0.0022, lift: 0.7, centre: 0.012, stem: 0.5, petalColor: "#9a5aa2", centreColor: "#7d4483" },
};

/** One uniform-array entry to a slot, a row to a flower: made once, then written into by `packFlowers`. */
export function makeFlowerTable(): THREE.Vector4[] {
  return Array.from({ length: MAX_FLOWERS * FLOWER_SLOTS }, () => new THREE.Vector4());
}

/**
 * Write the flowers `used` names into the table the shaders read, in that order, and say which row each
 * is. The slots:
 *
 *   0  a petal's length and width, its lift, the centre's breadth
 *   1  petals, how tall it stands
 *   2  the petals' colour (linear r, g, b)
 *   3  the centre's colour (linear r, g, b)
 */
export function packFlowers(used: readonly string[], table: THREE.Vector4[], flowers: Readonly<Record<string, Flower>>): Map<string, number> {
  const at = new Map<string, number>();
  const c = new THREE.Color();
  for (const name of used) {
    const f = flowers[name];
    if (!f || at.has(name)) continue;
    if (at.size >= MAX_FLOWERS) throw new Error(`At most ${MAX_FLOWERS} kinds of flower, got more`);
    const row = at.size * FLOWER_SLOTS;
    table[row].set(f.petalLength, f.petalWidth, Math.min(1, Math.max(0, f.lift)), f.centre);
    table[row + 1].set(Math.min(MAX_PETALS, Math.max(3, Math.round(f.petals))), f.stem, 0, 0);
    c.set(f.petalColor);
    table[row + 2].set(c.r, c.g, c.b, 0);
    c.set(f.centreColor);
    table[row + 3].set(c.r, c.g, c.b, 0);
    at.set(name, at.size);
  }
  return at;
}
