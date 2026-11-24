// A species: what one kind of grass is. Its shape and behaviour, as plain
// data, so a stand of grass is described and not programmed.
//
// Everything here is read by the shaders from one table (`packSpecies`), a
// row to a species. Adding a species adds a row; nothing in the shaders
// names one.

import * as THREE from "three/webgpu";
import { type Bloom, MAX_BLOOMS } from "./flowers";

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
  /**
   * The share of its stems that carry a seed head, 0..1: all of them in a stand gone to seed, a few in
   * marram's tussocks. A stem in seed stands a fifth taller than the leaves, as a flowering stem does.
   */
  seedShare: number;
  /**
   * How round it is, 0 (a leaf: flat, folded along its rib) to 1 (a stem: a rush has no leaves, only
   * round green stems that taper to a point; `width` is then the stem's thickness at its foot). A stem
   * looks the same from every side, has no rib and no veins, and lets no light through.
   */
  stem: number;
  /** The share of its stems that are in flower, 0..1: a brown tuft on the stem's side, a hand below its tip (a rush's). Only on a stem. */
  flower: number;

  // How it behaves.
  /** How little the wind moves it, 0 (lies down in a gust) to 1 (does not stir). */
  stiffness: number;
  /** How strongly it grows in clumps, taller at their centres, 0..1. */
  clump: number;
  /** How far apart its clumps and tussocks are, as a multiple of the field's (`look.clumpSize`): marram's stand further apart than a fescue's. */
  clumpScale: number;
  /**
   * How far it stands in tussocks with open ground between, 0 (a sward: it grows everywhere) to 1 (small
   * tussocks well apart). A tussock is a clump (`look.clumpSize` apart), some broader and some smaller.
   */
  tussock: number;
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

  // What flowers in it.
  /** The flowers that bloom among it, up to `MAX_BLOOMS` (none: an empty list). See `Bloom`. */
  blooms: Bloom[];

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
   * measured at 10 cm to 2.5 m across, 50 cm on average: Poole and Johnston; clover likewise), with
   * seedlings come up about them, for a grass that seeds as annual meadow-grass does. "runners": the
   * same, for a plant that spreads by its runners and hardly by seed (creeping bent in an annual
   * meadow-grass green, white clover): fewer and rounder, and nothing about them. "blotches":
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
  /**
   * Where its patches get in besides the lie of the ground (`patchSite`), -1..1: towards the stand's edge
   * and into the trees' shade (1: annual meadow-grass in a bent green, which comes in from the collar and
   * takes the shaded and worn ground first), away from them (-1: the bent left in a meadow-grass green,
   * holding out in the open middle), or neither (0). Left out: 0.
   */
  patchEdge?: number;
  /**
   * How unlike one another its plants' strains are, as a share of its colour (0: all alike). A green
   * sown from a bent bred of a few parents, or grown over by many strains of annual meadow-grass, comes
   * to be a quilt of touching patches each a shade unlike the next (USGA: "a patchwork quilt"), most
   * in early spring and late autumn and hardly at all in summer (`look.strains`). Left out: 0.
   */
  mosaic?: number;
  /** How broad a strain's patch is, roughly (m). Left out: 0.9. */
  mosaicSize?: number;
  /**
   * The colour of the ground under it, as a multiplier on the ground's own (the host's, under
   * `groundShade`): the ground shows between the stems of a thin stand, and is not the same ground
   * everywhere. Sand under a links' thin fescue, peat under a heath, mud in a wet meadow. Not far off, where
   * the ground stands in for the stand seen from there: that is the stand's colour. Left out: 1, 1, 1.
   */
  soil?: [number, number, number];
  /**
   * How readily it browns in a dry spell, 0..1 (`look.drought`): small spots on the crowns and the
   * high, firm ground, and a ring along its edge where the mower turns (the clean-up pass), as greens go
   * first. Left out: 0.
   */
  scorch?: number;

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
export const MAX_SPECIES = 16;
/** Four numbers to a slot, this many slots to a species. */
export type PatchKind = "colonies" | "runners" | "blotches";
export const SPECIES_SLOTS = 20;

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
 *   9  the ground's picture's own mean colour (linear r, g, b), patches are colonies (0), blotches (1) or runners (2)
 *  10  patchTint r, g, b, patch
 *  11  patchSite, edgeBlend, cutTip, seedShare
 *  12  tussock, stem, flower, clumpScale
 *  13  its flowers (`blooms`, four to a slot from here): their rows in the flower table (-1 for none)
 *  14    flowers to the square metre
 *  15    the share of ground
 *  16    where they take (-1 hollows .. 1 crowns)
 *  17    where: 0 in drifts, 1 only in the species' patches, 2 in drifts on its tussocks
 *  18  mosaic, mosaicSize, patchEdge, scorch
 *  19  soil r, g, b
 *
 * `layers` gives each picture's name its layer in the leaf texture, `flowerAt` each flower's name its
 * row in the flower table (`packFlowers`).
 */
