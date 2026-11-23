// A species: what one kind of grass is. Its shape and behaviour, as plain
// data, so a stand of grass is described and not programmed.
//
// Everything here is read by the shaders from one table (`packSpecies`), a
// row to a species. Adding a species adds a row; nothing in the shaders
// names one.

import * as THREE from "three/webgpu";

/** How a leaf ends: grown to a point, cut by a mower on a slant, or cut off square as close-mown turf is. */
export type TipShape = "point" | "cut" | "square";

export interface Species {
  name: string;

  // The stand.
  /** How tall the stand is (m). */
  height: number;
  /** How much its leaves differ in height, 0 (cut to one height) to 1 (half to one and a half times it). */
  heightSpread: number;
  /**
   * How thick it grows. Up to 1, the share of a sward's plants that grow: a
   * wiry grass is thin on the ground. Above 1, every plant grows and has
   * more leaves, in proportion: 2 is twice the leaves. (As far as the
   * layers allow: `GrassLayer.blades`, a third of it. The far tufts stop at 1.)
   */
  density: number;
  /** Whether it is drawn as tufts beyond the fine leaves (tall grass) or left to the ground there (mown turf). */
  tufted: boolean;

  // The leaf.
  /** A leaf's breadth at its widest, edge to edge (m), and how much more the broadest have. */
  width: number;
  widthSpread: number;
  tip: TipShape;
  /** How far leaves lean out from their root, 0 (upright pile) to 1 and over (sprawling). */
  splay: number;
  /** How far a leaning leaf's tip hangs, 0 (stiff) to 1 and over. */
  droop: number;
  /** How far leaves are turned from square-on and twist up their length, 0..1. */
  twist: number;
  /** A seed head on a thin stalk, 0 (a plain leaf) to 1. */
  seedHead: number;

  // How it behaves.
  /** How little the wind moves it, 0 (lies down in a gust) to 1 (does not stir). */
  stiffness: number;
  /** How strongly it grows in clumps, taller at their centres, 0..1. */
  clump: number;
  /** How uneven it is over a stride: height, lean and thickness, 0 (combed) to 1. */
  disorder: number;

  // Its colour. Hex colours are sRGB.
  color: string;
  /** What a leaf's colour is multiplied by towards its tip. */
  tipTint: [number, number, number];
  /** What a seed head's is. */
  seedTint: [number, number, number];
  /** How dark a leaf is at its root, where the stand shades itself: 1 is no darker. */
  rootShade: number;
  /** How much one leaf differs in tone from the next, 0..1. */
  variation: number;
  /** The share of leaves that are dead and straw-coloured, 0..1. */
  dry: number;
  /** How waxy a leaf is: the light it catches where it bends over, 0..1. */
  sheen: number;
  /**
   * How far the mower's roller lays it over, 0 (it stands as it grew) to 1:
   * what makes a mown sward's stripes. Where it is laid, and which way, is
   * the field's (`GrassOptions.mow`).
   */
  lay: number;

  // The ground under it (its picture is the field's: `Grass.bakeGround`, `Grass.setGroundPicture`).
  /** How much of the ground's picture shows: the leaves lying on it, and the dark between them, 0..1. */
  groundDetail: number;
  /** How much ground one copy of the picture covers (m), edge to edge. */
  groundTile: number;

  // A picture on the leaf (the host gives the pictures their names: `Grass.setLeafTextures`).
  /** The picture's name, or "" for a plain leaf. It runs root to tip up the picture, the leaf's breadth across it. */
  leafTexture: string;
  /**
   * What the picture is. "detail": the leaf's own colour, lighter and
   * darker as the picture is (mid grey leaves it alone): ribs, veins,
   * blotches. "color": the picture is the leaf's colour.
   */
  textureMode: TextureMode;
  /** How much of the picture shows, 0..1. */
  textureStrength: number;
  /**
   * The picture's transparency is the leaf's outline: the leaf is drawn as
   * a plain strip and cut to it, so it can be a seed head, a toothed leaf,
   * a flower.
   */
  textureCutout: boolean;
}

export type TextureMode = "detail" | "color";

/** Rows in the table. A map's species numbers are below this; `NO_GRASS` is not. */
export const MAX_SPECIES = 8;
/** Four numbers to a slot, this many slots to a species. */
export const SPECIES_SLOTS = 10;

const TIP_CODE: Record<TipShape, number> = { point: 0, cut: 1, square: 2 };

