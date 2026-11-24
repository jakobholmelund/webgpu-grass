// The lab's gallery: scenes, each the whole of what the lab can be set to
// (the species, what grows on the plot, where the eye is, the light, the
// wind, the mowing, the style), so one press shows what the package does.
// Plain data: a host can read a scene as it reads a preset.
//
// The first eight are a golf course's surfaces, short to tall, one to a scene.

import { MORE_PLANTS, MORE_TURF, type Species, TURF_SPECIES, cloneSpecies } from "../src/index";

export interface Scene {
  id: string;
  title: string;
  /** One line under the title: what to look at. */
  blurb: string;
  species: Species[];
  /** The species (its row) that fills the plot, or -1 for the mixed plot. */
  plot: number;
  /** The species the inspector opens on. */
  row: number;
  /** "The plot", or what stands on the bench: "One blade", "One plant", "One tuft", "One clump". */
  show?: string;
  view: { x: number; z: number; eye: number; yaw: number; pitch: number; fov: number };
  /** Sun heading and height (degrees). */
  sun: [number, number];
  /** Wind heading (degrees) and speed (m/s). */
  wind: [number, number];
  /** Mown in stripes: the pass width (m) and its heading (degrees). */
  mow?: [number, number];
  style?: { broad: number; flat: number };
  /** A golf ball in the grass, `ahead` metres in front of the eye: its lie (the share of it, 0..1, standing above the grass), and the share of it the grass before it is kept clear of. */
  ball?: { ahead: number; showing: number; uncover: number };
  look?: Partial<{ clumpSize: number; macro: number; edgeWobble: number; groundShade: number; shadow: number; occlusion: number }>;
}

const turf = (change?: (list: Species[]) => void): Species[] => {
  const list = cloneSpecies(TURF_SPECIES);
  change?.(list);
  return list;
};
const GREEN = 0;
const COLLAR = 1;
const FAIRWAY = 2;
const FIRST_CUT = 3;
const ROUGH = 4;
const DEEP_ROUGH = 5;
const FESCUE = 6;
const MEADOW = 7;
/** Looking across the plot's bands from the green outward, towards the meadow (+x) or the fescue (-x). */
const TO_MEADOW = -Math.PI / 2;
const TO_FESCUE = Math.PI / 2;

