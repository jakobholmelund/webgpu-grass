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

// None are shipped: their licences are not this one's. Put your own in ./reference with a `list.ts` there
// that exports `REFERENCES: Reference[]` (the folder is ignored by git), and the lab's Photo button shows
// each beside its species. Without that file there are none, and no button.
const found = import.meta.glob<{ REFERENCES?: Reference[] }>("./reference/list.ts", { eager: true });
export const REFERENCES: Reference[] = Object.values(found)[0]?.REFERENCES ?? [];
