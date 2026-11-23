// The grass itself: squares of plants that follow the camera, each plant
// placed, grown and lit by a compute pass and stood up as leaves.
//
// It began as Couch Golf Club's WebGPU grass (src/webgpu/vegetation.ts in
// that game) with the golf taken out and every number that describes a kind
// of grass moved into the species table (species.ts).
//
// What is drawn, from the eye outward:
//
//   peak, mid   two squares of fine single leaves, three to a plant, as
//               close together as a real sward near their centres and
//               steadily thinner outward (a leaf left standing where others
//               were thinned out is drawn broader by as much);
//   far         a wide square of tufts, a few broad blades each, out to the
//               grass's range, giving way to the fine leaves where they stand.
//
// A plant stays where it grows: the squares move in whole cells, so the view
// only chooses which plants are drawn.

import * as THREE from "three/webgpu";
import { Fn, If, abs, atomicAdd, atomicStore, attribute, cross, cameraPosition, clamp, cos, distance, dot, exp, float, floor, fract, instanceIndex, int, length, max, min, mix, mod, normalize, positionGeometry, positionWorld, pow, sign, sin, smoothstep, step, storage, texture, uint, uniform, uniformArray, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { type HeightSource, type MapSource, type MowSource } from "./field";
import { makeNoiseTexture } from "./noise";
import { MAX_SPECIES, SPECIES_SLOTS, type Species, makeSpeciesTable, packSpecies } from "./species";

type Int = THREE.Node<"int">;
type Vec2 = THREE.Node<"vec2">;
type Vec3 = THREE.Node<"vec3">;
type Vec4 = THREE.Node<"vec4">;

/** One square of plants. */
export interface GrassLayer {
  /** Plants along a side, and their spacing (m). */
  count: number;
  spacing: number;
  /** Leaves to a plant. */
  blades: number;
  /** How far it is drawn (m): a tuft layer from the eye, a fine layer from its own centre. */
  range: number;
}

/** A finer square of fine leaves still, drawn only while the eye is within `within` metres of where it is centred (in a 50 degree view 1,200 pixels tall; further in a closer or larger one). */
export interface NearLayer extends GrassLayer {
  within: number;
}

export interface GrassLayers {
  far: GrassLayer;
  peak: GrassLayer;
  mid: GrassLayer;
  /**
   * A coarser square of fine leaves beyond `mid`, drawn only when leaves can be seen that far: when the
   * broadest species' leaf is still half a pixel wide in the picture beyond `mid`'s reach (a large
   * display, a long lens, a broad-leaved grass). Left out, the leaves end with `mid`.
   */
  wide?: GrassLayer;
  /** Finer squares for an eye close to the ground, finest first. */
  near: NearLayer[];
  /** How far ahead of the eye each square is centred (m). */
  farAhead: number;
  peakAhead: number;
  midAhead: number;
}

/**
 * The squares as the game draws them. Far: 62,500 tufts of eight blades,
 * 22 cm apart, to 48 m. Peak and mid: 110,000 plants of three leaves each,
 * 2 cm and 3.9 cm apart: 7,200 and 2,000 leaves to the square metre at
 * their centres.
 *
 * Near (not the game's): the same number of plants 5 mm and 1 cm apart,
 * 120,000 and 29,000 leaves to the square metre, which is what a mown sward
 * has. From standing height that is far more than can be seen, so each is
 * drawn only while the eye is within a stride or two of it. Their plants
 * carry up to six leaves, for a species whose density is set above 1.
 */
export const DEFAULT_LAYERS: GrassLayers = {
  far: { count: 250, spacing: 0.22, blades: 8, range: 48 },
  peak: { count: 332, spacing: 0.0204, blades: 3, range: 3.38 },
  mid: { count: 332, spacing: 0.0388, blades: 3, range: 6.4 },
  wide: { count: 332, spacing: 0.0776, blades: 3, range: 12.8 },
  near: [
    { count: 332, spacing: 0.0051, blades: 6, range: 0.845, within: 1.2 },
    { count: 332, spacing: 0.0102, blades: 6, range: 1.69, within: 2.6 },
  ],
  farAhead: 21,
  peakAhead: 3.0,
  midAhead: 5.2,
};

/** A plant grows once its root is this far (m) inside its species' ground, so a border is a crowded line and not a spill. */
const EDGE_KEEP = 0.02;
/** Within this far (m) of a border a stand's height follows the canopy down towards its shorter neighbour's. */
const EDGE_RAMP_M = 0.35;
/** A tuft's blade stands at most this far (m) from the tuft's root, and never over the border. */
const REACH_MAX = 0.24;
/** A fine leaf left standing where others were thinned out is drawn up to this much broader. */
const BROADEN_MAX = 1.5;
/** A fine plant's leaves at a density of 1. A denser species has more of its layer's `blades`. */
const PLANT_LEAVES = 3;
/** How far a leaf fully laid by the mower leans, as its tip's reach over its height: some 25 degrees. */
const LAY_LEAN = 0.45;
/**
 * A stand seen from too far to see its leaves: how light it is between its roots' shade (0) and its lit
 * tips (1), and how far up it (0 root, 1 tip) the sun it takes is reckoned. The ground that stands in for
 * a stand, the last leaves of a square and the far tufts all go to this, so they meet.
 */
const STAND_MEAN = 0.55;
const STAND_SUN = 0.65;
/**
 * A square of fine leaves is thinned by distance from the eye, not from its own middle: all of it near the
 * eye, none at `LEAF_REACH` times its `range`, by a curve that is level at both ends (`leavesAt`). So the
 * grass is thick at the eye and thins away from it the same in every direction, and where one square's
 * leaves run out the next's are still there: there is no ring on the ground for the eye to find, only
 * less and less. The square itself stands `LEAF_AHEAD` of its range in front of the eye, so that all
 * of what the eye sees within the reach is inside it.
 */
const LEAF_REACH = 1.4;
const LEAF_AHEAD = 0.45;
/** How much paler grass is under a gust than out of one, at a wind of 8 m/s: laid-over leaves show their undersides. */
const GUST_PALE = 0.3;
/** A leaf folded along its rib has each half turned this far (radians) from flat, at a `fold` of 1: a shallow V. */
const FOLD_ANGLE = 0.5;
/** A tuft's blade is this many times as broad as a fine leaf of its species: it stands for several. */
const TUFT_BROAD = 3.1;
/** How many pictures the leaves can have between them, and the size each is kept at (across the leaf, up it). */
export const MAX_LEAF_TEXTURES = 16;
const LEAF_TEXTURE_W = 64;
const LEAF_TEXTURE_H = 256;

/** A ground picture's side, in pixels. */
const GROUND_SIZE = 1024;
/** A ground picture's height (its alpha) runs from the ground to this many of its species' leaf heights. */
const PILE_TALL = 1.2;
/** The slope of a ground picture is taken over this many of its pixels. */
const RELIEF_STEP = 4;
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});
const LINEAR_TO_SRGB = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));

/** What a specimen shows: one leaf, one plant of fine leaves, one tuft as the far field draws it, or a clump of plants. */
export type SpecimenKind = "blade" | "plant" | "tuft" | "clump";

/**
 * A little grass on its own, drawn by the field's own leaf shader: for
 * looking at a species closely, and for pictures of one. It reads the
 * species as they are now each time it is updated.
 */
export interface Specimen {
  object: THREE.Group;
  /** What to show, of which species (its row); `seed` picks another plant of the same kind. */
  set(kind: SpecimenKind, row: number, seed?: number): void;
  /** Once a frame. */
  update(timeS: number): void;
  /** How big it is (m), for framing it: its radius on the ground and its height. */
  readonly radius: number;
  readonly height: number;
  dispose(): void;
}

export interface GrassOptions {
  height: HeightSource;
  /** How the field was mown, for the species the mower lays over (`Species.lay`). Without it nothing is laid. */
  mow?: MowSource;
  map: MapSource;
  species: readonly Species[];
  layers?: GrassLayers;
}

export interface Grass {
  /** Add this to the scene. */
  object: THREE.Group;
  /**
   * The light and the air, for the host to set. `sun` points at the sun.
   * A leaf is lit as the ground under it would be: `sunTint` where the
   * ground faces the sun, `shadeTint` where it turns away. `wind` is its
   * heading (x, y: unit, in the ground plane's x and z) and its speed in
   * metres a second (z).
   */
  environment: { sun: THREE.Vector3; sunTint: THREE.Vector3; shadeTint: THREE.Vector3; wind: THREE.Vector3 };
  /**
   * How it is drawn, apart from what it is. `broad`, 0..1: fewer and
   * broader leaves. `flat`, 0..1: less of what tells one leaf from the
   * next (tone, the shaded root, sheen, the fold).
   */
  style: { broad: number; flat: number };
  /**
   * The field as a whole. `clumpSize`: metres between clump centres.
   * `macro`: how much the colour drifts over tens of metres. `edgeWobble`:
   * how far (m) a border strays from the map's cells. `mown`: whether the field is mown in stripes at all (`GrassOptions.mow` says how): off, no
   * leaf is laid over and there are no stripes. `depth`: how far a stand's
   * roots are as dark as the light's fall through its leaves makes them (by its height, its
   * density and the sun's height), over the species' own `rootShade` alone (0).
   * `fold`: how far a near leaf is folded
   * along its rib, in its geometry (1: a shallow V; 0: flat). `relief`: how deep the ground's
   * picture is: how far what stands high in it moves over what lies low as the eye moves, and
   * how its slopes are lit by the sun (1: as deep as the pile was laid; 0: a flat picture). `leafPixels`: how wide in the
   * picture a leaf must be to be drawn (1: most of a pixel; 0: always).
   * `shadow`: how dark
   * the shade of taller grass is, 0..1. `occlusion`: how much grass beside
   * taller grass loses of the sky's light, 0..1. `stripes`: how much
   * lighter laid grass is seen along its lay, and darker against it, 0..1.
   * `groundShade`: the
   * ground's colour under a stand, as a share of the colour of the stand's
   * roots. `bare`: the
   * ground's colour where nothing grows.
   */
  look: { clumpSize: number; macro: number; edgeWobble: number; groundShade: number; stripes: number; shadow: number; occlusion: number; fold: number; relief: number; leafPixels: number; depth: number; mown: boolean; bare: THREE.Color };
  /** Read the species again after changing them (or give another list). */
  setSpecies(list: readonly Species[]): void;
  /**
   * The pictures the species' leaves can have, by the names the species use
   * (`Species.leafTexture`): at most `MAX_LEAF_TEXTURES`. Each is kept at 64
   * by 256, the leaf's root at its bottom edge.
   */
  setLeafTextures(pictures: Record<string, CanvasImageSource>): void;
  /** A specimen standing at a place. Add its `object` to the scene. */
  /** How many plants the last frame drew, of `stats.plants` computed: read back from the graphics card, so not every frame. */
  countDrawn(renderer: THREE.WebGPURenderer): Promise<number>;
  createSpecimen(at: { x: number; y: number; z: number }): Specimen;
  /**
   * The ground under a species (its row): a picture of what lies on it,
   * seen from straight above, tiled over the species' ground (`Species.groundTile`).
   * Only its light and dark are used, against its own mean; the colour
   * stays the species'. `null` takes it away.
   */
  setGroundPicture(row: number, picture: CanvasImageSource | null): void;
  /**
   * Make a species' ground picture from the species itself: its leaves,
   * with its colours and its leaf picture, laid over as a mown or trodden
   * sward's are and drawn from straight above. Do it again when the
   * species changes.
   */
  bakeGround(renderer: THREE.WebGPURenderer, row: number): Promise<void>;
  /**
   * Once a frame, before rendering. `lookAt` is where the picture's middle
   * meets the ground, if the host knows it: the fine leaves are centred
   * there. Without it they are centred a few metres ahead of the eye. With
   * the ground's height there too (`y`), the finest squares know how far
   * off they are, and are drawn only when close.
   */
  update(renderer: THREE.WebGPURenderer, camera: THREE.Camera, timeS: number, lookAt?: { x: number; y?: number; z: number }): void;
  /** Which of it is drawn: the far tufts, the fine leaves. */
  show: { tufts: boolean; leaves: boolean };
  /**
   * For the host's ground material: the colour the grass standing at a
   * place takes (before light), so ground and grass are one colour and
   * where the leaves thin out there is nothing to see.
   */
  groundColor(xz: Vec2): Vec3;
  /** The light a leaf takes on ground with this normal, for the same reason. */
  light(normal: Vec3): Vec3;
  /** Plants computed each frame, and the most leaves they can stand up as. */
  stats: { plants: number; leaves: number };
  dispose(): void;
}

