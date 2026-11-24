// The placement's plain-number half (src/rank.ts): the rank matrix keeps whatever share it is given
// evenly spread, and a plant stands in its own cell. (Its card half is checked against it in the lab:
// `__grassLab.checkPlacement()`, which needs WebGPU.)
//
//   pnpm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { RANK_SIDE, finePlace, grassRanks, hashCell, rankMatrix } from "../src/rank.ts";

const N = RANK_SIDE;

/** The mean distance (cells) from each kept cell to its nearest kept neighbour, the square wrapping round. */
function nearest(kept) {
  let sum = 0;
  for (const [ax, ay] of kept) {
    let best = Infinity;
    for (const [bx, by] of kept) {
      if (ax === bx && ay === by) continue;
      const dx = Math.min(Math.abs(ax - bx), N - Math.abs(ax - bx));
      const dy = Math.min(Math.abs(ay - by), N - Math.abs(ay - by));
      best = Math.min(best, Math.hypot(dx, dy));
    }
    sum += best;
  }
  return sum / kept.length;
}

test("the ranks are each cell's place in one order, 0..1", () => {
  const r = grassRanks();
  assert.equal(r.length, N * N);
  const seen = new Set(r);
  assert.equal(seen.size, N * N, "two cells share a rank");
  for (const v of r) assert.ok(v > 0 && v < 1);
  assert.deepEqual(rankMatrix(), r, "not the same matrix every time");
});

test("whatever share is kept is evenly spread, as white noise is not", () => {
  const r = grassRanks();
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const share of [0.03, 0.1, 0.25, 0.5]) {
    const kept = [];
    const coin = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (r[y * N + x] < share) kept.push([x, y]);
        if (random() < share) coin.push([x, y]);
      }
    }
    // (Cells spread as evenly as can be, in a hexagonal packing, stand this far apart.)
    const even = Math.sqrt(2 / (Math.sqrt(3) * share));
    const ranked = nearest(kept) / even;
    const white = nearest(coin) / even;
    // (On a grid the kept cells cannot all stand hexagonally: about 0.7 of it is what void-and-cluster gets,
    // and white noise about 0.47.)
    assert.ok(ranked > 0.6, `share ${share}: kept cells ${ranked.toFixed(2)} of even spacing`);
    assert.ok(ranked >= white, `share ${share}: ranked ${ranked.toFixed(2)}, white noise ${white.toFixed(2)}`);
    // No clumps and no holes: how many are kept in each 8 by 8 window varies far less than by coin.
    const ranksAt = (x, y) => r[(y % N) * N + (x % N)];
    let rv = 0;
    let wv = 0;
    const coinAt = new Set(coin.map(([x, y]) => y * N + x));
    for (let y = 0; y < N; y += 4) {
      for (let x = 0; x < N; x += 4) {
        let a = 0;
        let b = 0;
        for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
          if (ranksAt(x + i, y + j) < share) a++;
          if (coinAt.has(((y + j) % N) * N + ((x + i) % N))) b++;
        }
        rv += (a - share * 64) ** 2;
        wv += (b - share * 64) ** 2;
      }
    }
    assert.ok(rv < wv * 0.35, `share ${share}: windows vary ${Math.sqrt(rv / 256).toFixed(2)} kept against ${Math.sqrt(wv / 256).toFixed(2)} by coin`);
  }
});

test("a plant stands in its own cell", () => {
  for (const [count, spacing, fx, fz] of [[96, 0.03, 1.7, -2.2], [160, 0.06, -517.3, 902.6], [128, 0.12, 0, 0]]) {
    for (let i = 0; i < count * count; i += 97) {
      const p = finePlace(i, count, spacing, fx, fz);
      assert.ok(p.x >= p.cx * spacing - 1e-4 && p.x <= (p.cx + 1) * spacing + 1e-4, `x ${p.x} outside cell ${p.cx}`);
      assert.ok(p.z >= p.cz * spacing - 1e-4 && p.z <= (p.cz + 1) * spacing + 1e-4, `z ${p.z} outside cell ${p.cz}`);
    }
  }
  const h = [];
  for (let i = 0; i < 2000; i++) h.push(hashCell(i % 37, Math.floor(i / 37)));
  const mean = h.reduce((a, b) => a + b, 0) / h.length;
  assert.ok(Math.abs(mean - 0.5) < 0.03, `the hash leans: mean ${mean}`);
});