export function packSpecies(
  list: readonly Species[],
  table: THREE.Vector4[],
  layers: ReadonlyMap<string, number> = new Map(),
  ground: readonly ({ mean: readonly [number, number, number] } | null)[] = [],
  flowerAt: ReadonlyMap<string, number> = new Map(),
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
    table[row + 11].set(Math.min(1, Math.max(-1, s.patchSite)), Math.max(0, s.edgeBlend), Math.min(1, Math.max(0, s.cutTip)), Math.min(1, Math.max(0, s.seedShare ?? 1)));
    const ids = [-1, -1, -1, -1];
    const perM2 = [0, 0, 0, 0];
    const cover = [0, 0, 0, 0];
    const site = [0, 0, 0, 0];
    const inPatches = [0, 0, 0, 0];
    (s.blooms ?? []).slice(0, MAX_BLOOMS).forEach((b, j) => {
      const at = flowerAt.get(b.flower);
      if (at === undefined || !(b.perM2 > 0)) return;
      ids[j] = at;
      perM2[j] = b.perM2;
      cover[j] = Math.min(1, Math.max(0, b.cover));
      site[j] = Math.min(1, Math.max(-1, b.site ?? 0));
      inPatches[j] = b.where === "patches" ? 1 : b.where === "tussocks" ? 2 : 0;
    });
    table[row + 13].set(ids[0], ids[1], ids[2], ids[3]);
    table[row + 14].set(perM2[0], perM2[1], perM2[2], perM2[3]);
    table[row + 15].set(cover[0], cover[1], cover[2], cover[3]);
    table[row + 16].set(site[0], site[1], site[2], site[3]);
    table[row + 17].set(inPatches[0], inPatches[1], inPatches[2], inPatches[3]);
    const soil = s.soil ?? [1, 1, 1];
    table[row + 19].set(Math.max(0, soil[0]), Math.max(0, soil[1]), Math.max(0, soil[2]), 0);
    table[row + 18].set(Math.min(0.3, Math.max(0, s.mosaic ?? 0)), Math.max(0.1, s.mosaicSize ?? 0.9), Math.min(1, Math.max(-1, s.patchEdge ?? 0)), Math.min(1, Math.max(0, s.scorch ?? 0)));
    table[row + 12].set(Math.min(1, Math.max(0, s.tussock)), Math.min(1, Math.max(0, s.stem)), Math.min(1, Math.max(0, s.flower)), Math.min(4, Math.max(0.25, s.clumpScale ?? 1)));
    table[row + 10].set(s.patchTint[0], s.patchTint[1], s.patchTint[2], Math.min(1, Math.max(0, s.patch)));
    table[row + 9].set(under?.mean[0] ?? 1, under?.mean[1] ?? 1, under?.mean[2] ?? 1, s.patchKind === "blotches" ? 1 : s.patchKind === "runners" ? 2 : 0);
  }
}

/** A plain leaf: what a species written before leaves had pictures is given. */
const NO_TEXTURE = { leafTexture: "", textureMode: "detail" as TextureMode, textureStrength: 1, textureCutout: false };
/** What a species written before these were settings is given: a plain leaf, standing as it grew. */
const NO_PATCHES = { tussock: 0, stem: 0, flower: 0, seedShare: 1, clumpScale: 1, blooms: [] as Bloom[], cutTip: 0, edgeBlend: 0, patchKind: "colonies" as PatchKind, patchSite: 0, patch: 0, patchSize: 0.4, patchTint: [1.1, 1.12, 0.88] as [number, number, number], patchTall: 1 };
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
  return list.map((s) => {
    // (A preset from when a species had one flower: `bloom`, `bloomPerM2`, `bloomCover`.)
    const { bloom, bloomPerM2, bloomCover, ...rest } = s as Species & { bloom?: string; bloomPerM2?: number; bloomCover?: number };
    const blooms: Bloom[] = s.blooms ? s.blooms.map((b) => ({ ...b })) : bloom && (bloomPerM2 ?? 0) > 0 ? [{ flower: bloom, perM2: bloomPerM2!, cover: bloomCover ?? 0, site: 0, where: "drifts" }] : [];
    return { ...ADDED_LATER, ...rest, blooms, tipTint: [...s.tipTint], seedTint: [...s.seedTint], patchTint: [...(s.patchTint ?? NO_PATCHES.patchTint)], ...(s.soil ? { soil: [...s.soil] as [number, number, number] } : {}) };
  });
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
      // (Checked below, flower by flower.)
      if (key === "blooms") continue;
      const got = row[key];
      if (Array.isArray(want)) {
        if (!Array.isArray(got) || got.length !== want.length || got.some((n) => typeof n !== "number" || !Number.isFinite(n))) return `species ${i}: ${key} is not ${want.length} numbers`;
      } else if (typeof got !== typeof want || (typeof got === "number" && !Number.isFinite(got))) {
        return `species ${i}: ${key} is missing or not a ${typeof want}`;
      }
    }
    if (!Object.hasOwn(TIP_CODE, row.tip as string)) return `species ${i}: tip is not point, cut or square`;
    if (!/^#[0-9a-f]{6}$/i.test(row.color as string)) return `species ${i}: color is not a hex colour`;
    if ("textureMode" in row && row.textureMode !== "detail" && row.textureMode !== "color") return `species ${i}: textureMode is not detail or color`;
    if ("blooms" in row) {
      const blooms = row.blooms;
      if (!Array.isArray(blooms) || blooms.length > MAX_BLOOMS) return `species ${i}: blooms is not a list of at most ${MAX_BLOOMS}`;
      for (const b of blooms as Record<string, unknown>[]) {
        if (typeof b !== "object" || b === null || typeof b.flower !== "string" || ![b.perM2, b.cover, b.site].every((n) => typeof n === "number" && Number.isFinite(n))) return `species ${i}: a bloom is not a flower's name and three numbers`;
        if (b.where !== "drifts" && b.where !== "patches" && b.where !== "tussocks") return `species ${i}: a bloom's where is not drifts, patches or tussocks`;
      }
    }
  }
  return null;
}

