// The lab's plot: 128 m of rolling ground and a map of what grows where.
// Plain numbers, made here; the package is handed them as any host's would be.

import { type GrassMap, type HeightGrid, NO_GRASS } from "../src/index";

const SIDE_M = 128;
const HEIGHT_CELL_M = 0.5;
const MAP_CELL_M = 0.125;

export function makeHeights(): HeightGrid {
  const n = SIDE_M / HEIGHT_CELL_M + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -SIDE_M / 2 + i * HEIGHT_CELL_M;
      const z = -SIDE_M / 2 + j * HEIGHT_CELL_M;
      heights[j * n + i] = 1.2 * Math.sin(x / 17 + 0.4) * Math.cos(z / 23) + 0.6 * Math.sin((x + z) / 9) + 0.12 * Math.sin(x / 3.1) * Math.sin(z / 3.7);
    }
  }
  return { heights, nx: n, nz: n, x0: -SIDE_M / 2, z0: -SIDE_M / 2, cell: HEIGHT_CELL_M };
}

/**
 * How the mixed plot is laid out, by the species' rows: bands either side of a winding line, each to so
 * many metres from it (`bands[0]` is row 0's, out to its edge), and beyond the last band one row on the
 * one side and another on the other.
 */
export interface PlotLayout {
  bands: number[];
  beyond: [number, number];
}

/** A golf course's surfaces: a winding green (0) with its collar (1), fairway (2), first cut (3), rough (4) and deep rough (5) either side, fescue (6) beyond on one side and meadow (7) on the other. */
export const TURF_LAYOUT: PlotLayout = { bands: [5, 6.2, 11, 13, 19, 25], beyond: [6, 7] };

/**
 * The mixed plot, as `layout` lays it out, with a bare path across it all and a bare hollow, for borders
 * with nothing. `only` fills the whole plot with one species instead. `rows` is how many species there
 * are: a row past the last is the last.
 */
export function makeMap(only: number | null, rows = 6, layout: PlotLayout = TURF_LAYOUT): GrassMap {
  const n = SIDE_M / MAP_CELL_M;
  const ids = new Uint8Array(n * n);
  if (only !== null) ids.fill(only);
  else {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -SIDE_M / 2 + (i + 0.5) * MAP_CELL_M;
        const z = -SIDE_M / 2 + (j + 0.5) * MAP_CELL_M;
        const off = x - 14 * Math.sin(z / 26);
        const d = Math.abs(off);
        const band = layout.bands.findIndex((out) => d < out);
        let id = band >= 0 ? band : layout.beyond[off > 0 ? 1 : 0];
        id = Math.min(id, rows - 1);
        if (Math.abs(x * 0.6 + z * 0.8 - 10) < 0.7) id = NO_GRASS;
        if (Math.hypot(x + 9, z - 4) < 2.6) id = NO_GRASS;
        ids[j * n + i] = id;
      }
    }
  }
  return { ids, nx: n, nz: n, x0: -SIDE_M / 2, z0: -SIDE_M / 2, cell: MAP_CELL_M };
}
