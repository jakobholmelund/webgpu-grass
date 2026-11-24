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
import { Fn, If, Loop, abs, asin, atomicAdd, atomicStore, attribute, cross, cameraPosition, clamp, cos, distance, dot, exp, float, floor, fract, instanceIndex, int, length, max, min, mix, mod, normalize, positionGeometry, positionWorld, pow, sign, sin, smoothstep, step, storage, texture, uint, uniform, uniformArray, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { type HeightSource, type MapSource, type MowSource } from "./field";
import { makeNoiseTexture } from "./noise";
import { FLOWER_SLOTS, FLOWERS, type Flower, MAX_BLOOMS, MAX_PETALS, makeFlowerTable, packFlowers } from "./flowers";
import { MAX_SPECIES, SPECIES_SLOTS, type Species, makeSpeciesTable, packSpecies } from "./species";
import { hashCell, placeInSquare, rankStore } from "./placement";

type Int = THREE.Node<"int">;
type Vec2 = THREE.Node<"vec2">;
type Vec3 = THREE.Node<"vec3">;
type Vec4 = THREE.Node<"vec4">;

/** The top of a stand, as a share of its species' height: its plants stand from 0.78 to 1.08 of that. */
const STAND_TOP = 0.93;
/**
 * How dark a stand is as a whole beside its leaves' own colour, 0..1: its roots are in its own shade, and
 * what is seen of it from any way off is root to tip together. For a host that says what colour a stand
 * of grass is to be, rather than its leaves: give the species that colour over this. (`sunUp`: the sun's
 * height, as the sine of its angle; `depth`: `look.depth`. The same sum the shaders do.)
 */
export function standTone(species: Pick<Species, "height" | "density" | "rootShade">, sunUp = 0.7, depth = 0.5): number {
  const leafArea = Math.min(6, species.height * 60 + 0.75) * Math.min(1.5, Math.max(0.3, species.density)) * (1.55 - species.rootShade);
  const reaches = Math.exp((-leafArea * 0.5) / Math.max(sunUp, 0.15)) * 0.62 + Math.exp(-leafArea * 0.5) * 0.38;
  const rootDark = species.rootShade + (Math.min(1, Math.max(0.06, reaches)) - species.rootShade) * depth;
  return rootDark + (1 - rootDark) * STAND_MEAN;
}

/**
 * A square of leaves is worked out and drawn while the nearest ground in the picture is within this share of
 * its reach: short of all of it, since the ground is not level and may rise to meet the eye.
 */
const SEEN_MARGIN = 0.85;
/** How many points a trail through the grass has at most (see `Grass.setTrail`). */
export const MAX_TRAIL = 24;
/** Two points of a trail further apart than this (m) are not joined. */
const TRAIL_GAP_M = 1.8;
/**
 * Grass a thing went through is back up after this long (s): dry, in about a second (a ball is 46 g, and
 * leaves it bent aside spring back as it leaves them; nothing is left to see); wet, a few seconds, a wet
 * leaf being heavier and clinging to its neighbours. Estimates: nobody has timed it. At its lowest it is
 * this share of its height.
 */
const TRAIL_UP_DRY_S = 1.1;
const TRAIL_UP_WET_S = 3.5;
/**
 * What a thing going through wet grass leaves is not bent leaves but leaves with the water wiped off
 * them: a darker line through grass that is pale with dew, there until the grass dries or is wet again.
 * It is kept this long (s), fading over the last third, and at its darkest the leaves' colour times this
 * (in grass wholly wet: `look.wet`).
 */
const TRAIL_WIPED_S = 240;
const TRAIL_WIPED_TINT = 0.8;
const TRAIL_TALL = 0.5;
/** How crushed grass is under a foot (`flat`), as a share of a trail's crush, and in its print after. */
const FOOT_CRUSH = 0.8;
/**
 * The grid that keeps what went through the grass (`createGrass`, "The grass's memory"): its cells
 * across (m) and how many a side. 30 m about the eye: a track further off than that is let go.
 */
const TRACK_CELL_M = 0.04;
const TRACK_SIDE = 768;
/** How far over the grass in a track is laid, the way the thing went (as a lean: 1 is nearly flat). */
const TRAIL_LAY = 0.85;
/** A stir of the air moves the grass within this far (m) of it. */
const STIR_REACH_M = 0.32;
/** How many things can lie in the grass at once (see `Grass.setThings`). */
export const MAX_THINGS = 4;

/** Something lying in the grass: a sphere. */
export interface GrassThing {
  /** Its centre (m, the world's). */
  x: number;
  y: number;
  z: number;
  radius: number;
  /** The grass is gone within this far (m) of its centre, growing back to full height a little beyond: a nest it has pressed. 0: none. */
  clear?: number;
  /**
   * Keep it in sight: the leaves standing between the eye and it are kept under a line from the eye to
   * it, so that this share of its height shows from the top down (`true`: half, the line to its middle),
   * and how deep it sits can be read off. Grass taller than a ball hides the ball altogether otherwise.
   * To show a lie as it is, give the share of it that stands above the grass, or a little more.
   */
  keepSeen?: boolean | number;
  /**
   * Not a sphere but a place on the ground something stands on, `radius` across (a foot): the grass
   * there is pressed down to a third of its height, coming back up over half as far again. `y`,
   * `clear` and `keepSeen` mean nothing for it.
   */
  flat?: boolean;
}

/**
 * Where the middle of a ball goes (m above its ground) for `showing` of its height, 0..1, to stand above
 * grass `grassTall` high: a ball in rough is held up by the grass, and its lie is how much of it shows.
 * Never lower than resting on the ground. (The top of a stand is its plants' mean height, a little
 * under the species' own: no two plants are the same height, so at any one place it is this give or take.)
 */
export function thingMiddleFor(grassTall: number, radius: number, showing: number): number {
  const top = grassTall * STAND_TOP;
  return Math.max(radius, top + (Math.min(1, Math.max(0, showing)) * 2 - 1) * radius);
}

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
  /** Only stands shorter than this (m) grow in it: a square fine enough for a green's shoots is far more leaves than rough has. */
  below?: number;
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
 * And a third, 2.2 mm apart, for close-mown turf seen from where a ball lies:
 * a green has some twenty shoots to the square centimetre.
 */
export const DEFAULT_LAYERS: GrassLayers = {
  far: { count: 250, spacing: 0.22, blades: 8, range: 48 },
  peak: { count: 332, spacing: 0.0204, blades: 3, range: 3.38 },
  mid: { count: 332, spacing: 0.0388, blades: 3, range: 6.4 },
  wide: { count: 332, spacing: 0.0776, blades: 3, range: 12.8 },
  near: [
    { count: 332, spacing: 0.0051, blades: 6, range: 0.845, within: 1.2 },
    { count: 332, spacing: 0.0102, blades: 6, range: 1.69, within: 2.6 },
    // (A putting green's own density: 20 shoots to the square centimetre, 2.2 mm apart, about the eye
    // when it is down where a ball lies. Only close-mown turf grows in it.)
    { count: 332, spacing: 0.0022, blades: 6, range: 0.365, within: 0.5, below: 0.03 },
  ],
  farAhead: 21,
  peakAhead: 3.0,
  midAhead: 5.2,
};

/** A plant grows once its root is this far (m) inside its species' ground, so a border is a crowded line and not a spill. */
const EDGE_KEEP = 0.02;
/** Within this far (m) of a border a stand's height follows the canopy down towards its shorter neighbour's. */
const EDGE_RAMP_M = 0.06;
/** A tuft's blade stands at most this far (m) from the tuft's root, and never over the border. */
const REACH_MAX = 0.24;
/** A fine leaf left standing where others were thinned out is drawn up to this much broader. */
const BROADEN_MAX = 1.5;
/** A fine plant's leaves at a density of 1. A denser species has more of its layer's `blades`. */
const PLANT_LEAVES = 3;
/**
 * A tussock's breadth (`Species.tussock`), as the square of its radius over the way between clumps: at
 * hardly any tussock the clumps touch and only the corners between them are open; at 1 a tussock is a
 * quarter of the way across.
 */
/** A stand this tall (m) begins to be drawn as tufts where its leaves are too thin to be seen; one two and a half times it, wholly. */
const TUFTS_FOR_UNSEEN_FROM_M = 0.15;
/**
 * An unmown stand (its leaves grown to points) this tall (m) is drawn as tufts where its leaves are too thin
 * to be seen, wholly from twice it: its uneven tips and tussocks are seen as a texture long after a single
 * leaf is not, where a mown sward is level and its ground carries it. (Unmown fescue at 10 cm, as a course's
 * native ground is, had nothing drawn on it between the last leaves a couple of strides off and the far
 * tufts.)
 */
const UNMOWN_TUFTS_FROM_M = 0.04;
const TUSSOCK_WIDEST = 0.42;
const TUSSOCK_SMALLEST = 0.06;
/** A stem (`Species.stem`): how much of its thickness is left at its tip's foot, and how much darker its edges are than its middle, being turned away. */
const STEM_TAPER = 0.45;
/**
 * A stem's flowers (`Species.flower`): a tuft on one side of it, this far up it and this tall (shares of
 * its length), reaching this many of the stem's own breadths out from its middle. The stem's strip is
 * drawn that much broader and cut back to the stem and the tuft, pixel by pixel, and only where the stem
 * is a few pixels broad in the picture: a tuft on a stem a pixel broad is a speck that comes and goes.
 */
const FLOWER_AT = 0.79;
const FLOWER_TALL = 0.03;
const FLOWER_OUT = 7;
const FLOWER_FROM_PX = 1.6;
/**
 * Within this many metres of its stand's edge a tussocked plant grows everywhere: the tussocks close up
 * into a fringe along the edge. (Half as far as the map can tell an edge is, `MapSource.edgeReach`, if that
 * is less: a fringe as broad as that is the whole stand.)
 */
const TUSSOCK_FRINGE_M = 0.6;
/** The share of a stand of stems that is drawn however thin they are in the picture. */
const STEMS_SEEN_LEAST = 0.7;
/** Radians a stem tilts for a lean of 1. */
const STEM_TILT = 1.1;
const STEM_ROUND = 0.42;
/** How far a leaf fully laid by the mower leans, as its tip's reach over its height: some 25 degrees. */
const LAY_LEAN = 0.45;
/** How far up the face of a leaf looks that is hardly laid over at all (radians from level). */
const LAY_FACE_UP = 0.35;
/** How bright a leaf's under face is beside its upper one: it has the ground on it, not the sky. */
const LAY_UNDER = 0.72;
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
/**
 * How much a far tuft's brightness follows the way it is laid over: a leaf laid towards the sun shows it
 * more of its face and one laid from it less, by this much of the change in how squarely the sun meets it,
 * and never by more than `LAID_LIT_MOST` either way. This is all a gust does to the look of far grass:
 * nothing is painted on it. (A painted patch of paler grass travelling downwind was an overlay, with
 * the grass under it standing still: it read as cloud shadow, not wind.)
 */
const LAID_LIT = 0.6;
const LAID_LIT_MOST = 0.16;
/** A crown is ground that stands this much (m) above the mean of the ground this far (m) round it; a hollow lies this much below the mean further round. */
const SITE_NEAR_M = 2.5;
const SITE_NEAR_RISE = 0.05;
const SITE_FAR_M = 9;
const SITE_FAR_DROP = 0.3;
/** How bright a leaf (or the ground) in another leaf's shadow is beside one in the sun: it still has the sky, and the light through the leaves. */
const LEAF_IN_SHADE = 0.5;
/** Grass shorter than the first (m) does not swing in the wind at all; grass as tall as the second swings freely. */
const SWING_FROM_M = 0.045;
const SWING_FULL_M = 0.11;
/**
 * The most a leaf's shine adds to its colour (of white, 1 being the sun's light full on a white card). A leaf's
 * glint can be far brighter than this in life; but a host that blooms what is bright (as a game's picture often
 * does) makes a lamp of every glint, and a field of swaying leaves flashes.
 */
const LEAF_SHINE_MOST = 0.3;
/** No leaf is given a colour brighter than this, whatever `look.brightest` says: past it something has gone wrong. */
const LEAF_BRIGHT_MOST = 4;
/** A leaf this many pixels broad in the picture shows its shine as narrow as it is; a narrower leaf shows it spread out. */
const SHINE_FULL_PIXELS = 6;
/** A leaf this many pixels broad in the picture begins to show its own surface (its halves, rib and edges); at two and a half times this, all of it. */
const LEAF_DETAIL_FROM_PX = 5;
/** And its veins from this many: there are `LEAF_VEINS` of them across it, and each needs a few pixels. */
const LEAF_VEINS_FROM_PX = 26;
const LEAF_VEINS = 7;
/** How much lighter the half of a leaf turned to the sun is, and darker the other (of the leaf's colour, at full side-on). */
const LEAF_HALVES = 0.2;
/** How dark the rib's groove is, and how wide (of the leaf's breadth). */
const LEAF_RIB = 0.22;
const LEAF_RIB_WIDE = 0.035;
/** How much darker a leaf is at its very edge. */
const LEAF_RIM = 0.14;
/** How dark the line between two veins is. */
const LEAF_VEIN = 0.07;
/** The lane kept open between the eye and a thing in the grass is this many times the thing's own breadth: in turf, and in grass a hand high or more. */
/** Grass under something that stands on it is this share of its height. */
const THING_TROD_TALL = 0.35;
const THING_LANE = 1.2;
const THING_LANE_TALL = 2.2;
/** Mown turf no taller than this (m) is one even sward; by twice this it is plants again. */
const SWARD_BELOW_M = 0.03;
/** Plants along the side of a square of leaves. */
const LAYER_SIDE = 332;
/** The leaves' swing runs downwind in waves this long (m). */
const SWING_WAVE_M = 1.8;
/** How far (radians of its swing, either way) a leaf is out of step with those about it. */
const SWING_OWN_RAD = 0.9;
/**
 * Seen from higher than this over the ground (m), a square keeps fewer of its plants, as the square of
 * the height falls, and draws those it keeps broader by as much, so the stand covers its ground as it did:
 * from above, the leaves of a stand are seen against each other and its ground, and a quarter of them as
 * broad again reads the same at a fraction of the cost. Never fewer than this share. (After bevy-grass.)
 */
const HEIGHT_THIN_FROM_M = 4;
const HEIGHT_THIN_LEAST = 0.25;
/** How fast the gusts travel downwind (m/s): this and this much more for each metre a second of wind. */
const GUST_PACE = 1.2;
const GUST_PACE_PER_MS = 0.55;
/**
 * Where the gusts' running offset wraps (m): a whole number of repeats of both noises they are read from
 * (61 m, and 19 m over 1.35), so the wrap shows no seam.
 */
const GUST_REPEAT_M = 61 * 380;
/** How long a dead leaf is beside a live one of the same plant. */
const DEAD_LEAF_TALL = 0.62;
/** The breadth of a patch where a grass is thick with seed heads or has hardly one (m), and of the slower swell over a stand (`Species.seedShare`). */
const SEED_PATCH_M = 3.7;
/** The breadth of a patch of a stand where more of its leaves are dead, or fewer (`Species.dry`). */
const DEAD_PATCH_M = 6.1;
const SEED_DRIFT_M = 23;
/** How much taller than the leaves a stem in seed stands, where only some are (`Species.seedShare`). */
const SEED_STALK_TALL = 1.2;
/** Where a flower's centre is broadest, as a share of the way from its top to its foot. */
const CENTRE_SHOULDER = 0.35;
/** A dead leaf: straw. */
const STRAW = new THREE.Color("#b9ac80");
/** A leaf folded along its rib has each half turned this far (radians) from flat, at a `fold` of 1: a shallow V. */
const FOLD_ANGLE = 0.5;
/** A tuft's blade is this many times as broad as a fine leaf of its species: it stands for several. */
const TUFT_BROAD = 3.1;
/**
 * But never narrower than this (m): a tuft of a fine-leaved grass stands for more of its leaves, it having
 * more of them to the square metre, not for a narrower strand. (At three of its own leaves, 0.6 mm fescue's
 * tufts were hairs, a quarter of a rye rough's, and a hillside of it was its bare ground.)
 */
const TUFT_LEAST_M = 0.0055;
/**
 * The most a tuft is broadened for those thinned out about it (`tuftKept`): so far, and a tuft left alone
 * still covers its share of the ground; further, and it is a fan, not grass.
 */
const TUFT_WIDEN_MOST = 3;
/**
 * Over this part of their range (shares of it) the far tufts take the ground's flat colour and the ground
 * takes the stand's mean for them (`toGround`, `ground`): the two together, or tufts still drawn stand on
 * ground already as light as they are, and a stand of long grass a dozen strides off is a flat colour.
 */
const TUFTS_TO_GROUND: readonly [number, number] = [0.55, 0.95];
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
  /**
   * The light at a place, from what the host has standing over the grass and the grass knows nothing
   * of: clouds, trees, buildings, rain. Each is a function of a place (x, z) the shaders call, in the
   * compute pass and in fragment shaders both, so a texture in one is looked up at a set level.
   */
  world?: WorldLight;
  /** Flowers of the host's own, by the names its species' `blooms` give them: added to `FLOWERS`, or in place of one of the same name. */
  flowers?: Readonly<Record<string, Flower>>;
  /**
   * The host's own noise in place of the grass's: a tiling picture of four unlike noises, one to a
   * channel, that repeats and has mipmaps. A host whose ground asks the grass for its shading
   * (`groundShade`) and has such a picture already gives it here, so the ground's shader looks up one
   * picture and not two: a shader stage has sixteen on any machine.
   */
  noise?: THREE.Texture;
}