const turf = (name: string, from: number, set: Partial<Species>): Species => ({ ...STARTER_SPECIES[from], ...set, name });

/**
 * A golf course's surfaces, short to tall, as eight named stands: the green, its collar, the fairway, the
 * first cut, the rough, deep rough, and two that nobody mows. The heights are heights of cut in use (see
 * the README for where each comes from). The leaf widths are set against the floras' (README, "Where
 * the numbers come from"): a leaf grown out, creeping bent 0.5 to 5 mm, perennial rye 2 to 4, Kentucky
 * bluegrass 1.7 to 5, red fescue 0.4 to 0.9 folded (Flora of Australia; Hitchcock has bent 1 to 8). A
 * mown grass's leaves are at the narrow end of its range, and narrower than the same grass left to grow,
 * so the mown ones here are: a rye leaf in a fairway is about 2 mm. The habit was set by eye: a likeness,
 * not a measurement.
 *
 * The colours are a leaf's, worked out: what a leaf with so much chlorophyll sends back of sun and sky
 * (PROSPECT-D, Feret et al. 2017), as linear sRGB, all at one brightness (2.2 times the leaf's own, which
 * is what an exposure for grass comes to). A leaf sends back about half as much red as green and a
 * quarter as much blue, whatever the grass: far more red than a green chosen by eye has. What differs
 * from grass to grass is the chlorophyll in a square centimetre of leaf, and those figures are
 * estimates, since nobody has published them species against species: bent 38 to 40 ug, rye 50 to 55,
 * Kentucky bluegrass 60, bermuda 45, red fescue 42, a hay meadow 34, fescue gone to seed 24 with brown
 * pigment in it, and annual meadow-grass 34 against the bent's 38 (the patches' tint). Fescue and Kentucky bluegrass
 * carry a wax bloom the leaf model has none of: it sends back a little more of everything and most
 * of the blue (1 to 2.5 parts in a hundred, an estimate), which is their grey-blue cast.
 *
 * The mown ones have mown edges (`edgeBlend` 0); deep rough, fescue and meadow run into their neighbours.
 * In the order of the lab's plot.
 */
