// A map of mixes: a host's map says where its stands are, and this says which of each stand's grasses grows
// at a place in it (the arithmetic, and why, is mixshare.ts, the twin of what is worked out here).

import * as THREE from "three/webgpu";
import { cos, dot, exp, float, floor, length, max, mix, mod, normalize, sin, step, vec2 } from "three/tsl";
import { type MapSource, NO_GRASS } from "./field";
import { type GrassMix, memberSalt, mixChances } from "./mixshare";
import { hashCell } from "./placement";
import { MAX_SPECIES } from "./species";

type Vec2 = THREE.Node<"vec2">;
type Float = THREE.Node<"float">;

/** 1 where a place is in one of a member's colonies (`inColony` in mixshare.ts, its twin). */
function inColony(xz: Vec2, size: number, kept: number, salt: number): Float {
  const home = floor(xz.div(size));
  const inside = float(0).toVar();
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cell = home.add(vec2(dx, dz));
      const hc = mod(cell, float(1024)).add(vec2(salt * 0.731, salt * 0.317));
      const there = step(float(kept), hashCell(hc.add(2.9))).oneMinus();
      const centre = cell.add(vec2(hashCell(hc.add(1.3)), hashCell(hc.add(7.9))).mul(0.7).add(0.15)).mul(size);
      const reach = exp(hashCell(hc.add(4.1)).sub(0.5).mul(0.8)).mul(size * 0.5);
      // (Its ragged edge: mixshare.ts `edgeAt`, its twin.)
      const off = xz.sub(centre);
      const n = normalize(off.add(vec2(1e-6, 0)));
      const a = hashCell(hc.add(5.3)).mul(6.2832);
      const b = hashCell(hc.add(6.7)).mul(6.2832);
      const along = dot(n, vec2(cos(a), sin(a)));
      const edge = float(1)
        .add(along.mul(along).mul(2).sub(1).mul(0.2))
        .add(dot(n, vec2(cos(b), sin(b))).mul(0.12))
        .add(hashCell(xz.mul(29.7)).mul(2).sub(1).mul(0.16));
      inside.assign(max(inside, step(length(off), reach.mul(edge)).mul(there)));
    }
  }
  return inside;
}

/**
 * A map whose stands are mixes: where `source` says a mix's lead (`GrassMix.species`), the place is the
 * member's whose colony it is in, if any, and the lead's if none. How far a place is from another stand
 * (`edge`) is the source's: a patch is part of its stand, so tufts, flowers and an edge's straying go by
 * the stand's edge, not by the patches'. (Two grasses of a stand do still run into each other at a patch's
 * edge, as far as each lets its edge stray: `Species.edgeBlend`.)
 *
 * A member may be `NO_GRASS`: bare ground in the stand, in patches (sandy scrapes on a links, thin ground
 * on a heath), where the host's own ground shows.
 *
 * Each member's chance of a colony is worked out here, once (`mixChances`): it throws on shares a mix cannot
 * have. A member costs nine looks at a hash for each place the grass asks about.
 */
export function mixedMap(source: MapSource, mixes: readonly GrassMix[]): MapSource {
  const worked = mixes.map((m) => {
    for (const row of [m.species, ...m.members.map((x) => x.species)]) {
      const bare = row === NO_GRASS && row !== m.species;
      if (!bare && !(row >= 0 && row < MAX_SPECIES && Number.isInteger(row))) throw new Error(`A mix's rows are whole numbers below ${MAX_SPECIES} (or a member's NO_GRASS), not ${row}`);
    }
    return { mix: m, chances: mixChances(m) };
  });
  return {
    bounds: source.bounds,
    edgeReach: source.edgeReach,
    sample(xz) {
      const here = source.sample(xz);
      let species: Float = here.species;
      for (const { mix: m, chances } of worked) {
        const isLead = step(float(m.species - 0.5), here.species).mul(step(here.species, float(m.species + 0.5)));
        // (Last member first, so the first one listed has a place two of them cover.)
        let pick: Float = float(m.species);
        for (let j = m.members.length - 1; j >= 0; j--) {
          if (!(chances[j] > 0)) continue;
          pick = mix(pick, float(m.members[j].species), inColony(xz, m.members[j].patchSize, chances[j], memberSalt(j)));
        }
        species = mix(species, pick, isLead);
      }
      return { species, edge: here.edge };
    },
    dispose() {
      source.dispose();
    },
  };
}