export const SCENES: Scene[] = [
  {
    id: "green-at-dawn",
    title: "The green",
    blurb: "Creeping bent at a putting green's height of cut, a low sun raking across it, seen from where a ball lies.",
    species: turf(),
    plot: GREEN, row: GREEN,
    view: { x: 2, z: 16, eye: 0.3, yaw: 0.3, pitch: -0.12, fov: 44 },
    sun: [80, 9], wind: [70, 1],
  },
  {
    id: "the-collar",
    title: "The collar",
    blurb: "Green, collar, fairway, running away to the right: three heights of cut, each mown to a line, under a low sun that shows the steps. They are a few millimetres and the mower made them.",
    species: turf(),
    plot: -1, row: COLLAR,
    view: { x: 3.4, z: 1, eye: 0.4, yaw: TO_MEADOW + 0.75, pitch: -0.2, fov: 46 },
    sun: [20, 16], wind: [70, 2],
  },
  {
    id: "striped-fairway",
    title: "The fairway, mown in stripes",
    blurb: "Perennial rye laid one way and back by the mower. Nothing is painted: the stripes are how leaves lying towards you and away from you take the light. Walk round them.",
    species: turf(),
    plot: FAIRWAY, row: FAIRWAY,
    view: { x: 2, z: 30, eye: 6, yaw: 0.15, pitch: -0.3, fov: 50 },
    sun: [215, 38], wind: [70, 2], mow: [2.8, 8],
  },
  {
    id: "the-first-cut",
    title: "The first cut",
    blurb: "A mower's width of semi-rough between the fairway and the rough: fairway, first cut, rough, each a step up.",
    species: turf(),
    plot: -1, row: FIRST_CUT,
    view: { x: 9.2, z: 2, eye: 0.22, yaw: TO_MEADOW + 0.2, pitch: -0.08, fov: 48 },
    sun: [200, 30], wind: [70, 3],
  },
  {
    id: "the-rough",
    title: "The rough",
    blurb: "Rye and bluegrass kept long enough that a ball sits down in it. Clover has come in where nobody sprays.",
    species: turf(),
    plot: ROUGH, row: ROUGH,
    view: { x: 14, z: -6, eye: 0.3, yaw: -0.9, pitch: -0.1, fov: 48 },
    sun: [140, 40], wind: [90, 3.5],
  },
  {
    id: "deep-rough",
    title: "Deep rough",
    blurb: "Red fescue cut once or twice a year: fine, limp and laid over by its own weight.",
    species: turf(),
    plot: DEEP_ROUGH, row: DEEP_ROUGH,
    view: { x: -6, z: 12, eye: 0.45, yaw: 0.8, pitch: -0.08, fov: 48 },
    sun: [240, 26], wind: [200, 4.5],
  },
  {
    id: "links-in-seed",
    title: "Fescue in seed",
    blurb: "Never mown: thin and wispy, gone to straw and seed, with an evening wind going through it.",
    species: turf(),
    plot: FESCUE, row: FESCUE,
    view: { x: 12, z: 8, eye: 0.7, yaw: 1.1, pitch: -0.05, fov: 46 },
    sun: [285, 12], wind: [250, 7],
  },
  {
    id: "hay-meadow",
    title: "A hay meadow",
    blurb: "Knee-deep and uncut. Walk into it (W) and look back at the sun through the leaves.",
    species: turf(),
    plot: MEADOW, row: MEADOW,
    view: { x: -20, z: 6, eye: 1.0, yaw: 2.2, pitch: -0.04, fov: 52 },
    sun: [130, 20], wind: [200, 5],
  },
  {
    id: "mown-and-natural",
    title: "A mown edge and a natural one",
    blurb: "Rough is mown to a line. Beyond it the deep rough and the fescue are nobody's, and run into each other in tongues and single plants.",
    species: turf(),
    plot: -1, row: DEEP_ROUGH,
    view: { x: -15.5, z: 2, eye: 1.1, yaw: TO_FESCUE - 0.2, pitch: -0.16, fov: 52 },
    sun: [160, 34], wind: [250, 4],
  },
  {
    id: "ball-in-the-rough",
    title: "A ball in the rough",
    blurb: "A ball with 47% of it showing: held up by the grass, the leaves under it pressed down, none through it, and a lane kept open so you can see how it sits. Its lie is on the right, under Scene.",
    species: turf(),
    plot: ROUGH, row: ROUGH,
    view: { x: 14, z: -6, eye: 0.22, yaw: -0.9, pitch: -0.4, fov: 36 },
    sun: [140, 40], wind: [90, 3.5],
    ball: { ahead: 0.45, showing: 0.47, uncover: 0.55 },
  },
  {
    id: "from-above",
    title: "The whole plot from above",
    blurb: "Fourteen metres up: no leaves are drawn from here, and the ground carries every surface's colour and its patches.",
    species: turf(),
    plot: -1, row: GREEN,
    view: { x: 2, z: 14, eye: 14, yaw: 0.25, pitch: -1.0, fov: 55 },
    sun: [240, 40], wind: [70, 3],
  },
  {
    id: "bermuda-at-noon",
    title: "A bermuda fairway at midday",
    blurb: "A warm-season fairway under a high sun: short, stiff, pointed leaves, and hardly a shadow.",
    species: turf((list) => {
      list[FAIRWAY] = cloneSpecies([MORE_TURF.bermuda])[0];
    }),
    plot: FAIRWAY, row: FAIRWAY,
    view: { x: -2, z: 12, eye: 0.22, yaw: -0.2, pitch: -0.1, fov: 46 },
    sun: [180, 74], wind: [120, 2.5],
  },
  {
    id: "a-dry-summer",
    title: "A dry summer",
    blurb: "A lawn after six weeks without rain: straw, with the green left where the ground holds water.",
    species: turf((list) => {
      list[ROUGH] = { ...cloneSpecies([MORE_TURF.bluegrass])[0], name: "Parched lawn", dry: 0.22, color: "#a8974c", tipTint: [1.12, 1.04, 0.8], density: 0.8, height: 0.05, sheen: 0.1, rootShade: 0.55, variation: 0.3, patchKind: "blotches", patchSite: -1, patch: 0.4, patchSize: 1.4, patchTint: [0.58, 1.0, 0.66], patchTall: 1.15 };
    }),
    plot: ROUGH, row: ROUGH,
    view: { x: -4, z: -12, eye: 0.35, yaw: 2.6, pitch: -0.14, fov: 48 },
    sun: [200, 58], wind: [30, 2],
  },
  {
    id: "rushes",
    title: "Soft rush",
    blurb: "A marsh's plant, not a grass: no leaves, only round stiff stems, in tussocks with open ground between and last year's dead stems among the green.",
    species: turf((list) => {
      list[MEADOW] = cloneSpecies([MORE_PLANTS.rush])[0];
    }),
    plot: MEADOW, row: MEADOW,
    view: { x: -20, z: 6, eye: 1.7, yaw: 2.2, pitch: -0.32, fov: 52 },
    sun: [130, 24], wind: [200, 4],
  },
  {
    id: "daisies",
    title: "Daisies in the rough",
    blurb: "The rough's own flower, here thick on the ground (it comes in thin drifts as the rough is made): petals within a few strides of the eye, dots of their colour beyond.",
    species: turf((list) => {
      Object.assign(list[ROUGH], { bloomCover: 0.75, bloomPerM2: 30 });
    }),
    plot: ROUGH, row: ROUGH,
    view: { x: 14, z: -6, eye: 0.32, yaw: -0.9, pitch: -0.36, fov: 42 },
    sun: [150, 42], wind: [90, 3],
  },
  {
    id: "storybook",
    title: "Storybook",
    blurb: "The same rough with the style turned up: fewer, broader leaves and flat shading. Photographic to drawn is two sliders.",
    species: turf((list) => {
      Object.assign(list[ROUGH], { color: "#57a845", patch: 0 });
    }),
    plot: ROUGH, row: ROUGH,
    view: { x: 14, z: -6, eye: 0.7, yaw: -0.9, pitch: -0.12, fov: 50 },
    sun: [140, 46], wind: [90, 4],
    style: { broad: 0.85, flat: 0.9 }, look: { macro: 0.55, clumpSize: 1.4 },
  },
  {
    id: "one-plant",
    title: "One plant on the bench",
    blurb: "Every field is this, a few hundred thousand times. Drag to turn it; change its species on the right.",
    species: turf(),
    plot: -1, row: ROUGH, show: "One clump",
    view: { x: 10.6, z: 21, eye: 0.5, yaw: 0.36, pitch: -0.13, fov: 50 },
    sun: [300, 32], wind: [70, 2],
  },
];