export const TURF_SPECIES: Species[] = [
  turf("Green (creeping bent)", 0, { cutTip: 0.12,
    height: 0.0032, heightSpread: 0.08, density: 2, width: 0.0009, widthSpread: 0.0003, tip: "cut",
    splay: 0.25, droop: 0.2, stiffness: 1, disorder: 0.25, color: "#6b8d4c", tipTint: [1.03, 1.04, 0.98], rootShade: 0.8, variation: 0.13,
    dry: 0.005, sheen: 0, lay: 1, groundTile: 0.35,
    // (Annual meadow-grass in it, as nearly every bent green has within a few years. It gets in where the green
    // stays wet, and from the collar inwards, and where the trees shade it: USGA, Green Section Record.)
    patchSite: -0.7, patch: 0.16, patchSize: 0.5, patchTint: [1.12, 1.1, 0.98], patchTall: 1.06, patchEdge: 0.7,
    // (A bent bred of a few parents grows into a quilt of its strains as the green ages: USGA, "Segregation
    // in Bentgrass Greens". How unlike, by eye: two per cent or so; at five it read as camouflage. Its meadow-grass wilts first in a dry spell.)
    mosaic: 0.022, mosaicSize: 1.4, scorch: 0.8,
  }),
  turf("Collar (creeping bent)", 0, { cutTip: 0.18,
    height: 0.008, heightSpread: 0.1, density: 2, width: 0.0011, widthSpread: 0.0004, tip: "cut",
    splay: 0.4, droop: 0.3, stiffness: 1, disorder: 0.3, color: "#688b4d", tipTint: [1.04, 1.05, 0.97], rootShade: 0.76, variation: 0.15,
    dry: 0.005, sheen: 0, lay: 1, groundTile: 0.4,
    patchSite: -0.7, patch: 0.12, patchSize: 0.5, patchTint: [1.12, 1.1, 0.98], patchTall: 1.06, patchEdge: 0.5,
    // (The collar goes first in a dry spell: USGA.)
    mosaic: 0.02, mosaicSize: 1.4, scorch: 1,
  }),
  turf("Fairway (perennial rye)", 1, { cutTip: 0.3,
    height: 0.011, heightSpread: 0.12, density: 1.5, width: 0.0018, widthSpread: 0.0006, tip: "cut",
    splay: 0.5, droop: 0.3, twist: 0.8, stiffness: 1, disorder: 0.4, color: "#60814e", tipTint: [1.06, 1.06, 0.97], rootShade: 0.68,
    variation: 0.2, dry: 0.01, sheen: 1, lay: 0.85, groundTile: 0.5,
  }),
  turf("First cut (perennial rye)", 1, { cutTip: 0.5,
    height: 0.032, heightSpread: 0.16, density: 1.6, width: 0.002, widthSpread: 0.0007, tip: "cut",
    splay: 0.7, droop: 0.45, twist: 1, stiffness: 0.95, disorder: 0.45, color: "#62834e", tipTint: [1.06, 1.06, 0.96], rootShade: 0.36,
    variation: 0.3, dry: 0.015, sheen: 1, lay: 0.5, groundTile: 0.6,
  }),
  // (Mown, as rough is on every course: a level top of cut ends, not a wild stand's own tips.)
  turf("Rough (rye and bluegrass)", 2, { twist: 1.1, cutTip: 0.6,
    height: 0.064, heightSpread: 0.3, density: 1.4, width: 0.0024, widthSpread: 0.0008, tip: "cut",
    splay: 0.85, droop: 0.7, stiffness: 0.9, clump: 0.5, disorder: 0.6, color: "#5e7e4f", tipTint: [1.07, 1.07, 0.95], rootShade: 0.34,
    variation: 0.3, dry: 0.02, sheen: 1,
    // (Something low and dark among it: clover, where nobody sprays. It creeps by its runners.)
    patchKind: "runners", patch: 0.08, patchSize: 0.66, patchTint: [0.72, 0.95, 0.72], patchTall: 0.7,
    // (No flowers: a course keeps its mown rough clear of them. Where nobody does, daisies, clover, creeping
    // buttercup and selfheal flower under a mower that passes every week or so: see `MORE_TURF.bluegrass`.)
  }),
  turf("Deep rough (red fescue)", 3, { twist: 0.6,
    height: 0.125, heightSpread: 0.5, density: 1.4, width: 0.0006, widthSpread: 0.0003, tip: "point",
    splay: 1.2, droop: 1.6, stiffness: 0.25, clump: 1, disorder: 1, color: "#789b64", tipTint: [1.12, 1.12, 0.88], rootShade: 0.5,
    variation: 0.24, dry: 0.05, sheen: 0.5, edgeBlend: 0.4,
    // (Cut a few times a year: cat's-ear and bird's-foot trefoil on the drier banks, ox-eye daisies, and
    // creeping buttercup down in the wet hollows.)
    blooms: [
      { flower: "catsear", perM2: 8, cover: 0.12, site: 0.5, where: "drifts" },
      { flower: "birdsfoot", perM2: 6, cover: 0.1, site: 0.7, where: "drifts" },
      { flower: "oxeye", perM2: 5, cover: 0.1, site: 0, where: "drifts" },
      { flower: "buttercup", perM2: 6, cover: 0.1, site: -0.8, where: "drifts" },
    ],
  }),
  turf("Fescue in seed", 4, {
    height: 0.3, heightSpread: 0.8, color: "#94a565", tipTint: [1.08, 1.08, 0.94], seedTint: [1.42, 1.38, 1.02], dry: 0.2, density: 0.75, edgeBlend: 1,
    // (A fine fescue's leaf, folded: 0.4 to 0.9 mm across, as the floras have red fescue's, and a stand of it
    // dense with them. Its culms in seed are 25 to 104 cm in Flora of Australia; the rough a course leaves
    // stands lower, as the README says.)
    width: 0.0006, widthSpread: 0.0003,
    // (Not every stem in seed: in a mown mountain meadow 6 to 21 per cent of red fescue's shoots flowered,
    // as the year went (Herben et al. 1993, Preslia), and a shoot is a few leaves to its one flowering stem.
    // Left unmown it flowers more freely; a tenth of what is drawn, and that in patches.)
    seedShare: 0.1,
    // (Thin, dry, unmown ground: cat's-ear most, ox-eye daisies, harebells, yarrow.)
    blooms: [
      { flower: "catsear", perM2: 8, cover: 0.18, site: 0.6, where: "drifts" },
      { flower: "oxeye", perM2: 6, cover: 0.15, site: 0, where: "drifts" },
      { flower: "harebell", perM2: 5, cover: 0.12, site: 0.5, where: "drifts" },
      { flower: "yarrow", perM2: 3, cover: 0.12, site: 0.3, where: "drifts" },
    ],
  }),
  turf("Hay meadow", 5, { height: 0.6, edgeBlend: 1.2, color: "#76954b",
    // (Buttercups, most in the damper ground; red clover; ox-eye daisies; knapweed.)
    blooms: [
      { flower: "buttercup", perM2: 10, cover: 0.2, site: -0.4, where: "drifts" },
      { flower: "redClover", perM2: 8, cover: 0.15, site: 0, where: "drifts" },
      { flower: "oxeye", perM2: 6, cover: 0.15, site: 0.3, where: "drifts" },
      { flower: "knapweed", perM2: 4, cover: 0.12, site: 0, where: "drifts" },
    ],
  }),
];