/** One uniform-array entry to a slot, a row to a species: made once, then written into by `packSpecies`. */
export function makeSpeciesTable(): THREE.Vector4[] {
  return Array.from({ length: MAX_SPECIES * SPECIES_SLOTS }, () => new THREE.Vector4());
}

/**
 * Write the species into the table the shaders read. The slots:
 *
 *   0  height, heightSpread, density, tufted
 *   1  width, widthSpread, splay, droop
 *   2  tip (0 point, 1 cut, 2 square), twist, seedHead, stiffness
 *   3  clump, disorder, rootShade, variation
 *   4  colour (linear r, g, b), sheen
 *   5  tipTint r, g, b, dry
 *   6  seedTint r, g, b, lay
 *   7  the picture's layer (-1 for none), its strength, its mode (0 detail, 1 colour), cut-out
 *   8  the ground's picture: how much shows (0 if it has none), its tile (m)
 *   9  the ground's picture's own mean colour (linear r, g, b)
 *
 * `layers` gives each picture's name its layer in the leaf texture.
 */
export function packSpecies(
  list: readonly Species[],
  table: THREE.Vector4[],
  layers: ReadonlyMap<string, number> = new Map(),
  ground: readonly ({ mean: readonly [number, number, number] } | null)[] = [],
): void {
  if (list.length > MAX_SPECIES) throw new Error(`At most ${MAX_SPECIES} species, got ${list.length}`);
  const c = new THREE.Color();
  for (let k = 0; k < MAX_SPECIES; k++) {
    const s = list[k];
    const row = k * SPECIES_SLOTS;
    if (!s) {
      for (let i = 0; i < SPECIES_SLOTS; i++) table[row + i].set(0, 0, 0, 0);
      continue;
    }
    c.set(s.color);
    table[row].set(s.height, s.heightSpread, s.density, s.tufted ? 1 : 0);
    table[row + 1].set(s.width, s.widthSpread, s.splay, s.droop);
    table[row + 2].set(TIP_CODE[s.tip], s.twist, s.seedHead, s.stiffness);
    table[row + 3].set(s.clump, s.disorder, s.rootShade, s.variation);
    table[row + 4].set(c.r, c.g, c.b, s.sheen);
    table[row + 5].set(s.tipTint[0], s.tipTint[1], s.tipTint[2], s.dry);
    table[row + 6].set(s.seedTint[0], s.seedTint[1], s.seedTint[2], s.lay);
    const layer = layers.get(s.leafTexture) ?? -1;
    table[row + 7].set(layer, layer < 0 ? 0 : s.textureStrength, s.textureMode === "color" ? 1 : 0, layer >= 0 && s.textureCutout ? 1 : 0);
    const under = ground[k] ?? null;
    table[row + 8].set(under ? s.groundDetail : 0, Math.max(0.05, s.groundTile), 0, 0);
    table[row + 9].set(under?.mean[0] ?? 1, under?.mean[1] ?? 1, under?.mean[2] ?? 1, 0);
  }
}

/** A plain leaf: what a species written before leaves had pictures is given. */
const NO_TEXTURE = { leafTexture: "", textureMode: "detail" as TextureMode, textureStrength: 1, textureCutout: false };
/** What a species written before these were settings is given: a plain leaf, standing as it grew. */
const ADDED_LATER = { ...NO_TEXTURE, lay: 0, groundDetail: 1, groundTile: 0.6 };

/**
 * Six stands to start from, short to tall. They are the surfaces of a golf
 * course as Couch Golf Club draws them, turned into rows, with a hay meadow
 * added to show the range. They are starting points for the lab, not
 * botany: no row here has been set against a photograph of a named grass.
 * Their leaves are a real leaf's breadth, 2 to 5 mm (the game drew few
 * leaves and made them several times that), which they can be because the
 * ground under them carries what leaves cannot be drawn.
 */