/** After Dave Hoskins' hash12: even on whole-numbered cells, where a sine hash stands plants in rows. */
const hashCell = Fn(([pIn]: [Vec2]) => {
  const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, vec3(p3.y, p3.z, p3.x).add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});

const hash21 = Fn(([pIn]: [Vec2]) => {
  const p = fract(pIn.mul(vec2(123.34, 456.21))).toVar();
  p.addAssign(dot(p, p.add(45.32)));
  return fract(p.x.mul(p.y));
});

export function createGrass(options: GrassOptions): Grass {
  const { height, map, mow } = options;
  const layers = options.layers ?? DEFAULT_LAYERS;

  const group = new THREE.Group();
  const noiseTex = makeNoiseTexture();
  const table = makeSpeciesTable();
  const tableNode = uniformArray(table, "vec4");
  const row = (k: Int, slot: number) => tableNode.element(k.mul(SPECIES_SLOTS).add(slot)) as unknown as Vec4;

  const uSun = uniform(new THREE.Vector3(0.45, 0.7, 0.55).normalize());
  const uSunTint = uniform(new THREE.Vector3(1.14, 1.04, 0.86));
  const uShadeTint = uniform(new THREE.Vector3(0.6, 0.7, 0.88));
  const uWind = uniform(new THREE.Vector3(1, 0, 3));
  const uTime = uniform(0);
  const uCamPos = uniform(new THREE.Vector3());
  const uCamFwd = uniform(new THREE.Vector2(0, 1));
  /** broad, flat. */
  const uStyle = uniform(new THREE.Vector2(0, 0));
  /** clumpSize, macro, edgeWobble, groundShade. */
  const uLook = uniform(new THREE.Vector4(0.85, 0.3, 0.03, 1));
  const uStripes = uniform(0.16);
  /** 1 while the field is mown in stripes (`look.mown`), 0 while it is not: then no leaf is laid over. */
  const uMown = uniform(0);
  /** The eye's height over the ground it looks at (m), as near as the host has said. */
  const uEyeUp = uniform(1.5);
  /** shadow, occlusion. */
  const uShade = uniform(new THREE.Vector2(0.6, 0.45));
  /** depth: how far the roots' shade follows the light's fall through the stand (0: the species' own `rootShade`). */
  const uLight = uniform(0.5);
  /** fold, relief, leafPixels. */
  const uDetail = uniform(new THREE.Vector3(1, 1, 1));
  const bare = new THREE.Color("#8a7355");
  const uBare = uniform(new THREE.Vector3(bare.r, bare.g, bare.b));
  const uMidFocus = uniform(new THREE.Vector2());
  /** The metres a pixel covers at a metre from the eye: the picture's zoom and size, for what may be widened to be seen. */
  const uPixel = uniform(0.00078);
  /** How far from the eye the fine leaves go (m): `mid`'s reach, or `wide`'s as far as it is drawn. The tufts grow in towards it. */
  const uLeafReach = uniform(layers.mid.range * LEAF_REACH);

  // The leaves' pictures: one layer to a picture, all one size.
  const leafPixels = new Uint8Array(LEAF_TEXTURE_W * LEAF_TEXTURE_H * 4 * MAX_LEAF_TEXTURES).fill(255);
  const leafTex = new THREE.DataArrayTexture(leafPixels, LEAF_TEXTURE_W, LEAF_TEXTURE_H, MAX_LEAF_TEXTURES);
  leafTex.format = THREE.RGBAFormat;
  leafTex.type = THREE.UnsignedByteType;
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.magFilter = leafTex.minFilter = THREE.LinearFilter;
  leafTex.wrapS = leafTex.wrapT = THREE.ClampToEdgeWrapping;
  leafTex.generateMipmaps = false;
  leafTex.needsUpdate = true;
  const leafLayers = new Map<string, number>();

  // The ground's pictures: a layer to a species (its row), each with smaller copies of itself for distance.
  const groundPixels = new Uint8Array(GROUND_SIZE * GROUND_SIZE * 4 * MAX_SPECIES).fill(128);
  const groundTex = new THREE.DataArrayTexture(groundPixels, GROUND_SIZE, GROUND_SIZE, MAX_SPECIES);
  groundTex.format = THREE.RGBAFormat;
  groundTex.type = THREE.UnsignedByteType;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.magFilter = THREE.LinearFilter;
  groundTex.minFilter = THREE.LinearMipmapLinearFilter;
  groundTex.generateMipmaps = true;
  groundTex.anisotropy = 8;
  groundTex.needsUpdate = true;
  /** For each species' row, its ground picture's mean colour (linear), or null if it has no picture. */
  const groundOf: ({ mean: [number, number, number] } | null)[] = Array.from({ length: MAX_SPECIES }, () => null);
  const repack = () => packSpecies(current, table, leafLayers, groundOf);
  /** Put a picture's pixels (sRGB, and in alpha how high each stands; GROUND_SIZE square) in a species' layer, and note its mean. */
  const setGroundLayer = (rowIndex: number, px: Uint8Array | Uint8ClampedArray | null) => {
    if (px === null) groundOf[rowIndex] = null;
    else {
      groundPixels.set(px, rowIndex * GROUND_SIZE * GROUND_SIZE * 4);
      const sum = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += SRGB_TO_LINEAR[px[i + c]];
      const n = px.length / 4;
      groundOf[rowIndex] = { mean: [Math.max(0.004, sum[0] / n), Math.max(0.004, sum[1] / n), Math.max(0.004, sum[2] / n)] };
      groundTex.needsUpdate = true;
    }
    repack();
  };
  let current: readonly Species[] = options.species;

  const noise = (uv: Vec2) => texture(noiseTex, uv).level(float(0)) as unknown as Vec4;

  /** The species and the border distance at a place, the place wobbled so a border is not the map's steps. */
  const lookup = (xz: Vec2) => {
    // (Over a metre or so: a finer wobble is a saw's edge, not a line that strays.)
    const w = noise(xz.div(16).add(0.17));
    return map.sample(xz.add(vec2(w.g, w.a).sub(0.5).mul(uLook.z.mul(2))));
  };

  /** A stand's colour at a place: its species' colour, drifting a little over tens of metres and over a few. */
  const tone = (xz: Vec2, base: Vec3) => {
    const ga = noise(xz.div(208.0));
    const gb = noise(xz.div(36.0).add(0.37));
    const broad = ga.r.mul(0.6).add(ga.g.mul(0.4));
    const mid = gb.r.mul(0.65).add(gb.a.mul(0.35));
    return base.mul(float(1).add(broad.sub(0.5).mul(uLook.y))).mul(float(1).add(mid.sub(0.5).mul(0.14)));
  };

  /** Lit as the ground is lit, slope and all: a bank facing the sun is lighter, and its grass with it. */
  const light = (n: Vec3): Vec3 => {
    const steep = normalize(vec3(n.x.mul(2.6), n.y, n.z.mul(2.6)));
    const lit = clamp(float(0.62).add(dot(steep, uSun).sub(uSun.y).mul(1.25)), float(0), float(1));
    return mix(uShadeTint, uSunTint, lit);
  };

  /** The way a species' leaves were laid over at a place (x, z), by how far the mower lays that species. */
  const layAt = (xz: Vec2, k: Int): Vec2 => (mow ? mow.sample(xz).mul(row(k, 6).w).mul(uMown) : vec2(0, 0));
  /**
   * Laid grass is lighter seen along its lay (the leaves' upper faces) and
   * darker against it (their cut ends, and the shade between them): the
   * stripes of a mown sward, which change places as the eye goes round
   * them. From the place and the eye alone, so the ground and the leaves on
   * it take exactly the same.
   */
  const laidShade = (xz: Vec2, lay: Vec2): THREE.Node<"float"> => {
    const to = xz.sub(vec2(uCamPos.x, uCamPos.z));
    const off = length(to);
    // (Looking straight down there is neither along nor against.)
    return float(1).add(dot(lay, to.div(max(off, float(1e-3)))).mul(uStripes).mul(smoothstep(float(0.15), float(1.2), off)));
  };

  // The canopy: how tall the grass stands at each place, kept as a picture over the map's ground and
  // drawn again when the species or the map may have changed. It is what shadows are found from.
  const CANOPY_SIZE = 512;
  /** The tallest a stand can be kept as (m). */
  const CANOPY_MAX = 1;
  const reach = map.bounds;
  const canopyTarget = reach ? new THREE.RenderTarget(CANOPY_SIZE, CANOPY_SIZE, { type: THREE.UnsignedByteType, depthBuffer: false }) : null;
  if (canopyTarget) canopyTarget.texture.minFilter = canopyTarget.texture.magFilter = THREE.LinearFilter;
  const canopyQuad = (() => {
    if (!reach) return null;
    const at = mix(vec2(reach.x0, reach.z0), vec2(reach.x1, reach.z1), uv());
    const here = lookup(at);
    const alive = step(here.species, float(MAX_SPECIES - 0.5));
    const tall = row(int(min(here.species, float(MAX_SPECIES - 1))), 0).x.mul(alive);
    const mat = new THREE.MeshBasicNodeMaterial({ fog: false });
    mat.colorNode = vec4(min(tall.div(CANOPY_MAX), float(1)), 0, 0, 1);
    return new THREE.QuadMesh(mat);
  })();
  const canopyAt = (xz: Vec2): THREE.Node<"float"> => {
    if (!reach || !canopyTarget) return float(0);
    const at = xz.sub(vec2(reach.x0, reach.z0)).div(vec2(reach.x1 - reach.x0, reach.z1 - reach.z0));
    return (texture(canopyTarget.texture, at).level(float(0)) as unknown as Vec4).x.mul(CANOPY_MAX);
  };
  /**
   * How much of the sun reaches a point `up` metres above the ground at a
   * place, 0..1: a few steps towards the sun, each asking whether the grass
   * there stands above the ray. Soft, and never black: a stand of grass is
   * not a wall.
   */
  const sunReach = (xz: Vec2, up: THREE.Node<"float">): THREE.Node<"float"> => {
    const flat = vec2(uSun.x, uSun.z);
    const across = max(length(flat), float(0.05));
    const to = flat.div(across);
    const rise = uSun.y.div(across);
    let lit = float(1) as THREE.Node<"float">;
    for (const far of [0.05, 0.12, 0.28, 0.6, 1.2]) {
      const over = canopyAt(xz.add(to.mul(far))).sub(up.add(rise.mul(far)));
      lit = min(lit, float(1).sub(smoothstep(float(0), float(0.015 + far * 0.1), over)));
    }
    return mix(float(1), lit, uShade.x);
  };
  /** How much of the sky a point sees, 0..1: less beside taller grass, whichever way the sun is. */
  const skyOpen = (xz: Vec2, up: THREE.Node<"float">): THREE.Node<"float"> => {
    let shut = float(0) as THREE.Node<"float">;
    for (const [dx, dz] of [[0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]) shut = shut.add(clamp(canopyAt(xz.add(vec2(dx, dz))).sub(up).div(0.27), float(0), float(1)));
    return float(1).sub(shut.mul(0.25).mul(uShade.y));
  };
  /** What a leaf or the ground is lit by where the sun does not reach it: the sky's light alone. */
  const inShade = () => uShadeTint.div(mix(uShadeTint, uSunTint, 0.62));

  /**
   * How much a place is in one of its species' patches, 0..1.
   *
   * A patch is a colony: a plant that came in and spread outward from where it landed, so it is a disc,
   * as old as it is wide, thick at its middle and thinning to single plants at its edge. There are many
   * small ones and few large, they stand where conditions let them in (so they gather in drifts and
   * leave other ground clear), and where two meet they merge into one scalloped shape.
   *
   * So: the ground is squared off at two sizes, and each square has at most one colony, somewhere in its
   * middle half, of a radius drawn so that most are small. Whether it is there at all goes by the
   * species' share and by a slow noise (the drifts). A place is as much in a patch as the nearest colony
   * makes it; its edge is frayed by pushing the place about a little before measuring.
   */
  const inPatch = (xz: Vec2, k: THREE.Node<"int">): THREE.Node<"float"> => {
    const share = row(k, 10).w;
    const size = row(k, 8).z;
    const turn = (v: Vec2, c: number, sn: number) => vec2(v.x.mul(c).sub(v.y.mul(sn)), v.x.mul(sn).add(v.y.mul(c)));
    // (Where colonies get in at all: over some ten patches' breadth, more here and none there.)
    const driftRaw = noise(turn(xz, 0.454, -0.891).div(size.mul(40)).add(vec2(0.57, 0.29))).r;
    const drift = smoothstep(float(0.36), float(0.62), driftRaw);
    // (The fraying: a place is measured from a little to one side of where it is, by a finer noise.)
    const fray = noise(turn(xz, 0.921, 0.391).div(size.mul(3.1)).add(0.81));
    const at = xz.add(vec2(fray.g, fray.a).sub(0.5).mul(size).mul(0.5));
    // (All the colonies there could be cover about a quarter of the ground: for a larger share they are wider.)
    const often = clamp(share.div(0.24), float(0), float(1)).mul(drift.mul(1.5).add(0.15));
    const wider = max(float(1), pow(share.div(0.24), float(0.5)));
    // (The plants at a colony's edge: a grain a leaf or two wide, by which the edge is ragged and not drawn.)
    const grain = noise(xz.div(size.mul(1.1)).add(0.23)).b;
    /**
     * The colonies of one size of square: how much the place is in one (x), and how near it is to one,
     * out to twice its breadth (y), which is where its seedlings come up.
     */
    const colonies = (cellM: THREE.Node<"float">, salt: number, often1: THREE.Node<"float">, least: number, most1: number): Vec2 => {
      // (No colony is round: it got on better one way than another. The place is measured from where a
      // noise as wide as the colonies puts it, so each has its own bays and lobes.)
      const lobes = noise(turn(xz, 0.719, 0.695).div(cellM.mul(2.6)).add(salt * 0.01));
      const g = at.add(vec2(lobes.r, lobes.a).sub(0.5).mul(cellM).mul(0.42)).div(cellM);
      const home = floor(g);
      const f = g.sub(home);
      // (A colony reaches at most a fifth of a square beyond its own, never three quarters of one, so the four squares nearest the place are all that can hold one that reaches it.)
      const side = vec2(step(float(0.5), f.x).mul(2).sub(1), step(float(0.5), f.y).mul(2).sub(1));
      let core = float(0) as THREE.Node<"float">;
      let near = float(0) as THREE.Node<"float">;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const cell = home.add(vec2(side.x.mul(ox), side.y.mul(oy)));
        const key = cell.add(salt);
        const centre = cell.add(vec2(hashCell(key), hashCell(key.add(17.3))).mul(0.5).add(0.25));
        const small = hashCell(key.add(41.7));
        const reach = min(mix(float(least), float(most1), small.mul(small)).mul(wider), float(0.74));
        const there = step(hashCell(key.add(73.1)), often1);
        // (And longer one way than the other, each its own way: up to half as long again.)
        const lie = hashCell(key.add(151.3)).mul(3.1416);
        const off = g.sub(centre);
        const along = off.x.mul(cos(lie)).add(off.y.mul(sin(lie)));
        const across = off.y.mul(cos(lie)).sub(off.x.mul(sin(lie)));
        const longer = mix(float(1), float(1.5), hashCell(key.add(197.9)));
        const away = length(vec2(along.div(longer), across)).div(reach);
        // (A colony is one plant's offspring: alike all through, each a little more or less unlike the
        // stand than the next. Its edge is its outermost plants: in or out by the grain, over a tenth of its breadth.)
        const unlike = mix(float(0.45), float(1), hashCell(key.add(113.9)));
        const inside = smoothstep(float(-0.06), float(0.06), float(0.9).sub(away).add(grain.sub(0.5).mul(0.3)));
        core = max(core, there.mul(unlike).mul(inside));
        near = max(near, there.mul(float(1).sub(smoothstep(float(0.8), float(2.2), away))));
      }
      return vec2(core, near);
    };
    const large = colonies(size.mul(6.3), 91.3, often, 0.1, 0.45);
    const middling = colonies(size.mul(2.2), 3.7, often, 0.1, 0.45);
    // (Seedlings: small ones, a hand or two across, thick about the colonies they came from and few elsewhere.)
    const seedlings = colonies(size.mul(0.7), 47.1, often.mul(float(0.12).add(max(large.y, middling.y).mul(1.1))), 0.12, 0.34);
    const grown = max(max(large.x, middling.x), seedlings.x.mul(0.85)).mul(mix(float(0.82), float(1), fray.r));
    // Blotches are the other kind: not something that grew, but the ground showing through the grass, so
    // they have no centres and no edges. Three lookups of the noise, turned and of unrelated sizes (one
    // alone is the same four shapes in rows), cut where the species' share of the ground lies above.
    const wide = noise(turn(xz, 0.814, 0.581).div(size.mul(9.48)).add(vec2(0.13, 0.71)));
    const pushed = xz.add(vec2(wide.r, wide.a).sub(0.5).mul(size).mul(2.2));
    const lumps = noise(pushed.div(size.mul(4)).add(0.37)).r.mul(0.4).add(wide.r.mul(0.26)).add(driftRaw.mul(0.22)).add(fray.g.mul(0.12));
    const cut = mix(float(0.62), float(0.34), share);
    const blotched = smoothstep(cut.sub(0.07), cut.add(0.1), lumps).mul(mix(float(0.55), float(1), smoothstep(float(0.3), float(0.7), fray.r)));
    return mix(grown, blotched, row(k, 9).w).mul(step(float(0.005), share));
  };
  /** A place's colour for being in a patch or not, as a multiplier. */
  const patchTint = (xz: Vec2, k: THREE.Node<"int">): Vec3 => mix(vec3(1), vec3(row(k, 10).x, row(k, 10).y, row(k, 10).z), inPatch(xz, k));

  /**
   * How much of the light reaches a stand's roots, 0..1. Light falls off through leaves as exp(-K L)
   * (Monsi and Saeki), L the leaf area passed on the way down. The stand's leaf area index is taken from
   * its height (mown bluegrass was measured at 3.2 at 3.8 cm and 4.9 at 7.6 cm, a putting green at about
   * 1: Lee et al. 2011) and its density; K is 0.5 for the sky's light and 0.5 / sin(sun's height) for the
   * sun's (leaves at all angles: Campbell and Norman 1998), so a low sun leaves the roots darker. The
   * species' own `rootShade` thickens or thins the stand about that, and `look.depth` sets how far this
   * is followed over `rootShade` alone.
   */
  const rootDark = (k: THREE.Node<"int">): THREE.Node<"float"> => {
    const stand = row(k, 0);
    const own = row(k, 3).z;
    const leafArea = min(float(6), stand.x.mul(60).add(0.75)).mul(clamp(stand.z, float(0.3), float(1.5))).mul(float(1.55).sub(own));
    const sunK = float(0.5).div(max(uSun.y, float(0.15)));
    const reaches = exp(leafArea.mul(sunK).negate()).mul(0.62).add(exp(leafArea.mul(-0.5)).mul(0.38));
    return mix(own, clamp(reaches, float(0.06), float(1)), uLight);
  };

  /** The share of a square's leaves that stand at `away` metres from the eye, 1 at the eye to 0 at its reach, level at both. */
  const leavesAt = (away: THREE.Node<"float">, range: number): THREE.Node<"float"> => {
    const q = clamp(away.div(range * LEAF_REACH), float(0), float(1));
    const left = float(1).sub(q.mul(q));
    return left.mul(left);
  };
  /** The squares of fine leaves, once they are made: where each is centred, how far it goes, how much of it is drawn. */
  const fineSquares: { uFocus: THREE.UniformNode<"vec2", THREE.Vector2>; uGate: THREE.UniformNode<"float", number>; range: number }[] = [];
  /** The share of a full stand of fine leaves that is left at a place, 0..1: the squares' own thinning, taken together. */
  /**
   * Whether a leaf `wide` metres across is drawn at `away` metres from the eye, 1..0: while it is most
   * of a pixel wide in the picture, less as it narrows, and not once it is a third of one. So the grass
   * is drawn as far as its leaves can be seen and no further, on any size of picture and through any lens:
   * a phone draws fewer, and a thin-leaved grass gives way to its ground sooner than a broad one.
   */
  const leafSeen = (wide: THREE.Node<"float">, away: THREE.Node<"float">): THREE.Node<"float"> => {
    // (`leafPixels` moves the rule: 1 is as above, 2 stops at twice the width, 0 draws every leaf.)
    const inPicture = wide.div(max(away, float(1e-3)).mul(uPixel));
    return mix(float(1), smoothstep(uDetail.z.mul(0.3), uDetail.z.mul(0.8).add(1e-4), inPicture), step(float(0.01), uDetail.z));
  };

  const leavesLeft = (xz: Vec2, wide: THREE.Node<"float">): THREE.Node<"float"> => {
    const away = length(vec3(xz.x.sub(uCamPos.x), uEyeUp, xz.y.sub(uCamPos.z)));
    let gone = float(1) as THREE.Node<"float">;
    for (const sq of fineSquares) {
      const share = leavesAt(away, sq.range).mul(sq.uGate);
      gone = gone.mul(float(1).sub(share));
    }
    return float(1).sub(gone).mul(leafSeen(wide, away));
  };

  const groundColor = (xz: Vec2): Vec3 => {
    const m = lookup(xz);
    const alive = step(m.species, float(MAX_SPECIES - 0.5));
    const k = int(min(m.species, float(MAX_SPECIES - 1)));
    const base = row(k, 4);
    // Near the eye the ground is what shows between the leaves, in the stand's
    // shade: as dark as the leaves' roots. Far off it stands in for the whole
    // stand, where the tufts have taken its colour and stopped (see `toGround`).
    // (By the eye's whole distance, height and all: from far overhead the ground under the eye is far too.)
    const farOff = smoothstep(float(layers.far.range * 0.22), float(layers.far.range * 0.6), length(vec3(xz.x.sub(uCamPos.x), uEyeUp, xz.y.sub(uCamPos.z))));
    // Where the leaves stand the ground is what shows between them; where they have thinned out it stands
    // in for them. So it goes from the one to the other exactly as the leaves go: by how many of them
    // are left here (`leavesLeft`), for a species the far tufts do not take over from, and by the
    // tufts' own fading for one they do.
    // (For a species with far tufts too: they stand a hand apart, and dark ground between them is a dark
    // band between the leaves and the ground beyond.)
    const far = max(float(1).sub(leavesLeft(xz, row(k, 1).x.add(row(k, 1).y.mul(0.5)))), farOff);
    // (Not as dark as the roots themselves: the ground's picture has the dark between the leaves in it.)
    // Between the leaves it is nearly as dark as their roots; standing in for them it is their mean, root
    // to tip (`STAND_MEAN`), which is what the last leaves and the far tufts turn to as they go.
    const under = mix(mix(rootDark(k), float(1), 0.4), mix(rootDark(k), float(1), STAND_MEAN), far).mul(uLook.w);
    // A fine grain, for the leaves' tips where the eye is too far off for leaves: gone by a dozen strides.
    const grain = noise(xz.div(0.5)).b.sub(0.5).mul(0.1).mul(float(1).sub(smoothstep(float(3), float(14), distance(xz, vec2(uCamPos.x, uCamPos.z)))));
    // The ground's picture: what lies on it, as lighter and darker than the picture's own mean, so
    // the species' colour stands and, far off where the picture is its mean, nothing is left of it.
    // (Never from the very foot of its own stand: that dark is in `under` and in its picture already, and three
    // darks on the ground against sunlit tips is a grain the far ground has not got.)
    const standsFor = canopyAt(xz).mul(STAND_SUN);
    const picture = row(k, 8);
    const mean = row(k, 9);
    // (Looked up twice, the second time turned and at another size, and the two mixed by a slow noise: one
    // copy repeated every tile is a pattern of dots from above. And gone by twenty metres, where its
    // smaller copies are down to the few blobs every tile has in the same places.)
    const turned = vec2(xz.x.mul(0.819).sub(xz.y.mul(0.574)), xz.x.mul(0.574).add(xz.y.mul(0.819)));
    const which = smoothstep(float(0.35), float(0.65), noise(xz.div(5.3).add(0.71)).g);
    const toEye = vec3(uCamPos.x.sub(xz.x), uEyeUp, uCamPos.z.sub(xz.y));
    const eyeAway = length(toEye);
    const shows = picture.x.mul(float(1).sub(smoothstep(float(6), float(20), eyeAway)));
    // Relief. The picture carries, beside its colour, how high what is in it stands (0..1 of `PILE_TALL`
    // leaf heights: its alpha). Two things are made of that, both scaled by `relief`:
    //  - the picture is looked up where the line of sight meets that height and not where it meets the
    //    flat ground, so what stands high moves across what lies low as the eye moves (parallax);
    //  - the slope towards the sun, from the height a little that way, lights what faces the sun and
    //    shades what faces from it, as a slope is lit: by its angle to the light.
    const pileTall = row(k, 0).x.mul(PILE_TALL);
    // (How far the sight line runs along the ground for each metre it drops; held, near the horizon.)
    const sightRun = vec2(toEye.x, toEye.z).div(max(toEye.y, eyeAway.mul(0.3)));
    const sunAlong = normalize(vec2(uSun.x, uSun.z).add(vec2(1e-4, 0)));
    const sunFlat = length(vec2(uSun.x, uSun.z));
    const turn = (v: Vec2) => vec2(v.x.mul(0.819).sub(v.y.mul(0.574)), v.x.mul(0.574).add(v.y.mul(0.819)));
    const pileAt = (at: Vec2, tileM: THREE.Node<"float">, run: Vec2, sunWay: Vec2) => {
      const tall0 = (texture(groundTex, at).depth(k) as unknown as Vec4).w;
      const seenAt = at.add(run.mul(tall0.sub(0.5)).mul(pileTall).mul(uDetail.y).div(tileM));
      const texel = texture(groundTex, seenAt).depth(k) as unknown as Vec4;
      const sunward = (texture(groundTex, seenAt.add(sunWay.mul(RELIEF_STEP / GROUND_SIZE))).depth(k) as unknown as Vec4).w;
      // (Metres risen per metre towards the sun.)
      const climb = sunward.sub(texel.w).mul(pileTall).div(tileM.mul(RELIEF_STEP / GROUND_SIZE)).mul(uDetail.y);
      const lit = clamp(uSun.y.sub(climb.mul(sunFlat)).div(max(uSun.y, float(0.15)).mul(pow(climb.mul(climb).add(1), float(0.5)))), float(0.6), float(1.15));
      return min(vec3(texel.x, texel.y, texel.z).div(vec3(mean.x, mean.y, mean.z)), vec3(3)).mul(lit);
    };
    const lying = mix(vec3(1), mix(
      pileAt(xz.div(picture.y), picture.y, sightRun, sunAlong),
      pileAt(turned.div(picture.y.mul(1.31)).add(vec2(0.37, 0.61)), picture.y.mul(1.31), turn(sightRun), turn(sunAlong)),
      which,
    ), shows);
    // (A stand in seed is paler for its heads, which is most of what is seen of it from any way off.)
    const heads = row(k, 6);
    const inSeed = mix(vec3(1), vec3(heads.x, heads.y, heads.z), row(k, 2).z.mul(0.5));
    // The wind shows on the far ground as it does on the leaves: where a gust lies the grass over it turns
    // its paler side up, and the patches travel downwind to the horizon (the same field the leaves lean by:
    // see the compute pass). Only where the ground stands in for the leaves, and for grass the wind can move.
    const wDir = normalize(vec2(uWind.x, uWind.y).add(vec2(1e-4, 0)));
    const gustAt = xz.sub(wDir.mul(uTime.mul(float(1.2).add(uWind.z.mul(0.55)))));
    const gustIs = smoothstep(float(0.3), float(0.72), noise(gustAt.div(61.0)).r.mul(0.68).add(noise(gustAt.mul(1.35).div(19.0).add(0.43)).g.mul(0.32)));
    const windTakes = min(smoothstep(float(0.075), float(0.17), row(k, 0).x).mul(float(1).sub(row(k, 2).w)).mul(1.4), float(1));
    const blown = float(1).add(gustIs.sub(0.5).mul(windTakes).mul(clamp(uWind.z.div(8.0), float(0), float(1.7))).mul(far).mul(GUST_PALE));
    // (Bare ground is shaded as grown ground is: a path beside tall grass lies in its shadow.)
    return mix(uBare, tone(xz, vec3(base.x, base.y, base.z)).mul(patchTint(xz, k)).mul(under).mul(laidShade(xz, layAt(xz, k))).mul(float(1).add(grain)).mul(lying).mul(inSeed).mul(blown), alive).mul(mix(inShade(), vec3(1), sunReach(xz, standsFor))).mul(skyOpen(xz, standsFor));
  };

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // A leaf of grass is narrow where it leaves the stem, nearly parallel-sided
  // for most of its length, and tapers only near its end: [half-width,
  // height] at each joint, then the tip. Enough joints for it to bend over in
  // a curve (a fine leaf in a field is a few pixels wide: three carry it).
  const FINE_RINGS: [number, number][] = [[0.6, 0], [1, 0.34], [0.9, 0.76]];
  const TUFT_RINGS: [number, number][] = [[0.62, 0], [1, 0.28], [0.95, 0.55], [0.74, 0.8]];
  /** The same outline with `joints` joints, for a leaf seen close: a specimen. */
  const fineRings = (rings: [number, number][], joints: number): [number, number][] => {
    const top = rings[rings.length - 1][1];
    return Array.from({ length: joints }, (_, i) => {
      const y = (i / (joints - 1)) * top;
      let j = 0;
      while (j < rings.length - 2 && rings[j + 1][1] <= y) j++;
      const t = (y - rings[j][1]) / (rings[j + 1][1] - rings[j][1]);
      return [rings[j][0] + (rings[j + 1][0] - rings[j][0]) * t, y];
    });
  };
  /**
   * `blades` leaves, each a strip of two vertices to a joint and two at the
   * tip (both at the middle: a point; a cut-out leaf spreads them, see
   * `leaf`). `position` is [half-width, height, which leaf]; `aSide` says
   * which edge a vertex is on.
   */
  const bladeGeometry = (blades: number, rings: [number, number][], folded = false) => {
    const all: [number, number][] = [...rings, [0, 1]];
    // A flat leaf has its two edges at each joint. A folded one has its rib there too, twice over (once
    // for each half, so each half can face its own way): `aMid` is the leaf's half-breadth at a rib
    // vertex, which is how far back the fold carries it, and 0 at an edge.
    const perRing = folded ? 4 : 2;
    const VERTS = all.length * perRing;
    const INDICES = (all.length - 1) * (folded ? 12 : 6);
    const pos = new Float32Array(blades * VERTS * 3);
    const sideOf = new Float32Array(blades * VERTS);
    const mid = new Float32Array(blades * VERTS);
    const idx = new Uint16Array(blades * INDICES);
    for (let b = 0; b < blades; b++) {
      const v0 = b * VERTS;
      all.forEach(([w, y], j) => {
        const at = v0 + j * perRing;
        if (folded) {
          pos.set([-w, y, b, 0, y, b, 0, y, b, w, y, b], at * 3);
          sideOf.set([-1, -1, 1, 1], at);
          mid.set([0, w, w, 0], at);
        } else {
          pos.set([-w, y, b, w, y, b], at * 3);
          sideOf.set([-1, 1], at);
        }
      });
      for (let j = 0; j < all.length - 1; j++) {
        const a = v0 + j * perRing;
        const up = a + perRing;
        if (folded) idx.set([a, a + 1, up, a + 1, up + 1, up, a + 2, a + 3, up + 2, a + 3, up + 3, up + 2], b * INDICES + j * 12);
        else idx.set([a, a + 1, up, a + 1, up + 1, up], b * INDICES + j * 6);
      }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSide", new THREE.BufferAttribute(sideOf, 1));
    if (folded) geo.setAttribute("aMid", new THREE.BufferAttribute(mid, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  };

  interface LeafPlace { hcell: Vec2; r0: THREE.Node<"float">; xz: Vec2 }
  interface LeafKind {
    /** A fine single leaf, or a tuft's broad blade. */
    fine: boolean;
    /** In a field (widened with distance, taking the ground's colour far off), or a specimen drawn as it is. */
    field: boolean;
    /** The layer's range (m), for a field. */
    range: number;
    /** Each plant turned its own way, where there is no eye to turn towards: a picture taken from straight above. */
    spin?: boolean;
    /** Its geometry has a rib to fold along (`bladeGeometry`): the squares nearest the eye, and a specimen. */
    folded?: boolean;
  }

  /**
   * One vertex of a leaf: where it is and what colour, from its plant's
   * place and what was worked out for the plant (`aGrassState`, lean x and z,
   * height, gust; `aGrassShape`, species and reach or broadening;
   * `aGrassColor`, lit colour and the ground's height). The same for a field
   * and for a specimen: a specimen is what the field draws.
   */
  const leaf = (at: LeafPlace, o: LeafKind) => {
    const { hcell, r0, xz } = at;
    const { fine } = o;
    const TOP_HALF_WIDTH = (fine ? FINE_RINGS : TUFT_RINGS).at(-1)![0];
    const st = attribute("aGrassState", "vec4");
    const sh = attribute("aGrassShape", "vec4");
    const colSt = attribute("aGrassColor", "vec4");
    const edge = attribute("aSide", "float");
    // (The fold: at a rib vertex, the half-breadth it is carried back by; the angle each half is turned through.)
    const ribBack = o.folded ? attribute("aMid", "float") : float(0);
    const onRib = step(float(1e-6), ribBack);
    const foldBy = uDetail.x.mul(FOLD_ANGLE);
    const tall = st.z;
    const gustHere = st.w;
    const k = int(sh.x.add(0.5));
    const stand = row(k, 0);
    const blade = row(k, 1);
    const form = row(k, 2);
    const habit = row(k, 3);
    const baseCol = row(k, 4);
    const tint = row(k, 5);
    const seedTint = row(k, 6);
    const picture = row(k, 7);
    const sheenAmt = baseCol.w;
    const cutout = picture.w;
    const isCut = step(float(0.5), form.x);
    const isSquare = step(float(1.5), form.x);
    const seed = form.z;
    const flat = uStyle.y;

    const root = vec3(xz.x, colSt.w, xz.y);
    const dist = distance(root, cameraPosition);
    const gPos = positionGeometry;
    const b = gPos.z;
    const ang = r0.add(b.mul(0.381966)).mul(6.2832);
    const out2 = vec2(cos(ang), sin(ang));
    const rb = hashCell(hcell.add(b.mul(7.3)));
    // A tuft's blades stand about its root, a mown sward's over its whole cell; none over the border.
    const footRadius = mix(float(0.02).add(rb.mul(0.16)), float(0.03).add(pow(rb, float(0.5)).mul(0.17)), isCut);
    const foot = root.add(vec3(out2.x, 0, out2.y).mul(fine ? float(0) : min(footRadius, sh.y)));
    const spinTo = hashCell(hcell.add(19.3)).mul(6.2832);
    const toCam = o.spin ? vec2(cos(spinTo), sin(spinTo)) : normalize(vec2(cameraPosition.x.sub(foot.x), cameraPosition.z.sub(foot.z)).add(1e-4));
    // Mown grass has no tip: the mower took it. A cut leaf ends in a slant,
    // its top joint level and its tip moved out over one edge; close-mown
    // turf is cut off square, each leaf the same width all the way up, so
    // the stand reads as a dense pile.
    const isTip = step(float(0.99), gPos.y);
    const isTopJoint = step(float(0.7), gPos.y).mul(float(1).sub(isTip));
    const cutSide = step(float(0.5), rb).mul(2).sub(1);
    // A seed head: a third of a leaf's width up a third of its height, swelling to nearly twice it below the tip.
    const seedHead = mix(float(1), mix(float(0.32), float(1.9), smoothstep(float(0.3), float(0.78), gPos.y)), seed);
    const squareX = mix(sign(gPos.x).mul(0.85), float(0), isTip);
    const shapedX = mix(mix(gPos.x, mix(gPos.x, cutSide.mul(TOP_HALF_WIDTH), isTip), isCut), squareX, isSquare).mul(seedHead);
    // (A cut-out leaf is a plain strip, its outline left to its picture.)
    const leafX = mix(shapedX, edge.mul(float(1).sub(onRib)), cutout);
    const gy = mix(mix(gPos.y, mix(gPos.y, mix(float(0.86), float(0.88), isSquare), isTopJoint), isCut), gPos.y, cutout);
    // A leaf does not turn to face whoever looks at it. Each is turned its
    // own way, up to some 60 degrees from square-on, and twists a little up
    // its length, so some are seen broad and some nearly edge-on.
    const turn = hashCell(hcell.add(b.mul(5.9).add(41.0))).sub(0.5).mul(2.1).add(gy.mul(0.5).mul(cutSide)).mul(form.y);
    const side = vec3(toCam.y.negate(), 0, toCam.x).mul(cos(turn)).add(vec3(toCam.x, 0, toCam.y).mul(sin(turn)));
    // (Half the leaf's breadth: the strip's vertices stand at -1 and 1 across it.)
    const leafWidth = blade.x.add(rb.mul(blade.y)).mul(0.5).mul(float(1).add(uStyle.x.mul(2.5)));
    // In a field a leaf is never drawn thinner than a pixel or so, or it
    // flickers in and out; and a leaf broadened for the leaves thinned out
    // about it is never broadened past a few pixels, so what is seen close,
    // or through a long lens, is the leaf at its own breadth.
    const pixel = dist.mul(uPixel);
    const seen = max(leafWidth, pixel.mul(0.6));
    const width = !o.field
      ? leafWidth.mul(fine ? 1 : TUFT_BROAD)
      : fine
        ? min(seen.mul(float(1).add(sh.y)), max(seen, pixel.mul(1.75)))
        : leafWidth.mul(TUFT_BROAD).mul(mix(float(0.55), float(1), clamp(dist.div(uLeafReach), float(0), float(1)))).mul(float(1).add(dist.mul(0.09))).mul(mix(float(1.0), float(1.48), smoothstep(float(18), float(38), dist)));
    // No two leaves of a plant the same height.
    const rh = hashCell(hcell.add(b.mul(3.1).add(17.0)));
    const bladeTall = tall.mul(float(1).sub(stand.y.mul(0.5)).add(rh.mul(stand.y)));

    // The leaf arches: upright at the root, bending over more and more towards the tip.
    const lean0 = vec2(st.x, st.y).add(out2.mul(fine ? float(0.2).add(rb.mul(0.42)) : float(0.25).add(rb.mul(0.3))).mul(blade.z));
    // No leaf is ever still, and none only leans: each swings in a small figure of eight of its own, the
    // swing running up the leaf a little late towards its tip, more in a wind and less for a stiff grass.
    // (Most of what is seen of a field moving is this, and the gusts over it the rest: Sanders, GDC 2018.)
    const swingAt = uTime.mul(float(1.3).add(uWind.z.mul(0.22))).add(hashCell(hcell.add(b.mul(5.3).add(41.0))).mul(6.2832)).sub(gy.mul(1.4));
    const swingBy = float(1).sub(row(k, 2).w.mul(0.75)).mul(float(0.014).add(min(uWind.z.div(8), float(1.5)).mul(0.034)));
    const lean2 = o.spin ? lean0 : lean0.add(vec2(sin(swingAt), sin(swingAt.mul(2)).mul(0.5)).mul(swingBy));
    const bendPow = fine ? gy.mul(gy) : pow(gy, float(2.1));
    // The leaf bends over in an arc, and is as long bent as straight: it leans the way of `lean2`, and
    // from root to tip turns through an angle that grows with the lean (and with how far the species'
    // leaves hang). At a share `gy` of its length it has turned that share of the angle, so it has gone
    // out (1 - cos) and up (sin) of it, over the whole angle: a bow, where a leaf sheared sideways by
    // its lean grew longer the further it leant.
    const leanBy = max(length(lean2), float(1e-4));
    const leanTo = lean2.div(leanBy);
    const bendAll = clamp(leanBy.mul(float(1.6).add(blade.w.mul(0.4))), float(1e-3), float(2.6));
    const bendHere = bendAll.mul(gy);
    const goesOut = float(1).sub(cos(bendHere)).div(bendAll);
    const goesUp = sin(bendHere).div(bendAll);
    const runAll = vec3(leanTo.x.mul(sin(bendHere)), cos(bendHere), leanTo.y.mul(sin(bendHere)));
    const faceAll = normalize(cross(side, runAll));
    const rawPos = foot.add(side.mul(leafX).mul(width)).add(vec3(0, bladeTall.mul(goesUp), 0)).add(vec3(leanTo.x, 0, leanTo.y).mul(bladeTall).mul(goesOut)).sub(faceAll.mul(ribBack.mul(width).mul(sin(foldBy).div(cos(foldBy)))));
    // (The root is sunk a little so no leaf floats on a slope: 3 cm for tall grass, less for a leaf shorter than that.)
    const rawY = rawPos.y.sub(min(float(0.03), bladeTall.mul(0.4)).mul(float(1).sub(gy)));
    // A fine plant has three leaves, and more the denser its species is above
    // 1: as many as its density times three, the odd leaf on some plants and
    // not on others. The leaves it has no use for are not drawn.
    const spare = fine ? float(1).sub(step(b.add(hashCell(hcell.add(77.7))), max(stand.z, float(1)).mul(PLANT_LEAVES))) : float(0);
    const worldPos = tall.lessThanEqual(1e-4).or(spare.greaterThan(0.5)).select(vec3(0, -9999, 0), vec3(rawPos.x, rawY, rawPos.z));

    const colLit = vec3(colSt.x, colSt.y, colSt.z);
    const tipTint = vec3(tint.x, tint.y, tint.z);
    const variation = habit.w.mul(float(1).sub(flat));
    const leafTone = float(1).sub(variation.mul(0.5)).add(rb.mul(variation));
    const rootIs = rootDark(k);
    const rootShade = mix(rootIs, float(1), flat.mul(0.7));
    const V = normalize(cameraPosition.sub(worldPos));
    // Towards the end of their range the tufts take the ground's own flat
    // colour, root to tip, so where they stop there is nothing to see stop.
    const toGround = fine || !o.field ? float(0) : smoothstep(float(o.range * 0.22), float(o.range * 0.6), dist);

    let leafCol: Vec3;
    if (fine) {
      // A calm pile: each leaf a little lighter or darker than the next, its
      // root in the stand's shade. Low contrast between neighbours is what
      // reads as lush, and a leaf hardly lighter or darker than the ground it
      // stands on is not seen one by one where the leaves are few.
      const plain = mix(colLit.mul(rootShade), colLit.mul(mix(vec3(1), tipTint, 0.5)), smoothstep(float(0), float(0.8), gPos.y)).mul(leafTone);
      // (Less of it the smaller the leaf is in the picture: a leaf under a pixel wide is its stand's mean, or a
      // field seen from far above glitters where its near leaves are.)
      const calm = o.field ? float(1).sub(float(1).sub(flat).mul(clamp(leafWidth.div(pixel.mul(1.2)), float(0), float(1)))) : flat;
      // And each leaf takes the light its own way (none of this where the style is calm):
      // the face it turns to the sun or from it, either side of it alike;
      // (Each half of a folded leaf faces its own way: turned about the leaf's length, in towards the rib.)
      const face = o.folded ? normalize(faceAll.mul(cos(foldBy)).sub(side.mul(edge).mul(sin(foldBy)))) : normalize(faceAll.add(side.mul(edge).mul(0.3)));
      // (And down in the fold less of the sky is seen than out at the edges: the deeper the fold, the darker its rib.)
      const inFold = float(1).sub(onRib.mul(sin(foldBy)).mul(0.45).mul(float(1).sub(calm)));
      const turned = mix(mix(float(0.8), float(1.18), abs(dot(face, uSun))), float(1), calm).mul(inFold);
      // its own green, a little to the yellow or to the blue of its neighbours';
      const own = vec3(1).add(vec3(0.16, 0.04, -0.2).mul(rh.sub(0.5)).mul(min(habit.w.mul(4), float(1))).mul(float(1).sub(calm)));
      // the sun through it, seen from the far side, strongest towards its tip;
      // (Through it: seen against the sun, bent a little by the leaf's own face, and tight about the sun's
      // direction: Barre-Brisebois and Bouchard 2011. A leaf passes about as much green as it reflects and
      // far less red and blue, so what comes through is yellower and deeper than the leaf's own colour.)
      const through = pow(max(dot(V.negate(), normalize(uSun.add(face.mul(0.2)))), float(0)), float(4)).mul(float(1).sub(abs(dot(face, V)).mul(0.5))).mul(gPos.y).mul(float(1).sub(calm));
      // and the sun off it, where its face lies between the sun and the eye. A leaf's shine is white, not
      // its own colour, weak face on and strong at a glancing angle (Fresnel, for wax of index 1.5), and
      // narrower along the leaf than across it (wheat leaves: roughness 0.18 along the veins, 0.46 across).
      const halfway = normalize(uSun.add(V));
      const offFace = max(abs(dot(face, halfway)), float(0.03));
      const along = dot(runAll, halfway).div(0.18);
      const across = dot(side, halfway).div(0.46);
      const lobe = exp(along.mul(along).add(across.mul(across)).div(offFace.mul(offFace)).negate());
      const glance = float(0.04).add(float(0.96).mul(pow(float(1).sub(max(dot(V, halfway), float(0))), float(5))));
      const gloss = min(lobe.mul(glance).mul(1.6), float(0.6)).mul(sheenAmt).mul(gPos.y).mul(float(1).sub(calm));
      leafCol = plain.mul(turned).mul(own).add(colLit.mul(vec3(0.95, 1.4, 0.3)).mul(through).mul(0.7)).add(vec3(1, 1, 1).mul(dot(uSunTint, vec3(0.3, 0.5, 0.2))).mul(gloss));
    } else {
      // (A tuft's foot is less dark than a leaf's root: tufts stand a hand apart, with nothing in front
      // to hide their feet as a sward's own leaves hide its roots, and a field of dark feet is a dark band
      // between the leaves and the ground beyond.)
      const plain = mix(colLit.mul(mix(rootShade, float(1), 0.6)), colLit.mul(mix(vec3(1), tipTint, 0.6)).mul(leafTone), pow(gPos.y, float(0.8)));
      // Light through the leaf, towards the sun.
      const backSun = pow(max(dot(V.negate(), uSun), float(0)), float(3));
      const litGate = clamp(dot(colLit, vec3(0.3, 0.5, 0.2)).mul(2.8), float(0.28), float(1.0));
      const back = plain.add(uSunTint.mul(backSun).mul(0.3).mul(gPos.y).mul(gPos.y).mul(litGate));
      // A leaf is folded along its rib: one half takes the light and the
      // other turns from it. And it is waxy: where it bends over towards the
      // sun's reflection it catches the light, most at the arch near its tip.
      const leafUp = normalize(vec3(lean2.x.mul(bendPow).mul(-1.2), float(1), lean2.y.mul(bendPow).mul(-1.2)).add(vec3(toCam.x, 0, toCam.y).mul(0.35)));
      const sheen = pow(max(dot(leafUp, normalize(uSun.add(V))), float(0)), float(14)).mul(gPos.y).mul(litGate).mul(sheenAmt).mul(float(1).sub(flat));
      const fold = float(1);
      // (A gust shows as a paler patch crossing the grass: laid-over blades turn their backs to the sky.)
      const near = back.mul(fold).add(uSunTint.mul(sheen).mul(0.06)).add(back.mul(GUST_PALE).mul(gustHere).mul(clamp(uWind.z.div(8.0), float(0), float(1.7))).mul(mix(gPos.y, float(1), toGround)));
      // (The ground a stand in seed gives way to is paler for its heads: see `groundColor`.)
      leafCol = mix(near, colLit.mul(mix(rootIs, float(1), STAND_MEAN)).mul(mix(vec3(1), vec3(seedTint.x, seedTint.y, seedTint.z), seed.mul(0.5))), toGround);
    }
    // Some leaves are dead: straw, the lighter for standing among green.
    const isDry = step(hashCell(hcell.add(b.mul(9.7).add(63.0))), tint.w).mul(float(1).sub(toGround)).mul(float(1).sub(flat));
    const straw = vec3(1.22, 1.38, 0.6).mul(dot(colLit, vec3(0.3, 0.5, 0.2))).mul(mix(rootShade, float(1), gPos.y));
    // A seed head is pale against its stalk.
    const head = smoothstep(float(0.42), float(0.82), gPos.y).mul(seed).mul(float(1).sub(toGround)).mul(float(1).sub(cutout));
    // (A tuft's blade stands for several leaves and is as much broader: its head is paled less, or the tufts are a pale band beyond the leaves.)
    const sunlit = mix(mix(leafCol, straw, isDry), colLit.mul(vec3(seedTint.x, seedTint.y, seedTint.z)), head.mul(fine ? 0.85 : 0.4));
    // The sun reaches its tip more than its root, by what stands between each and the sun (`sunReach`).
    // (A far tuft is lit root to tip as its top is, because the ground it gives way to is: a tuft with its
    // foot in its stand's shade is a dark blot on ground that stands for the whole stand in the sun.)
    const own = sunlit.mul(mix(inShade(), vec3(1), mix(mix(sh.z, sh.w, fine ? gPos.y : gPos.y.mul(0.4).add(0.6)), mix(sh.z, sh.w, STAND_SUN), toGround)));
    // Where a square of fine leaves thins out, the few leaves left take the colour of the ground that is
    // taking over from them (the stand's own, lit as its top is): a lone leaf with its own light tip and
    // its own turn to the sun is a pale fleck on that ground, and a band of them is where the leaves end.
    // (How many are left is in how much the leaf was broadened: see the compute pass.)
    const left = fine && o.field ? float(1).div(float(1).add(sh.y).mul(float(1).add(sh.y))) : float(1);
    const asGround = colLit.mul(mix(rootIs, float(1), STAND_MEAN)).mul(mix(vec3(1), vec3(seedTint.x, seedTint.y, seedTint.z), seed.mul(0.5))).mul(mix(inShade(), vec3(1), mix(sh.z, sh.w, STAND_SUN)));
    const col = mix(asGround, own, smoothstep(float(0.16), float(0.6), left));

    // The picture on the leaf: across it and up it, its layer and how much of
    // it shows. In a field its detail fades out with distance (it has no
    // smaller copies of itself to be seen small by); its outline stays.
    const u = mix(gPos.x.mul(0.5).add(0.5), edge.mul(0.5).add(0.5), cutout);
    const shows = picture.y.mul(o.field ? float(1).sub(smoothstep(float(3), float(9), dist)) : float(1));
    // What the picture's colour is set against: mid grey (a picture of detail) or the species' own colour (a picture of the leaf).
    // (A dead leaf has lost the species' colour: its picture is set against that colour's grey, and stays straw.)
    const ownCol = vec3(baseCol.x, baseCol.y, baseCol.z);
    const against = mix(vec3(0.2140), mix(ownCol, vec3(dot(ownCol, vec3(0.3, 0.5, 0.2))), isDry), picture.z);
    // How much of the strip drawn is leaf: a leaf thinner than the pixel it was widened to is that much see-through.
    const cover = fine && o.field ? clamp(leafWidth.div(seen), float(0.5), float(1)) : float(1);
    return { pos: worldPos, col, cover, uv: vec4(u, gPos.y, max(picture.x, float(0)), shows), against: vec4(against, cutout) };
  };

  /** The leaves' material: unlit (the colour is worked out in `leaf`), the scene's fog applied. */
  const leafMaterial = (at: () => LeafPlace, o: LeafKind, name: string) => {
    const out = leaf(at(), o);
    const vCol = varying(out.col, `vGrassCol${name}`);
    const vUv = varying(out.uv, `vGrassUv${name}`);
    const vAgainst = varying(out.against, `vGrassAgainst${name}`);
    const texel = texture(leafTex, vec2(vUv.x, vUv.y)).depth(int(vUv.z.add(0.5))) as unknown as Vec4;
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    mat.positionNode = out.pos;
    mat.colorNode = vec4(vCol.mul(mix(vec3(1), min(vec3(texel.x, texel.y, texel.z).div(vec3(vAgainst.x, vAgainst.y, vAgainst.z)), vec3(4)), vUv.w)), 1);
    mat.maskNode = vAgainst.w.lessThan(0.5).or(texel.w.greaterThan(0.5));
    if (o.fine && o.field) {
      // (Where the picture has several samples to a pixel, a share of them is the leaf: a far leaf thins out and does not fatten.)
      mat.opacityNode = varying(out.cover, `vGrassCover${name}`);
      mat.alphaToCoverage = true;
    }
    return mat;
  };

  const makeLayer = (L: GrassLayer, fine: boolean, name: string, uFocus: THREE.UniformNode<"vec2", THREE.Vector2>) => {
    const total = L.count * L.count;
    // (A leaf of the nearest squares is seen large: it has five joints to bend by, where three carry one further off.)
    // (And those leaves are folded along the rib, in their geometry: far ones are too small for it to show.)
    const foldedLayer = fine && name.startsWith("Near");
    const layerRings = fine ? (name.startsWith("Near") ? fineRings(FINE_RINGS, 5) : FINE_RINGS) : TUFT_RINGS;
    /** How much of the layer is drawn, 0..1: a near layer comes and goes with the eye's distance (see `update`). */
    const uGate = uniform(1);
    // What the compute pass leaves for each plant: its lean (x, z), height and gust;
    // its species and reach (a tuft) or broadening (a fine plant); its lit colour and the ground's height.
    const stateAttr = new THREE.StorageInstancedBufferAttribute(total, 4);
    const shapeAttr = new THREE.StorageInstancedBufferAttribute(total, 4);
    const colAttr = new THREE.StorageInstancedBufferAttribute(total, 4);
    const stateStore = storage(stateAttr, "vec4", total);
    const shapeStore = storage(shapeAttr, "vec4", total);
    const colStore = storage(colAttr, "vec4", total);
    // Only the plants that grow and are in view are drawn. The compute pass writes each of those into
    // the next free place in the buffers (with which plant of the square it is, for the leaf shader to
    // place it again) and counts them into the draw's own arguments, so the draw is of that many and
    // no plant that is not seen costs a vertex.
    const cellAttr = new THREE.StorageInstancedBufferAttribute(total, 4);
    const cellStore = storage(cellAttr, "vec4", total);
    /** indexCount, instanceCount, firstIndex, baseVertex, firstInstance. */
    const drawArgs = new THREE.IndirectStorageBufferAttribute(new Uint32Array([L.blades * layerRings.length * (foldedLayer ? 12 : 6), 0, 0, 0, 0]), 5);
    const drawStore = storage(drawArgs, "uint", 5).toAtomic();
    const reset = Fn(() => {
      atomicStore(drawStore.element(1), uint(0));
    })().compute(1);

    /** Where plant `instanceIndex` grows: its cell of the square, scattered within it. */
    const place = (idx: THREE.Node<"uint"> | THREE.Node<"float">) => {
      const gx = float(mod(float(idx), float(L.count)));
      const gz = floor(float(idx).div(float(L.count)));
      const cell = floor(uFocus.div(L.spacing)).add(vec2(gx, gz)).sub(L.count * 0.5);
      // (The hash loses its evenness on a fine square's large cell numbers, and the leaves fall into rows: it is given the cell within a repeat no eye will find.)
      const hcell = fine ? mod(cell, float(1024)) : cell;
      const r0 = hashCell(hcell);
      const r1 = hashCell(hcell.add(31.7));
      const xz = cell.add(vec2(r0, r1)).mul(L.spacing);
      return { hcell, r0, r1, xz };
    };

    const compute = Fn(() => {
      const { hcell, r0, r1, xz } = place(instanceIndex);
      const outState = vec4(0, 0, 0, 0).toVar();
      const outShape = vec4(0, 0, 0, 0).toVar();
      const outCol = vec4(0, 0, 0, 0).toVar();
      const toCell = xz.sub(vec2(uCamPos.x, uCamPos.z));
      const dist2d = length(toCell);
      // (The fine leaves are computed only where the picture is: within some 53 degrees of the eye's heading.)
      const inView = fine
        ? dist2d.lessThan(40).and(dist2d.lessThan(1.5).or(dot(toCell, uCamFwd).greaterThan(dist2d.mul(0.6))))
        : dist2d.lessThan(L.range + 1).and(dist2d.lessThan(3.5).or(dot(toCell, uCamFwd).greaterThan(dist2d.mul(-0.35))));

      If(inView, () => {
        const ground = height.sample(xz);
        const gy = ground.height;
        const root = vec3(xz.x, gy, xz.y);
        const dist = distance(root, uCamPos);

        const here = lookup(xz);
        const alive = step(here.species, float(MAX_SPECIES - 0.5));
        const k = int(min(here.species, float(MAX_SPECIES - 1)));
        const stand = row(k, 0);
        const habit = row(k, 3);
        const tall0 = stand.x;
        const density = stand.z;
        const tufted = stand.w;
        const stiffness = row(k, 2).w;
        const clumpAmt = habit.x;
        const disorder = habit.y;
        const baseCol = row(k, 4);

        // Disorder: grass is not combed. Over a stride or so the leaves stand a
        // little taller or shorter, lean together one way and then another, and
        // grow thicker here and thinner there.
        const chA = noise(xz.div(1.3).add(0.61));
        const chB = noise(xz.div(0.41).add(0.19));
        const chaosTall = chA.r.mul(0.6).add(chB.g.mul(0.4));
        const chaosTurn = chA.g.mul(0.7).add(chB.r.mul(0.3)).mul(12.566);
        const chaosThick = chA.b.mul(0.5).add(chB.b.mul(0.5));

        // A fine square keeps all its leaves at its centre and steadily fewer
        // outward, none at its range (no smoothstep: its flat ends would show
        // as a ring where the thinning starts and another where it ends).
        const fadeDist = fine ? distance(xz, uFocus) : dist;
        const viewShare0 = (fine ? leavesAt(dist, L.range).mul(leafSeen(row(k, 1).x.add(row(k, 1).y.mul(0.5)), dist)) : pow(clamp(float(1).sub(fadeDist.sub(L.range * 0.12).div(L.range * 0.88)), float(0), float(1)), float(0.85)))
          .mul(mix(float(1), mix(float(0.74), float(1), chaosThick), disorder))
          .mul(float(1).sub(uStyle.x.mul(0.6)));
        const viewShare = viewShare0.mul(uGate);
        // (A density up to 1 is the share of plants that grow; above it every plant grows, with more leaves: see `leaf`.)
        const keepShare = viewShare.mul(min(density, float(1)));
        const thin = fine
          ? step(hashCell(hcell.add(91.7)), keepShare)
          : step(r1, float(1).sub(smoothstep(float(L.range * 0.3), float(L.range * 0.8), dist).mul(0.55))).mul(step(hashCell(hcell.add(91.7)), density));

        // A fine leaf stands on its root, so it grows right up to the border: every place is one species'
        // or the other's, and kept back from the line on both sides the leaves leave a bare strip along it, a
        // trench with the ground's shade showing in it. A tuft's blades stand out from its root, so its root
        // keeps its distance.
        const rooted = fine ? float(1) : step(float(EDGE_KEEP), here.edge);
        const reach = clamp(here.edge.sub(EDGE_KEEP), float(0), float(REACH_MAX));
        const rangeFade = fine ? float(1) : float(1).sub(smoothstep(float(L.range * (fine ? 0.97 : 0.6)), float(L.range * (fine ? 1.02 : 1)), fadeDist));
        // Where the fine leaves stand, the tufts give way, growing in again as
        // the leaves thin out: a tuft left standing among them shows as a pale
        // tip sticking up out of the pile. And a mown sward has no tufts at
        // all: a few broad blades at 3 cm are pale flecks on it.
        // Nor does a tuft stand within a stride of the eye, where its broad
        // blades are flat green wedges before the lens: that ground is the
        // fine leaves' (the host aims them at the foreground, see `update`).
        const layerOn = fine ? float(1) : tufted.mul(smoothstep(uLeafReach.mul(0.45), uLeafReach, dist)).mul(smoothstep(float(0.9), float(1.5), dist));
        const grow = alive.mul(rooted).mul(rangeFade).mul(thin).mul(layerOn);

        const tallNode = tall0.toVar();
        // (The grass in a patch is its own height.)
        const patchHere = inPatch(xz, k).toVar();
        tallNode.mulAssign(mix(float(1), row(k, 8).w, patchHere));
        // Beside shorter grass, or bare ground, a stand comes down to meet it over a stride (by the canopy's
        // picture, which is the mean of the two at their line): never up, so mown turf beside rough stays
        // mown to its edge, and what is left at the line is a step half the height it was.
        tallNode.mulAssign(mix(clamp(canopyAt(xz).div(max(tall0, float(1e-4))), float(0.3), float(1)), float(1), smoothstep(float(0), float(EDGE_RAMP_M), here.edge)));
        if (fine) {
          // (A pile is a pile only while it is thick. Where the square thins out, lone leaves a centimetre tall on close-mown turf are dark specks on it, so there they sink away and leave the turf to the ground.)
          const closeMown = float(1).sub(smoothstep(float(0.015), float(0.03), tall0));
          // (Over the whole of the thinning, not a band of it: a band is a line round the square, where the
          // leaves of one density stop and those of the next go on.)
          // (Every species, and over the whole of the thinning: a square whose last leaves stand full height
          // has an edge, a line round it where its grain stops, however few they are.)
          tallNode.mulAssign(mix(smoothstep(float(0), float(0.5), viewShare), smoothstep(float(0), float(0.35), viewShare), closeMown));
          tallNode.mulAssign(mix(float(1), mix(float(0.74), float(1.26), chaosTall), disorder));
        }

        // Clumps (after Sucker Punch's grass for Ghost of Tsushima, GDC 2021):
        // each plant belongs to the nearest of a scatter of clump centres and
        // takes that clump's height and tone; it stands tallest at the centre
        // and leans out from it.
        const clumpAt = xz.div(uLook.x);
        const clumpCell = floor(clumpAt);
        const clumpBest = float(9).toVar();
        const clumpId = vec2(0, 0).toVar();
        const clumpOut = vec2(0, 0).toVar();
        for (let cj = -1; cj <= 1; cj++) {
          for (let ci = -1; ci <= 1; ci++) {
            const cc = clumpCell.add(vec2(ci, cj));
            const centre = cc.add(vec2(hash21(cc.add(11.3)), hash21(cc.add(47.9))));
            const away = clumpAt.sub(centre);
            const d2 = dot(away, away);
            If(d2.lessThan(clumpBest), () => {
              clumpBest.assign(d2);
              clumpId.assign(cc);
              clumpOut.assign(away);
            });
          }
        }
        // (The fine leaves take the clumps at half strength, so they agree with the tufts beyond them.)
        const clumped = clumpAmt.mul(fine ? 0.5 : 1);
        const clumpTall = mix(float(0.74), float(1.16), hash21(clumpId.add(3.7))).mul(mix(float(1.08), float(0.85), smoothstep(float(0.05), float(0.6), clumpBest)));
        const clumpTone = hash21(clumpId.add(71.1)).sub(0.5);
        tallNode.mulAssign(mix(float(1), clumpTall, clumped));
        const base = vec3(baseCol.x, baseCol.y, baseCol.z).mul(vec3(1).add(vec3(0.22, 0.12, -0.07).mul(clumpTone).mul(clumped)));

        // (The tufts thin with distance, and those left are drawn broader.)
        const lodKeep = fine ? float(1) : step(r0, mix(float(1.0), float(0.45), smoothstep(float(18), float(38), dist)));
        const tall = tallNode.mul(float(0.78).add(r0.mul(0.3))).mul(grow).mul(lodKeep);

        // Gusts: wind does not arrive as even waves. A field of stronger and
        // weaker air, broad patches with smaller ones inside, travels downwind
        // at about the wind's own pace, and the grass lies down as each crosses it.
        const wDir = normalize(vec2(uWind.x, uWind.y).add(vec2(1e-4, 0)));
        const windy = clamp(uWind.z.div(8.0), float(0), float(1.7));
        const gustAt = xz.sub(wDir.mul(uTime.mul(float(1.2).add(uWind.z.mul(0.55)))));
        const gustBroad = noise(gustAt.div(61.0)).r;
        const gustSmall = noise(gustAt.mul(1.35).div(19.0).add(0.43)).g;
        const flutter = sin(uTime.mul(2.3).add(r0.mul(6.28))).mul(0.06);
        const gust = clamp(smoothstep(float(0.3), float(0.72), gustBroad.mul(0.68).add(gustSmall.mul(0.32))).add(flutter), float(0), float(1));
        const swirl = vec2(cos(uTime.mul(1.2).add(xz.x.mul(0.28))), sin(uTime.mul(1.05).add(xz.y.mul(0.25)))).mul(0.06);
        // Wind moves what stands tall enough to be moved, and is not too stiff.
        const windTakes = smoothstep(float(0.075), float(0.17), tall0).mul(float(1).sub(stiffness)).mul(1.4);
        const lay = layAt(xz, k);
        const lean = wDir.mul(windy.mul(float(0.1).add(gust.mul(0.42)))).add(swirl).mul(windTakes)
          .add(clumpOut.mul(0.22).mul(clumped))
          .add(fine ? vec2(cos(chaosTurn), sin(chaosTurn)).mul(disorder.mul(0.24)) : vec2(0, 0))
          // (A leaf the roller went over leans the way it went.)
          .add(lay.mul(LAY_LEAN));

        // (What of the sky it sees is worked out half way up it, and is in its colour; the sun at its root and at its tip go with it, for the leaf to shade between.)
        const colLit = tone(xz, base).mul(mix(vec3(1), vec3(row(k, 10).x, row(k, 10).y, row(k, 10).z), patchHere)).mul(light(ground.normal)).mul(laidShade(xz, lay)).mul(skyOpen(xz, tall0.mul(STAND_SUN)));
        // (A fine leaf is broadened for the leaves the view thinned out about it, not for those its species never grows.)
        const broaden = clamp(float(1).div(pow(max(viewShare, float(0.1)), float(0.5))).sub(1), float(0), float(BROADEN_MAX));
        outState.assign(vec4(lean.x, lean.y, tall, gust.sub(0.5).mul(min(windTakes, float(1)))));
        outShape.assign(vec4(float(k), fine ? broaden : reach, sunReach(xz, float(0)), sunReach(xz, tall0)));
        outCol.assign(vec4(colLit.x, colLit.y, colLit.z, gy));
      });

      If(outState.z.greaterThan(1e-4), () => {
        const slot = atomicAdd(drawStore.element(1), uint(1));
        stateStore.element(slot).assign(outState);
        shapeStore.element(slot).assign(outShape);
        colStore.element(slot).assign(outCol);
        cellStore.element(slot).assign(vec4(float(instanceIndex), 0, 0, 0));
      });
    })().compute(total);

    const geo = bladeGeometry(L.blades, layerRings, foldedLayer);
    geo.setAttribute("aGrassState", stateAttr);
    geo.setAttribute("aGrassShape", shapeAttr);
    geo.setAttribute("aGrassColor", colAttr);
    geo.setAttribute("aGrassCell", cellAttr);
    geo.instanceCount = total;
    geo.setIndirect(drawArgs);
    const mat = leafMaterial(() => {
      const { hcell, r0, xz } = place(attribute("aGrassCell", "vec4").x);
      return { hcell, r0, xz };
    }, { fine, field: true, range: L.range, folded: foldedLayer }, name);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `grass-${name}`;
    // (Its plants are wherever the camera is; there is no box to cull it by.)
    mesh.frustumCulled = false;
    geometries.push(geo);
    materials.push(mat);
    group.add(mesh);
    if (fine) fineSquares.push({ uFocus, uGate, range: L.range });
    return { compute, reset, uFocus, uGate, mesh, fine, range: L.range, drawArgs, attrs: [stateAttr, shapeAttr, colAttr, cellAttr, drawArgs], total, leaves: total * L.blades };
  };

  const far = makeLayer(layers.far, false, "Far", uniform(new THREE.Vector2()));
  const peak = makeLayer(layers.peak, true, "Peak", uniform(new THREE.Vector2()));
  const mid = makeLayer(layers.mid, true, "Mid", uMidFocus);
  const nears = layers.near.map((L, i) => ({ L, layer: makeLayer(L, true, `Near${i}`, uniform(new THREE.Vector2())) }));
  const wide = layers.wide ? makeLayer(layers.wide, true, "Wide", uniform(new THREE.Vector2())) : null;
  const all = [far, ...nears.map((n) => n.layer), peak, mid, ...(wide ? [wide] : [])];
  const shown = { tufts: true, leaves: true };

  const createSpecimen = (at: { x: number; y: number; z: number }): Specimen => {
    const object = new THREE.Group();
    /** A plant of the specimen: where it stands from the centre (m), its cell for the shader's hashes, and its own luck. */
    interface Plant { x: number; z: number; cx: number; cz: number; luck: number; tallLuck: number; turn: number; out: number }
    let plants: Plant[] = [];
    let kind: SpecimenKind = "plant";
    let speciesRow = 0;
    let mesh: THREE.Mesh | null = null;
    let state: THREE.InstancedBufferAttribute | null = null;
    let shape: THREE.InstancedBufferAttribute | null = null;
    let colour: THREE.InstancedBufferAttribute | null = null;
    const size = { radius: 0.05, height: 0.05 };
    const clear = () => {
      if (!mesh) return;
      object.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh = null;
    };
    const set = (nextKind: SpecimenKind, nextRow: number, seed = 1) => {
      clear();
      kind = nextKind;
      speciesRow = Math.min(current.length - 1, Math.max(0, nextRow));
      let h = (seed * 2654435761) >>> 0;
      const rnd = () => {
        h = (h + 0x6d2b79f5) >>> 0;
        let t = Math.imul(h ^ (h >>> 15), 1 | h);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const plant = (x: number, z: number, out: number): Plant => ({ x, z, cx: Math.floor(rnd() * 1000), cz: Math.floor(rnd() * 1000), luck: rnd(), tallLuck: rnd(), turn: rnd() * Math.PI * 2, out });
      plants = [];
      if (kind === "clump") {
        // A clump as the field grows one: plants a couple of centimetres apart about a centre, thinning out at its rim.
        const radius = Math.min(0.6, uLook.value.x * 0.5);
        const step = (layers.near[1] ?? layers.peak).spacing;
        const n = Math.ceil(radius / step);
        for (let j = -n; j <= n && plants.length < 7000; j++) {
          for (let i = -n; i <= n && plants.length < 7000; i++) {
            const x = (i + rnd() - 0.5) * step;
            const z = (j + rnd() - 0.5) * step;
            const d = Math.hypot(x, z);
            if (d < radius) plants.push(plant(x, z, d / radius));
          }
        }
      } else plants.push(plant(0, 0, 0));

      const fine = kind !== "tuft";
      const blades = kind === "blade" ? 1 : kind === "tuft" ? layers.far.blades : (layers.near[0] ?? layers.peak).blades;
      // (Seen close, a leaf wants more joints than a field gives it; a clump's leaves are many, and get fewer.)
      const geo = bladeGeometry(blades, fineRings(fine ? FINE_RINGS : TUFT_RINGS, kind === "clump" ? 6 : 14), fine);
      const placeData = new Float32Array(plants.length * 4);
      plants.forEach((p, i) => placeData.set([at.x + p.x, at.z + p.z, p.cx, p.cz], i * 4));
      state = new THREE.InstancedBufferAttribute(new Float32Array(plants.length * 4), 4);
      shape = new THREE.InstancedBufferAttribute(new Float32Array(plants.length * 4), 4);
      colour = new THREE.InstancedBufferAttribute(new Float32Array(plants.length * 4), 4);
      for (const a of [state, shape, colour]) a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("aGrassPlace", new THREE.InstancedBufferAttribute(placeData, 4));
      geo.setAttribute("aGrassState", state);
      geo.setAttribute("aGrassShape", shape);
      geo.setAttribute("aGrassColor", colour);
      geo.instanceCount = plants.length;
      const mat = leafMaterial(() => {
        const placed = attribute("aGrassPlace", "vec4");
        const hcell = vec2(placed.z, placed.w);
        return { hcell, r0: hashCell(hcell), xz: vec2(placed.x, placed.y) };
      }, { fine, field: false, range: 0, folded: fine }, "Specimen");
      mesh = new THREE.Mesh(geo, mat);
      mesh.name = "grass-specimen";
      mesh.frustumCulled = false;
      object.add(mesh);
      update(uTime.value);
    };
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const base = new THREE.Color();
    const update = (timeS: number) => {
      const s = current[speciesRow];
      if (!mesh || !state || !shape || !colour || !s) return;
      const fine = kind !== "tuft";
      // Lit as level ground is (see `light`), and blown as the field is, without its travelling gusts.
      base.set(s.color);
      const lit = [0, 1, 2].map((c) => uShadeTint.value.getComponent(c) + (uSunTint.value.getComponent(c) - uShadeTint.value.getComponent(c)) * 0.62);
      const wind = uWind.value;
      const windy = Math.min(1.7, Math.max(0, wind.z / 8));
      const windTakes = smooth(0.075, 0.17, s.height) * (1 - s.stiffness) * 1.4;
      const clumped = s.clump * 0.5;
      let top = 0;
      plants.forEach((p, i) => {
        const gust = 0.5 + 0.5 * Math.sin(timeS * (0.9 + wind.z * 0.12) + p.x * 1.7 + p.z * 1.1);
        const blow = windy * (0.1 + gust * 0.42) * windTakes;
        const inClump = kind === "clump";
        // (A clump stands tallest at its centre and leans out from it; its rim thins out.)
        const d2 = p.out * p.out * 0.25;
        const clumpTall = inClump ? 1.1 * (1.08 + (0.85 - 1.08) * smooth(0.05, 0.6, d2 * 4)) : 1;
        const grows = !inClump || p.luck < s.density * (1 - smooth(0.7, 1, p.out));
        const disorderTall = fine ? 1 + (0.74 + 0.52 * p.tallLuck - 1) * s.disorder : 1;
        const tall = grows ? s.height * disorderTall * (1 + (clumpTall - 1) * clumped) * (0.78 + p.tallLuck * 0.3 + (inClump ? 0 : 0.15)) : 0;
        const outX = p.out > 1e-6 ? p.x / Math.hypot(p.x, p.z) : 0;
        const outZ = p.out > 1e-6 ? p.z / Math.hypot(p.x, p.z) : 0;
        const chaos = inClump && fine ? 0.24 * s.disorder : 0;
        state!.setXYZW(i, wind.x * blow + outX * p.out * 0.22 * clumped + Math.cos(p.turn) * chaos, wind.y * blow + outZ * p.out * 0.22 * clumped + Math.sin(p.turn) * chaos, tall, (gust - 0.5) * Math.min(windTakes, 1));
        shape!.setXYZW(i, speciesRow, fine ? 0 : REACH_MAX, 1, 1);
        colour!.setXYZW(i, base.r * lit[0], base.g * lit[1], base.b * lit[2], at.y);
        top = Math.max(top, tall * (1 + s.heightSpread * 0.5));
      });
      state.needsUpdate = shape.needsUpdate = colour.needsUpdate = true;
      size.height = Math.max(0.01, top);
      // (A tuft's blades stand up to its reach from its root.)
      size.radius = kind === "clump" ? Math.min(0.6, uLook.value.x * 0.5) : kind === "tuft" ? REACH_MAX : Math.max(0.02, top * 0.6);
    };
    return {
      object,
      set,
      update,
      get radius() {
        return size.radius;
      },
      get height() {
        return size.height;
      },
      dispose: clear,
    };
  };

  let baking = Promise.resolve();
  const bakeGround = (renderer: THREE.WebGPURenderer, rowIndex: number): Promise<void> => {
    // (One at a time: they share the renderer.)
    baking = baking.then(() => bakeOne(renderer, rowIndex)).catch((err) => console.warn("[grass] the ground's picture was not made:", err));
    return baking;
  };
  const bakeOne = async (renderer: THREE.WebGPURenderer, rowIndex: number) => {
    const s = current[rowIndex];
    if (!s) return;
    const tile = Math.max(0.05, s.groundTile);
    let seed = (rowIndex + 1) * 2654435761;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Enough leaves to lie four deep over the ground, as a sward's do: by the leaf's own breadth and length.
    const lying = 1.5;
    const leafArea = Math.max(1e-6, (s.width + s.widthSpread * 0.5) * s.height * lying * 0.8);
    const plants = Math.round(Math.min(36000, Math.max(300, ((4 * Math.min(2, Math.max(0.1, s.density)) * tile * tile) / leafArea / PLANT_LEAVES))));
    const base = new THREE.Color(s.color);
    const lit = [0, 1, 2].map((c) => uShadeTint.value.getComponent(c) + (uSunTint.value.getComponent(c) - uShadeTint.value.getComponent(c)) * 0.62);
    // (Nine of each, a tile apart, so what hangs over one edge comes in at the other and the picture repeats without a seam.)
    const count = plants * 9;
    const place = new Float32Array(count * 4);
    const state = new Float32Array(count * 4);
    const shape = new Float32Array(count * 4);
    const colour = new Float32Array(count * 4);
    for (let i = 0; i < plants; i++) {
      const x = rnd() * tile;
      const z = rnd() * tile;
      const cx = Math.floor(rnd() * 1000);
      const cz = Math.floor(rnd() * 1000);
      const turn = rnd() * Math.PI * 2;
      // Laid over, each its own way: some nearly flat, some half up.
      const over = (0.5 + rnd() * 1.6) * lying * 0.6;
      const tall = s.height * (0.8 + rnd() * 0.4);
      // (The lower in the pile, the more in the shade of the rest.)
      const depth = rnd();
      const tone = (0.5 + 0.6 * depth) * (0.9 + rnd() * 0.2);
      for (let c = 0; c < 9; c++) {
        const k = (i * 9 + c) * 4;
        place.set([x + ((c % 3) - 1) * tile, z + (Math.floor(c / 3) - 1) * tile, cx, cz], k);
        state.set([Math.cos(turn) * over, Math.sin(turn) * over, tall, 0], k);
        shape.set([rowIndex, 0, 1, 1], k);
        colour.set([base.r * lit[0] * tone, base.g * lit[1] * tone, base.b * lit[2] * tone, depth * s.height * 0.5], k);
      }
    }
    const geo = bladeGeometry(PLANT_LEAVES, FINE_RINGS);
    geo.setAttribute("aGrassPlace", new THREE.InstancedBufferAttribute(place, 4));
    geo.setAttribute("aGrassState", new THREE.InstancedBufferAttribute(state, 4));
    geo.setAttribute("aGrassShape", new THREE.InstancedBufferAttribute(shape, 4));
    geo.setAttribute("aGrassColor", new THREE.InstancedBufferAttribute(colour, 4));
    geo.instanceCount = count;
    const mat = leafMaterial(() => {
      const placed = attribute("aGrassPlace", "vec4");
      const hcell = vec2(placed.z, placed.w);
      return { hcell, r0: hashCell(hcell), xz: vec2(placed.x, placed.y) };
    }, { fine: true, field: false, range: 0, spin: true }, "Bake");
    mat.fog = false;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    // (What shows through the leaves is the bottom of the pile, in its shade.)
    scene.background = new THREE.Color(base.r * lit[0] * 0.3, base.g * lit[1] * 0.3, base.b * lit[2] * 0.3);
    scene.add(mesh);
    const above = new THREE.OrthographicCamera(-tile / 2, tile / 2, tile / 2, -tile / 2, 0.1, 50);
    above.position.set(tile / 2, 20, tile / 2);
    above.up.set(0, 0, -1);
    above.lookAt(tile / 2, 0, tile / 2);
    const target = new THREE.RenderTarget(GROUND_SIZE, GROUND_SIZE, { type: THREE.UnsignedByteType, depthBuffer: true });
    try {
      const before = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, above);
      renderer.setRenderTarget(before);
      const px = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, GROUND_SIZE, GROUND_SIZE)) as Uint8Array;
      // And again, each leaf painted by how high it is there: the pile's relief.
      mat.colorNode = vec4(vec3(clamp(positionWorld.y.div(s.height * PILE_TALL), float(0), float(1))), 1);
      mat.needsUpdate = true;
      scene.background = new THREE.Color(0, 0, 0);
      renderer.setRenderTarget(target);
      renderer.render(scene, above);
      renderer.setRenderTarget(before);
      const tall = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, GROUND_SIZE, GROUND_SIZE)) as Uint8Array;
      // (Drawn in linear light; kept, as every picture here is, in sRGB.)
      const out = new Uint8Array(GROUND_SIZE * GROUND_SIZE * 4);
      for (let i = 0; i < out.length; i += 4) {
        out[i] = LINEAR_TO_SRGB(px[i] / 255);
        out[i + 1] = LINEAR_TO_SRGB(px[i + 1] / 255);
        out[i + 2] = LINEAR_TO_SRGB(px[i + 2] / 255);
        out[i + 3] = tall[i];
      }
      setGroundLayer(rowIndex, out);
    } finally {
      target.dispose();
      geo.dispose();
      mat.dispose();
    }
  };

  repack();
  const style = { broad: 0, flat: 0 };
  let frame = 0;
  const look = { clumpSize: 0.85, macro: 0.3, edgeWobble: 0.03, groundShade: 1, stripes: 0.16, shadow: 0.6, occlusion: 0.45, fold: 1, relief: 1, leafPixels: 1, depth: 0.5, mown: false, bare };
  const fwd = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const bufferSize = new THREE.Vector2();

  return {
    object: group,
    environment: { sun: uSun.value, sunTint: uSunTint.value, shadeTint: uShadeTint.value, wind: uWind.value },
    style,
    look,
    setSpecies(list) {
      current = list;
      repack();
    },
    setLeafTextures(pictures) {
      const names = Object.keys(pictures);
      if (names.length > MAX_LEAF_TEXTURES) throw new Error(`At most ${MAX_LEAF_TEXTURES} leaf pictures, got ${names.length}`);
      const canvas = new OffscreenCanvas(LEAF_TEXTURE_W, LEAF_TEXTURE_H);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      leafLayers.clear();
      names.forEach((name, layer) => {
        ctx.clearRect(0, 0, LEAF_TEXTURE_W, LEAF_TEXTURE_H);
        ctx.drawImage(pictures[name], 0, 0, LEAF_TEXTURE_W, LEAF_TEXTURE_H);
        const px = ctx.getImageData(0, 0, LEAF_TEXTURE_W, LEAF_TEXTURE_H).data;
        const rowBytes = LEAF_TEXTURE_W * 4;
        // (The picture's bottom row first: the leaf's root.)
        for (let y = 0; y < LEAF_TEXTURE_H; y++) leafPixels.set(px.subarray((LEAF_TEXTURE_H - 1 - y) * rowBytes, (LEAF_TEXTURE_H - y) * rowBytes), layer * rowBytes * LEAF_TEXTURE_H + y * rowBytes);
        leafLayers.set(name, layer);
      });
      leafTex.needsUpdate = true;
      repack();
    },
    async countDrawn(renderer) {
      let plants = 0;
      for (const l of all) {
        if (!l.mesh.visible) continue;
        plants += new Uint32Array(await renderer.getArrayBufferAsync(l.drawArgs))[1];
      }
      return plants;
    },
    createSpecimen,
    setGroundPicture(rowIndex, picture) {
      if (picture === null) return setGroundLayer(rowIndex, null);
      const canvas = new OffscreenCanvas(GROUND_SIZE, GROUND_SIZE);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(picture, 0, 0, GROUND_SIZE, GROUND_SIZE);
      // (A picture brings no heights: what is lighter in it is taken to stand higher.)
      const px = ctx.getImageData(0, 0, GROUND_SIZE, GROUND_SIZE).data;
      for (let i = 0; i < px.length; i += 4) px[i + 3] = Math.round(px[i] * 0.3 + px[i + 1] * 0.5 + px[i + 2] * 0.2);
      setGroundLayer(rowIndex, px);
    },
    bakeGround,
    update(renderer, camera, timeS, lookAt) {
      camera.getWorldPosition(eye);
      camera.getWorldDirection(fwd);
      const hLen = Math.hypot(fwd.x, fwd.z);
      // (Looking straight down there is no heading: the last one stands.)
      if (hLen > 1e-3) uCamFwd.value.set(fwd.x / hLen, fwd.z / hLen);
      const f = uCamFwd.value;
      uCamPos.value.copy(eye);
      // (A perspective camera's projection has 1 / tan(half its field of view) at [5].)
      renderer.getDrawingBufferSize(bufferSize);
      uPixel.value = 2 / Math.max(1e-3, camera.projectionMatrix.elements[5]) / Math.max(1, bufferSize.y);
      uTime.value = timeS;
      uSun.value.normalize();
      uStyle.value.set(style.broad, style.flat);
      uLook.value.set(Math.max(0.05, look.clumpSize), look.macro, look.edgeWobble, look.groundShade);
      uStripes.value = look.stripes;
      uMown.value = look.mown ? 1 : 0;
      uShade.value.set(look.shadow, look.occlusion);
      uDetail.value.set(look.fold, look.relief, look.leafPixels);
      uLight.value = look.depth;
      // (The canopy's picture, again every so often: a species may have grown, or the map been painted on.)
      if (canopyTarget && canopyQuad && frame++ % 20 === 0) {
        const before = renderer.getRenderTarget();
        renderer.setRenderTarget(canopyTarget);
        canopyQuad.render(renderer);
        renderer.setRenderTarget(before);
      }
      uBare.value.set(look.bare.r, look.bare.g, look.bare.b);
      far.uFocus.value.set(eye.x + f.x * layers.farAhead, eye.z + f.y * layers.farAhead);
      if (lookAt?.y !== undefined) uEyeUp.value = Math.max(0, eye.y - lookAt.y);
      // Each square of fine leaves stands about the eye, a little ahead of it (`LEAF_AHEAD`), and is there at
      // all only if the eye is near enough the ground for any of its leaves to be within its reach.
      for (const l of all) {
        if (!l.fine) continue;
        l.uFocus.value.set(eye.x + f.x * l.range * LEAF_AHEAD, eye.z + f.y * l.range * LEAF_AHEAD);
        l.uGate.value = uEyeUp.value < l.range * LEAF_REACH ? 1 : 0;
      }
      // The widest square is there only as far as leaves can be seen beyond `mid`'s reach: by where the
      // broadest species' leaf is down to half a pixel (times `leafPixels`) in this picture.
      const midReach = layers.mid.range * LEAF_REACH;
      uLeafReach.value = midReach;
      if (wide) {
        const broadest = current.reduce((w, sp) => Math.max(w, sp.width + sp.widthSpread * 0.5), 0);
        const seenTo = look.leafPixels < 0.01 ? Infinity : broadest / (uPixel.value * 0.5 * look.leafPixels);
        const t = Math.min(1, Math.max(0, (seenTo - midReach) / (midReach * 0.45)));
        const share = t * t * (3 - 2 * t);
        wide.uGate.value *= share;
        uLeafReach.value = midReach + (wide.range * LEAF_REACH - midReach) * wide.uGate.value;
      }
      for (const l of all) l.mesh.visible = l.fine ? shown.leaves && l.uGate.value > 0 : shown.tufts;
      const passes = all.filter((l) => l.mesh.visible).flatMap((l) => [l.reset, l.compute]);
      if (passes.length > 0) renderer.compute(passes);
    },
    show: shown,
    groundColor,
    light,
    stats: { plants: all.reduce((n, l) => n + l.total, 0), leaves: all.reduce((n, l) => n + l.leaves, 0) },
    dispose() {
      // The compute passes own pipelines and bind groups in the renderer: none is freed unless disposed by name.
      for (const l of all) {
        l.compute.dispose();
        l.reset.dispose();
      }
      for (const l of all) for (const a of l.attrs) a.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      noiseTex.dispose();
      leafTex.dispose();
      groundTex.dispose();
      canopyTarget?.dispose();
    },
  };
}