/** Two more, for a host or a scene to put in a row of its own: a warm-season fairway and a lawn. */
export const MORE_TURF: { bermuda: Species; bluegrass: Species } = {
  bermuda: turf("Fairway (bermuda)", 1, { cutTip: 0.3,
    height: 0.011, heightSpread: 0.1, density: 1.8, width: 0.0013, widthSpread: 0.0004, tip: "point",
    splay: 0.9, droop: 0.3, twist: 0.3, stiffness: 1, disorder: 0.45, color: "#67884d", tipTint: [1.1, 1.1, 0.9], rootShade: 0.62,
    variation: 0.26, dry: 0.03, sheen: 0.5, lay: 0.7, groundTile: 0.5,
  }),
  bluegrass: turf("Lawn (Kentucky bluegrass)", 2, { cutTip: 0.55,
    height: 0.06, heightSpread: 0.2, density: 1.3, tufted: false, width: 0.0024, widthSpread: 0.0008, tip: "cut",
    splay: 0.8, droop: 0.9, stiffness: 0.85, clump: 0.3, disorder: 0.6, color: "#628061", tipTint: [1.08, 1.08, 0.96], rootShade: 0.55,
    variation: 0.18, dry: 0.01, sheen: 0.5, lay: 0.4,
    patchKind: "runners", patch: 0.12, patchSize: 0.66, patchTint: [0.68, 0.94, 0.7], patchTall: 0.7,
    // (A lawn's: daisies, the clover's heads in its patches, slender speedwell.)
    blooms: [
      { flower: "daisy", perM2: 20, cover: 0.12, site: 0.2, where: "drifts" },
      { flower: "clover", perM2: 20, cover: 0, site: 0, where: "patches" },
      { flower: "speedwell", perM2: 14, cover: 0.08, site: -0.3, where: "drifts" },
    ],
  }),
};

/**
 * What grows beside grass and is not one, for a host or a scene to put in a row of its own.
 *
 * Soft rush (Juncus effusus), a marsh's and a wet ditch's plant: no leaves, only round, smooth, glossy
 * stems, 2 to 4 mm thick at the foot and tapering to a point, 30 cm to over a metre tall (Flora Iberica: stems
 * 1 to 5 mm across, plants 25 to 128 cm), stiff and nearly straight, standing in dense tussocks that fan out from their middles, with the last years' dead stems
 * straw-brown among the green (the floras: Stace; Clapham, Tutin and Moore). Its colour is a guess at a
 * dark leaf's (65 ug of chlorophyll to the square centimetre): nobody has published a rush's. Its flowers
 * are a brown tuft that sits on the side of a stem a hand below its tip, on a third of its stems.
 */
export const MORE_PLANTS: { rush: Species } = {
  rush: turf("Soft rush", 5, {
    height: 0.75, heightSpread: 0.7, density: 1.3, tufted: true, width: 0.0034, widthSpread: 0.0012, tip: "point",
    splay: 0.5, droop: 0, twist: 0, seedHead: 0, stiffness: 0.85, clump: 1, disorder: 0.5, tussock: 0.82, stem: 1, flower: 0.35,
    color: "#5a7a48", tipTint: [1.12, 1.02, 0.78], rootShade: 0.4, variation: 0.26, dry: 0.2, sheen: 1, edgeBlend: 0.6,
  }),
};

/**
 * Grasses of other courses than the cool, wet parkland `TURF_SPECIES` are: a green gone over to annual
 * meadow-grass, a warm coast's kikuyu, a links' fine fescue, and the dunes' marram.
 *
 * Their leaves are set against the floras (README, "Where the numbers come from"): annual meadow-grass 1
 * to 5 mm grown out (Flora of Australia; Hitchcock 1 to 3), kikuyu 2 to 8 (Flora Iberica; 2 to 3.5 in
 * Thailand), red fescue 0.4 to 0.9 folded, marram 1.5 to 4 rolled and 50 to 120 cm tall (Flora Iberica;
 * Hitchcock 70 to 100 cm).
 *
 * Annual meadow-grass (Poa annua) takes over most old greens on wet or mild coasts (California's
 * public courses, Pebble Beach, much of the Pacific north-west): a lighter, yellower green than bent
 * (34 ug of chlorophyll against the bent's 38: the bent green's patch tint), a broader leaf (2 to 3 mm
 * grown, 1 to 1.5 at a green's cut), and it seeds even at a green's height, which a putt feels as
 * bumpiness: a scatter of small pale seed heads. Bent that is left in it is the darker patches.
 *
 * Kikuyu (Pennisetum clandestinum, in the floras an African grass grown and gone wild on the coasts of
 * California, Australia and South Africa) runs on thick stems over and under the ground into a dense,
 * springy mat, the ball sitting up on it in a fairway and down in it in the rough: leaves 3 to 5 mm,
 * folded, stiff, a bright pale green (taken as bermuda's 45 ug: it is a warm-season grass like bermuda),
 * torn more than cut by a mower. Its own flowers are its stamens: white threads among the leaves after a
 * mowing.
 *
 * Fine fescue (Chewings and slender creeping red fescue) is a links' fairway and green: leaves rolled to a
 * needle, half a millimetre, the densest of the turf grasses, grey-green with red fescue's wax, browning
 * in a dry summer where a links is not watered, and firm, which is why a links runs. Greens of it are cut
 * higher than bent (4 to 5 mm); a fairway at about 10 mm.
 *
 * Marram (Ammophila arenaria) holds the dunes behind a links: leaves rolled into stiff, sharp, grey-green
 * tubes 50 cm to over a metre, fanning from tussocks with bare sand between, many dead and pale, and in
 * summer a dense pale spike of a seed head 7 to 22 cm long (the floras). Its colour is red fescue's
 * with more wax (an estimate). Its rolled leaf is drawn as part way to a stem (`stem`), its tussocks further
 * apart than the field's clumps (`clumpScale`), by eye, and its spikes as a flower of its own (`FLOWERS.marram`)
 * on the tussocks: a leaf has too few joints to carry a spike a fifth of its length.
 *
 * As with the others, the habit was set by eye.
 */