export const STARTER_SPECIES: Species[] = [
  {
    name: "Close-mown turf",
    height: 0.0085, heightSpread: 0.1, density: 1, tufted: false,
    width: 0.0018, widthSpread: 0.0008, tip: "square", splay: 0.3, droop: 0.3, twist: 0, seedHead: 0,
    stiffness: 1, clump: 0, disorder: 0.3,
    color: "#5a9a3c", tipTint: [1.06, 1.06, 0.96], seedTint: [1, 1, 1], rootShade: 0.72, variation: 0.2, dry: 0.01, sheen: 0,
    ...NO_TEXTURE,
    groundDetail: 1,
    groundTile: 0.6,
    lay: 1,
  },
  {
    name: "Mown sward",
    height: 0.03, heightSpread: 0.16, density: 1, tufted: false,
    width: 0.0022, widthSpread: 0.001, tip: "cut", splay: 1, droop: 1, twist: 1, seedHead: 0,
    stiffness: 1, clump: 0, disorder: 0.4,
    color: "#4f8d38", tipTint: [1.07, 1.06, 0.94], seedTint: [1, 1, 1], rootShade: 0.66, variation: 0.22, dry: 0.02, sheen: 0.4,
    ...NO_TEXTURE,
    groundDetail: 1,
    groundTile: 0.6,
    lay: 0.5,
  },
  {
    name: "Rough",
    height: 0.06, heightSpread: 0.4, density: 1, tufted: true,
    width: 0.003, widthSpread: 0.002, tip: "point", splay: 1, droop: 1, twist: 1, seedHead: 0,
    stiffness: 0.75, clump: 1, disorder: 1,
    color: "#447a33", tipTint: [1.12, 1.08, 0.86], seedTint: [1, 1, 1], rootShade: 0.55, variation: 0.24, dry: 0.035, sheen: 1,
    ...NO_TEXTURE,
    groundDetail: 1,
    groundTile: 0.6,
    lay: 0,
  },
  {
    name: "Deep rough",
    height: 0.1, heightSpread: 0.4, density: 1, tufted: true,
    width: 0.0035, widthSpread: 0.0025, tip: "point", splay: 1, droop: 1, twist: 1, seedHead: 0,
    stiffness: 0.4, clump: 1, disorder: 1,
    color: "#3a6a2e", tipTint: [1.12, 1.08, 0.86], seedTint: [1, 1, 1], rootShade: 0.45, variation: 0.24, dry: 0.05, sheen: 1,
    ...NO_TEXTURE,
    groundDetail: 1,
    groundTile: 0.6,
    lay: 0,
  },
  {
    name: "Fescue in seed",
    height: 0.2, heightSpread: 0.9, density: 0.32, tufted: true,
    width: 0.0016, widthSpread: 0.001, tip: "point", splay: 1, droop: 1, twist: 1, seedHead: 1,
    stiffness: 0, clump: 1, disorder: 1,
    color: "#9a9455", tipTint: [1.1, 1.08, 0.9], seedTint: [1.55, 1.34, 0.9], rootShade: 0.4, variation: 0.2, dry: 0.14, sheen: 0.6,
    ...NO_TEXTURE,
    groundDetail: 1,
    groundTile: 0.6,
    lay: 0,
  },
  {
    name: "Hay meadow",
    height: 0.45, heightSpread: 0.7, density: 0.6, tufted: true,
    width: 0.005, widthSpread: 0.003, tip: "point", splay: 0.8, droop: 1.3, twist: 1, seedHead: 0.6,
    stiffness: 0, clump: 0.7, disorder: 1,
    color: "#63883a", tipTint: [1.12, 1.08, 0.86], seedTint: [1.5, 1.3, 0.95], rootShade: 0.35, variation: 0.26, dry: 0.08, sheen: 0.8,
    ...NO_TEXTURE,
    groundDetail: 1,
    groundTile: 0.6,
    lay: 0,
  },
];

/** A copy that shares nothing with the original, for the lab's editing and for presets. */
export function cloneSpecies(list: readonly Species[]): Species[] {
  return list.map((s) => ({ ...ADDED_LATER, ...s, tipTint: [...s.tipTint], seedTint: [...s.seedTint] }));
}

