// Photographs of real grass, to set the lab's species against: each named for the species (by its name
// in TURF_SPECIES) it stands beside. The files go in ./reference. They are the lab's, not the package's:
// nothing in src reads them.

export interface Reference {
  /** The species' name, as the lab's own list has it. */
  species: string;
  file: string;
  /** What the photograph shows, in a line. */
  shows: string;
  credit: string;
  licence: string;
  /** Its page, where the terms are. */
  source: string;
}

// (None are shipped: add your own files to ./reference and list them here, and the lab's Photo button shows
// each beside its species.)
export const REFERENCES: Reference[] = [];
