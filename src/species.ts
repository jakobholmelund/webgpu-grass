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

  /**
   * The share of its mown leaves whose cut ends have died back to straw, 0..1: few behind a sharp reel
   * (a green), most behind a rotary that tears (rough). Nothing for a grass that is not mown.
   */
  cutTip: number;

  // Its edge, where other grass begins.
  /**
   * How far its edge strays into it (m). 0 is a mown edge: a mower cuts to a line, and the grass is one
   * height on this side and another on that. More is an edge nobody keeps: the neighbour comes in among
   * it in tongues and single plants over about this far, and the two heights run into each other.
   */
  edgeBlend: number;

  // Patches: no stand is one thing. Part of its ground is another grass that came in (annual meadow-grass
  // in a bent green, brighter and a little taller), or the same grass doing worse (drought, which browns
  // a lawn in patches and not evenly), or something low and dark among it. One kind of patch to a species.
  /**
   * What the patches are. "colonies": plants that came in and spread, each a disc grown out from where it
   * landed, alike within itself and a little unlike the next (annual meadow-grass in a bent green was
   * measured at 10 cm to 2.5 m across, 50 cm on average: Poole and Johnston; clover likewise). "blotches":
   * the stand's own grass doing worse or better where the ground makes it, in odd shapes with hazy edges
   * (drought, which greenkeepers call a camouflage pattern).
   */
  patchKind: PatchKind;
  /**
   * Where the patches take, -1..1: on the crowns and knolls, which dry out first (1), in the hollows,
   * where water gathers and stays (-1), or anywhere (0). By the ground's own shape: see `look.site`.
   */
  patchSite: number;
  /** The share of the stand's ground that is in patches, 0..1 (0: none). */
  patch: number;
  /** How far across a patch is, roughly (m). */
  patchSize: number;
  /** The colour of the grass in a patch, as multipliers on the species' own. */
  patchTint: [number, number, number];
  /** How tall the grass in a patch is, as a multiple of the species' height. */
  patchTall: number;

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
export type PatchKind = "colonies" | "blotches";
export const SPECIES_SLOTS = 12;

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
 *        (and in z, w: patchSize, patchTall)
 *  10  patchTint r, g, b, patch
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
    table[row + 8].set(under ? s.groundDetail : 0, Math.max(0.05, s.groundTile), Math.max(0.02, s.patchSize), s.patchTall);
    table[row + 11].set(Math.min(1, Math.max(-1, s.patchSite)), Math.max(0, s.edgeBlend), Math.min(1, Math.max(0, s.cutTip)), 0);
    table[row + 10].set(s.patchTint[0], s.patchTint[1], s.patchTint[2], Math.min(1, Math.max(0, s.patch)));
    table[row + 9].set(under?.mean[0] ?? 1, under?.mean[1] ?? 1, under?.mean[2] ?? 1, s.patchKind === "blotches" ? 1 : 0);
  }
}

/** A plain leaf: what a species written before leaves had pictures is given. */
const NO_TEXTURE = { leafTexture: "", textureMode: "detail" as TextureMode, textureStrength: 1, textureCutout: false };
/** What a species written before these were settings is given: a plain leaf, standing as it grew. */
const NO_PATCHES = { cutTip: 0, edgeBlend: 0, patchKind: "colonies" as PatchKind, patchSite: 0, patch: 0, patchSize: 0.4, patchTint: [1.1, 1.12, 0.88] as [number, number, number], patchTall: 1 };
const ADDED_LATER = { ...NO_TEXTURE, ...NO_PATCHES, lay: 0, groundDetail: 1, groundTile: 0.6 };

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
    ...NO_PATCHES,
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
    ...NO_PATCHES,
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
    ...NO_PATCHES,
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
    ...NO_PATCHES,
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
    ...NO_PATCHES,
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
    ...NO_PATCHES,
    groundDetail: 1,
    groundTile: 0.6,
    lay: 0,
  },
];