/** Whether a parsed preset is a list of species this version can draw; the reason if not. */
export function checkSpecies(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return "not a list of species";
  if (value.length > MAX_SPECIES) return `more than ${MAX_SPECIES} species`;
  const model = STARTER_SPECIES[0] as unknown as Record<string, unknown>;
  for (const [i, s] of value.entries()) {
    if (typeof s !== "object" || s === null) return `species ${i} is not an object`;
    const row = s as Record<string, unknown>;
    for (const key of Object.keys(model)) {
      const want = model[key];
      // (A preset from before a setting was added has not got it: `cloneSpecies` fills it in.)
      if (key in ADDED_LATER && !(key in row)) continue;
      const got = row[key];
      if (Array.isArray(want)) {
        if (!Array.isArray(got) || got.length !== want.length || got.some((n) => typeof n !== "number" || !Number.isFinite(n))) return `species ${i}: ${key} is not ${want.length} numbers`;
      } else if (typeof got !== typeof want || (typeof got === "number" && !Number.isFinite(got))) {
        return `species ${i}: ${key} is missing or not a ${typeof want}`;
      }
    }
    if (!(row.tip as string in TIP_CODE)) return `species ${i}: tip is not point, cut or square`;
    if (!/^#[0-9a-f]{6}$/i.test(row.color as string)) return `species ${i}: color is not a hex colour`;
    if ("textureMode" in row && row.textureMode !== "detail" && row.textureMode !== "color") return `species ${i}: textureMode is not detail or color`;
  }
  return null;
}

const turf = (name: string, from: number, set: Partial<Species>): Species => ({ ...STARTER_SPECIES[from], ...set, name });

/**
 * Eight named grasses, as they are kept: the four a golf course is mostly
 * made of (creeping bent, perennial rye, fine fescue, bermuda), a lawn's
 * bluegrass, and two left to grow. The heights are mowing heights in use;
 * the leaf widths are the species' own, from turf references (bent and
 * fine fescue under a millimetre, bermuda 1.5 to 2, rye and bluegrass 2 to
 * 4). The colours and the habit were set by eye beside photographs in the
 * lab: a likeness, not a measurement.
 *
 * In the order of the lab's plot: short to tall for the first six.
 */
export const TURF_SPECIES: Species[] = [
  turf("Creeping bent, green", 0, {
    height: 0.0035, heightSpread: 0.08, density: 2, width: 0.0009, widthSpread: 0.0003, tip: "cut",
    splay: 0.25, droop: 0.2, stiffness: 1, disorder: 0.25, color: "#4c8a3a", tipTint: [1.06, 1.08, 0.94], rootShade: 0.74, variation: 0.24,
    dry: 0.005, sheen: 0, lay: 1, groundTile: 0.35,
  }),
  turf("Perennial rye, fairway", 1, {
    height: 0.013, heightSpread: 0.12, density: 1.5, width: 0.0026, widthSpread: 0.001, tip: "cut",
    splay: 0.7, droop: 0.6, twist: 0.6, stiffness: 1, disorder: 0.35, color: "#3f8a35", tipTint: [1.1, 1.09, 0.98], rootShade: 0.68,
    variation: 0.2, dry: 0.01, sheen: 1, lay: 0.85, groundTile: 0.5,
  }),
  turf("Perennial rye, rough", 2, {
    height: 0.055, heightSpread: 0.3, density: 1, width: 0.0032, widthSpread: 0.0012, tip: "point",
    splay: 1, droop: 1.2, stiffness: 0.7, clump: 0.7, disorder: 0.9, color: "#4a9440", tipTint: [1.1, 1.1, 0.92], rootShade: 0.5,
    variation: 0.22, dry: 0.02, sheen: 1,
  }),
  turf("Red fescue, deep rough", 3, {
    height: 0.11, heightSpread: 0.5, density: 1.4, width: 0.0009, widthSpread: 0.0004, tip: "point",
    splay: 1.1, droop: 1.5, stiffness: 0.25, clump: 1, disorder: 1, color: "#4f9638", tipTint: [1.12, 1.12, 0.88], rootShade: 0.5,
    variation: 0.24, dry: 0.05, sheen: 0.5,
  }),
  turf("Fescue in seed", 4, { color: "#8c9862", tipTint: [1.08, 1.08, 0.94], seedTint: [1.42, 1.38, 1.02], dry: 0.2, density: 0.38 }),
  turf("Hay meadow", 5, {}),
  turf("Bermuda, fairway", 1, {
    height: 0.011, heightSpread: 0.1, density: 1.8, width: 0.0017, widthSpread: 0.0005, tip: "point",
    splay: 0.9, droop: 0.3, twist: 0.3, stiffness: 1, disorder: 0.45, color: "#68a53f", tipTint: [1.1, 1.1, 0.9], rootShade: 0.62,
    variation: 0.26, dry: 0.03, sheen: 0.5, lay: 0.7, groundTile: 0.5,
  }),
  turf("Kentucky bluegrass, lawn", 2, {
    height: 0.06, heightSpread: 0.2, density: 1.3, tufted: false, width: 0.003, widthSpread: 0.001, tip: "cut",
    splay: 0.8, droop: 0.9, stiffness: 0.85, clump: 0.3, disorder: 0.6, color: "#39793d", tipTint: [1.08, 1.08, 0.96], rootShade: 0.55,
    variation: 0.18, dry: 0.01, sheen: 0.5, lay: 0.4,
  }),
];