/** See `GrassOptions.world`. Any of them may be left out. */
export interface WorldLight {
  /** How much of the sun reaches the place, 0..1: a cloud's shadow, a tree's. The sky still lights it. */
  sun?(xz: Vec2): THREE.Node<"float">;
  /** How much of the sky the place sees, 0..1: under a tree's crown, in a hollow, against a wall. */
  sky?(xz: Vec2): THREE.Node<"float">;
  /**
   * How much of the day's light a place goes without, 0 (open) to 1 (under a closed crown): for what
   * grows there, not for how it is lit now, so it does not move with the sun or sway with the leaves.
   * The flowers of open grassland take little of it (`Flower.colony`). Not given: open everywhere.
   */
  shelter?(xz: Vec2): THREE.Node<"float">;
  /** What the grass's colour is multiplied by there: wet grass is darker, grass under leaves is lit green. */
  tint?(xz: Vec2): Vec3;
  /**
   * What the colour of something in the grass that is not grass (a flower) is multiplied by there: the
   * light's part of `tint` (the shade, the wet), without what a host puts in `tint` to make the grass the
   * colour of its ground. Not given, flowers take `tint`.
   */
  light?(xz: Vec2): Vec3;
  /**
   * The air between a leaf and the eye: given the leaf's colour and where it is, the colour that reaches
   * the eye. A host with haze of its own (the scene's fog is applied without this). Called for each
   * corner of a leaf, in a vertex shader.
   */
  air?(colour: Vec3, at: Vec3): Vec3;
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
   * how far (m) a border strays from the map's cells. `leafShadows`: whether the leaves about the eye shadow each other and the ground (they are
   * drawn once more each frame, from the sun: it costs about as much again as drawing them).
   * `amount`: how much of the grass is drawn, 0.05 to 1 (the plants left are broader for the ones
   * left out, so the field keeps its cover: a host's own setting for a slower machine).
   * `brightest`: no leaf is drawn brighter than this (a host that blooms what is bright sets it
   * under its threshold, or a back-lit leaf is a lamp).
   * `blooms`: whether the species' flowers are drawn (`Species.blooms`).
   * `strains`: how unlike its strains a mown stand shows itself (`Species.mosaic`), 0..1: most in early
   * spring and late autumn, when the strains wake and sleep at their own times, hardly at all in summer.
   * `drought`: how dry the ground has been, 0..1: the mown grass browns in spots (`Species.scorch`).
   * `wet`: how wet the leaves are, 0 (dry) to 1 (dew, or rain): what a trail through them leaves
   * (`setTrail`). The colour of wet grass is the host's to give (`world.tint`).
   * `site`: how far the grass's colour follows the lie of the ground, lusher in the hollows
   * and paler on the crowns (it needs the map's `bounds`; patches follow it by each species' `patchSite`).
   * `mown`: whether the field is mown in stripes at all (`GrassOptions.mow` says how): off, no
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
  look: { clumpSize: number; macro: number; edgeWobble: number; groundShade: number; stripes: number; shadow: number; occlusion: number; fold: number; relief: number; leafPixels: number; depth: number; mown: boolean; site: number; leafShadows: boolean; brightest: number; wet: number; blooms: boolean; amount: number; strains: number; drought: number; bare: THREE.Color };
  /** Read the species again after changing them (or give another list). */
  setSpecies(list: readonly Species[]): void;
  /**
   * What lies in the grass (a ball, a stone): at most `MAX_THINGS` spheres. No leaf goes through one:
   * the grass under it is pressed down beneath it, a leaf that would cross it is carried round it, and
   * the leaves about it are held still. Give them again whenever one moves; none, to clear them.
   */
  setThings(list: readonly GrassThing[]): void;
  /**
   * Where something has gone through the grass, in the order it went: at most `MAX_TRAIL` points, each a
   * place, how broad the thing was there (m) and when it was there (s, on `update`'s clock). The grass is
   * laid over along the track between each point and the next as the thing passes, and is back up in
   * about a second: dry grass keeps no track. Wet grass (`look.wet`) is slower up, and its leaves along
   * the track are a little darker for some minutes, the wet wiped off them. (A faint line, and on the
   * leaves only: a dew track as it is seen on a green, dark through pale, wants the dew drawn and the
   * ground under the leaves to carry the line, and neither is done.) The grass remembers the track after
   * its points are gone, within 15 m or so of the eye. None, to clear it (what it left stays, and fades).
   */
  setTrail(points: readonly { x: number; z: number; radius: number; at: number }[]): void;
  /** A stir of the air at a place: the grass within a stride of it is pushed out from it and along (`dx`, `dz`: which way, and how hard, 1 being a club's swing). None, for still. */
  setStir(stir: { x: number; z: number; dx: number; dz: number } | null): void;
  /**
   * The pictures the species' leaves can have, by the names the species use
   * (`Species.leafTexture`): at most `MAX_LEAF_TEXTURES`. Each is kept at 64
   * by 256, the leaf's root at its bottom edge.
   */
  setLeafTextures(pictures: Record<string, CanvasImageSource>): void;
  /** A specimen standing at a place. Add its `object` to the scene. */
  /**
   * How many plants the last frame drew, of `stats.plants` computed: read back from the graphics card, so not
   * every frame. It sets `stats.flowersDrawn` too.
   */
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
   * (With `lookAt.focus`, the leaves are thickest about that place and not about the eye: a picture
   * of something on the ground some way off, a ball at a golfer's feet seen from behind, has its grass
   * where the thing is. They thin out from there as they otherwise do from the eye.)
   * Once a frame, before rendering. `lookAt` is where the picture's middle
   * meets the ground, if the host knows it: the fine leaves are centred
   * there. Without it they are centred a few metres ahead of the eye. With
   * the ground's height there too (`y`), the finest squares know how far
   * off they are, and are drawn only when close.
   */
  update(renderer: THREE.WebGPURenderer, camera: THREE.Camera, timeS: number, lookAt?: { x: number; y?: number; z: number; focus?: boolean }): void;
  /** Which of it is drawn: the far tufts, the fine leaves. */
  show: { tufts: boolean; leaves: boolean };
  /**
   * For the host's ground material: the colour the grass standing at a
   * place takes (before light), so ground and grass are one colour and
   * where the leaves thin out there is nothing to see.
   */
  groundColor(xz: Vec2): Vec3;
  /**
   * For a host whose ground has its own colour: what the grass standing at a place does to it, as
   * what to multiply that colour by. The host's colour is taken to be the stand's as a whole (so the
   * species' leaf colour is that colour over `standTone`): far off this is 1. Dark where the eye sees down between the leaves and the stand's
   * own mean where it stands in for leaves too far off to draw, the stand's picture and its relief,
   * its patches, the mower's stripes, the gusts, the grass's own shade. None of the world's light
   * (`GrassOptions.world`), which is the host's to put on its ground itself. In a fragment shader.
   */
  groundShade(xz: Vec2): Vec3;
  /** The light a leaf takes on ground with this normal, for the same reason. */
  light(normal: Vec3): Vec3;
  /**
   * The plants there are in all, the most leaves they can stand up as, and `computed`: how many plants
   * the last frame worked out (the squares whose leaves could be in the picture; the rest were left alone).
   * `flowers`: the places there are for a flower, near and far; `flowersDrawn`: how many flowers stood on them
   * and were drawn, as `countDrawn` last found (none while flowers are not drawn).
   */
  stats: { plants: number; leaves: number; computed: number; flowers: number; flowersDrawn: number };
  dispose(): void;
}

const hash21 = Fn(([pIn]: [Vec2]) => {
  const p = fract(pIn.mul(vec2(123.34, 456.21))).toVar();
  p.addAssign(dot(p, p.add(45.32)));
  return fract(p.x.mul(p.y));
});