/** A copy that shares nothing with the original, for the lab's editing and for presets. */
export function cloneSpecies(list: readonly Species[]): Species[] {
  return list.map((s) => ({ ...ADDED_LATER, ...s, tipTint: [...s.tipTint], seedTint: [...s.seedTint], patchTint: [...(s.patchTint ?? NO_PATCHES.patchTint)] }));
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
 * A golf course's surfaces, short to tall, as eight named stands: the green, its collar, the fairway, the
 * first cut, the rough, deep rough, and two that nobody mows. (A mown grass's leaves are narrower than
 * the same grass's left to grow: a rye leaf is 2 to 4 mm in the books and about 2 mm in a fairway.) The heights are heights of cut in use (see
 * the README for where each comes from); the leaf widths are the species' own, from turf references
 * (bent and fine fescue under a millimetre, rye 2 to 4). The colours and the habit were set by eye: a
 * likeness, not a measurement.
 *
 * The mown ones have mown edges (`edgeBlend` 0); deep rough, fescue and meadow run into their neighbours.
 * In the order of the lab's plot.
 */
export const TURF_SPECIES: Species[] = [
  turf("Green (creeping bent)", 0, { cutTip: 0.12,
    height: 0.0032, heightSpread: 0.08, density: 2, width: 0.0009, widthSpread: 0.0003, tip: "cut",
    splay: 0.25, droop: 0.2, stiffness: 1, disorder: 0.25, color: "#538440", tipTint: [1.03, 1.04, 0.98], rootShade: 0.8, variation: 0.13,
    dry: 0.005, sheen: 0, lay: 1, groundTile: 0.35,
    // (Annual meadow-grass in it, as nearly every bent green has within a few years. It gets in where the green stays wet.)
    patchSite: -0.7, patch: 0.16, patchSize: 0.5, patchTint: [1.08, 1.1, 0.9], patchTall: 1.06,
  }),
  turf("Collar (creeping bent)", 0, { cutTip: 0.18,
    height: 0.008, heightSpread: 0.1, density: 2, width: 0.0011, widthSpread: 0.0004, tip: "cut",
    splay: 0.4, droop: 0.3, stiffness: 1, disorder: 0.3, color: "#4f8640", tipTint: [1.04, 1.05, 0.97], rootShade: 0.76, variation: 0.15,
    dry: 0.005, sheen: 0, lay: 1, groundTile: 0.4,
    patchSite: -0.7, patch: 0.12, patchSize: 0.5, patchTint: [1.08, 1.1, 0.9], patchTall: 1.06,
  }),
  turf("Fairway (perennial rye)", 1, { cutTip: 0.3,
    height: 0.011, heightSpread: 0.12, density: 1.5, width: 0.0018, widthSpread: 0.0006, tip: "cut",
    splay: 0.7, droop: 0.6, twist: 0.6, stiffness: 1, disorder: 0.35, color: "#3f8a35", tipTint: [1.06, 1.06, 0.97], rootShade: 0.68,
    variation: 0.2, dry: 0.01, sheen: 1, lay: 0.85, groundTile: 0.5,
  }),
  turf("First cut (perennial rye)", 1, { cutTip: 0.5,
    height: 0.032, heightSpread: 0.16, density: 1.6, width: 0.002, widthSpread: 0.0007, tip: "cut",
    splay: 0.6, droop: 0.5, twist: 0.8, stiffness: 0.95, disorder: 0.35, color: "#47963a", tipTint: [1.06, 1.06, 0.96], rootShade: 0.36,
    variation: 0.3, dry: 0.015, sheen: 1, lay: 0.5, groundTile: 0.6,
  }),
  // (Mown, as rough is on every course: a level top of cut ends, not a wild stand's own tips.)
  turf("Rough (rye and bluegrass)", 2, { cutTip: 0.6,
    height: 0.064, heightSpread: 0.3, density: 1.4, width: 0.0024, widthSpread: 0.0008, tip: "cut",
    splay: 0.8, droop: 0.7, stiffness: 0.9, clump: 0.4, disorder: 0.5, color: "#4a9440", tipTint: [1.07, 1.07, 0.95], rootShade: 0.34,
    variation: 0.3, dry: 0.02, sheen: 1,
    // (Something low and dark among it: clover, where nobody sprays.)
    patch: 0.08, patchSize: 0.66, patchTint: [0.72, 0.95, 0.72], patchTall: 0.7,
  }),
  turf("Deep rough (red fescue)", 3, {
    height: 0.125, heightSpread: 0.5, density: 1.4, width: 0.0009, widthSpread: 0.0004, tip: "point",
    splay: 1.1, droop: 1.5, stiffness: 0.25, clump: 1, disorder: 1, color: "#4f9638", tipTint: [1.12, 1.12, 0.88], rootShade: 0.5,
    variation: 0.24, dry: 0.05, sheen: 0.5, edgeBlend: 0.4,
  }),
  turf("Fescue in seed", 4, {
    height: 0.3, heightSpread: 0.8, color: "#8c9862", tipTint: [1.08, 1.08, 0.94], seedTint: [1.42, 1.38, 1.02], dry: 0.2, density: 0.38, edgeBlend: 1,
  }),
  turf("Hay meadow", 5, { height: 0.6, edgeBlend: 1.2 }),
];

/** Two more, for a host or a scene to put in a row of its own: a warm-season fairway and a lawn. */
export const MORE_TURF: { bermuda: Species; bluegrass: Species } = {
  bermuda: turf("Fairway (bermuda)", 1, { cutTip: 0.3,
    height: 0.011, heightSpread: 0.1, density: 1.8, width: 0.0013, widthSpread: 0.0004, tip: "point",
    splay: 0.9, droop: 0.3, twist: 0.3, stiffness: 1, disorder: 0.45, color: "#68a53f", tipTint: [1.1, 1.1, 0.9], rootShade: 0.62,
    variation: 0.26, dry: 0.03, sheen: 0.5, lay: 0.7, groundTile: 0.5,
  }),
  bluegrass: turf("Lawn (Kentucky bluegrass)", 2, { cutTip: 0.55,
    height: 0.06, heightSpread: 0.2, density: 1.3, tufted: false, width: 0.0024, widthSpread: 0.0008, tip: "cut",
    splay: 0.8, droop: 0.9, stiffness: 0.85, clump: 0.3, disorder: 0.6, color: "#39793d", tipTint: [1.08, 1.08, 0.96], rootShade: 0.55,
    variation: 0.18, dry: 0.01, sheen: 0.5, lay: 0.4,
    patch: 0.12, patchSize: 0.66, patchTint: [0.68, 0.94, 0.7], patchTall: 0.7,
  }),
};