export const MORE_GRASSES: { poaGreen: Species; kikuyuFairway: Species; kikuyuRough: Species; fescueGreen: Species; fescueFairway: Species; marram: Species } = {
  poaGreen: turf("Green (annual meadow-grass)", 0, { cutTip: 0.16,
    height: 0.0032, heightSpread: 0.14, density: 1.7, width: 0.0013, widthSpread: 0.0004, tip: "cut", seedHead: 0.12,
    splay: 0.35, droop: 0.25, stiffness: 1, disorder: 0.35, color: "#789b4a", tipTint: [1.04, 1.05, 0.96], seedTint: [1.35, 1.32, 1.12], rootShade: 0.78, variation: 0.17,
    dry: 0.008, sheen: 0, lay: 1, groundTile: 0.35,
    // (The bent that is left in it: darker, finer, a little lower; spreading by its runners, not by seed, so
    // rounder patches and no seedlings about them. How much darker by eye: as dark as 0.89 it read as stains.)
    patchKind: "runners", patchSite: 0, patch: 0.14, patchSize: 0.45, patchTint: [0.92, 0.94, 1.02], patchTall: 0.95, patchEdge: -0.5,
    // (Many strains of meadow-grass, each its own shade, more than a bent green's: USGA, "Why Are Our Greens So
    // Patchy and Bumpy?". And it wilts first in a dry spell.)
    mosaic: 0.028, mosaicSize: 1.1, scorch: 1,
  }),
  kikuyuFairway: turf("Fairway (kikuyu)", 1, { cutTip: 0.4,
    height: 0.013, heightSpread: 0.1, density: 1.7, width: 0.0033, widthSpread: 0.0009, tip: "cut",
    splay: 0.45, droop: 0.15, twist: 0.35, stiffness: 1, clump: 0, disorder: 0.35, color: "#698a4c", tipTint: [1.06, 1.06, 0.95], rootShade: 0.6,
    variation: 0.2, dry: 0.015, sheen: 0.6, lay: 0.55, groundTile: 0.5,
    // (Its stamens, white threads out of the mat in the days after a mowing.)
    blooms: [{ flower: "kikuyu", perM2: 30, cover: 0.35, site: 0, where: "drifts" }],
  }),
  kikuyuRough: turf("Rough (kikuyu)", 2, { cutTip: 0.55,
    height: 0.05, heightSpread: 0.22, density: 1.6, width: 0.0038, widthSpread: 0.001, tip: "cut",
    splay: 0.9, droop: 0.45, twist: 0.6, stiffness: 0.95, clump: 0.25, disorder: 0.5, color: "#678849", tipTint: [1.07, 1.07, 0.94], rootShade: 0.36,
    variation: 0.24, dry: 0.025, sheen: 0.8, lay: 0,
    blooms: [
      { flower: "kikuyu", perM2: 26, cover: 0.3, site: 0, where: "drifts" },
      { flower: "dandelion", perM2: 6, cover: 0.08, site: 0, where: "drifts" },
    ],
  }),
  fescueGreen: turf("Green (fine fescue)", 0, { cutTip: 0.14,
    height: 0.0045, heightSpread: 0.1, density: 2.3, width: 0.0006, widthSpread: 0.0002, tip: "cut",
    splay: 0.3, droop: 0.25, stiffness: 1, disorder: 0.3, color: "#789b64", tipTint: [1.06, 1.05, 0.94], rootShade: 0.78, variation: 0.16,
    dry: 0.03, sheen: 0.2, lay: 0.85, groundTile: 0.35,
    // (Browner where it dries first, on the crowns.)
    patchKind: "blotches", patchSite: 0.8, patch: 0.14, patchSize: 0.8, patchTint: [1.1, 1.0, 0.84], patchTall: 1,
    mosaic: 0.015, mosaicSize: 1.2, scorch: 0.6,
  }),
  fescueFairway: turf("Fairway (fine fescue)", 1, { cutTip: 0.4,
    height: 0.01, heightSpread: 0.14, density: 2.2, width: 0.0006, widthSpread: 0.0002, tip: "cut",
    splay: 0.6, droop: 0.5, twist: 0.5, stiffness: 1, disorder: 0.45, color: "#789b64", tipTint: [1.1, 1.07, 0.9], rootShade: 0.66,
    variation: 0.24, dry: 0.07, sheen: 0.3, lay: 0.4, groundTile: 0.5,
    patchKind: "blotches", patchSite: 0.8, patch: 0.22, patchSize: 1.6, patchTint: [1.16, 1.02, 0.8], patchTall: 1,
  }),
  marram: turf("Marram", 5, {
    height: 0.8, heightSpread: 0.5, density: 1, tufted: true, width: 0.003, widthSpread: 0.001, tip: "point",
    splay: 0.55, droop: 0.3, twist: 0.3, seedHead: 0, stiffness: 0.7, clump: 1, clumpScale: 1.9, disorder: 0.6, tussock: 0.85, stem: 0.6, flower: 0,
    // (Its spikes, which are its flowers, rising from the tussocks; and harebells and bird's-foot trefoil.)
    blooms: [
      { flower: "marram", perM2: 9, cover: 0.8, site: 0, where: "tussocks" },
      { flower: "harebell", perM2: 4, cover: 0.15, site: 0, where: "drifts" },
      { flower: "birdsfoot", perM2: 4, cover: 0.12, site: 0.4, where: "drifts" },
    ],
    color: "#7f9a6e", tipTint: [1.15, 1.1, 0.86], seedTint: [1.6, 1.45, 1.05], rootShade: 0.5, variation: 0.2, dry: 0.28, sheen: 0.5, edgeBlend: 0.8,
  }),
};

