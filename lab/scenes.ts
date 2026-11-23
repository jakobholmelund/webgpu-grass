// The lab's gallery: ten scenes, each the whole of what the lab can be set to
// (the species, what grows on the plot, where the eye is, the light, the
// wind, the mowing, the style), so one press shows what the package does.
// Plain data: a host can read a scene as it reads a preset.

import { type Species, TURF_SPECIES, cloneSpecies } from "../src/index";

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
  /** Pass width (m), heading (degrees) and how strongly the stripes show (0..0.4). */
  mow?: [number, number, number];
  style?: { broad: number; flat: number };
  look?: Partial<{ clumpSize: number; macro: number; edgeWobble: number; groundShade: number; shadow: number; occlusion: number }>;
}

const turf = (change?: (list: Species[]) => void): Species[] => {
  const list = cloneSpecies(TURF_SPECIES);
  change?.(list);
  return list;
};
const BENT = 0;
const RYE = 1;
const RYE_ROUGH = 2;
const RED_FESCUE = 3;
const SEED_FESCUE = 4;
const MEADOW = 5;
const BERMUDA = 6;
const BLUEGRASS = 7;

export const SCENES: Scene[] = [
  {
    id: "green-at-dawn",
    title: "A green at first light",
    blurb: "Creeping bent cut to 3.5 mm, a low sun raking across it, seen from where a ball lies.",
    species: turf(),
    plot: BENT, row: BENT,
    view: { x: 2, z: 16, eye: 0.3, yaw: 0.3, pitch: -0.12, fov: 44 },
    sun: [80, 9], wind: [70, 1],
  },
  {
    id: "striped-fairway",
    title: "A striped fairway",
    blurb: "Perennial rye at 13 mm, laid one way and back by the mower: the stripes are the leaves' lean, not paint.",
    species: turf(),
    plot: RYE, row: RYE,
    view: { x: 2, z: 30, eye: 1.7, yaw: 0.15, pitch: -0.2, fov: 50 },
    sun: [215, 38], wind: [70, 2], mow: [2.8, 8, 0.28],
  },
  {
    id: "bermuda-at-noon",
    title: "Bermuda at midday",
    blurb: "A warm-season fairway under a high sun: short, stiff, pointed leaves, and hardly a shadow.",
    species: turf(),
    plot: BERMUDA, row: BERMUDA,
    view: { x: -2, z: 12, eye: 0.22, yaw: -0.2, pitch: -0.1, fov: 46 },
    sun: [180, 74], wind: [120, 2.5],
  },
  {
    id: "links-in-seed",
    title: "Links fescue in seed",
    blurb: "Thin and wispy, gone to straw and seed, with an evening wind going through it.",
    species: turf(),
    plot: SEED_FESCUE, row: SEED_FESCUE,
    view: { x: 12, z: 8, eye: 0.6, yaw: 1.1, pitch: -0.05, fov: 46 },
    sun: [285, 12], wind: [250, 7],
  },
  {
    id: "hay-meadow",
    title: "A hay meadow in a breeze",
    blurb: "Knee-deep and uncut. Walk into it (W) and look back at the sun through the leaves.",
    species: turf(),
    plot: MEADOW, row: MEADOW,
    view: { x: -20, z: 6, eye: 0.9, yaw: 2.2, pitch: -0.04, fov: 52 },
    sun: [130, 20], wind: [200, 5],
  },
  {
    id: "the-edge-of-the-rough",
    title: "Where the fairway meets the rough",
    blurb: "Eight grasses on one plot, short to tall, each growing right up to its neighbour, shadow and all.",
    species: turf(),
    plot: -1, row: RYE_ROUGH,
    view: { x: 3.5, z: 2, eye: 0.6, yaw: -1.25, pitch: -0.1, fov: 52 },
    sun: [200, 30], wind: [70, 3],
  },
  {
    id: "from-above",
    title: "The whole plot from above",
    blurb: "Fourteen metres up: no leaves are drawn from here, and the ground carries every species' colour and its patches.",
    species: turf(),
    plot: -1, row: BENT,
    view: { x: 2, z: 14, eye: 14, yaw: 0.25, pitch: -1.0, fov: 55 },
    sun: [240, 40], wind: [70, 3],
  },
  {
    id: "a-dry-summer",
    title: "A dry summer",
    blurb: "A lawn after six weeks without rain: straw, with the patches that still hold water left green.",
    species: turf((list) => {
      Object.assign(list[BLUEGRASS], { name: "Parched lawn", dry: 0.22, color: "#a8974c", tipTint: [1.12, 1.04, 0.8], density: 0.8, height: 0.05, sheen: 0.1, rootShade: 0.55, variation: 0.3, patchKind: "blotches", patch: 0.4, patchSize: 1.4, patchTint: [0.58, 1.0, 0.66], patchTall: 1.15 });
    }),
    plot: BLUEGRASS, row: BLUEGRASS,
    view: { x: -4, z: -12, eye: 0.35, yaw: 2.6, pitch: -0.14, fov: 48 },
    sun: [200, 58], wind: [30, 2],
  },
  {
    id: "storybook",
    title: "Storybook",
    blurb: "The same field with the style turned up: fewer, broader leaves and flat shading. Photographic to drawn is two sliders.",
    species: turf((list) => {
      Object.assign(list[RED_FESCUE], { color: "#4f9a4a" });
      Object.assign(list[RYE_ROUGH], { color: "#57a845" });
    }),
    plot: RYE_ROUGH, row: RYE_ROUGH,
    view: { x: 14, z: -6, eye: 0.7, yaw: -0.9, pitch: -0.12, fov: 50 },
    sun: [140, 46], wind: [90, 4],
    style: { broad: 0.85, flat: 0.9 }, look: { macro: 0.55, clumpSize: 1.4 },
  },
  {
    id: "one-plant",
    title: "One plant on the bench",
    blurb: "Every field is this, a few hundred thousand times. Drag to turn it; change its species on the right.",
    species: turf(),
    plot: -1, row: RYE_ROUGH, show: "One clump",
    view: { x: 10.6, z: 21, eye: 0.5, yaw: 0.36, pitch: -0.13, fov: 50 },
    sun: [300, 32], wind: [70, 2],
  },
];
