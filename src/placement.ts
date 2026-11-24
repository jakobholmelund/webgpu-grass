// Where the shaders stand each plant, and which they keep when a square is thinned: the graphics card's
// half of what rank.ts does in plain numbers. Both halves are kept in step: `probePlacement` runs this
// half on the card for a set of plants and hands back what it worked out, for the lab's check against
// rank.ts (`checkPlacement`).

import * as THREE from "three/webgpu";
import { Fn, dot, float, floor, fract, instanceIndex, int, mod, storage, uniform, vec2, vec3, vec4 } from "three/tsl";
import { RANK_SIDE, grassRanks } from "./rank";

type Vec2 = THREE.Node<"vec2">;
type Float = THREE.Node<"float">;

/** After Dave Hoskins' hash12: even on whole-numbered cells, where a sine hash stands plants in rows. (Its twin: `hashCell` in rank.ts.) */
export const hashCell = Fn(([pIn]: [Vec2]) => {
  const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, vec3(p3.y, p3.z, p3.x).add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});

/** The rank matrix (rank.ts `grassRanks`) where the shaders read it. One to a grass. */
export function rankStore() {
  const attr = new THREE.StorageBufferAttribute(grassRanks(), 1);
  const node = storage(attr, "float", RANK_SIDE * RANK_SIDE).toReadOnly();
  return {
    /** A cell's rank, 0..1 (cells counted from anywhere, below nothing too). (Its twin: `rankOf`.) */
    rankOf(cell: Vec2): Float {
      const at = cell.sub(floor(cell.div(RANK_SIDE)).mul(RANK_SIDE));
      return node.element(int(at.y).mul(RANK_SIDE).add(int(at.x))) as unknown as Float;
    },
    dispose() {
      attr.array = new Float32Array(1);
    },
  };
}

/**
 * Where a square's plant `idx` grows: its cell, counted from the square's corner about `focus`, and
 * scattered within it by its cell's hash. A fine square hashes its cell within a repeat of 1024 cells: the
 * hash loses its evenness on large cell numbers, and the leaves fall into rows. (Its twin: `finePlace`.)
 */
export function placeInSquare(idx: THREE.Node<"uint"> | Float, count: number, spacing: number, focus: Vec2, fine: boolean) {
  const gx = float(mod(float(idx), float(count)));
  const gz = floor(float(idx).div(float(count)));
  const cell = floor(focus.div(spacing)).add(vec2(gx, gz)).sub(count * 0.5);
  const hcell = fine ? mod(cell, float(1024)) : cell;
  const r0 = hashCell(hcell);
  const r1 = hashCell(hcell.add(31.7));
  const xz = cell.add(vec2(r0, r1)).mul(spacing);
  return { cell, hcell, r0, r1, xz };
}

/**
 * For checking: the first `plants` plants of a fine square of `count` cells a side, `spacing` m apart, about
 * `focus` (m), as the card places them: for each, its x and z (m), its cell's rank, and its cell's hash.
 */
export async function probePlacement(renderer: THREE.WebGPURenderer, o: { count: number; spacing: number; focusX: number; focusZ: number; plants: number }): Promise<Float32Array> {
  const out = new THREE.StorageBufferAttribute(new Float32Array(o.plants * 4), 4);
  const outNode = storage(out, "vec4", o.plants);
  const ranks = rankStore();
  const uFocus = uniform(new THREE.Vector2(o.focusX, o.focusZ));
  const pass = Fn(() => {
    const p = placeInSquare(instanceIndex, o.count, o.spacing, uFocus, true);
    outNode.element(instanceIndex).assign(vec4(p.xz.x, p.xz.y, ranks.rankOf(p.cell), p.r0));
  })().compute(o.plants);
  await renderer.computeAsync(pass);
  const data = new Float32Array(await renderer.getArrayBufferAsync(out));
  pass.dispose?.();
  return data;
}