/**
 * The grasses of ground nobody mows but once a year, for the mixes a host makes of them (`mixedMap`): no
 * stand of native grass is one grass. Each is drawn as it stands in high summer, gone to seed.
 *
 * Their leaves and stems are the floras' (Kew's GrassBase, the Flora of New Zealand, Flora of Victoria,
 * Flora of North America):
 *
 * - Sheep's fescue (Festuca ovina): leaves folded to a bristle, 0.3 to 0.6 mm (Kew; 0.3 to 1.2 in New
 *   England), 3 to 25 cm long, in dense tufts with ground between; stems 5 to 60 cm. Of dry, thin, sandy and
 *   acid ground: a links' dunes, a heath. Greyer than red fescue, with more wax on it (an estimate).
 * - Common bent (Agrostis capillaris): leaves flat, 1 to 2.5 mm (to 5), 2 to 13 cm long; stems 10 to 70 cm;
 *   a very loose panicle of purplish-brown spikelets, so a stand of it in seed has a reddish haze. It
 *   creeps by short runners. A greener grass than the fescues, with no wax.
 * - Yorkshire fog (Holcus lanatus): leaves flat and soft with velvety hairs, 3 to 10 mm, to 25 cm long;
 *   stems 30 to 110 cm; a panicle that goes from pinkish white to purple. A pale grey-green, matt for its
 *   hairs, in tufts: the grass of a damp, rich meadow.
 * - Sweet vernal grass (Anthoxanthum odoratum): leaves flat, 2 to 6.5 mm, 3.5 to 18 cm long; stems 12 to
 *   50 cm (to 90); a dense, spike-like panicle, yellow-green, gold as it ripens. The first meadow grass to
 *   flower, in April to June, and the smell of hay (coumarin).
 * - Wavy hair-grass (Deschampsia flexuosa): leaves rolled to a thread, 0.3 to 0.6 mm (New Zealand; 0.3 to
 *   0.8, Kew), 5 to 20 cm long, in dense tufts far overtopped by their stems, 20 to 75 cm; a loose panicle
 *   on wavy branches, silvery and purplish. Of acid heath and open woods.
 * - Creeping bent (Agrostis stolonifera) left unmown: leaves flat, 0.5 to 5 mm (Kew; to 8, New Zealand),
 *   1 to 10 cm long; stems 8 to 40 cm, bent at their foot and rooting where they touch the ground, from
 *   runners over it; a narrow panicle, spread in flower and drawn in after, greenish to purplish. With red
 *   fescue the body of a grazed or wet coastal meadow (the Juncetum gerardii's closed swards).
 * - Saltmarsh rush (Juncus gerardii): a rush, not a grass, of coastal meadows the sea reaches in winter:
 *   slender, wiry, dark green stems 25 to 80 cm (New Zealand 40 to 80; Burren to 60), with flat narrow
 *   leaves half their length, in loose tufts along a creeping black rootstock, not in tussocks; dark brown
 *   flowers in a cluster near the top. Drawn as stems, as soft rush is (`MORE_PLANTS.rush`).
 *
 * Their seed heads stand where every grass's here does, a fifth over its leaves: the floras' stems stand
 * further over some of them (wavy hair-grass's most), which a leaf's three joints cannot draw. The colours
 * are set by eye from the floras' words; the habit by eye too, as with the others. None has flowers of
 * its own: a host gives a mix its flowers.
 */
