// A flower: what blooms among a species' grass, as plain data. Like a species, it is described and not
// programmed: the shaders name none, and adding one adds an entry.
//
// The way a head is built (each petal a small curved surface about the stem's tip, by how far it
// reaches, how it lifts and how broad it is, with nearer and further drawings of it) follows Inkwell's
// WebGPU flower field (github.com/siliconjungle/inkwell-webgpu-flowers, MIT). Nothing of its code or
// its painted flowers is here.

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

/** The most petals a head is drawn with. */
export const MAX_PETALS = 16;

/**
 * Four that grow in mown grass. Sizes from the floras (Stace; Clapham, Tutin and Moore): a daisy's head
 * 16 to 25 mm across on a stalk 3 to 12 cm; a creeping buttercup's flower 2 to 3 cm, five glossy petals;
 * a dandelion's head 25 to 40 mm of strap-shaped florets; white clover's a ball 15 to 20 mm across.
 * Colours by eye.
 */
export const FLOWERS: Record<string, Flower> = {
  daisy: { name: "Daisy", petals: 16, petalLength: 0.0085, petalWidth: 0.003, lift: 0.1, centre: 0.007, stem: 0.07, petalColor: "#f1f1ea", centreColor: "#e3bd1c" },
  buttercup: { name: "Creeping buttercup", petals: 5, petalLength: 0.0105, petalWidth: 0.0105, lift: 0.4, centre: 0.006, stem: 0.18, petalColor: "#f0cf12", centreColor: "#c7a90c" },
  dandelion: { name: "Dandelion", petals: 16, petalLength: 0.015, petalWidth: 0.0038, lift: 0.18, centre: 0.011, stem: 0.11, petalColor: "#f2c90f", centreColor: "#e8b70a" },
  clover: { name: "White clover", petals: 16, petalLength: 0.0075, petalWidth: 0.0034, lift: 0.95, centre: 0.006, stem: 0.06, petalColor: "#ece8dc", centreColor: "#d9d2bd" },
};