export function createGrass(options: GrassOptions): Grass {
  const { height, map, mow } = options;
  /** How broad the fringe of a tussocked stand is (m): see `TUSSOCK_FRINGE_M`. */
  const fringeM = Math.min(TUSSOCK_FRINGE_M, (map.edgeReach ?? Infinity) * 0.5);
  const layers = options.layers ?? DEFAULT_LAYERS;

  const group = new THREE.Group();

  // Leaves' shadows on each other: the leaves about the eye are drawn once more each frame, from the sun,
  // into a picture of how far from the sun the nearest leaf is along each of its rays. A leaf, or the
  // ground, is in shadow where it is further than that. (Two pictures, turn about: a frame reads the one
  // the frame before drew, since a picture cannot be read while it is drawn into.)
  const SHADOW_SIZE = 2048;
  /** The ground the shadow's picture covers reaches this far (m) each way from where the eye looks: 3 mm to the pixel. */
  const SHADOW_HALF_M = 2.4;
  /** A leaf is not in its own shadow: what is this much (m) nearer the sun than it does not count. */
  const SHADOW_BIAS_M = 0.006;
  /** How many of the picture's pixels apart, along the sun's ray over level ground, two leaves must be for one to shadow the other. */
  const SHADOW_PIXELS_APART = 1.5;
  /** A stand's leaves shadow each other by the picture in full once the stand is this many of its pixels tall, measured along the ground under the sun; at one, not at all. */
  const SHADOW_PIXELS_TALL = 3;
  /** A stand's own leaves reach this many times its height above a point in it, at most (a tall leaf, ground rising a little towards the sun): what shadows it from further up the sun's ray than that is something taller. A golf course's surfaces step up by two or three times each, so this is well under two. */
  const SHADOW_OWN_REACH = 1.6;
  const SHADOW_DEEP_M = 60;
  /** Only the squares of leaves that reach no further than this (m) are drawn into it: the two nearest. */
  const SHADOW_NEAR_RANGE_M = 2;
  /** The widest square of leaves that is drawn into the shadow picture reaches this far (m, its `range`). */
  const SHADOW_CAST_RANGE_M = Math.max(...layers.near.map((l) => l.range).filter((r) => r < SHADOW_NEAR_RANGE_M));
  /** A point goes from lit to shadowed over this much depth (m) behind what shadows it. */
  const SHADOW_SOFT_M = 0.012;
  const shadowTargets = [0, 1].map(() => {
    const t = new THREE.RenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthBuffer: true });
    t.depthTexture = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
    return t;
  });
  const shadowMats = [new THREE.Matrix4(), new THREE.Matrix4()];
  const shadowNodes: THREE.TextureNode[] = [];
  const uSunMat = uniform(new THREE.Matrix4());
  /** 1 when the renderer keeps depth reversed (`reversedDepthBuffer`): the sun's picture is then near 1, far 0. */
  const uReversedDepth = uniform(0);
  const uShadowOn = uniform(0);
  /** Where the leaves are thickest, and thin out from: the eye (x, y, z, and its height over the ground in w), or the place the host says the picture is of (w 0). */
  const uThickAt = uniform(new THREE.Vector4());
  /** How far a place is from where the leaves are thickest. */
  const fromThick = (xz: Vec2): THREE.Node<"float"> => length(vec3(xz.x.sub(uThickAt.x), uThickAt.w, xz.y.sub(uThickAt.z)));
  // What lies in the grass: each a sphere (its centre and radius), and how the grass is about it (x: cleared to this far, y: kept in sight).
  const thingAt = Array.from({ length: MAX_THINGS }, () => uniform(new THREE.Vector4(0, -9999, 0, 0)));
  const thingHow = Array.from({ length: MAX_THINGS }, () => uniform(new THREE.Vector4(0, 0, 0, 0)));
  // Where something has gone through the grass (x, z, how broad, when), in the order it went; and a stir of the air at a place (x, z, and which way and how hard).
  const trail = uniformArray(Array.from({ length: MAX_TRAIL }, () => new THREE.Vector4()), "vec4");
  const uTrailCount = uniform(0);
  /** How wet the leaves are, 0 dry to 1 (`look.wet`). */
  const uWet = uniform(0);
  /** `look.strains`, `look.drought`. */
  const uStrains = uniform(0.5);
  const uDrought = uniform(0);
  const uStir = uniform(new THREE.Vector4());
  // The grass's memory of what has been through it (after bevy-grass's trample buffer): a grid of cells
  // `TRACK_CELL_M` across, `TRACK_SIDE` a side, over the ground about the eye, wrapping round, so a cell
  // stands for whichever place of the world under it is nearest the eye and is cleared when that changes.
  // Each cell keeps how far the grass there is pushed over (x, z), how crushed it is (0..1), and how much
  // of its wet was wiped off (0..1). Each frame a pass fades every cell, at the grass's own pace, and
  // stamps in what is going through it now: the trail (`setTrail`) and anything that stands on the grass
  // (`setThings`, `flat`). A plant reads its four cells, however many things went through.
  const trackCount = TRACK_SIDE * TRACK_SIDE;
  // (Two entries to a cell, its numbers and then which place it is of (x), in one buffer: a shader stage is
  // sure of only eight storage buffers, and the plants' pass has six of its own.)
  const trackData = new Float32Array(trackCount * 8);
  for (let i = 0; i < trackCount; i++) trackData[i * 8 + 4] = -1;
  const trackAttr = new THREE.StorageBufferAttribute(trackData, 4);
  const trackStore = storage(trackAttr, "vec4", trackCount * 2);
  const cellOf = (slot: Int) => trackStore.element(slot.mul(2)) as unknown as Vec4;
  const keyOf = (slot: Int) => (trackStore.element(slot.mul(2).add(1)) as unknown as Vec4).x;
  /** The window's first cell (in cells, whole): `TRACK_SIDE` cells either way from there are kept. */
  const uTrackOrigin = uniform(new THREE.Vector2());
  /** What a cell keeps from one frame to the next: of its crush and push (x), and of its wiped wet (y). */
  const uTrackFade = uniform(new THREE.Vector2(1, 1));
  /** Where anything is stamped in this frame (m): least x, z, most x, z. None: least past most. */
  const uTrackBox = uniform(new THREE.Vector4(1, 1, 0, 0));
  /** Which stretch of the world a cell is of, as a number: the same cell of the window may be another. */
  const trackKey = (cell: Vec2): THREE.Node<"float"> => floor(cell.x.div(TRACK_SIDE)).add(1024).mul(4096).add(floor(cell.y.div(TRACK_SIDE)).add(1024));
  const trackSlot = (cell: Vec2): Int => {
    const s = cell.sub(floor(cell.div(TRACK_SIDE)).mul(TRACK_SIDE));
    return int(s.y).mul(TRACK_SIDE).add(int(s.x));
  };
  /**
   * What is going through the grass at a place now: how far it pushes it over (x, y), how crushed it is
   * (z, 0..1) and how much of its wet is wiped (w, 0..1). The trail: grass a thing went through is
   * crushed along its track, laid over the way it went and pushed out to either side, and springs back
   * by the time it is `TRAIL_UP_*_S` old; the wet wiped off it is kept `TRAIL_WIPED_S`. Something
   * standing on the grass crushes it to a footprint and wipes its wet.
   */
  const goingThrough = (xz: Vec2): Vec4 => {
    const crushed = float(0).toVar();
    const push = vec2(0, 0).toVar();
    const wiped = float(0).toVar();
    const upAfter = mix(float(TRAIL_UP_DRY_S), float(TRAIL_UP_WET_S), uWet);
    If(uTrailCount.greaterThan(1), () => {
      Loop({ start: int(0), end: int(uTrailCount.sub(1)), type: "int", condition: "<" }, ({ i }: { i: THREE.Node<"int"> }) => {
        const a = trail.element(i) as unknown as Vec4;
        const b = trail.element(i.add(1)) as unknown as Vec4;
        const age = uTime.sub(b.w);
        const from = vec2(a.x, a.y);
        const along = vec2(b.x, b.y).sub(from);
        const span = dot(along, along);
        // (Two points far apart are two visits, not a track between them: then it is the later one alone.)
        const t = mix(float(1), clamp(dot(xz.sub(from), along).div(max(span, float(1e-6))), float(0), float(1)), step(span, float(TRAIL_GAP_M * TRAIL_GAP_M)));
        const off = xz.sub(from.add(along.mul(t)));
        const d = length(off);
        const r = max(b.z, float(0.038));
        const live = step(float(0), age).mul(step(age, float(TRAIL_WIPED_S))).mul(step(float(0.001), b.z)).mul(step(d, r.mul(2)));
        const spring = float(1).sub(smoothstep(upAfter.mul(0.15), upAfter, age)).mul(live);
        wiped.assign(max(wiped, float(1).sub(smoothstep(r.mul(0.7), r.mul(1.5), d)).mul(float(1).sub(smoothstep(float(TRAIL_WIPED_S * 0.67), float(TRAIL_WIPED_S), age))).mul(live)));
        const crush = float(1).sub(smoothstep(r.mul(0.25), r.mul(1.45), d)).mul(spring);
        const ring = float(1).sub(smoothstep(r.mul(0.35), r.mul(1.9), d)).mul(smoothstep(float(0.01), r.mul(0.45), d)).mul(spring);
        push.addAssign(off.div(max(d, float(1e-4))).mul(ring).mul(0.18));
        // (And along the track the grass is laid over the way the thing went, as a roller lays it: it is
        // the laid leaves, showing their sides to the light, that make a track seen; leaves a third shorter
        // in a lane a hand wide are not.)
        push.addAssign(along.div(max(pow(span, float(0.5)), float(1e-4))).mul(crush).mul(TRAIL_LAY).mul(step(span, float(TRAIL_GAP_M * TRAIL_GAP_M))));
        crushed.assign(max(crushed, crush));
      });
    });
    // (A foot: a place something stands on, `flat`. Its print is crushed and its wet wiped.)
    for (let i = 0; i < MAX_THINGS; i++) {
      const r = thingHow[i].z;
      const d = length(xz.sub(vec2(thingAt[i].x, thingAt[i].z)));
      const print = float(1).sub(smoothstep(r.mul(0.7), r.mul(1.1), d)).mul(step(float(1e-4), r));
      crushed.assign(max(crushed, print.mul(FOOT_CRUSH)));
      wiped.assign(max(wiped, print));
    }
    return vec4(push.x, push.y, crushed, wiped);
  };
  /** The pass that fades the grid and stamps in what is going through it (see above). */
  const trackPass = Fn(() => {
    const slot = float(instanceIndex);
    const inWindow = vec2(mod(slot, float(TRACK_SIDE)), floor(slot.div(TRACK_SIDE)));
    // (The place of the world this cell is now: the one in the window about the eye.)
    const cell = uTrackOrigin.add(mod(inWindow.sub(uTrackOrigin), float(TRACK_SIDE)));
    const key = trackKey(cell);
    const here = int(instanceIndex);
    const was = cellOf(here);
    const same = keyOf(here).equal(key);
    const kept = same.select(was.mul(vec4(uTrackFade.x, uTrackFade.x, uTrackFade.x, uTrackFade.y)), vec4(0, 0, 0, 0)).toVar();
    const xz = cell.add(0.5).mul(TRACK_CELL_M);
    If(xz.x.greaterThanEqual(uTrackBox.x).and(xz.y.greaterThanEqual(uTrackBox.y)).and(xz.x.lessThanEqual(uTrackBox.z)).and(xz.y.lessThanEqual(uTrackBox.w)), () => {
      const now = goingThrough(xz);
      // (The more crushed of what was and what is now, with its push; the more wiped.)
      const newer = now.z.greaterThan(kept.z);
      kept.assign(vec4(newer.select(now.x, kept.x), newer.select(now.y, kept.y), max(now.z, kept.z), max(now.w, kept.w)));
    });
    trackStore.element(here.mul(2)).assign(kept);
    trackStore.element(here.mul(2).add(1)).assign(vec4(key, 0, 0, 0));
  })().compute(trackCount);
  /** What the grid keeps at a place, between its four nearest cells; nothing where it keeps another place. */
  const trackAt = (xz: Vec2): Vec4 => {
    const c = xz.div(TRACK_CELL_M).sub(0.5);
    const c0 = floor(c);
    const t = c.sub(c0);
    const at = (dx: number, dz: number) => {
      const cell = c0.add(vec2(dx, dz));
      const slot = trackSlot(cell);
      const same = keyOf(slot).equal(trackKey(cell));
      return same.select(cellOf(slot), vec4(0, 0, 0, 0));
    };
    return mix(mix(at(0, 0), at(1, 0), t.x), mix(at(0, 1), at(1, 1), t.x), t.y);
  };
  /**
   * What a plant rooted at `xz` has of what went through the grass and the stir: which way it is pushed
   * over (x, y), what is left of its height (z) and how much of its wet was wiped off (w, in grass as wet
   * as `look.wet`). The stir pushes it out from where the air was stirred and along.
   */
  const pressedAt = (xz: Vec2): Vec4 => {
    const kept = trackAt(xz);
    const push = vec2(kept.x, kept.y).toVar();
    const way = vec2(uStir.z, uStir.w);
    const hard = length(way);
    const from = xz.sub(vec2(uStir.x, uStir.y));
    const away = length(from);
    const out = normalize(from.div(max(away, float(1e-4))).add(way.div(max(hard, float(1e-4))).mul(1.15)));
    push.addAssign(out.mul(float(1).sub(smoothstep(float(0.05), float(STIR_REACH_M), away)).mul(min(hard, float(1.25))).mul(step(float(0.01), hard)).mul(0.25)));
    return vec4(push.x, push.y, mix(float(1), float(TRAIL_TALL), kept.z), kept.w.mul(uWet));
  };
  /** How tall a plant rooted at `xz` (its ground at `gy`) stands among the things in the grass: `tall`, less whatever they take. `luck` 0..1 is the plant's own. */
  const amongThings = (tall: THREE.Node<"float">, xz: Vec2, gy: THREE.Node<"float">, luck: THREE.Node<"float">): THREE.Node<"float"> => {
    let t = tall;
    for (let i = 0; i < MAX_THINGS; i++) {
      const c = thingAt[i];
      const r = c.w;
      const there = step(float(1e-5), r);
      const rel = xz.sub(vec2(c.x, c.z));
      const d = length(rel);
      // (Trodden: pressed down under something that stands on it.)
      const trod = thingHow[i].z;
      t = t.mul(mix(float(1), mix(float(1), float(THING_TROD_TALL), float(1).sub(smoothstep(trod.mul(0.45), max(trod.mul(1.55), float(1e-4)), d))), step(float(1e-4), trod)));
      // (The nest it has pressed.)
      const clear = thingHow[i].x;
      t = t.mul(mix(float(1), smoothstep(clear.mul(0.65), max(clear.mul(1.15), float(1e-4)), d), step(float(1e-4), clear).mul(there)));
      // (Under it: no taller than its underside there.)
      const under = max(c.y.sub(pow(max(r.mul(r).sub(d.mul(d)), float(0)), float(0.5))).sub(gy).sub(0.002), float(0));
      t = mix(t, min(t, under), step(d, r).mul(there));
      // (Between the eye and it: under the line of sight to its middle, for most plants, in a lane a little wider than it is.)
      // (To the height on it above which it is to show: its top less that share of its height.)
      const share = thingHow[i].y;
      const lineTo = c.y.add(r.mul(float(1).sub(share.mul(2))));
      const eye = vec3(uCamPos.x.sub(c.x), uCamPos.y.sub(lineTo), uCamPos.z.sub(c.z));
      const eyeFlat = max(length(vec2(eye.x, eye.z)), float(1e-4));
      const dir = vec2(eye.x, eye.z).div(eyeFlat);
      const toward = dot(rel, dir);
      const aside = abs(rel.x.mul(dir.y).sub(rel.y.mul(dir.x)));
      const sight = max(lineTo.sub(gy).add(toward.mul(eye.y).div(eyeFlat)), float(0));
      // (Every plant in the lane, each to somewhere under the line: at a sward's density one plant in ten
      // left standing is leaf enough to hide a ball. And a wider lane through taller grass, whose leaves hang in from the sides.)
      const laneWide = mix(float(THING_LANE), float(THING_LANE_TALL), smoothstep(float(0.06), float(0.15), tall));
      const lane = float(1).sub(smoothstep(r.mul(laneWide).mul(0.8), max(r.mul(laneWide).mul(1.7), float(1e-4)), aside)).mul(step(float(0), toward)).mul(step(float(1e-4), share)).mul(there);
      t = mix(t, min(t, sight.mul(mix(float(0.6), float(1), luck))), lane);
    }
    return t;
  };
  /** A point carried out of the things in the grass, if it is inside one: to just off its skin. */
  const outOfThings = (at: Vec3): Vec3 => {
    let q = at;
    for (let i = 0; i < MAX_THINGS; i++) {
      const c = thingAt[i];
      const centre = vec3(c.x, c.y, c.z);
      const from = q.sub(centre);
      const reach = max(length(from), float(1e-5));
      const skin = c.w.add(0.002);
      q = mix(q, centre.add(from.div(reach).mul(skin)), step(reach, skin).mul(step(float(1e-5), c.w)));
    }
    return q;
  };
  /** How free a leaf at `at` is to move, 0..1: one against a thing in the grass is held by it. */
  const freeOfThings = (at: Vec3): THREE.Node<"float"> => {
    let f = float(1) as THREE.Node<"float">;
    for (let i = 0; i < MAX_THINGS; i++) {
      const c = thingAt[i];
      f = f.mul(mix(float(1), smoothstep(c.w.mul(1.6), max(c.w.mul(6), float(1e-4)), distance(at, vec3(c.x, c.y, c.z))), step(float(1e-5), c.w)));
    }
    return f;
  };
  /** 1 while the leaves are being drawn from the sun: they are then the leaves the eye sees (as broad, turned the same way), not leaves made for a camera where the sun is. */
  const uFromSun = uniform(0);
  const sunCam = new THREE.OrthographicCamera(-SHADOW_HALF_M, SHADOW_HALF_M, SHADOW_HALF_M, -SHADOW_HALF_M, 0.1, SHADOW_DEEP_M);
  /**
   * Whether the sun reaches a point past the leaves about it (x: 1 it does, 0 it does not), how far that
   * is known (y: 0 outside the picture), how far the picture can tell the leaves of a stand `stands` tall
   * apart (z), and whether the sun reaches the point past everything taller than that stand (w).
   */
  const leafShadow = (at: Vec3, stands: THREE.Node<"float">, broad: THREE.Node<"float">): Vec4 => {
    const clip = uSunMat.mul(vec4(at, 1));
    const inPicture = vec2(clip.x.mul(0.5).add(0.5), clip.y.mul(-0.5).add(0.5));
    const node = texture(shadowTargets[0].depthTexture!, inPicture).level(float(0));
    shadowNodes.push(node as unknown as THREE.TextureNode);
    // (A renderer that keeps depth reversed draws the sun's picture with near at 1 and far at 0: turned back,
    // both are the share of the way from near to far, as below.)
    const nearest = mix((node as unknown as Vec4).x, float(1).sub((node as unknown as Vec4).x), uReversedDepth);
    const sunDepth = mix(clip.z, float(1).sub(clip.z), uReversedDepth);
    // (Known only as far as the leaves that are drawn into the picture go: they thin out away from the eye
    // as their square does, and past them the picture is empty, which is not the same as sunlit.)
    const casters = leavesAt(fromThick(vec2(at.x, at.z)), SHADOW_CAST_RANGE_M);
    const known = float(1).sub(smoothstep(float(0.8), float(0.98), max(abs(clip.x), abs(clip.y)))).mul(uShadowOn).mul(casters);
    // (In shadow by degrees over a little depth, not all at once: a leaf swaying across a shadow's edge
    // darkens as it goes in, where one that is either lit or not twinkles.)
    const sunPast = (gap: THREE.Node<"float">) => clamp(nearest.sub(sunDepth.sub(gap.div(SHADOW_DEEP_M))).div(SHADOW_SOFT_M / SHADOW_DEEP_M).add(1), float(0), float(1));
    // (The picture cannot tell apart what lies within one of its pixels, and under a low sun a pixel is a
    // long way along the ground: a pixel's breadth over the sun's slope. Leaves nearer each other than that
    // are not in each other's shadow by it, or a short sward comes out in blocks the size of the pixels.)
    const along = pow(max(float(1).sub(uSun.y.mul(uSun.y)), float(0)), float(0.5)).div(max(uSun.y, float(0.05)));
    const apart = along.mul(SHADOW_PIXELS_APART * 2 * SHADOW_HALF_M / SHADOW_SIZE).add(SHADOW_BIAS_M);
    // (And a stand no taller than that reach is leaves the picture cannot tell apart at all: there the
    // picture says nothing, and each leaf is in the sun or out of it by how deep in the stand it is.)
    // (Nor can it tell apart leaves narrower than its pixels: such a leaf is in the picture or not by where
    // it happens to lie across a pixel, and as it sways its shadow comes and goes.)
    const toldApart = smoothstep(float(1), float(SHADOW_PIXELS_TALL), stands.div(along.mul(2 * SHADOW_HALF_M / SHADOW_SIZE))).mul(smoothstep(float(0.5), float(1.1), broad.div(2 * SHADOW_HALF_M / SHADOW_SIZE)));
    // (What such a stand still takes from the picture is the shadow of anything taller beside it: whatever
    // is further up the sun's ray than the stand's own leaves could be.)
    const ownReach = stands.mul(SHADOW_OWN_REACH).div(max(uSun.y, float(0.05)));
    return vec4(sunPast(apart), known, toldApart, sunPast(apart.add(ownReach)));
  };
  const noiseTex = options.noise ?? makeNoiseTexture();
  /** Whether the noise is ours to dispose: a host's own is the host's, and may be sampled by everything else it draws. */
  const ownNoise = !options.noise;
  /** Set by `dispose`: a ground picture still being made then stops before it uploads anything. */
  let disposed = false;
  const table = makeSpeciesTable();
  const tableNode = uniformArray(table, "vec4");
  const row = (k: Int, slot: number) => tableNode.element(k.mul(SPECIES_SLOTS).add(slot)) as unknown as Vec4;
  const flowerTable = makeFlowerTable();
  const flowerNode = uniformArray(flowerTable, "vec4");
  /** A flower's slot in the flower table (`packFlowers`). */
  const frow = (f: Int, slot: number) => flowerNode.element(f.mul(FLOWER_SLOTS).add(slot)) as unknown as Vec4;
  /** Whether any species has a flower in it: if none has, nothing of the flowers is worked out or drawn. */
  let anyBlooms = false;

  const uSun = uniform(new THREE.Vector3(0.45, 0.7, 0.55).normalize());
  const uSunTint = uniform(new THREE.Vector3(1.14, 1.04, 0.86));
  const uShadeTint = uniform(new THREE.Vector3(0.6, 0.7, 0.88));
  const uWind = uniform(new THREE.Vector3(1, 0, 3));
  const uTime = uniform(0);
  /**
   * The wind's running totals, kept on the CPU from one frame to the next (see `update`): how far the gusts
   * have travelled (x, z, m), and a phase for the air's slow turning across z. A gust field placed by time
   * times the wind's speed would jump, all of it at once, whenever the wind's speed or heading changed.
   */
  const uGust = uniform(new THREE.Vector4());
  let lastTimeS: number | null = null;
  /** Running phases (radians): the leaves' swing, a flower's nod, the gusts' flutter, the air's turning across x. */
  const uPhase = uniform(new THREE.Vector4());
  const uCamPos = uniform(new THREE.Vector3());
  const uCamFwd = uniform(new THREE.Vector2(0, 1));
  /** Which way the eye looks, up and down too (a camera looking down sees ground behind its heading). */
  const uCamLook = uniform(new THREE.Vector3(0, 0, 1));
  /**
   * How far any part of a flower can be from its root (m), for the tallest flower in use: what the flower
   * pass leaves out behind the eye is out by more than this, so none of a flower at the picture's edge is.
   */
  const uBloomReach = uniform(1);
  /** broad, flat. */
  const uStyle = uniform(new THREE.Vector2(0, 0));
  /** clumpSize, macro, edgeWobble, groundShade. */
  const uLook = uniform(new THREE.Vector4(0.85, 0.3, 0.03, 1));
  const uStripes = uniform(1);
  /** 1 while the field is mown in stripes (`look.mown`), 0 while it is not: then no leaf is laid over. */
  const uMown = uniform(0);
  /** The eye's height over the ground it looks at (m), as near as the host has said. */
  const uEyeUp = uniform(1.5);
  /** The cells' ranks for thinning (placement.ts). */
  const ranks = rankStore();
  /** The share of a square's plants kept for the eye's height over the ground: `HEIGHT_THIN_FROM_M`. */
  const heightShare = (): THREE.Node<"float"> => clamp(pow(float(HEIGHT_THIN_FROM_M).div(max(uEyeUp, float(HEIGHT_THIN_FROM_M))), float(2)), float(HEIGHT_THIN_LEAST), float(1));
  /**
   * The share of a tuft square's plants kept at `dist` m from the eye, for the eye's sake (not its species'):
   * fewer further off, and fewer from high up. Those kept are drawn as much broader (to `TUFT_WIDEN_MOST`),
   * so a stand covers its ground as far as it is drawn: thinned and not broadened, a hillside of long grass
   * twenty metres off was its bare ground with a tuft to every square metre or two.
   */
  const tuftKept = (dist: THREE.Node<"float">, range: number): THREE.Node<"float"> =>
    float(1).sub(smoothstep(float(range * 0.3), float(range * 0.8), dist).mul(0.55))
      .mul(mix(float(1.0), float(0.45), smoothstep(float(18), float(38), dist)))
      .mul(heightShare());
  /** shadow, occlusion. */
  const uShade = uniform(new THREE.Vector2(0.6, 0.45));
  /** depth: how far the roots' shade follows the light's fall through the stand (0: the species' own `rootShade`). */
  const uLight = uniform(0.5);
  /** How far the grass's colour follows the lie of the ground (`look.site`). */
  const uSite = uniform(0.5);
  const uBrightest = uniform(4);
  const uAmount = uniform(1);
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
  // (As many layers as there are species, not as many as there could be: a layer is 4 MB here and a
  // third more on the card for its smaller copies. A longer list given later grows it.)
  const makeGroundTex = (px: Uint8Array, layers: number) => {
    const tex = new THREE.DataArrayTexture(px, GROUND_SIZE, GROUND_SIZE, layers);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  };
  let groundLayers = Math.max(1, Math.min(MAX_SPECIES, options.species.length));
  let groundPixels = new Uint8Array(GROUND_SIZE * GROUND_SIZE * 4 * groundLayers).fill(128);
  let groundTex = makeGroundTex(groundPixels, groundLayers);
  /** Every lookup of the ground's pictures, so a grown texture can be put in their place. */
  const groundNodes: THREE.TextureNode[] = [];
  const groundSample = (at: Vec2, k: Int) => {
    const n = texture(groundTex, at);
    groundNodes.push(n);
    return n.depth(k) as unknown as Vec4;
  };
  /** Make room for the ground pictures of `rows` species. */
  const growGround = (rows: number) => {
    if (rows <= groundLayers) return;
    const layers = Math.min(MAX_SPECIES, rows);
    const px = new Uint8Array(GROUND_SIZE * GROUND_SIZE * 4 * layers).fill(128);
    px.set(groundPixels);
    const old = groundTex;
    groundPixels = px;
    groundLayers = layers;
    groundTex = makeGroundTex(px, layers);
    for (const n of groundNodes) n.value = groundTex;
    old.dispose();
  };
  /** For each species' row, its ground picture's mean colour (linear), or null if it has no picture. */
  const groundOf: ({ mean: [number, number, number] } | null)[] = Array.from({ length: MAX_SPECIES }, () => null);
  const flowers: Record<string, Flower> = { ...FLOWERS, ...(options.flowers ?? {}) };
  const repack = () => {
    const used = current.flatMap((s) => (s.blooms ?? []).slice(0, MAX_BLOOMS).filter((b) => b.perM2 > 0 && flowers[b.flower]).map((b) => b.flower));
    const flowerAt = packFlowers(used, flowerTable, flowers);
    anyBlooms = flowerAt.size > 0;
    // (Its stem drawn up by two fifths again, and a quarter taller for its own luck, then bowed and nodding in
    // the wind by at most some half its height: twice and a bit its stem; and its head, its spike's or umbel's
    // length and its petals, on top; and a little for a far dot drawn larger than the flower.)
    uBloomReach.value = used.reduce((most, name) => {
      const fl = flowers[name];
      return Math.max(most, fl.stem * 2.1 + (fl.length ?? 0) + fl.petalLength * 1.2 + fl.centre + 0.1);
    }, 0.1);
    packSpecies(current, table, leafLayers, groundOf, flowerAt);
  };
  /** Put a picture's pixels (sRGB, and in alpha how high each stands; GROUND_SIZE square) in a species' layer, and note its mean. */
  const setGroundLayer = (rowIndex: number, px: Uint8Array | Uint8ClampedArray | null) => {
    if (px === null) groundOf[rowIndex] = null;
    else {
      growGround(rowIndex + 1);
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
    const strayed = xz.add(vec2(w.g, w.a).sub(0.5).mul(uLook.z.mul(2)));
    // An edge nobody keeps (`edgeBlend`): the place is asked for a little way off, by three noises, one a
    // few strides wide (the neighbour's tongues), one a stride (its drifts), one a hand (its single
    // plants), each as far as the species here lets its edge stray. So the neighbour comes in among it, and
    // a mown species, which lets nothing stray, keeps its line on its own side.
    const blend = row(int(min(map.sample(strayed).species, float(MAX_SPECIES - 1))), 11).y;
    const tongues = noise(xz.div(9.7).add(0.61));
    const drifts = noise(xz.div(2.3).add(0.29));
    const plants = noise(xz.div(0.37).add(0.83));
    // (The noise keeps near its middle: each is stretched to reach about as far, in metres, as it says.)
    const off = vec2(tongues.r, tongues.a).sub(0.5).mul(4.2).add(vec2(drifts.g, drifts.r).sub(0.5).mul(2.4)).add(vec2(plants.b, plants.g).sub(0.5).mul(1.8));
    return map.sample(strayed.add(off.mul(blend)));
  };

  /** A stand's colour at a place: its species' colour, drifting a little over tens of metres and over a few. */
  const tone = (xz: Vec2, base: Vec3) => {
    const ga = noise(xz.div(208.0));
    const gb = noise(xz.div(36.0).add(0.37));
    const broad = ga.r.mul(0.6).add(ga.g.mul(0.4));
    const mid = gb.r.mul(0.65).add(gb.a.mul(0.35));
    const drifted = base.mul(float(1).add(broad.sub(0.5).mul(uLook.y))).mul(float(1).add(mid.sub(0.5).mul(0.14)));
    return options.world?.tint ? drifted.mul(options.world.tint(xz)) : drifted;
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
   * What laying grass over does to how bright it is: nothing is painted. A mown stripe is leaves that all
   * lean one way, so they all turn their faces one way, and a stand of leaves that face one way sends back
   * more light the more of each face the eye sees and the sun strikes. For a deep stand of such leaves the
   * light sent back towards the eye goes as
   *
   *     |n.s| |n.e| / ( |n.s| e.up + |n.e| s.up )
   *
   * (single scattering in a canopy of oriented leaves: Ross 1981), n the leaves' face, s the sun, e the eye.
   * The stripe beside it leans the other way, and the two are told apart by nothing else: so the stripes
   * are there where the eye looks along the passes and gone where it looks across them, they change places
   * as the eye goes round, and they come and go with the sun. As a share of the mean of the two ways, so
   * that grass not laid over is as it was. From the place, the eye and the sun alone, so the ground and the
   * leaves on it take exactly the same.
   */
  const laidShade = (xz: Vec2, lay: Vec2): THREE.Node<"float"> => {
    const toEye = normalize(vec3(uCamPos.x.sub(xz.x), max(uEyeUp, float(0.02)), uCamPos.z.sub(xz.y)));
    const laid = min(length(lay), float(1));
    const way = lay.div(max(length(lay), float(1e-4)));
    // (A leaf laid over shows its upper face: the further over, the more that face looks up, and the less back the way it came.)
    const tilt = laid.mul(0.5).add(LAY_FACE_UP);
    const sent = (sign: number) => {
      const face = vec3(way.x.mul(cos(tilt)).mul(-sign), sin(tilt), way.y.mul(cos(tilt)).mul(-sign));
      // (Lit by the sky as well as the sun, and from either side: a leaf passes about as much light as it
      // sends back. But the side it shows matters: its upper face has the sky on it, its under face the ground.)
      const lit = abs(dot(face, uSun)).mul(0.65).add(0.35);
      const facing = dot(face, toEye);
      const seen = max(abs(facing), float(0.08));
      const side = mix(float(LAY_UNDER), float(1), smoothstep(float(-0.15), float(0.15), facing));
      return lit.mul(seen).div(lit.mul(toEye.y).add(seen.mul(max(uSun.y, float(0.05))))).mul(side);
    };
    const here = sent(1);
    const mean = here.add(sent(-1)).mul(0.5);
    return float(1).add(clamp(here.div(mean).sub(1), float(-0.3), float(0.3)).mul(laid).mul(uStripes));
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
    // And with it the lie of the ground there, which the grass's own height has nothing to do with but
    // which is wanted at the same places: whether it stands above the ground about it, a few strides
    // round (a crown or a knoll: it sheds water and dries first), and whether it lies below the ground
    // further round (a hollow: water comes to it and stays). Each -1..1, kept as 0..1.
    const ringMean = (r: number) => {
      let sum = float(0) as THREE.Node<"float">;
      for (let i = 0; i < 8; i++) sum = sum.add(height.sample(at.add(vec2(Math.cos((i * Math.PI) / 4) * r, Math.sin((i * Math.PI) / 4) * r))).height);
      return sum.div(8);
    };
    const own = height.sample(at).height;
    const crown = clamp(own.sub(ringMean(SITE_NEAR_M)).div(SITE_NEAR_RISE), float(-1), float(1));
    const basin = clamp(ringMean(SITE_FAR_M).sub(own).div(SITE_FAR_DROP), float(-1), float(1));
    const mat = new THREE.MeshBasicNodeMaterial({ fog: false });
    mat.colorNode = vec4(min(tall.div(CANOPY_MAX), float(1)), crown.mul(0.5).add(0.5), basin.mul(0.5).add(0.5), 1);
    return new THREE.QuadMesh(mat);
  })();
  const canopyAt = (xz: Vec2): THREE.Node<"float"> => {
    if (!reach || !canopyTarget) return float(0);
    const at = xz.sub(vec2(reach.x0, reach.z0)).div(vec2(reach.x1 - reach.x0, reach.z1 - reach.z0));
    return (texture(canopyTarget.texture, at).level(float(0)) as unknown as Vec4).x.mul(CANOPY_MAX);
  };
  /**
   * How dry a place is for where it lies, -1 (a hollow, where water gathers) to 1 (a crown, which sheds
   * it): from the lie of the ground alone, as the canopy's picture keeps it. 0 where there is no picture.
   */
  const dryAt = (xz: Vec2): THREE.Node<"float"> => {
    if (!reach || !canopyTarget) return float(0);
    const at = xz.sub(vec2(reach.x0, reach.z0)).div(vec2(reach.x1 - reach.x0, reach.z1 - reach.z0));
    const kept = texture(canopyTarget.texture, at).level(float(0)) as unknown as Vec4;
    return clamp(kept.y.sub(0.5).mul(1.3).sub(kept.z.sub(0.5).mul(1.5)), float(-1), float(1));
  };
  /** The grass's colour for where it lies: lusher and deeper in the hollows, paler and yellower on the crowns (`look.site`). */
  const siteTint = (xz: Vec2): Vec3 => {
    const dry = dryAt(xz);
    return mix(vec3(1), mix(vec3(0.88, 0.97, 0.86), vec3(1.12, 1.05, 0.84), dry.mul(0.5).add(0.5)), uSite.mul(abs(dry)));
  };
  /**
   * How much of the sun reaches a point `up` metres above the ground at a
   * place, 0..1: a few steps towards the sun, each asking whether the grass
   * there stands above the ray. Soft, and never black: a stand of grass is
   * not a wall.
   */
  const sunReach = (xz: Vec2, up: THREE.Node<"float">, world = true): THREE.Node<"float"> => {
    const flat = vec2(uSun.x, uSun.z);
    const across = max(length(flat), float(0.05));
    const to = flat.div(across);
    const rise = uSun.y.div(across);
    let lit = float(1) as THREE.Node<"float">;
    for (const far of [0.05, 0.12, 0.28, 0.6, 1.2]) {
      const over = canopyAt(xz.add(to.mul(far))).sub(up.add(rise.mul(far)));
      lit = min(lit, float(1).sub(smoothstep(float(0), float(0.015 + far * 0.1), over)));
    }
    return mix(float(1), lit, uShade.x).mul(world && options.world?.sun ? clamp(options.world.sun(xz), float(0), float(1)) : float(1));
  };
  /** How much of the sky a point sees, 0..1: less beside taller grass, whichever way the sun is. */
  const skyOpen = (xz: Vec2, up: THREE.Node<"float">, world = true): THREE.Node<"float"> => {
    let shut = float(0) as THREE.Node<"float">;
    for (const [dx, dz] of [[0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]) shut = shut.add(clamp(canopyAt(xz.add(vec2(dx, dz))).sub(up).div(0.27), float(0), float(1)));
    return float(1).sub(shut.mul(0.25).mul(uShade.y)).mul(world && options.world?.sky ? clamp(options.world.sky(xz), float(0), float(1)) : float(1));
  };
  /** What a leaf or the ground is lit by where the sun does not reach it: the sky's light alone. */
  const inShade = () => uShadeTint.div(mix(uShadeTint, uSunTint, 0.62));

  /**
   * The clump a place belongs to, for a species: the nearest of a scatter of clump centres (`look.clumpSize`
   * apart, times the species' `clumpScale`), as its squared distance in shares of the way between clumps,
   * which clump it is, and the way out from its centre. Within a shader function (`Fn`).
   */
  const nearestClump = (xz: Vec2, k: Int) => {
    const clumpAt = xz.div(uLook.x.mul(max(row(k, 12).w, float(0.25))));
    const clumpCell = floor(clumpAt);
    const best = float(9).toVar();
    const id = vec2(0, 0).toVar();
    const out = vec2(0, 0).toVar();
    for (let cj = -1; cj <= 1; cj++) {
      for (let ci = -1; ci <= 1; ci++) {
        const cc = clumpCell.add(vec2(ci, cj));
        const centre = cc.add(vec2(hash21(cc.add(11.3)), hash21(cc.add(47.9))));
        const away = clumpAt.sub(centre);
        const d2 = dot(away, away);
        If(d2.lessThan(best), () => {
          best.assign(d2);
          id.assign(cc);
          out.assign(away);
        });
      }
    }
    return { best, id, out };
  };
  /**
   * Whether a place is on one of its species' tussocks (`Species.tussock`), 0..1: the plant grows only within
   * some way of its clump's centre, with open ground beyond; the further, the smaller the tussocks; some
   * broad and some small. (In squared shares of the way between clumps, as `nearestClump` says.) Along the
   * stand's edge (`edge`, m) the tussocks close up: what grows at a marsh's margin is a fringe, not islands.
   * `fray` pushes a tussock's edge about a little. 1 everywhere for a species that is not in tussocks.
   */
  const tussockOf = (best: THREE.Node<"float">, id: Vec2, k: Int, edge: THREE.Node<"float">, fray: THREE.Node<"float">) => {
    const tussockAmt = row(k, 12).x;
    const tussockWide = mix(float(TUSSOCK_WIDEST), float(TUSSOCK_SMALLEST), tussockAmt).mul(mix(float(0.45), float(1.5), hash21(id.add(29.9))));
    const inFringe = float(1).sub(smoothstep(float(fringeM * 0.4), float(fringeM), edge));
    return mix(float(1), max(float(1).sub(smoothstep(tussockWide.mul(0.55), tussockWide, best.add(fray))), inFringe), step(float(0.01), tussockAmt));
  };

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
  /**
   * How far a colony reaches from its centre at most, in squares of its own size (`inPatch`), its long way,
   * its ragged edge and all: at the most a centre a square away is three quarters of one from the place.
   */
  const REACH_MOST = 0.68;
  /** Metres from a stand's edge over which `patchEdge` goes from all to none. */
  const PATCH_EDGE_M = [1.5, 7];
  /** The colour a dry spell turns mown grass, as a multiplier on its own (by eye: straw, not dead). */
  const SCORCH_TINT = [1.12, 1.0, 0.68];
  const inPatch = (xz: Vec2, k: THREE.Node<"int">, edge: THREE.Node<"float"> = float(1e3), shadeToo = true): THREE.Node<"float"> => {
    // (More of them where the ground suits them and fewer where it does not: `patchSite`; and towards the
    // stand's edge and in the trees' shade, or away from them, `patchEdge`: in within a few metres of the edge.)
    const towards = row(k, 18).z;
    // (Not for the ground's colour (`shadeToo`): a host's ground shader has its own textures to look up and a
    // stage is sure of only sixteen; with the shelter's too a course with drawn ground had seventeen and drew
    // no ground at all. Its leaves take the shade, and the ground under a green's leaves is near enough.)
    const shaded = shadeToo && options.world?.shelter ? clamp(options.world.shelter(xz), float(0), float(1)) : float(0);
    const edgeward = float(1).sub(smoothstep(float(PATCH_EDGE_M[0]), float(PATCH_EDGE_M[1]), edge)).add(shaded).min(float(1));
    const byEdge = max(float(0), float(1).add(towards.mul(edgeward.mul(2.2).sub(0.6))));
    const share = clamp(row(k, 10).w.mul(float(1).add(row(k, 11).x.mul(dryAt(xz)).mul(1.8))).mul(byEdge), float(0), float(1));
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
    // (The plants at a colony's edge: a grain a few runners wide, by which the edge is ragged and not drawn.
    // Not broader: a grain half a colony wide broke its edge into islands and a colony read as a stain.)
    const grain = noise(xz.div(size.mul(0.16)).add(0.23)).b;
    // (`patchKind`: 0 colonies with seedlings about them, 1 blotches, 2 runners, colonies without.)
    const kindCode = row(k, 9).w;
    const isBlotches = float(1).sub(step(float(0.5), abs(kindCode.sub(1))));
    const seeds = float(1).sub(step(float(1.5), kindCode));
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
      // (Only the four squares nearest the place are looked at: a colony in any other has its centre at least
      // three quarters of a square away, so none reaches further than that from its centre, its ragged edge and
      // its long way and all, or it is cut off along the squares' lines: `REACH_MOST`.)
      const side = vec2(step(float(0.5), f.x).mul(2).sub(1), step(float(0.5), f.y).mul(2).sub(1));
      let core = float(0) as THREE.Node<"float">;
      let near = float(0) as THREE.Node<"float">;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const cell = home.add(vec2(side.x.mul(ox), side.y.mul(oy)));
        const key = cell.add(salt);
        const centre = cell.add(vec2(hashCell(key), hashCell(key.add(17.3))).mul(0.5).add(0.25));
        const small = hashCell(key.add(41.7));
        // (And longer one way than the other, each its own way: up to half as long again.)
        const longer = mix(float(1), float(1.5), hashCell(key.add(197.9)));
        const reach = min(mix(float(least), float(most1), small.mul(small)).mul(wider), float(REACH_MOST).div(longer));
        const there = step(hashCell(key.add(73.1)), often1);
        const lie = hashCell(key.add(151.3)).mul(3.1416);
        const off = g.sub(centre);
        const along = off.x.mul(cos(lie)).add(off.y.mul(sin(lie)));
        const across = off.y.mul(cos(lie)).sub(off.x.mul(sin(lie)));
        const away = length(vec2(along.div(longer), across)).div(reach);
        // (A colony is one plant's offspring: alike all through, each a little more or less unlike the
        // stand than the next. Its edge is its outermost plants: in or out by the grain, over a tenth of its breadth.)
        const unlike = mix(float(0.45), float(1), hashCell(key.add(113.9)));
        const inside = smoothstep(float(-0.06), float(0.06), float(0.9).sub(away).add(grain.sub(0.5).mul(0.24)));
        core = max(core, there.mul(unlike).mul(inside));
        // (Its seedlings' ground: out to the furthest a square away that can still be seen from here, whatever its size.)
        near = max(near, there.mul(float(1).sub(smoothstep(min(reach, float(0.45)), float(0.75), length(off)))));
      }
      return vec2(core, near);
    };
    const large = colonies(size.mul(6.3), 91.3, often, 0.1, 0.45);
    const middling = colonies(size.mul(2.2), 3.7, often, 0.1, 0.45);
    // (Seedlings: small ones, a hand or two across, thick about the colonies they came from and few elsewhere.)
    const seedlings = colonies(size.mul(0.7), 47.1, often.mul(float(0.12).add(max(large.y, middling.y).mul(1.1))).mul(seeds), 0.12, 0.34);
    const grown = max(max(large.x, middling.x), seedlings.x.mul(0.85)).mul(mix(float(0.82), float(1), fray.r));
    // Blotches are the other kind: not something that grew, but the ground showing through the grass, so
    // they have no centres and no edges. Three lookups of the noise, turned and of unrelated sizes (one
    // alone is the same four shapes in rows), cut where the species' share of the ground lies above.
    const wide = noise(turn(xz, 0.814, 0.581).div(size.mul(9.48)).add(vec2(0.13, 0.71)));
    const pushed = xz.add(vec2(wide.r, wide.a).sub(0.5).mul(size).mul(2.2));
    const lumps = noise(pushed.div(size.mul(4)).add(0.37)).r.mul(0.4).add(wide.r.mul(0.26)).add(driftRaw.mul(0.22)).add(fray.g.mul(0.12));
    const cut = mix(float(0.62), float(0.34), share);
    const blotched = smoothstep(cut.sub(0.07), cut.add(0.1), lumps).mul(mix(float(0.55), float(1), smoothstep(float(0.3), float(0.7), fray.r)));
    return mix(grown, blotched, isBlotches).mul(step(float(0.005), share));
  };
  /** A place's colour for being in a patch or not, as a multiplier. */
  const patchTint = (xz: Vec2, k: THREE.Node<"int">, edge: THREE.Node<"float"> = float(1e3)): Vec3 => mix(vec3(1), vec3(row(k, 10).x, row(k, 10).y, row(k, 10).z), inPatch(xz, k, edge, false));

  /**
   * A place's colour for its strain (`Species.mosaic`), as a multiplier: the ground is shared out among
   * touching patches, each the nearest of a scatter of centres (the larger the strain the further it
   * reaches: weighted), their lines wandering; each patch a shade lighter or darker and a little yellower
   * or bluer than the next, more so as `look.strains` says the season shows it.
   */
  const strainTint = (xz: Vec2, k: THREE.Node<"int">): Vec3 => {
    const amount = row(k, 18).x.mul(uStrains);
    const size = row(k, 18).y;
    const wander = noise(xz.div(size.mul(2.1)).add(vec2(0.47, 0.19)));
    const g = xz.add(vec2(wander.r, wander.g).sub(0.5).mul(size).mul(0.9)).div(size);
    const home = floor(g);
    const best = float(1e3).toVar();
    const next = float(1e3).toVar();
    const id = vec2(0, 0).toVar();
    const id2 = vec2(0, 0).toVar();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cell = home.add(vec2(dx, dz));
        const hc = mod(cell, float(4096));
        const centre = cell.add(vec2(hash21(hc.add(5.1)), hash21(hc.add(9.3))).mul(0.8).add(0.1));
        const d = dot(g.sub(centre), g.sub(centre)).sub(hash21(hc.add(2.7)).mul(0.45));
        const nearer = d.lessThan(best);
        const second = d.lessThan(next);
        id2.assign(nearer.select(id, second.select(cell, id2)));
        next.assign(nearer.select(best, min(next, d)));
        id.assign(nearer.select(cell, id));
        best.assign(min(best, d));
      }
    }
    // (Each patch's colour, and its neighbour's: where two strains meet they grow in among each other over a
    // hand or so, so the line between them is soft, not drawn.)
    const toneOf = (c: Vec2): Vec3 => {
      const hid = mod(c, float(4096));
      const shade = hash21(hid.add(13.7)).sub(0.5).mul(2);
      const warm = hash21(hid.add(29.1)).sub(0.5).mul(2);
      return vec3(shade).add(vec3(0.5, 0.12, -0.7).mul(warm));
    };
    const among = float(0.5).mul(float(1).sub(smoothstep(float(0), float(0.18), next.sub(best))));
    return vec3(1).add(mix(toneOf(id), toneOf(id2), among).mul(amount)).max(vec3(0.5));
  };

  /**
   * A place's colour for a dry spell (`Species.scorch`, `look.drought`), as a multiplier: small spots,
   * a hand to a foot across, gathered on the crowns and in a few drifts; and a ring along the stand's edge
   * a mower's width in, where the clean-up pass turns. Straw, not dead: a dry green is paler and tanner
   * in places, never bare.
   */
  const scorchTint = (xz: Vec2, k: THREE.Node<"int">, edge: THREE.Node<"float">): Vec3 => {
    const amount = row(k, 18).w.mul(uDrought);
    const crown = smoothstep(float(0.05), float(0.6), dryAt(xz));
    const drift = smoothstep(float(0.5), float(0.75), noise(xz.div(6.1).add(0.91)).g);
    const spots = smoothstep(float(0.6), float(0.7), noise(xz.div(0.32).add(0.21)).b.mul(0.7).add(noise(xz.div(1.1).add(0.57)).r.mul(0.3)));
    const ring = smoothstep(float(0.08), float(0.25), edge).mul(float(1).sub(smoothstep(float(0.55), float(0.85), edge))).mul(smoothstep(float(0.35), float(0.6), noise(xz.div(0.6).add(0.33)).a));
    const browned = max(spots.mul(max(crown, drift.mul(0.6))), ring.mul(0.7)).mul(amount);
    return mix(vec3(1), vec3(SCORCH_TINT[0], SCORCH_TINT[1], SCORCH_TINT[2]), browned);
  };

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
      const share = leavesAt(fromThick(xz), sq.range).mul(sq.uGate);
      gone = gone.mul(float(1).sub(share));
    }
    return float(1).sub(gone).mul(leafSeen(wide, away));
  };

  const ground = (xz: Vec2, forHost: boolean): Vec3 => {
    const m = lookup(xz);
    const alive = step(m.species, float(MAX_SPECIES - 0.5));
    const k = int(min(m.species, float(MAX_SPECIES - 1)));
    const base = row(k, 4);
    // Near the eye the ground is what shows between the leaves, in the stand's
    // shade: as dark as the leaves' roots. Far off it stands in for the whole
    // stand, where the tufts have taken its colour and stopped (see `toGround`).
    // (By the eye's whole distance, height and all: from far overhead the ground under the eye is far too.)
    const farOff = smoothstep(float(layers.far.range * TUFTS_TO_GROUND[0]), float(layers.far.range * TUFTS_TO_GROUND[1]), length(vec3(xz.x.sub(uCamPos.x), uEyeUp, xz.y.sub(uCamPos.z))));
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
    // (And not before the picture is made: until then its mean is nothing, and a colour over nothing is not a number.)
    const shows = picture.x.mul(float(1).sub(smoothstep(float(6), float(20), eyeAway))).mul(step(float(1e-4), mean.y));
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
      const tall0 = groundSample(at, k).w;
      const seenAt = at.add(run.mul(tall0.sub(0.5)).mul(pileTall).mul(uDetail.y).div(tileM));
      const texel = groundSample(seenAt, k);
      const sunward = groundSample(seenAt.add(sunWay.mul(RELIEF_STEP / GROUND_SIZE)), k).w;
      // (Metres risen per metre towards the sun.)
      const climb = sunward.sub(texel.w).mul(pileTall).div(tileM.mul(RELIEF_STEP / GROUND_SIZE)).mul(uDetail.y);
      const lit = clamp(uSun.y.sub(climb.mul(sunFlat)).div(max(uSun.y, float(0.15)).mul(pow(climb.mul(climb).add(1), float(0.5)))), float(0.6), float(1.15));
      return min(vec3(texel.x, texel.y, texel.z).div(max(vec3(mean.x, mean.y, mean.z), vec3(1e-4))), vec3(3)).mul(lit);
    };
    const lying = mix(vec3(1), mix(
      pileAt(xz.div(picture.y), picture.y, sightRun, sunAlong),
      pileAt(turned.div(picture.y.mul(1.31)).add(vec2(0.37, 0.61)), picture.y.mul(1.31), turn(sightRun), turn(sunAlong)),
      which,
    ), shows);
    // (A stand in seed is paler for its heads, which is most of what is seen of it from any way off.)
    const heads = row(k, 6);
    const inSeed = mix(vec3(1), vec3(heads.x, heads.y, heads.z), row(k, 2).z.mul(row(k, 11).w).mul(0.5));
    // (No gust is painted on the far ground: the wind is seen where there are leaves to move, and ground
    // that stands in for leaves too far off to draw is still, as they would seem from there.)
    const blown = float(1);
    // (Looking towards the sun the leaves glow with the light through them, and the ground that stands
    // for them further off glows as they do, or a dull band lies where the leaves stop: a leaf's glow,
    // averaged over its length and the ways it faces.)
    const fromEye = normalize(vec3(xz.x.sub(uCamPos.x), max(uEyeUp, float(0.02)).negate(), xz.y.sub(uCamPos.z)));
    const glow = vec3(1).add(vec3(1.25, 1.4, 0.05).mul(pow(max(dot(fromEye, uSun), float(0)), float(4)).mul(0.26).mul(far).mul(smoothstep(float(0.02), float(0.1), row(k, 0).x))));
    // (Bare ground is shaded as grown ground is: a path beside tall grass lies in its shadow.)
    // (Not for a host's own ground: its shader has its own textures to look up, a stage may have sixteen in all on any
    // machine, and the leaves' shadow picture is the one of ours the ground can best do without.)
    const onGround = forHost ? vec4(1, 0, 1, 1) : leafShadow(positionWorld, row(k, 0).x, row(k, 1).x);
    const leavesShade = mix(float(1), mix(float(LEAF_IN_SHADE), float(1), mix(onGround.w, onGround.x, onGround.z)), onGround.y);
    // What the stand does to the ground's colour, apart from what colour that is.
    const stand = vec3(leavesShade).mul(siteTint(xz)).mul(patchTint(xz, k, m.edge)).mul(strainTint(xz, k)).mul(scorchTint(xz, k, m.edge)).mul(under).mul(laidShade(xz, layAt(xz, k))).mul(float(1).add(grain)).mul(lying).mul(inSeed).mul(blown).mul(glow);
    // (For a host with its own ground: that alone, with the grass's own shade and none of the world's, which is the host's to put on its ground itself.)
    // (As a share of the stand's own mean: the host's colour is the stand's as a whole, so far off, where the
    // ground stands in for the stand, this is 1 and the host's colour is what is seen. See `standTone`.)
    if (forHost) return mix(vec3(1), stand.div(mix(rootDark(k), float(1), STAND_MEAN).mul(uLook.w).max(0.05)), alive).mul(mix(inShade(), vec3(1), sunReach(xz, standsFor, false))).mul(skyOpen(xz, standsFor, false));
    return mix(uBare, tone(xz, vec3(base.x, base.y, base.z)).mul(stand), alive).mul(mix(inShade(), vec3(1), sunReach(xz, standsFor))).mul(skyOpen(xz, standsFor));
  };
  const groundColor = (xz: Vec2): Vec3 => ground(xz, false);
  const groundShade = (xz: Vec2): Vec3 => ground(xz, true);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // A leaf of grass is narrow where it leaves the stem, nearly parallel-sided
  // for most of its length, and tapers only near its end: [half-width,
  // height] at each joint, then the tip. Enough joints for it to bend over in
  // a curve (a fine leaf in a field is a few pixels wide: three carry it).
  const FINE_RINGS: [number, number][] = [[0.6, 0], [1, 0.34], [0.9, 0.76]];
  // (A tuft's blade stands for several leaves, and is broad for it: but broad low down, where the leaves
  // it stands for are a mass, and drawn out fine above, where they are single tips. Broad to its top it
  // is an agave on a skyline.)
  const TUFT_RINGS: [number, number][] = [[0.62, 0], [1, 0.24], [0.66, 0.5], [0.3, 0.78]];
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
    const ribBack0 = o.folded ? attribute("aMid", "float") : float(0);
    const onRib = step(float(1e-6), ribBack0);
    const foldBy = uDetail.x.mul(FOLD_ANGLE);
    const tall = st.z;
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
    const flat = uStyle.y;
    // (A stem is round: it is not folded, and has no rib to be carried back.)
    const stem = row(k, 12).y;
    const ribBack = ribBack0.mul(float(1).sub(stem));

    const root = vec3(xz.x, colSt.w, xz.y);
    // (Where the leaf is seen from: the eye, also when it is the sun that draws it, for its shadow.)
    const seenFrom = mix(cameraPosition, uCamPos, uFromSun);
    const dist = distance(root, seenFrom);
    const gPos = positionGeometry;
    const b = gPos.z;
    const ang = r0.add(b.mul(0.381966)).mul(6.2832);
    const out2 = vec2(cos(ang), sin(ang));
    const rb = hashCell(hcell.add(b.mul(7.3)));
    // A seed head, on the share of the stems that carry one (`seedShare`).
    const seedShare = row(k, 11).w;
    // (Not evenly: a grass flowers in patches, a clone or a run of good ground thick with heads and the next
    // few metres with hardly one, and a stand over tens of metres more or less. So the share is the stand's
    // over its whole ground, some of it twice that and some a fifth: `SEED_PATCH_M`, `SEED_DRIFT_M`.)
    const seedPatch = mix(float(0.2), float(2), smoothstep(float(0.3), float(0.7), noise(xz.div(SEED_PATCH_M).add(0.37)).g))
      .mul(mix(float(0.55), float(1.3), smoothstep(float(0.25), float(0.75), noise(xz.div(SEED_DRIFT_M).add(0.83)).b)));
    const fertile = step(hashCell(hcell.add(b.mul(5.9).add(41.0))), seedShare.mul(seedPatch));
    // (So too its dead leaves (`Species.dry`): more where it has stood longest unthinned and on the dry
    // crowns, which burn first, fewer in the hollows; the share is the stand's over its whole ground.)
    const deadShare = clamp(tint.w.mul(mix(float(0.35), float(1.6), smoothstep(float(0.25), float(0.75), noise(xz.div(DEAD_PATCH_M).add(0.53)).r))).mul(float(1).add(dryAt(xz).mul(0.5))), float(0), float(1));
    const seed = form.z.mul(fertile);
    // A tuft's blades stand about its root, a mown sward's over its whole cell; none over the border.
    const footRadius = mix(float(0.02).add(rb.mul(0.16)), float(0.03).add(pow(rb, float(0.5)).mul(0.17)), isCut);
    // (Close-mown turf is not plants standing apart: it is one sward, its shoots as near each other one
    // way as another. So a mown plant's leaves stand spread over the whole of the plant's own cell, each
    // its own shoot, and not in a bunch at the cell's middle with bare ground showing round it.)
    const sward = isCut.mul(float(1).sub(smoothstep(float(SWARD_BELOW_M), float(SWARD_BELOW_M * 2), stand.x)));
    const swardOut = vec2(hashCell(hcell.add(b.mul(4.1).add(71.0))), hashCell(hcell.add(b.mul(6.7).add(83.0)))).sub(0.5).mul((o.range * 2) / LAYER_SIDE).mul(sward);
    const foot = root.add(fine ? vec3(swardOut.x, 0, swardOut.y).mul(o.field ? 1 : 0) : vec3(out2.x, 0, out2.y).mul(min(footRadius, sh.y)));
    const spinTo = hashCell(hcell.add(19.3)).mul(6.2832);
    const toCam = o.spin ? vec2(cos(spinTo), sin(spinTo)) : normalize(vec2(seenFrom.x.sub(foot.x), seenFrom.z.sub(foot.z)).add(1e-4));
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
    // (A stem is thickest at its foot and tapers evenly to its point.)
    const stemX = mix(sign(gPos.x).mul(mix(float(1), float(STEM_TAPER), gPos.y)), float(0), isTip);
    const shapedX = mix(mix(mix(gPos.x, mix(gPos.x, cutSide.mul(TOP_HALF_WIDTH), isTip), isCut), squareX, isSquare), stemX, stem).mul(seedHead);
    // (A cut-out leaf is a plain strip, its outline left to its picture.)
    const leafX = mix(shapedX, edge.mul(float(1).sub(onRib)), cutout);
    // (The slant is the mower's tear across the leaf: about as high as the leaf is broad, some nearly
    // square and some well aslant, whatever the leaf's length. As a share of a long leaf that is very
    // little: a cut leaf is a strap with an end, not a spear.)
    const tear = clamp(row(k, 1).x.mul(mix(float(0.25), float(1.1), hashCell(hcell.add(b.mul(9.7).add(53.0))))).div(max(tall, float(1e-4))), float(0.006), float(0.14));
    const gy = mix(mix(gPos.y, mix(gPos.y, mix(float(1).sub(tear), float(0.88), isSquare), isTopJoint), isCut), gPos.y, cutout);
    // A leaf does not turn to face whoever looks at it. Each is turned its
    // own way, up to some 60 degrees from square-on, and twists a little up
    // its length, so some are seen broad and some nearly edge-on.
    const turn = hashCell(hcell.add(b.mul(5.9).add(41.0))).sub(0.5).mul(2.1).add(gy.mul(0.5).mul(cutSide)).mul(form.y);
    const side = vec3(toCam.y.negate(), 0, toCam.x).mul(cos(turn)).add(vec3(toCam.x, 0, toCam.y).mul(sin(turn)));
    // (Half the leaf's breadth: the strip's vertices stand at -1 and 1 across it.)
    // (A dead leaf has dried and rolled in on itself: half as broad as it was.)
    const leafWidth = blade.x.add(rb.mul(blade.y)).mul(0.5).mul(float(1).add(uStyle.x.mul(2.5))).mul(mix(float(1), mix(float(0.5), float(1), stem), step(hashCell(hcell.add(b.mul(9.7).add(63.0))), deadShare)));
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
        : max(leafWidth.mul(TUFT_BROAD), float(TUFT_LEAST_M)).mul(mix(float(0.55), float(1), clamp(dist.div(uLeafReach), float(0), float(1)))).mul(float(1).add(dist.mul(0.09))).mul(min(float(1).div(tuftKept(dist, o.range)), float(TUFT_WIDEN_MOST)));
    // No two leaves of a plant the same height.
    const rh = hashCell(hcell.add(b.mul(3.1).add(17.0)));
    // A mown leaf is not as long as the grass is tall: it grew to its own length, some well past the
    // mower's height and some not up to it, and the mower took off whatever stood above. So it is drawn
    // at its own length and only as far along as where it crosses that height (see `cutAt`): the stand
    // has a level top of cut ends, with the shorter leaves' own tips below it.
    const mown = max(isCut, isSquare);
    // (A dead leaf is an old one: the plant's lowest, down in the stand under the live ones, not up among their tips.)
    // (A dead stem is last year's, and stands as tall as this year's.)
    const oldLeaf = mix(float(1), mix(float(DEAD_LEAF_TALL), float(1), stem), step(hashCell(hcell.add(b.mul(9.7).add(63.0))), deadShare));
    // (Where only some stems are in seed, those stand a fifth over the leaves, as a flowering stem does.)
    const seedStalk = mix(float(1), float(SEED_STALK_TALL), fertile.mul(step(float(1e-3), form.z)).mul(float(1).sub(step(float(0.999), seedShare))));
    const bladeTall = mix(tall.mul(float(1).sub(stand.y.mul(0.5)).add(rh.mul(stand.y))), tall.mul(float(0.85).add(rh.mul(0.95))), mown).mul(oldLeaf).mul(seedStalk);

    // The leaf arches: upright at the root, bending over more and more towards the tip.
    const lean0 = vec2(st.x, st.y).add(out2.mul(fine ? float(0.2).add(rb.mul(0.42)) : float(0.25).add(rb.mul(0.3))).mul(blade.z));
    // In a wind no leaf is still, and none only leans: each swings in a small figure of eight, the
    // swing running up the leaf a little late towards its tip, more in a wind and less for a stiff grass.
    // (Most of what is seen of a field moving is this, and the gusts over it the rest: Sanders, GDC 2018.)
    // (Not each to its own beat: leaves that stand together swing together, a little out of step, and the
    // swing runs downwind through the stand in waves a stride or two long. Each wholly to its own beat,
    // a stand does not sway: it shimmers.)
    const swingWave = dot(xz, vec2(uWind.x, uWind.y)).mul(-6.2832 / SWING_WAVE_M).add(sin(xz.x.mul(1.7).add(xz.y.mul(0.9))).mul(1.3)).add(sin(xz.y.mul(2.1).sub(xz.x.mul(0.6))).mul(1.1));
    const swingAt = uPhase.x.add(swingWave).add(hashCell(hcell.add(b.mul(5.3).add(41.0))).sub(0.5).mul(SWING_OWN_RAD * 2)).sub(gy.mul(1.4));
    // (And in still air nothing swings at all.)
    // (Only grass long enough to swing: mown turf up to the first cut stands still in any wind, rough hardly stirs, and from deep rough up it all goes.)
    const swingBy = smoothstep(float(SWING_FROM_M), float(SWING_FULL_M), row(k, 0).x).mul(float(1).sub(row(k, 2).w.mul(0.75))).mul(smoothstep(float(0), float(1.5), uWind.z).mul(0.014).add(min(uWind.z.div(8), float(1.5)).mul(0.034))).mul(o.field && fine ? freeOfThings(root.add(vec3(0, tall.mul(0.5), 0))) : float(1));
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
    // (How far along itself a mown leaf gets before the mower's height: it rises as sin(bend g) / bend of its length.)
    const cutAt = mix(float(1), asin(clamp(tall.mul(bendAll).div(max(bladeTall, float(1e-5))), float(0), float(1))).div(bendAll), mown);
    const bendHere = bendAll.mul(gy).mul(cutAt);
    // (A stem does not bow: it is stiff, and stands straight at whatever angle it leans, so a tussock is a
    // sheaf of straight stems fanning out from its foot.)
    const tiltBy = clamp(leanBy.mul(STEM_TILT), float(0), float(1.2));
    const goesOut = mix(float(1).sub(cos(bendHere)).div(bendAll), sin(tiltBy).mul(gy), stem);
    const goesUp = mix(sin(bendHere).div(bendAll), cos(tiltBy).mul(gy), stem);
    const runAll = normalize(mix(vec3(leanTo.x.mul(sin(bendHere)), cos(bendHere), leanTo.y.mul(sin(bendHere))), vec3(leanTo.x.mul(sin(tiltBy)), cos(tiltBy), leanTo.y.mul(sin(tiltBy))), stem));
    const faceAll = normalize(cross(side, runAll));
    // (A stem in flower: its strip is broader by `FLOWER_OUT`, for the tuft to be drawn on. See `leafMaterial`.)
    const stemPixels = o.field ? leafWidth.mul(2).div(max(pixel, float(1e-6))) : float(40);
    const inFlower = fine ? step(hashCell(hcell.add(b.mul(15.1).add(37.0))), row(k, 12).z).mul(stem).mul(smoothstep(float(FLOWER_FROM_PX), float(FLOWER_FROM_PX * 2), stemPixels)).mul(float(1).sub(uFromSun)) : float(0);
    const stripBroader = mix(float(1), float(FLOWER_OUT), inFlower);
    const rawPos = foot.add(side.mul(leafX).mul(width).mul(stripBroader)).add(vec3(0, bladeTall.mul(goesUp), 0)).add(vec3(leanTo.x, 0, leanTo.y).mul(bladeTall).mul(goesOut)).sub(faceAll.mul(ribBack.mul(width).mul(sin(foldBy).div(cos(foldBy)))));
    // (The root is sunk a little so no leaf floats on a slope: 3 cm for tall grass, less for a leaf shorter than that.)
    const rawY = rawPos.y.sub(min(float(0.03), bladeTall.mul(0.4)).mul(float(1).sub(gy)));
    // A fine plant has three leaves, and more the denser its species is above
    // 1: as many as its density times three, the odd leaf on some plants and
    // not on others. The leaves it has no use for are not drawn.
    const spare = fine ? float(1).sub(step(b.add(hashCell(hcell.add(77.7))), max(stand.z, float(1)).mul(PLANT_LEAVES))) : float(0);
    const worldPos = tall.lessThanEqual(1e-4).or(spare.greaterThan(0.5)).select(vec3(0, -9999, 0), o.field && fine ? outOfThings(vec3(rawPos.x, rawY, rawPos.z)) : vec3(rawPos.x, rawY, rawPos.z));

    const colLit = vec3(colSt.x, colSt.y, colSt.z);
    const tipTint = vec3(tint.x, tint.y, tint.z);
    const variation = habit.w.mul(float(1).sub(flat));
    const leafTone = float(1).sub(variation.mul(0.5)).add(rb.mul(variation));
    const rootIs = rootDark(k);
    const rootShade = mix(rootIs, float(1), flat.mul(0.7));
    const V = normalize(cameraPosition.sub(worldPos));
    // Towards the end of their range the tufts take the ground's own flat
    // colour, root to tip, so where they stop there is nothing to see stop. (Only as they end: taking it
    // from a quarter of the way out, a stand of long grass a dozen strides off was a flat colour.)
    const toGround = fine || !o.field ? float(0) : smoothstep(float(o.range * TUFTS_TO_GROUND[0]), float(o.range * TUFTS_TO_GROUND[1]), dist);

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
      const faceLeaf = o.folded ? normalize(faceAll.mul(cos(foldBy)).sub(side.mul(edge).mul(sin(foldBy)))) : normalize(faceAll.add(side.mul(edge).mul(0.3)));
      // (A stem's face turns away to either side, as a cylinder's does.)
      const face = normalize(mix(faceLeaf, faceAll.add(side.mul(edge).mul(0.9)), stem));
      // (And down in the fold less of the sky is seen than out at the edges: the deeper the fold, the darker its rib.)
      const inFold = float(1).sub(onRib.mul(sin(foldBy)).mul(0.45).mul(float(1).sub(calm)).mul(float(1).sub(stem)));
      // And each leaf is in the sun or out of it: the sun gets down between the others to some depth, a
      // different depth for every leaf, so each has its own line with sun above it and the others' shade
      // below. (How often the sun reaches a height is the same fall through the stand as the roots' shade.)
      const sunGetsTo = pow(max(rootIs, float(0.02)), float(1).sub(gPos.y));
      const ownLuck = hashCell(hcell.add(b.mul(11.7).add(87.0)));
      const inSun = smoothstep(ownLuck.mul(0.9).sub(0.06), ownLuck.mul(0.9).add(0.06), sunGetsTo);
      const shadowed = o.field ? leafShadow(worldPos, max(tall, stand.x), row(k, 1).x) : vec4(1, 0, 1, 1);
      const byDepth = mix(float(1), mix(float(0.58), float(1.14), inSun), float(1).sub(calm).mul(uLight).mul(1.4).min(1));
      const dapple = mix(byDepth, mix(byDepth.mul(mix(float(LEAF_IN_SHADE), float(1), shadowed.w)), mix(float(LEAF_IN_SHADE), float(1.1), shadowed.x), shadowed.z), shadowed.y);
      const turned = mix(mix(float(0.8), float(1.18), abs(dot(face, uSun))), float(1), calm).mul(inFold).mul(dapple);
      // its own green, a little to the yellow or to the blue of its neighbours';
      const own = vec3(1).add(vec3(0.16, 0.04, -0.2).mul(rh.sub(0.5)).mul(min(habit.w.mul(4), float(1))).mul(float(1).sub(calm)));
      // the sun through it, seen from the far side, strongest towards its tip;
      // (Through it: seen against the sun, bent a little by the leaf's own face, and tight about the sun's
      // direction: Barre-Brisebois and Bouchard 2011. By PROSPECT-D a grass leaf passes about as much green
      // as it sends back, nine tenths as much red and next to no blue: what comes through is the leaf's
      // colour without its blue, a yellower and deeper green.)
      const through = pow(max(dot(V.negate(), normalize(uSun.add(face.mul(0.2)))), float(0)), float(4)).mul(float(1).sub(abs(dot(face, V)).mul(0.5))).mul(gPos.y).mul(float(1).sub(calm)).mul(float(1).sub(stem));
      // and the sun off it, where its face lies between the sun and the eye. A leaf's shine is white, not
      // its own colour, weak face on and strong at a glancing angle (Fresnel, for wax of index 1.5), and
      // narrower along the leaf than across it (wheat leaves: roughness 0.18 along the veins, 0.46 across).
      const halfway = normalize(uSun.add(V));
      const offFace = max(abs(dot(face, halfway)), float(0.03));
      // (A leaf only a pixel or two broad in the picture cannot show a narrow shine: all the ways its
      // face turns across that pixel, and from one frame to the next as it sways, are in the one pixel, so
      // the shine there is the same light spread over them all: broader and as much fainter. A narrow
      // shine on such a leaf is a white spark that comes and goes: a field of them twinkles.)
      const broadInPicture = clamp(leafWidth.mul(2).div(max(dist.mul(uPixel), float(1e-6))).div(SHINE_FULL_PIXELS), float(0), float(1));
      const roughAlong = mix(float(0.6), float(0.18), broadInPicture);
      const roughAcross = mix(float(0.8), float(0.46), broadInPicture);
      const along = dot(runAll, halfway).div(roughAlong);
      const across = dot(side, halfway).div(roughAcross);
      const lobe = exp(along.mul(along).add(across.mul(across)).div(offFace.mul(offFace)).negate()).mul(float(0.18 * 0.46).div(roughAlong.mul(roughAcross)));
      const glance = float(0.04).add(float(0.96).mul(pow(clamp(float(1).sub(dot(V, halfway)), float(0), float(1)), float(5))));
      const gloss = min(lobe.mul(glance).mul(1.6), float(LEAF_SHINE_MOST)).mul(sheenAmt).mul(gPos.y).mul(float(1).sub(calm));
      // (In place of the sun off its face, not on top of it: a leaf seen from its far side shows the light
      // through it and not the light it sends back the other way. Added together a back-lit leaf was twice
      // as bright as any leaf is, and a picture that blooms what is bright made a lamp of it.)
      leafCol = mix(plain.mul(turned).mul(own), colLit.mul(vec3(1.25, 1.4, 0.05)), through.mul(0.7)).add(vec3(1, 1, 1).mul(dot(uSunTint, vec3(0.3, 0.5, 0.2))).mul(gloss));
    } else {
      // (A tuft's foot is less dark than a leaf's root: tufts stand a hand apart, with nothing in front
      // to hide their feet as a sward's own leaves hide its roots, and a field of dark feet is a dark band
      // between the leaves and the ground beyond.)
      const plain = mix(colLit.mul(mix(rootShade, float(1), 0.6)), colLit.mul(mix(vec3(1), tipTint, 0.6)).mul(leafTone), pow(gPos.y, float(0.8)));
      // Light through the leaf, towards the sun.
      const backSun = pow(max(dot(V.negate(), uSun), float(0)), float(3));
      const litGate = clamp(dot(colLit, vec3(0.3, 0.5, 0.2)).mul(2.8), float(0.28), float(1.0));
      // (The leaf's own colour without its blue, as what comes through a leaf is: white light added to a tip is frost on a far field.)
      const back = plain.add(plain.mul(vec3(1.25, 1.4, 0.05)).mul(backSun).mul(0.6).mul(gPos.y).mul(gPos.y).mul(litGate));
      // A leaf is folded along its rib: one half takes the light and the
      // other turns from it. And it is waxy: where it bends over towards the
      // sun's reflection it catches the light, most at the arch near its tip.
      const leafUp = normalize(vec3(lean2.x.mul(bendPow).mul(-1.2), float(1), lean2.y.mul(bendPow).mul(-1.2)).add(vec3(toCam.x, 0, toCam.y).mul(0.35)));
      const sheen = pow(max(dot(leafUp, normalize(uSun.add(V))), float(0)), float(14)).mul(gPos.y).mul(litGate).mul(sheenAmt).mul(float(1).sub(flat));
      const fold = float(1);
      // (A gust shows in the tuft itself: laid over, its leaves meet the sun more squarely or less, and are
      // that much lighter or darker, most at their tips and not at all where the tufts give way to the ground.)
      const laidFace = normalize(vec3(lean2.x.negate(), float(1), lean2.y.negate()));
      const laidLit = float(1).add(clamp(dot(laidFace, uSun).sub(uSun.y).mul(LAID_LIT), float(-LAID_LIT_MOST), float(LAID_LIT_MOST)).mul(gPos.y).mul(float(1).sub(toGround)).mul(float(1).sub(flat)));
      const near = back.mul(fold).mul(laidLit).add(uSunTint.mul(sheen).mul(0.06));
      // (The ground a stand in seed gives way to is paler for its heads: see `groundColor`.)
      leafCol = mix(near, colLit.mul(mix(rootIs, float(1), STAND_MEAN)).mul(mix(vec3(1), vec3(seedTint.x, seedTint.y, seedTint.z), seed.mul(0.5))), toGround);
    }
    // Some leaves are dead: straw, the lighter for standing among green.
    const isDry = step(hashCell(hcell.add(b.mul(9.7).add(63.0))), deadShare).mul(float(1).sub(toGround)).mul(float(1).sub(flat));
    // (Straw is its own colour, not the leaf's green gone grey: a grey leaf among green ones looks pink.
    // It is lit as the leaf it was would be: by how bright that leaf is beside its species' own colour.)
    const lum = vec3(0.3, 0.5, 0.2);
    const lightOnIt = dot(colLit, lum).div(max(dot(vec3(baseCol.x, baseCol.y, baseCol.z), lum), float(1e-3)));
    const straw = vec3(STRAW.r, STRAW.g, STRAW.b).mul(lightOnIt).mul(mix(rootShade, float(1), gPos.y));
    // A seed head is pale against its stalk.
    const head = smoothstep(float(0.42), float(0.82), gPos.y).mul(seed).mul(float(1).sub(toGround)).mul(float(1).sub(cutout));
    // (A tuft's blade stands for several leaves and is as much broader: its head is paled less, or the tufts are a pale band beyond the leaves.)
    // A cut end dies back: a day or two after mowing the last couple of millimetres of a leaf are straw,
    // the more of the leaves the more the mower tore them (`cutTip`). Only the end, and only on leaves the
    // mower reached: the leaf below it is as green as it was.
    const frayed = step(hashCell(hcell.add(b.mul(13.3).add(29.0))), row(k, 11).z).mul(mown).mul(step(cutAt, float(0.999)).add(isSquare).min(1));
    // (The very end, and a little of it below: the leaf's own green gone yellow, not another colour laid on it.)
    const cutEnd = isTip.add(isTopJoint.mul(0.3)).mul(frayed).mul(float(1).sub(toGround)).mul(float(1).sub(flat));
    const cutCol = leafCol.mul(vec3(1.55, 1.32, 0.5)).mul(mix(float(0.9), float(1.15), rh));
    const sunlit = mix(mix(mix(leafCol, cutCol, cutEnd.mul(0.85)), straw, isDry), colLit.mul(vec3(seedTint.x, seedTint.y, seedTint.z)), head.mul(fine ? 0.85 : 0.4));
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
    // (Across a stem: its edges at 0 and 1 and, on a strip made to fold, its rib in the middle.)
    const u = mix(mix(gPos.x.mul(0.5).add(0.5), edge.mul(0.5).add(0.5), cutout), edge.mul(float(1).sub(onRib)).mul(0.5).add(0.5), stem);
    const shows = picture.y.mul(o.field ? float(1).sub(smoothstep(float(3), float(9), dist)) : float(1));
    // What the picture's colour is set against: mid grey (a picture of detail) or the species' own colour (a picture of the leaf).
    // (A dead leaf has lost the species' colour: its picture is set against that colour's grey, and stays straw.)
    const ownCol = vec3(baseCol.x, baseCol.y, baseCol.z);
    const against = mix(vec3(0.2140), mix(ownCol, vec3(dot(ownCol, vec3(0.3, 0.5, 0.2))), isDry), picture.z);
    // How much of the strip drawn is leaf: a leaf thinner than the pixel it was widened to is that much see-through.
    const cover = fine && o.field ? clamp(leafWidth.div(seen), float(0.5), float(1)) : float(1);
    // What is drawn on the leaf itself, pixel by pixel, when it is broad enough in the picture to show it
    // (see `leafMaterial`): how many pixels broad it is there, and how far its face is turned side-on to the sun.
    const pixelsBroad = o.field ? width.mul(2).div(max(dist.mul(uPixel), float(1e-6))).mul(float(1).sub(flat)).mul(float(1).sub(uFromSun)) : float(40).mul(float(1).sub(flat));
    // (Nothing brighter than light itself, and never not a number: one such leaf in a picture that blooms what is bright is a lamp.)
    const inAir = o.field && options.world?.air ? options.world.air(col, worldPos) : col;
    const colSafe = min(max(inAir, vec3(0)), vec3(LEAF_BRIGHT_MOST));
    return { pos: worldPos, col: colSafe, cover, uv: vec4(u, gPos.y, max(picture.x, float(0)), shows), against: vec4(against, cutout), surface: vec4(pixelsBroad, dot(side, uSun), stem, stripBroader) };
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
    // A leaf's own surface, drawn pixel by pixel across it: nothing of it shows on a leaf a few pixels
    // broad, and from an ankle's height a leaf without it is a strip of green paper.
    //  - its two halves, which fold up from the rib and so take the sun differently, one lit and one not;
    //  - the rib itself, a dark groove down the middle;
    //  - its edges, which turn away and are thin;
    //  - its veins, which in a grass run side by side from root to tip (and need the leaf broader still).
    const vSurface = varying(out.surface, `vGrassSurface${name}`);
    // (On a strip drawn broader for a stem's flowers, the stem is the strip's middle: across it, in the stem's own breadths.)
    const onStem = vUv.x.sub(0.5).mul(vSurface.w);
    const across = clamp(onStem, float(-0.5), float(0.5));
    const outTo = abs(across).mul(2);
    // The flowers: a tuft of small brown flowers that seems to sit on the stem's side, a hand below its tip
    // (what goes on above it is a bract, which looks like more stem). A lumpy oval, its inner end on the stem.
    // (`onStem` runs half a breadth to either side over the stem, and half of `FLOWER_OUT` to the strip's edge.)
    const tuftAcross = onStem.sub(FLOWER_OUT * 0.25 + 0.15).div(FLOWER_OUT * 0.25 - 0.15);
    const tuftAlong = vUv.y.sub(FLOWER_AT).div(FLOWER_TALL * 0.5);
    const lumps = sin(tuftAlong.mul(7.3).add(tuftAcross.mul(4.1))).mul(sin(tuftAcross.mul(9.7).sub(tuftAlong.mul(3.3)))).mul(0.3);
    const inTuft = step(tuftAcross.mul(tuftAcross).add(tuftAlong.mul(tuftAlong)).add(lumps), float(1)).mul(step(float(1.5), vSurface.w));
    const onTheStem = step(abs(onStem), float(0.5));
    const shown = smoothstep(float(LEAF_DETAIL_FROM_PX), float(LEAF_DETAIL_FROM_PX * 2.5), vSurface.x);
    const veinsShown = smoothstep(float(LEAF_VEINS_FROM_PX), float(LEAF_VEINS_FROM_PX * 2), vSurface.x);
    const halves = sign(across).mul(vSurface.y).mul(smoothstep(float(0.02), float(0.12), abs(across))).mul(LEAF_HALVES);
    const rib = exp(across.mul(across).div(LEAF_RIB_WIDE * LEAF_RIB_WIDE).negate()).mul(LEAF_RIB);
    const rim = outTo.mul(outTo).mul(outTo).mul(LEAF_RIM);
    const veins = cos(vUv.x.mul(6.2832 * LEAF_VEINS)).mul(0.5).add(0.5).mul(LEAF_VEIN);
    const leafSurface = float(1).add(halves.sub(rib).sub(rim).mul(shown)).sub(veins.mul(veinsShown));
    // (A stem is a cylinder: lighter on the side the sun is, and darker out at both edges, which are turned away.)
    const stemSurface = float(1).add(across.mul(2).mul(vSurface.y).mul(STEM_ROUND).sub(outTo.mul(outTo).mul(STEM_ROUND)).mul(shown));
    const surface = mix(leafSurface, stemSurface, vSurface.z);
    // (No brighter than the host allows, `look.brightest`: by its brightest channel, so a leaf held back keeps its colour.)
    const flowerCol = vec3(0.95, 0.55, 0.3).mul(float(1).add(lumps.mul(0.9)));
    const drawn = vCol.mul(mix(vec3(surface), flowerCol, inTuft)).mul(mix(vec3(1), min(vec3(texel.x, texel.y, texel.z).div(vec3(vAgainst.x, vAgainst.y, vAgainst.z)), vec3(4)), vUv.w));
    mat.colorNode = vec4(drawn.mul(min(float(1), uBrightest.div(max(max(drawn.x, drawn.y), max(drawn.z, float(1e-4)))))), 1);
    mat.maskNode = vAgainst.w.lessThan(0.5).or(texel.w.greaterThan(0.5)).and(onTheStem.add(inTuft).greaterThan(0.5));
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

    /** Where plant `instanceIndex` grows: its cell of the square, scattered within it (placement.ts). */
    const place = (idx: THREE.Node<"uint"> | THREE.Node<"float">) => placeInSquare(idx, L.count, L.spacing, uFocus, fine);

    const compute = Fn(() => {
      const { cell, hcell, r0, xz } = place(instanceIndex);
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
        // (Most of a stand of stems is drawn however thin they are in the picture: a stem to the knee is seen as a
        // line long after it is too thin to be seen as a breadth, and from above a marsh without them is its bare floor.)
        const viewShare0 = (fine ? leavesAt(fromThick(xz), L.range).mul(max(leafSeen(row(k, 1).x.add(row(k, 1).y.mul(0.5)), dist), row(k, 12).y.mul(STEMS_SEEN_LEAST))) : pow(clamp(float(1).sub(fadeDist.sub(L.range * 0.12).div(L.range * 0.88)), float(0), float(1)), float(0.85)))
          .mul(mix(float(1), mix(float(0.74), float(1), chaosThick), disorder))
          .mul(float(1).sub(uStyle.x.mul(0.6)))
          .mul(uAmount)
          // (Fewer seen from higher up, each broader: see `HEIGHT_THIN_FROM_M`.)
          .mul(heightShare());
        const viewShare = viewShare0.mul(uGate);
        // (A density up to 1 is the share of plants that grow; above it every plant grows, with more leaves: see `leaf`.)
        const below = (L as NearLayer).below ?? 0;
        const shortEnough = below > 0 ? float(1).sub(smoothstep(float(below * 0.6), float(below), tall0)) : float(1);
        const keepShare = viewShare.mul(min(density, float(1))).mul(shortEnough);
        // (Kept by the cell's rank, not a coin of its own: whatever the share, those kept are evenly spread. A
        // tuft square keeps fewer further off, and fewer still from high up; those left are drawn broader.)
        const rank = ranks.rankOf(cell);
        const tuftShare = tuftKept(dist, L.range).mul(min(density, float(1)));
        const thin = step(rank, fine ? keepShare : tuftShare);

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
        // (A tall stand's tufts also stand wherever few of its leaves are drawn: off to the side of where
        // the leaves are thickest, or where they are too thin in the picture, which on a small picture or
        // from above is nearer than the leaves' reach. Short grass there is its ground's colour and nothing
        // is missed, but a stand to the knee is a shape, and without it there is bare ground between the
        // last leaves and the first tufts.)
        const unmown = float(1).sub(step(float(0.5), row(k, 2).x));
        const tuftsForUnseen = max(smoothstep(float(TUFTS_FOR_UNSEEN_FROM_M), float(TUFTS_FOR_UNSEEN_FROM_M * 2.5), tall0), unmown.mul(smoothstep(float(UNMOWN_TUFTS_FROM_M), float(UNMOWN_TUFTS_FROM_M * 2), tall0)));
        const leavesUnseen = fine ? float(0) : float(1).sub(leavesLeft(xz, row(k, 1).x.add(row(k, 1).y.mul(0.5)))).mul(tuftsForUnseen);
        const layerOn = fine ? float(1) : tufted.mul(max(smoothstep(uLeafReach.mul(0.45), uLeafReach, dist), leavesUnseen)).mul(smoothstep(float(0.9), float(1.5), dist));
        const grow = alive.mul(rooted).mul(rangeFade).mul(thin).mul(layerOn);

        const tallNode = tall0.toVar();
        // (The grass in a patch is its own height.)
        const patchHere = inPatch(xz, k, here.edge).toVar();
        tallNode.mulAssign(mix(float(1), row(k, 8).w, patchHere));
        // Beside shorter grass, or bare ground, a stand comes down to meet it over a stride (by the canopy's
        // picture, which is the mean of the two at their line): never up, so mown turf beside rough stays
        // mown to its edge, and what is left at the line is a step half the height it was.
        // (Not stems: a rush at its stand's edge is as tall as any other, and stands over the grass beside it.)
        tallNode.mulAssign(mix(clamp(canopyAt(xz).div(max(tall0, float(1e-4))), float(0.3), float(1)), float(1), max(smoothstep(float(0), row(k, 11).y.mul(0.9).add(EDGE_RAMP_M), here.edge), row(k, 12).y)));
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
        const { best: clumpBest, id: clumpId, out: clumpOut } = nearestClump(xz, k);
        // (The fine leaves take the clumps at half strength, so they agree with the tufts beyond them.)
        const clumped = clumpAmt.mul(fine ? 0.5 : 1);
        const clumpTall = mix(float(0.74), float(1.16), hash21(clumpId.add(3.7))).mul(mix(float(1.08), float(0.85), smoothstep(float(0.05), float(0.6), clumpBest)));
        const clumpTone = hash21(clumpId.add(71.1)).sub(0.5);
        tallNode.mulAssign(mix(float(1), clumpTall, clumped));
        const base = vec3(baseCol.x, baseCol.y, baseCol.z).mul(vec3(1).add(vec3(0.22, 0.12, -0.07).mul(clumpTone).mul(clumped)));
        // Tussocks (`Species.tussock`): the plant grows only within some way of its clump's centre, with
        // open ground beyond: the further, the smaller the tussocks; some broad and some small, and the
        // odd one missing. (In squared shares of the way between clumps, as `clumpBest` is.)
        const inTussock = tussockOf(clumpBest, clumpId, k, here.edge.add(chA.b.sub(0.5).mul(fringeM * 0.3)), chB.r.sub(0.5).mul(0.05));
        tallNode.mulAssign(inTussock);

        // (The tufts thin with distance, and those left are drawn broader.)
        // (The tufts' thinning with distance is in `thin`, by rank.)
        const lodKeep = float(1);
        const pressed = fine ? pressedAt(xz) : vec4(0, 0, 1, 0);
        const tall = (fine ? amongThings(tallNode.mul(float(0.78).add(r0.mul(0.3))).mul(grow).mul(lodKeep), xz, gy, hashCell(hcell.add(57.3))) : tallNode.mul(float(0.78).add(r0.mul(0.3))).mul(grow).mul(lodKeep)).mul(pressed.z);

        // Gusts: wind does not arrive as even waves. A field of stronger and
        // weaker air, broad patches with smaller ones inside, travels downwind
        // at about the wind's own pace, and the grass lies down as each crosses it.
        const wDir = normalize(vec2(uWind.x, uWind.y).add(vec2(1e-4, 0)));
        const windy = clamp(uWind.z.div(8.0), float(0), float(1.7));
        const gustAt = xz.sub(vec2(uGust.x, uGust.y));
        const gustBroad = noise(gustAt.div(61.0)).r;
        const gustSmall = noise(gustAt.mul(1.35).div(19.0).add(0.43)).g;
        // (A flutter on the gusts: plants that stand together flutter nearly together, as they swing.)
        const flutter = sin(uPhase.z.add(sin(xz.x.mul(1.9).add(xz.y.mul(1.1))).mul(1.4)).add(sin(xz.y.mul(2.3).sub(xz.x.mul(0.7))).mul(1.2)).add(r0.sub(0.5).mul(SWING_OWN_RAD * 2))).mul(0.06);
        const gust = clamp(smoothstep(float(0.3), float(0.72), gustBroad.mul(0.68).add(gustSmall.mul(0.32))).add(flutter), float(0), float(1));
        // (The air's slow turning about, which is there in any wind and not in none.)
        const swirl = vec2(cos(uPhase.w.add(xz.x.mul(0.28))), sin(uGust.z.add(xz.y.mul(0.25)))).mul(0.06).mul(smoothstep(float(0), float(1.5), uWind.z));
        // Wind moves what stands tall enough to be moved, and is not too stiff.
        const windTakes = smoothstep(float(0.075), float(0.17), tall0).mul(float(1).sub(stiffness)).mul(1.4);
        const lay = layAt(xz, k);
        const lean = wDir.mul(windy.mul(float(0.1).add(gust.mul(0.42)))).add(swirl).mul(windTakes)
          .add(clumpOut.mul(0.22).mul(clumped))
          .add(fine ? vec2(cos(chaosTurn), sin(chaosTurn)).mul(disorder.mul(0.24)) : vec2(0, 0))
          // (A leaf the roller went over leans the way it went.)
          .add(lay.mul(LAY_LEAN))
          // (And over the way whatever went through it, or stirred it, pushed it.)
          .add(vec2(pressed.x, pressed.y));

        // (What of the sky it sees is worked out half way up it, and is in its colour; the sun at its root and at its tip go with it, for the leaf to shade between.)
        const colLit = tone(xz, base).mul(mix(float(1), float(TRAIL_WIPED_TINT), pressed.w)).mul(siteTint(xz)).mul(mix(vec3(1), vec3(row(k, 10).x, row(k, 10).y, row(k, 10).z), patchHere)).mul(strainTint(xz, k)).mul(scorchTint(xz, k, here.edge)).mul(light(ground.normal)).mul(laidShade(xz, lay)).mul(skyOpen(xz, tall0.mul(STAND_SUN)));
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
      if (disposed) return;
      // And again, each leaf painted by how high it is there: the pile's relief.
      mat.colorNode = vec4(vec3(clamp(positionWorld.y.div(s.height * PILE_TALL), float(0), float(1))), 1);
      mat.needsUpdate = true;
      scene.background = new THREE.Color(0, 0, 0);
      renderer.setRenderTarget(target);
      renderer.render(scene, above);
      renderer.setRenderTarget(before);
      const tall = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, GROUND_SIZE, GROUND_SIZE)) as Uint8Array;
      if (disposed) return;
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

  // Flowers (`Species.blooms`): two squares of places a flower could stand, following the eye as the
  // leaves' squares do. Near the eye a flower is its petals, each a small curved surface about the stem's
  // tip, its centre and its stalk; further off it is a dot of its colour, no smaller than most of a pixel.
  // Which places have one, and which flower, is worked out from the place's own number: nothing is kept
  // from one frame to the next. A compute pass works each place out once a frame (whether it has a
  // flower, where its head is, which way it faces) and the drawing reads it, a vertex at a time.
  const BLOOM_NEAR = { count: 96, spacing: 0.11, ahead: 1.5 };
  const BLOOM_FAR = { count: 192, spacing: 0.16, ahead: 8 };
  /** Metres from the eye over which petals give way to dots, and where the dots end. */
  const BLOOM_PETALS_TO = [4.0, 5.0];
  const BLOOM_DOTS_TO = [15, 19];
  /** A place's number for its species and flower: the flower's row and the species' row times this. */
  const BLOOM_KEY = 32;
  /**
   * Where a flower grows (`Flower.colony`), as plants of open grassland do: in colonies, a plant's runners
   * or its own seed about where it took, clumped round a centre and thinning out from it (as a Thomas
   * cluster process has them); the colonies only where the ground suits that flower, which over tens of
   * metres is some ground and not other; and a few strays between colonies, from seed carried further.
   * So most of a stand's ground has none of a flower, some has it thick, and the edge of each is ragged.
   *
   * `COLONY_APART`: how far apart (in colony radii) the centres could stand, where every place for one
   * held one. `COLONY_SHARE`: the share of the ground within a radius of a centre if all did (pi over
   * the square of `COLONY_APART`): a flower's `cover` over it is how many do. `HABITAT_M`: the breadth of
   * the ground that suits a flower or does not. `STRAYS`: how thick the strays are, as a share of a
   * colony's heart. `SHELTER_FROM`, `SHELTER_TO`: the shelter (`WorldLight.shelter`) from which a meadow
   * flower begins to give way, and by which it has gone.
   */
  const COLONY_APART = 3.2;
  const COLONY_SHARE = Math.PI / (COLONY_APART * COLONY_APART);
  const HABITAT_M = 34;
  const STRAYS = 0.035;
  /**
   * A flower's own plant: its heads come up together from one rosette or one stretch of runner, a hand or
   * two across (as a plant creeps 1 to 27 cm a year: `Flower.colony`). The ground is squared off this
   * broad (m) and a share of its squares (`PLANT_SHARE`) hold a plant, the flowers of those that do
   * standing as thick as all would have.
   */
  const PLANT_M = 0.26;
  const PLANT_SHARE = 0.4;
  /**
   * How a flower's flowering falls with the light it goes without (`WorldLight.shelter`): by this for each
   * tenth of the open's light lost, as meadow herbs at a forest's edge (the chance of one flowering fell
   * 21 and 35 per cent a tenth at two sites, Celis et al. 2019); and none below its least light
   * (`Flower.light`).
   */
  const FLOWERING_PER_TENTH = 0.72;
  /**
   * How thick a flower stands at a place for its colonies, 0.. (1 the heart of a middling colony): the
   * nearest of the colonies about it, each kept if it suits (`kept`, by the ground at its own centre),
   * its own size and its own thickness, plus the strays. Within a shader function (`Fn`).
   */
  const colonyAt = (xz: Vec2, radius: THREE.Node<"float">, kept: (centre: Vec2) => THREE.Node<"float">, salt: number): THREE.Node<"float"> => {
    const cellM = radius.mul(COLONY_APART);
    const g = xz.div(cellM);
    const home = floor(g);
    const thick = float(0).toVar();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cell = home.add(vec2(dx, dz));
        const hc = mod(cell, float(4096)).add(vec2(salt * 0.731, salt * 0.317));
        // (Somewhere in its square, not on its edge; most small and a few large; some thick, some thin.)
        const centre = cell.add(vec2(hash21(hc.add(1.3)), hash21(hc.add(7.9))).mul(0.7).add(0.15)).mul(cellM);
        const reach = radius.mul(exp(hash21(hc.add(4.1)).sub(0.5).mul(1.3)));
        const heart = mix(float(0.55), float(1.45), hash21(hc.add(9.7)));
        const there = step(hash21(hc.add(2.9)), kept(centre));
        const d2 = dot(xz.sub(centre), xz.sub(centre)).div(reach.mul(reach));
        thick.assign(max(thick, heart.mul(exp(d2.mul(-1.6))).mul(there)));
      }
    }
    return thick;
  };
  /**
   * A square of places for flowers, and the pass that works them out. `from` and `to`: the distances from the
   * eye (m) between which the square's flowers are drawn at all; a place outside them is not worked out.
   */
  const bloomSites = (L: { count: number; spacing: number; ahead: number }, from: number, to: number) => {
    const total = L.count * L.count;
    // What the pass leaves for each flower: its root and which flower it is (`BLOOM_KEY`), its head and its own
    // luck, the way its head faces and how tall it stands.
    const rootAttr = new THREE.StorageInstancedBufferAttribute(total, 4);
    const headAttr = new THREE.StorageInstancedBufferAttribute(total, 4);
    const upAttr = new THREE.StorageInstancedBufferAttribute(total, 4);
    const rootStore = storage(rootAttr, "vec4", total);
    const headStore = storage(headAttr, "vec4", total);
    const upStore = storage(upAttr, "vec4", total);
    // Few places hold a flower (well under one in fifty). As the leaves' squares do (`makeLayer`), the pass
    // writes each flower into the next free place in the buffers and counts them into the draw's own
    // arguments, so the draw is of the flowers alone and an empty place costs no vertex. (Four storage
    // buffers of its own, and the host's heights: a shader stage is sure of only eight.)
    /** indexCount (set by `attach`), instanceCount, firstIndex, baseVertex, firstInstance. */
    const drawArgs = new THREE.IndirectStorageBufferAttribute(new Uint32Array([0, 0, 0, 0, 0]), 5);
    const drawStore = storage(drawArgs, "uint", 5).toAtomic();
    const reset = Fn(() => {
      atomicStore(drawStore.element(1), uint(0));
    })().compute(1);
    const compute = Fn(() => {
      const idx = float(instanceIndex);
      const gx = mod(idx, float(L.count));
      const gz = floor(idx.div(float(L.count)));
      const middle = vec2(uCamPos.x, uCamPos.z).add(uCamFwd.mul(L.ahead));
      const cell = floor(middle.div(L.spacing)).add(vec2(gx, gz)).sub(L.count * 0.5);
      const hcell = mod(cell, float(1024)).add(vec2(L.count * 0.37, L.count * 0.11));
      const r0 = hashCell(hcell);
      const r1 = hashCell(hcell.add(31.7));
      const xz = cell.add(vec2(r0, r1)).mul(L.spacing);
      const here = map.sample(xz);
      const k = int(min(here.species, float(MAX_SPECIES - 1)));
      const ids = row(k, 13);
      const outRoot = vec4(0, 0, 0, -1).toVar();
      const outHead = vec4(0, 0, 0, 0).toVar();
      const outUp = vec4(0, 1, 0, 0).toVar();
      // Most places cannot have a flower, and are found out before the colonies are looked for, which is most
      // of the work: those of no grass or of a species that has no flowers, at the stand's very edge, and those
      // further off than the square's flowers are drawn (by the ground's distance first, which is never more
      // than the eye's; then by the eye's own, for the far dots' near end too). And those behind the eye by
      // more than a flower can reach (`uBloomReach`), which no part of a flower there can be seen from.
      const mayFlower = here.species.lessThanEqual(float(MAX_SPECIES - 0.5))
        .and(max(max(ids.x, ids.y), max(ids.z, ids.w)).greaterThan(-0.5))
        .and(here.edge.greaterThanEqual(0.12))
        .and(length(xz.sub(vec2(uCamPos.x, uCamPos.z))).lessThan(to));
      If(mayFlower, () => {
        const ground = height.sample(xz);
        const root = vec3(xz.x, ground.height, xz.y);
        const away = distance(root, uCamPos);
        const inSight = away.lessThan(to).and(away.greaterThan(from)).and(dot(root.sub(uCamPos), uCamLook).greaterThan(uBloomReach.negate()));
        If(inSight, () => {
          const luck = hashCell(hcell.add(57.1));
          const perM2 = row(k, 14);
          const cover = row(k, 15);
          const site = row(k, 16);
          const inPatches = row(k, 17);
          // Each of the species' flowers in colonies of its own (`colonyAt`), where the ground suits it: by a
          // slow noise of its own (some ground and not other), by the lie of the ground (`Bloom.site`), and out
          // of the trees' shade (`WorldLight.shelter`). Or in the species' patches.
          const world = options.world;
          const open = (at: Vec2, least: THREE.Node<"float">) => {
            if (!world?.shelter) return float(1);
            const lit = float(1).sub(clamp(world.shelter(at), float(0), float(1)));
            return pow(float(FLOWERING_PER_TENTH), float(1).sub(lit).mul(10)).mul(smoothstep(least.sub(0.05), least.add(0.05), lit));
          };
          // (Its plants: the place's square, the squares a little warped so they do not line up.)
          const plantWarp = noise(xz.div(1.3).add(0.19));
          const plantCell = floor(xz.add(vec2(plantWarp.r, plantWarp.b).sub(0.5).mul(PLANT_M)).div(PLANT_M));
          const habitat = (at: Vec2, j: number) => {
            const n = noise(at.div(HABITAT_M).add(vec2(0.13 + j * 0.29, 0.61 - j * 0.17)));
            return smoothstep(float(0.36), float(0.64), [n.r, n.g, n.b, n.a][j]);
          };
          const patched = smoothstep(float(0.35), float(0.65), inPatch(xz, k));
          // (On the species' tussocks: a tussock grass's flowering stems rise from its tussocks, not the open ground.)
          const clump = nearestClump(xz, k);
          const onTussock = step(float(0.5), tussockOf(clump.best, clump.id, k, here.edge, float(0)));
          const pick = hashCell(hcell.add(91.7));
          const chosen = float(-1).toVar();
          const upTo = float(0).toVar();
          for (let j = 0; j < MAX_BLOOMS; j++) {
            const at = (v: Vec4) => [v.x, v.y, v.z, v.w][j];
            // (How many of the places for a colony hold one: its cover over the share all of them would take, twice
            // that where the ground suits it, as about half of it does; more on the ground's lie it likes.)
            const fRow = int(max(at(ids), float(0)));
            const radius = frow(fRow, 2).w;
            const least = frow(fRow, 4).x;
            const suits = (centre: Vec2) => clamp(at(cover).div(COLONY_SHARE).mul(2).mul(float(1).add(at(site).mul(dryAt(centre)).mul(1.8))), float(0), float(1)).mul(habitat(centre, j)).mul(open(centre, least));
            const aPlant = step(hash21(mod(plantCell, float(4096)).add(vec2(3.7 + j * 1.9, 8.3 - j * 2.3))), float(PLANT_SHARE)).div(PLANT_SHARE);
            const thick = colonyAt(xz, radius, suits, 11 + j * 17).add(habitat(xz, j).mul(STRAYS)).mul(open(xz, least)).mul(aPlant);
            // (`where`: 0 in colonies, 1 in the patches, 2 in colonies on the tussocks.)
            const inDrifts = thick.mul(step(float(1e-3), at(cover)));
            const inDrift = mix(mix(inDrifts, patched, step(float(0.5), at(inPatches))), inDrifts.mul(onTussock), step(float(1.5), at(inPatches)));
            // (A place has one flower at most: each flower takes its own share of the places, one after another.)
            upTo.addAssign(at(perM2).mul(L.spacing * L.spacing).mul(inDrift).mul(uAmount).mul(step(float(-0.5), at(ids))));
            chosen.assign(chosen.lessThan(0).and(pick.lessThan(upTo)).select(at(ids), chosen));
          }
          const alive = step(here.species, float(MAX_SPECIES - 0.5)).mul(step(float(0), chosen)).mul(step(float(0.12), here.edge));
          const f = int(max(chosen, float(0)));
          // How tall it stands: its own height, some more and some less; and in grass as tall as it or taller,
          // drawn up towards the light by as much as two fifths again, and no more: a short flower in long
          // grass stands down among the leaves, half seen or not at all, as it does.
          const own = frow(f, 1).y.mul(mix(float(0.8), float(1.25), luck));
          const tall = own.mul(float(1).add(smoothstep(float(0.5), float(1.5), row(k, 0).x.div(max(own, float(1e-3)))).mul(0.4)));
          // The wind: it nods downwind, further in a gust, and swings a little about that.
          const wDir = normalize(vec2(uWind.x, uWind.y).add(vec2(1e-4, 0)));
          const gustAt = xz.sub(vec2(uGust.x, uGust.y));
          const gust = smoothstep(float(0.3), float(0.72), noise(gustAt.div(61.0)).r);
          const swing = sin(uPhase.y.add(luck.mul(6.2832)).sub(dot(xz, wDir).mul(3.2)));
          const nod = wDir.mul(clamp(uWind.z.div(8), float(0), float(1.7)).mul(float(0.22).add(gust.mul(0.5))).add(swing.mul(0.1).mul(min(uWind.z.div(4), float(1))))).mul(tall).mul(0.4);
          const head = root.add(vec3(nod.x, tall, nod.y));
          // (The head faces up the stalk, each tipped a little its own way.)
          const tip = vec2(hashCell(hcell.add(13.9)), hashCell(hcell.add(71.3))).sub(0.5).mul(0.5);
          const up = normalize(vec3(nod.x.div(tall).add(tip.x), float(1), nod.y.div(tall).add(tip.y)));
          const key = mix(float(-1), float(f).add(float(k).mul(BLOOM_KEY)), alive);
          outRoot.assign(vec4(root, key));
          outHead.assign(vec4(head, luck));
          outUp.assign(vec4(up, tall));
        });
      });
      If(outRoot.w.greaterThan(-0.5), () => {
        const slot = atomicAdd(drawStore.element(1), uint(1));
        rootStore.element(slot).assign(outRoot);
        headStore.element(slot).assign(outHead);
        upStore.element(slot).assign(outUp);
      });
    })().compute(total);
    /** The flower as the drawing has it, from what the pass left. */
    const read = () => {
      const a = attribute("aBloomRoot", "vec4") as unknown as Vec4;
      const b = attribute("aBloomHead", "vec4") as unknown as Vec4;
      const c = attribute("aBloomUp", "vec4") as unknown as Vec4;
      const root = vec3(a.x, a.y, a.z);
      const kf = floor(max(a.w, float(0)).div(BLOOM_KEY));
      const k = int(kf);
      const f = int(max(a.w, float(0)).sub(kf.mul(BLOOM_KEY)));
      return { xz: vec2(a.x, a.z), root, head: vec3(b.x, b.y, b.z), up: vec3(c.x, c.y, c.z), tall: c.w, luck: b.w, k, f, alive: step(float(-0.5), a.w), away: distance(root, uCamPos) };
    };
    /** Draw `geo` once for each flower the pass found. */
    const attach = (geo: THREE.InstancedBufferGeometry) => {
      geo.setAttribute("aBloomRoot", rootAttr);
      geo.setAttribute("aBloomHead", headAttr);
      geo.setAttribute("aBloomUp", upAttr);
      geo.instanceCount = total;
      (drawArgs.array as Uint32Array)[0] = geo.index!.count;
      geo.setIndirect(drawArgs);
    };
    return { compute, reset, read, attach, drawArgs, attrs: [rootAttr, headAttr, upAttr, drawArgs] };
  };
  /**
   * A flower's colour as it is lit there, into the host's air, and no brighter than leaves may be. Its head
   * takes the host's light (`world.light`); its stalk, green as a leaf is, the grass's tint (`stalk` 1).
   */
  const bloomLit = (col: Vec3, xz: Vec2, at: Vec3, up: THREE.Node<"float">, facing: Vec3, stalk: THREE.Node<"float"> = float(0)): Vec3 => {
    const lit = col.mul(light(facing)).mul(mix(inShade(), vec3(1), sunReach(xz, up)));
    const world = options.world;
    const tinted = world?.light && world?.tint ? lit.mul(mix(world.light(xz), world.tint(xz), stalk)) : world?.light ? lit.mul(world.light(xz)) : world?.tint ? lit.mul(world.tint(xz)) : lit;
    const inAir = world?.air ? world.air(tinted, at) : tinted;
    return inAir.mul(min(float(1), uBrightest.div(max(max(inAir.x, inAir.y), max(inAir.z, float(1e-4))))));
  };
  const hidden = vec3(0, -9999, 0);
  // (The petals are gone by the end of their fade; the dots are not drawn before it begins, nor past theirs.)
  const nearSites = bloomSites(BLOOM_NEAR, 0, BLOOM_PETALS_TO[1]);
  const farSites = bloomSites(BLOOM_FAR, BLOOM_PETALS_TO[0], BLOOM_DOTS_TO[1]);
  const makeBlooms = () => {
    // Near: `position` is (across, along, which petal), `uv.x` which part: 0 a petal, 1 the centre, 2 the stalk.
    const pos: number[] = [];
    const part: number[] = [];
    const index: number[] = [];
    for (let slot = 0; slot < MAX_PETALS; slot++) {
      const v0 = pos.length / 3;
      for (const along of [0, 0.55, 1]) for (const across of [-1, 1]) { pos.push(across, along, slot); part.push(0, 0); }
      index.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4, v0 + 3, v0 + 5, v0 + 4);
    }
    // (The centre: its top, a ring a third of the way down, and its foot's ring: a dome, a knob or a spike's core.)
    const c0 = pos.length / 3;
    pos.push(0, 0, 0);
    part.push(1, 0);
    for (const along of [CENTRE_SHOULDER, 1]) for (let i = 0; i < 8; i++) { pos.push(Math.cos((i / 8) * Math.PI * 2), along, Math.sin((i / 8) * Math.PI * 2)); part.push(1, 0); }
    for (let i = 0; i < 8; i++) index.push(c0, c0 + 1 + i, c0 + 1 + ((i + 1) % 8));
    for (let i = 0; i < 8; i++) {
      const a = c0 + 1 + i;
      const b = c0 + 1 + ((i + 1) % 8);
      index.push(a, a + 8, b, b, a + 8, b + 8);
    }
    const s0 = pos.length / 3;
    for (const along of [0, 0.5, 1]) for (const across of [-1, 1]) { pos.push(across, along, 0); part.push(2, 0); }
    index.push(s0, s0 + 1, s0 + 2, s0 + 1, s0 + 3, s0 + 2, s0 + 2, s0 + 3, s0 + 4, s0 + 3, s0 + 5, s0 + 4);
    const nearGeo = new THREE.InstancedBufferGeometry();
    nearGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    nearGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(part), 2));
    nearGeo.setIndex(index);
    nearSites.attach(nearGeo);

    const near = (() => {
      const site = nearSites.read();
      const g = positionGeometry;
      const isCentre = step(float(0.5), uv().x).mul(step(uv().x, float(1.5)));
      const isStalk = step(float(1.5), uv().x);
      const shape = frow(site.f, 0);
      const kind = frow(site.f, 1);
      const petals = kind.x;
      // Its form (`Flower.form`): 0 a disc, 1 a spike, 2 an umbel, 3 a bell; and a spike's length or an umbel's breadth.
      const isSpike = step(abs(kind.z.sub(1)), float(0.5));
      const isUmbel = step(abs(kind.z.sub(2)), float(0.5));
      const isBell = step(abs(kind.z.sub(3)), float(0.5));
      const span = kind.w;
      // (Smaller as they give way to the dots, and gone where the dots have taken over.)
      const size = float(1).sub(smoothstep(float(BLOOM_PETALS_TO[0]), float(BLOOM_PETALS_TO[1]), site.away));
      // Which way the head faces: up its stalk, or for a bell, hanging from the stalk's top, out to its own side.
      const hang = normalize(vec3(cos(site.luck.mul(6.2832)).mul(0.9), float(-1), sin(site.luck.mul(6.2832)).mul(0.9)));
      const up = normalize(mix(site.up, hang, isBell));
      const axisX = normalize(cross(up, vec3(0, 0, 1)));
      const axisZ = cross(axisX, up);
      const slot = g.z;
      const along = g.y;
      const own = hashCell(vec2(slot.mul(7.13), site.luck.mul(91.7)));
      // A disc's (and a bell's) petal: out from the centre's rim along its own way, rising as it goes (hanging,
      // if its lift is below nothing), broadest past its middle.
      const angle = slot.add(site.luck).add(own.sub(0.5).mul(0.35)).div(petals).mul(6.2832);
      const out = vec2(cos(angle), sin(angle));
      const reach = shape.w.mul(0.4).add(along.mul(shape.x).mul(mix(float(0.86), float(1.1), own)));
      const broad = shape.y.mul(0.5).mul(mix(float(0.4), float(1), smoothstep(float(0), float(0.55), along))).mul(mix(float(1), float(0.45), smoothstep(float(0.55), float(1), along)));
      // (A flat flower's petals lie out; a ball's curl up and over, so the head is as tall as it is broad.)
      const turnUp = shape.z.mul(1.5708).mul(mix(float(0.85), float(1.2), own));
      const outBy = shape.w.mul(0.4).add(reach.sub(shape.w.mul(0.4)).mul(cos(turnUp.mul(along))));
      const upBy = reach.sub(shape.w.mul(0.4)).mul(sin(turnUp.mul(along))).add(own.sub(0.5).mul(shape.x).mul(0.12).mul(along));
      const flat = out.mul(outBy).add(vec2(out.y.negate(), out.x).mul(g.x).mul(broad));
      const discAt = axisX.mul(flat.x).add(axisZ.mul(flat.y)).add(up.mul(upBy));
      // A spike's or an umbel's floret: one of `petals`, placed by the golden angle so none line up. Up the
      // spike from its foot to its tip, round its core; or over the umbel's top, more of them to its edge and
      // its edge a little lower. Each is a small petal pointing out, raised as far as `lift` says.
      // (Kept in 0..1: the centre's and stalk's vertices carry other numbers where a petal has its slot, and a
      // root of less than nothing is not a number, which a mix by nought does not take away.)
      const t = clamp(slot.add(0.5).div(petals), float(0), float(1));
      const fAngle = slot.mul(2.39996).add(site.luck.mul(6.2832));
      const fOut = axisX.mul(cos(fAngle)).add(axisZ.mul(sin(fAngle)));
      const fSide = axisX.mul(sin(fAngle).negate()).add(axisZ.mul(cos(fAngle)));
      const spikeFoot = up.mul(t.mul(span)).add(fOut.mul(shape.w.mul(0.5)));
      const umbelFoot = fOut.mul(t.sqrt().mul(span)).add(up.mul(float(1).sub(t).mul(span).mul(0.3).add(shape.x.mul(0.2))));
      const fRise = clamp(shape.z, float(0), float(1)).mul(1.5708).mul(mix(float(0.8), float(1.2), own));
      const floretAt = mix(spikeFoot, umbelFoot, isUmbel)
        .add(fOut.mul(cos(fRise)).add(up.mul(sin(fRise))).mul(along.mul(shape.x)))
        .add(fSide.mul(g.x).mul(broad));
      const florets = max(isSpike, isUmbel);
      const petalAt = site.head.add(mix(discAt, floretAt, florets).mul(size));
      // The centre: a low dome, or a knob under the petals (`centreTall`); a spike's core, from its foot to its
      // tip; an umbel has none.
      const rim = shape.w.mul(0.5);
      const centreTall = frow(site.f, 3).w;
      // (A dome is round in profile: its shoulder ring most of its breadth, at two thirds of its height. A spike's
      // core is a blunt cylinder: full breadth from the shoulder down.)
      const domeR = float(1).sub(float(1).sub(along).mul(float(1).sub(along))).sqrt();
      const coreR = min(along.div(CENTRE_SHOULDER), float(1));
      // (An umbel's centre is its body: the many florets too small to draw one by one, a low dome as broad as the head.)
      const centreR = mix(rim.mul(mix(domeR, coreR, isSpike)), span.mul(domeR), isUmbel);
      const domeUp = float(1).sub(along).mul(rim).mul(mix(float(0.45), float(2.2), centreTall)).add(shape.x.mul(max(shape.z, float(0))).mul(0.2)).sub(rim.mul(1.3).mul(centreTall));
      const coreUp = min(float(1).sub(along).div(1 - CENTRE_SHOULDER), float(1)).mul(span).add(rim.mul(0.8).mul(float(1).sub(coreR)));
      const umbelUp = float(1).sub(along).mul(span).mul(0.3);
      const centreAt = site.head.add(axisX.mul(g.x.mul(centreR)).add(axisZ.mul(g.z.mul(centreR))).add(up.mul(mix(mix(domeUp, coreUp, isSpike), umbelUp, isUmbel))).mul(size));
      // The stalk: a thread from the ground to the head, bowed the way the head nods.
      const toEye = normalize(cameraPosition.sub(site.root));
      const side = normalize(cross(toEye, vec3(0, 1, 0)));
      const stalkAt = mix(site.root, site.head, along).add(vec3(0, 1, 0).mul(site.tall.mul(0.06).mul(sin(along.mul(3.1416))))).add(side.mul(g.x).mul(0.0006).mul(float(1).add(site.away.mul(0.6))));
      const gone = site.alive.mul(size).lessThan(0.02).or(isCentre.add(isStalk).lessThan(0.5).and(slot.greaterThanEqual(petals.sub(0.5))));
      const at = gone.select(hidden, isStalk.greaterThan(0.5).select(stalkAt, isCentre.greaterThan(0.5).select(centreAt, petalAt)));
      const petalCol = vec3(frow(site.f, 2).x, frow(site.f, 2).y, frow(site.f, 2).z).mul(mix(float(0.78), float(1.04), along)).mul(mix(float(0.93), float(1.05), own));
      const centreCol = vec3(frow(site.f, 3).x, frow(site.f, 3).y, frow(site.f, 3).z).mul(mix(float(1.08), float(0.8), along));
      const stalkCol = vec3(row(site.k, 4).x, row(site.k, 4).y, row(site.k, 4).z).mul(mix(float(0.55), float(0.95), along));
      const petalFacing = mix(up.add(axisX.mul(out.x).add(axisZ.mul(out.y)).mul(shape.z.mul(along))), up.add(fOut.mul(0.6)), florets);
      const facing = normalize(mix(petalFacing, up, max(isCentre, isStalk)));
      const col = bloomLit(mix(mix(petalCol, centreCol, isCentre), stalkCol, isStalk), site.xz, at, site.tall, facing, isStalk);
      const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      mat.positionNode = at;
      mat.colorNode = vec4(varying(col, "vBloomCol"), 1);
      const mesh = new THREE.Mesh(nearGeo, mat);
      mesh.name = "grass-BloomNear";
      mesh.frustumCulled = false;
      return { mesh, mat };
    })();

    // Far: a dot to a flower, turned to the eye, of the flower's own breadth or most of a pixel.
    const farGeo = new THREE.InstancedBufferGeometry();
    farGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
    farGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    farGeo.setIndex([0, 1, 2, 1, 3, 2]);
    farSites.attach(farGeo);
    const far = (() => {
      const site = farSites.read();
      const g = positionGeometry;
      const shape = frow(site.f, 0);
      const shows = smoothstep(float(BLOOM_PETALS_TO[0]), float(BLOOM_PETALS_TO[1]), site.away).mul(float(1).sub(smoothstep(float(BLOOM_DOTS_TO[0]), float(BLOOM_DOTS_TO[1]), site.away)));
      // Its outline, as half a breadth across and half a height up: a disc's round; a spike tall and thin (its
      // core and florets across, its length up, standing on the stalk's top); an umbel broad and low.
      const farKind = frow(site.f, 1);
      const isSpikeF = step(abs(farKind.z.sub(1)), float(0.5));
      const isUmbelF = step(abs(farKind.z.sub(2)), float(0.5));
      const discOwn = shape.x.mul(mix(float(1), float(0.55), clamp(shape.z, float(0), float(1)))).add(shape.w.mul(0.4)).mul(0.85);
      const ownW = mix(mix(discOwn, shape.w.mul(0.5).add(shape.x.mul(0.6)), isSpikeF), farKind.w.add(shape.x.mul(0.5)), isUmbelF);
      const ownH = mix(mix(discOwn, farKind.w.mul(0.5), isSpikeF), farKind.w.mul(0.35).add(shape.x.mul(0.5)), isUmbelF);
      const least = site.away.mul(uPixel).mul(0.6);
      const drawnW = max(ownW, least);
      const drawnH = max(ownH, least);
      const toEye = normalize(cameraPosition.sub(site.head));
      const side = normalize(cross(vec3(0, 1, 0), toEye));
      const upOn = cross(toEye, side);
      const middle = site.head.add(site.up.mul(farKind.w.mul(0.5).mul(isSpikeF)));
      const at = site.alive.mul(shows).lessThan(0.02).select(hidden, middle.add(side.mul(g.x.mul(drawnW)).add(upOn.mul(g.y.mul(drawnH)))));
      const own = ownW.mul(ownH).sqrt();
      const drawn = drawnW.mul(drawnH).sqrt();
      // (Mostly its petals' colour, a little of its centre's; and a dot drawn larger than the flower is as much fainter, toward the grass it stands in.)
      const flowerCol = mix(vec3(frow(site.f, 2).x, frow(site.f, 2).y, frow(site.f, 2).z), vec3(frow(site.f, 3).x, frow(site.f, 3).y, frow(site.f, 3).z), 0.16);
      const grassCol = vec3(row(site.k, 4).x, row(site.k, 4).y, row(site.k, 4).z);
      const strength = clamp(own.div(drawn), float(0), float(1));
      const col = bloomLit(mix(grassCol, flowerCol, mix(float(0.18), float(1), strength.mul(strength)).mul(shows)), site.xz, at, site.tall, site.up);
      const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      mat.positionNode = at;
      mat.colorNode = vec4(varying(col, "vBloomDotCol"), 1);
      const round = uv().sub(0.5).mul(2);
      mat.maskNode = dot(round, round).lessThan(1);
      const mesh = new THREE.Mesh(farGeo, mat);
      mesh.name = "grass-BloomFar";
      mesh.frustumCulled = false;
      return { mesh, mat };
    })();
    geometries.push(nearGeo, farGeo);
    materials.push(near.mat, far.mat);
    group.add(near.mesh, far.mesh);
    return [near.mesh, far.mesh];
  };
  const bloomMeshes = makeBlooms();
  const stats = { plants: all.reduce((n, l) => n + l.total, 0), leaves: all.reduce((n, l) => n + l.leaves, 0), computed: 0, flowers: BLOOM_NEAR.count * BLOOM_NEAR.count + BLOOM_FAR.count * BLOOM_FAR.count, flowersDrawn: 0 };
  const look = { clumpSize: 0.85, macro: 0.3, edgeWobble: 0.03, groundShade: 1, stripes: 1, shadow: 0.6, occlusion: 0.45, fold: 1, relief: 1, leafPixels: 1, depth: 0.5, mown: false, site: 0.5, leafShadows: true, brightest: 4, wet: 0, blooms: true, amount: 1, strains: 0.5, drought: 0, bare };
  const fwd = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const shadowAt = new THREE.Vector3();
  const shadowRight = new THREE.Vector3();
  const shadowUp = new THREE.Vector3();
  let shadowTurn = 0;
  let shadowSkip = 0;
  const bufferSize = new THREE.Vector2();

  return {
    object: group,
    environment: { sun: uSun.value, sunTint: uSunTint.value, shadeTint: uShadeTint.value, wind: uWind.value },
    style,
    look,
    setTrail(points) {
      const n = Math.min(points.length, MAX_TRAIL);
      for (let i = 0; i < n; i++) (trail.array[i] as THREE.Vector4).set(points[i].x, points[i].z, points[i].radius, points[i].at);
      uTrailCount.value = n;
    },
    setStir(stir) {
      if (stir) uStir.value.set(stir.x, stir.z, stir.dx, stir.dz);
      else uStir.value.set(0, 0, 0, 0);
    },
    setThings(list) {
      for (let i = 0; i < MAX_THINGS; i++) {
        const t = list[i];
        if (t) {
          // (A flat place has no sphere: its radius is kept apart, and what is done about a sphere finds none.)
          thingAt[i].value.set(t.x, t.y, t.z, t.flat ? 0 : Math.max(0, t.radius));
          thingHow[i].value.set(t.flat ? 0 : Math.max(0, t.clear ?? 0), t.flat ? 0 : t.keepSeen === true ? 0.5 : Math.min(1, Math.max(0, t.keepSeen || 0)), t.flat ? Math.max(0, t.radius) : 0, 0);
        } else {
          thingAt[i].value.set(0, -9999, 0, 0);
          thingHow[i].value.set(0, 0, 0, 0);
        }
      }
    },
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
      let flowers = 0;
      if (bloomMeshes[0].visible) for (const sites of [nearSites, farSites]) flowers += new Uint32Array(await renderer.getArrayBufferAsync(sites.drawArgs))[1];
      stats.flowersDrawn = flowers;
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
      uCamLook.value.copy(fwd);
      const f = uCamFwd.value;
      uCamPos.value.copy(eye);
      // (A perspective camera's projection has 1 / tan(half its field of view) at [5].)
      renderer.getDrawingBufferSize(bufferSize);
      uPixel.value = 2 / Math.max(1e-3, camera.projectionMatrix.elements[5]) / Math.max(1, bufferSize.y);
      // The wind's running totals: what it has done since the last frame, at the pace it blows now.
      const dt = lastTimeS === null ? 0 : Math.min(0.25, Math.max(0, timeS - lastTimeS));
      lastTimeS = timeS;
      const w = uWind.value;
      const wLen = Math.hypot(w.x, w.y) || 1;
      const travel = (GUST_PACE + GUST_PACE_PER_MS * w.z) * dt;
      const g = uGust.value;
      g.x = (((g.x + (w.x / wLen) * travel) % GUST_REPEAT_M) + GUST_REPEAT_M) % GUST_REPEAT_M;
      g.y = (((g.y + (w.y / wLen) * travel) % GUST_REPEAT_M) + GUST_REPEAT_M) % GUST_REPEAT_M;
      const turn = (phase: number, rate: number) => (phase + rate * dt) % (Math.PI * 2);
      g.z = turn(g.z, 1.05);
      const ph = uPhase.value;
      ph.set(turn(ph.x, 1.3 + 0.22 * w.z), turn(ph.y, 2.1 + 0.2 * w.z), turn(ph.z, 2.3), turn(ph.w, 1.2));
      uTime.value = timeS;
      // The grass's memory: its window about the eye, what each cell keeps of the last frame, and where
      // anything can be stamped in this one.
      uTrackOrigin.value.set(Math.floor(eye.x / TRACK_CELL_M) - TRACK_SIDE / 2, Math.floor(eye.z / TRACK_CELL_M) - TRACK_SIDE / 2);
      const wetNow = Math.min(1, Math.max(0, look.wet));
      const upAfterS = TRAIL_UP_DRY_S + (TRAIL_UP_WET_S - TRAIL_UP_DRY_S) * wetNow;
      // (Mostly back by `upAfterS`, as the trail's own spring is; the wiped wet over `TRAIL_WIPED_S`.)
      uTrackFade.value.set(Math.exp((-3 * dt) / upAfterS), Math.exp((-3 * dt) / TRAIL_WIPED_S));
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      const take = (x: number, z: number, r: number) => {
        box[0] = Math.min(box[0], x - r);
        box[1] = Math.min(box[1], z - r);
        box[2] = Math.max(box[2], x + r);
        box[3] = Math.max(box[3], z + r);
      };
      const n = uTrailCount.value;
      for (let i = 0; i < n; i++) {
        const q = trail.array[i] as THREE.Vector4;
        if (timeS - q.w <= TRAIL_WIPED_S && q.z > 0) take(q.x, q.y, Math.max(q.z, 0.038) * 2 + TRACK_CELL_M);
      }
      // (A track between two points runs across the box of both, which the points' own boxes cover.)
      for (let i = 0; i < MAX_THINGS; i++) if (thingHow[i].value.z > 0) take(thingAt[i].value.x, thingAt[i].value.z, thingHow[i].value.z * 1.1 + TRACK_CELL_M);
      if (box[0] <= box[2]) uTrackBox.value.set(box[0], box[1], box[2], box[3]);
      else uTrackBox.value.set(1, 1, 0, 0);
      uSun.value.normalize();
      uStyle.value.set(style.broad, style.flat);
      uLook.value.set(Math.max(0.05, look.clumpSize), look.macro, look.edgeWobble, look.groundShade);
      uStripes.value = look.stripes;
      uMown.value = look.mown ? 1 : 0;
      uSite.value = look.site;
      uBrightest.value = look.brightest;
      uWet.value = Math.min(1, Math.max(0, look.wet));
      uStrains.value = Math.min(1, Math.max(0, look.strains));
      uDrought.value = Math.min(1, Math.max(0, look.drought));
      for (const m of bloomMeshes) m.visible = look.blooms && anyBlooms;
      uAmount.value = Math.min(1, Math.max(0.05, look.amount));
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
      if (lookAt?.focus) uThickAt.value.set(lookAt.x, lookAt.y ?? eye.y - uEyeUp.value, lookAt.z, 0);
      else uThickAt.value.set(eye.x, eye.y, eye.z, uEyeUp.value);
      // Each square of fine leaves stands about the eye, a little ahead of it (`LEAF_AHEAD`), and is there at
      // all only if the eye is near enough the ground for any of its leaves to be within its reach.
      // (The nearest ground in the picture: where the bottom of the picture meets the ground, for a camera
      // that looks out over level ground from its height. Nearer than that there is ground, under the eye and
      // behind the picture's edge, and no leaf on it is seen: a camera a man's height up that looks ahead
      // has no ground in its picture for three strides, and a square of leaves that reaches two has none
      // in it. Looking straight down, or with no such camera, it is the ground under the eye.)
      const fovHalf = Math.atan(1 / Math.max(1e-3, camera.projectionMatrix.elements[5]));
      const down = Math.asin(Math.min(1, Math.max(-1, -fwd.y))) + fovHalf;
      const nearestSeen = down <= 0.02 ? Infinity : uEyeUp.value / Math.sin(Math.min(Math.PI / 2, down));
      for (const l of all) {
        if (!l.fine) continue;
        if (lookAt?.focus) {
          l.uFocus.value.set(lookAt.x, lookAt.z);
          l.uGate.value = 1;
        } else {
          l.uFocus.value.set(eye.x + f.x * l.range * LEAF_AHEAD, eye.z + f.y * l.range * LEAF_AHEAD);
          l.uGate.value = nearestSeen < l.range * LEAF_REACH * SEEN_MARGIN ? 1 : 0;
        }
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
      stats.computed = all.reduce((n, l) => n + (l.mesh.visible ? l.total : 0), 0);
      const passes = [trackPass, ...all.filter((l) => l.mesh.visible).flatMap((l) => [l.reset, l.compute])];
      if (bloomMeshes[0].visible) passes.push(nearSites.reset, nearSites.compute, farSites.reset, farSites.compute);
      if (passes.length > 0) renderer.compute(passes);
      // The leaves' shadows: the squares nearest the eye, drawn from the sun.
      if (look.leafShadows && shown.leaves && uSun.value.y > 0.05 && shadowSkip++ % 2 === 1) {
        // (A frame that draws none keeps the one before: leaves move little in a sixtieth of a second.)
      } else if (look.leafShadows && shown.leaves && uSun.value.y > 0.05) {
        const write = shadowTurn % 2;
        const read = 1 - write;
        for (const n of shadowNodes) n.value = shadowTargets[read].depthTexture!;
        uSunMat.value.copy(shadowMats[read]);
        uReversedDepth.value = renderer.reversedDepthBuffer ? 1 : 0;
        uShadowOn.value = shadowTurn > 0 ? 1 : 0;
        shadowAt.set(eye.x + f.x * SHADOW_HALF_M * 0.7, eye.y - uEyeUp.value, eye.z + f.y * SHADOW_HALF_M * 0.7);
        // (By whole pixels of the picture: moved by part of one, every shadow's edge shifts as the eye does.)
        shadowRight.set(0, uSun.value.y > 0.95 ? 0 : 1, uSun.value.y > 0.95 ? 1 : 0).cross(uSun.value).normalize();
        shadowUp.copy(uSun.value).cross(shadowRight).normalize();
        const texel = (2 * SHADOW_HALF_M) / SHADOW_SIZE;
        const offRight = shadowAt.dot(shadowRight);
        const offUp = shadowAt.dot(shadowUp);
        shadowAt.addScaledVector(shadowRight, Math.round(offRight / texel) * texel - offRight).addScaledVector(shadowUp, Math.round(offUp / texel) * texel - offUp);
        sunCam.position.copy(shadowAt).addScaledVector(uSun.value, SHADOW_DEEP_M * 0.5);
        sunCam.up.set(0, uSun.value.y > 0.95 ? 0 : 1, uSun.value.y > 0.95 ? 1 : 0);
        sunCam.lookAt(shadowAt);
        sunCam.updateMatrixWorld();
        // (Flowers cast no shadow on the leaves: they are not in the sun's picture.)
        for (const m of bloomMeshes) m.visible = false;
        const were = all.map((l) => l.mesh.visible);
        for (const l of all) l.mesh.visible = l.mesh.visible && l.fine && l.range < SHADOW_NEAR_RANGE_M;
        const before = renderer.getRenderTarget();
        renderer.setRenderTarget(shadowTargets[write]);
        uFromSun.value = 1;
        renderer.render(group, sunCam);
        uFromSun.value = 0;
        renderer.setRenderTarget(before);
        all.forEach((l, i) => (l.mesh.visible = were[i]));
        for (const m of bloomMeshes) m.visible = look.blooms && anyBlooms;
        shadowMats[write].multiplyMatrices(sunCam.projectionMatrix, sunCam.matrixWorldInverse);
        shadowTurn++;
      } else {
        uShadowOn.value = 0;
        shadowTurn = 0;
      }
    },
    show: shown,
    groundColor,
    groundShade,
    light,
    stats,
    dispose() {
      // The compute passes own pipelines and bind groups in the renderer: none is freed unless disposed by name.
      for (const l of all) {
        l.compute.dispose();
        l.reset.dispose();
      }
      for (const l of all) for (const a of l.attrs) a.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      disposed = true;
      if (ownNoise) noiseTex.dispose();
      leafTex.dispose();
      groundTex.dispose();
      ranks.dispose();
      // (The trample grid's buffer is the renderer's until disposed: emptying its array frees nothing on the card.)
      trackPass.dispose();
      trackAttr.dispose();
      for (const t of shadowTargets) {
        t.depthTexture?.dispose();
        t.dispose();
      }
      for (const sites of [nearSites, farSites]) {
        sites.compute.dispose();
        sites.reset.dispose();
        for (const a of sites.attrs) a.dispose();
      }
      if (canopyQuad) (canopyQuad.material as THREE.Material).dispose();
      canopyTarget?.dispose();
    },
  };
}