export const NATIVE_GRASSES: {
  sheepsFescue: Species;
  commonBent: Species;
  yorkshireFog: Species;
  sweetVernal: Species;
  wavyHairGrass: Species;
  creepingBent: Species;
  saltmarshRush: Species;
} = {
  sheepsFescue: turf("Sheep's fescue", 4, {
    height: 0.18, heightSpread: 0.7, density: 0.85, width: 0.00045, widthSpread: 0.00015, tip: "point",
    splay: 1, droop: 0.9, twist: 0.8, seedHead: 1, seedShare: 0.15, stiffness: 0.3, clump: 1, tussock: 0.35, disorder: 1,
    color: "#8b9f74", tipTint: [1.1, 1.08, 0.92], seedTint: [1.4, 1.3, 1.02], rootShade: 0.45, variation: 0.2, dry: 0.24, sheen: 0.8, edgeBlend: 0.8,
    blooms: [],
  }),
  commonBent: turf("Common bent", 4, {
    height: 0.2, heightSpread: 0.6, density: 0.9, width: 0.0018, widthSpread: 0.0008, tip: "point",
    splay: 1, droop: 1.2, twist: 1, seedHead: 1, seedShare: 0.35, stiffness: 0.2, clump: 0.5, disorder: 1,
    color: "#73975a", tipTint: [1.08, 1.06, 0.92], seedTint: [1.32, 1.02, 0.98], rootShade: 0.45, variation: 0.22, dry: 0.12, sheen: 0.2, edgeBlend: 0.8,
    blooms: [],
  }),
  yorkshireFog: turf("Yorkshire fog", 5, {
    height: 0.35, heightSpread: 0.6, density: 0.7, width: 0.005, widthSpread: 0.002, tip: "point",
    splay: 0.9, droop: 1.1, twist: 1, seedHead: 1, seedShare: 0.3, stiffness: 0.15, clump: 0.8, disorder: 1,
    color: "#8ea57a", tipTint: [1.08, 1.06, 0.96], seedTint: [1.45, 1.22, 1.24], rootShade: 0.4, variation: 0.2, dry: 0.12, sheen: 0, edgeBlend: 1,
    blooms: [],
  }),
  sweetVernal: turf("Sweet vernal grass", 5, {
    height: 0.25, heightSpread: 0.6, density: 0.7, width: 0.0035, widthSpread: 0.0015, tip: "point",
    splay: 0.8, droop: 0.9, twist: 1, seedHead: 1, seedShare: 0.3, stiffness: 0.35, clump: 0.7, disorder: 1,
    color: "#71944f", tipTint: [1.1, 1.08, 0.9], seedTint: [1.5, 1.36, 0.86], rootShade: 0.4, variation: 0.22, dry: 0.18, sheen: 0.4, edgeBlend: 1,
    blooms: [],
  }),
  wavyHairGrass: turf("Wavy hair-grass", 4, {
    height: 0.18, heightSpread: 0.7, density: 0.9, width: 0.00045, widthSpread: 0.0002, tip: "point",
    splay: 1, droop: 1, twist: 1, seedHead: 1, seedShare: 0.4, stiffness: 0.25, clump: 1, tussock: 0.3, disorder: 1,
    color: "#6f9052", tipTint: [1.1, 1.08, 0.9], seedTint: [1.4, 1.26, 1.36], rootShade: 0.42, variation: 0.2, dry: 0.15, sheen: 0.6, edgeBlend: 0.8,
    blooms: [],
  }),
  creepingBent: turf("Creeping bent", 4, {
    height: 0.2, heightSpread: 0.5, density: 1.1, width: 0.0025, widthSpread: 0.0012, tip: "point",
    splay: 1.2, droop: 1.3, twist: 1, seedHead: 1, seedShare: 0.25, stiffness: 0.15, clump: 0.2, disorder: 1,
    color: "#6b9152", tipTint: [1.07, 1.06, 0.93], seedTint: [1.25, 1.05, 1.05], rootShade: 0.45, variation: 0.2, dry: 0.08, sheen: 0.2, edgeBlend: 0.9,
    blooms: [],
  }),
  saltmarshRush: turf("Saltmarsh rush", 5, {
    height: 0.4, heightSpread: 0.45, density: 0.9, tufted: true, width: 0.0014, widthSpread: 0.0005, tip: "point",
    splay: 0.35, droop: 0.1, twist: 0, seedHead: 0, stiffness: 0.8, clump: 0.6, disorder: 0.6, tussock: 0.15, stem: 1, flower: 0.4,
    color: "#4d6b3c", tipTint: [1.1, 1.0, 0.8], rootShade: 0.4, variation: 0.2, dry: 0.15, sheen: 0.8, edgeBlend: 0.6,
    blooms: [],
  }),
};

/**
 * Every species here by a name: a host makes its own list from them (`cloneSpecies` the ones it wants, in
 * the order of its map's numbers), as a course has the grasses it has.
 */
export const GRASSES = {
  bentGreen: TURF_SPECIES[0],
  bentCollar: TURF_SPECIES[1],
  ryeFairway: TURF_SPECIES[2],
  ryeFirstCut: TURF_SPECIES[3],
  rough: TURF_SPECIES[4],
  redFescueRough: TURF_SPECIES[5],
  fescueInSeed: TURF_SPECIES[6],
  hayMeadow: TURF_SPECIES[7],
  bermudaFairway: MORE_TURF.bermuda,
  bluegrassLawn: MORE_TURF.bluegrass,
  ...MORE_GRASSES,
  ...NATIVE_GRASSES,
  softRush: MORE_PLANTS.rush,
} satisfies Record<string, Species>;

/** A species' name in `GRASSES`. */
export type GrassName = keyof typeof GRASSES;
