// A mix's plain-number half (src/mixshare.ts): each grass of a mix takes its share of the stand, in
// patches of about its size, the same every time. (Its card half, `mixedMap`, works the same sums.)
//
//   pnpm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { mixAt, mixChances, mostCover } from "../src/mixshare.ts";

/** The share of each row over a square of places `side` metres across, `step` apart. */
function shares(mix, chances, side = 400, step = 0.37) {
  const count = new Map();
  let n = 0;
  for (let z = 0; z < side; z += step) {
    for (let x = 0; x < side; x += step) {
      const s = mixAt(mix, chances, x - 191.3, z + 57.9);
      count.set(s, (count.get(s) ?? 0) + 1);
      n++;
    }
  }
  return (row) => (count.get(row) ?? 0) / n;
}

const MIXES = {
  links: { species: 8, members: [{ species: 9, share: 0.3, patchSize: 1.5 }, { species: 10, share: 0.15, patchSize: 2 }] },
  heath: { species: 8, members: [{ species: 9, share: 0.35, patchSize: 1 }, { species: 10, share: 0.1, patchSize: 2 }] },
  meadow: { species: 8, members: [{ species: 9, share: 0.35, patchSize: 2.5 }, { species: 10, share: 0.2, patchSize: 1 }] },
};

for (const [name, mix] of Object.entries(MIXES)) {
  test(`each grass of the ${name} mix takes its share, within two points`, () => {
    const at = shares(mix, mixChances(mix));
    const lead = 1 - mix.members.reduce((a, m) => a + m.share, 0);
    assert.ok(Math.abs(at(mix.species) - lead) < 0.02, `lead ${at(mix.species).toFixed(3)} for ${lead}`);
    for (const m of mix.members) assert.ok(Math.abs(at(m.species) - m.share) < 0.02, `row ${m.species}: ${at(m.species).toFixed(3)} for ${m.share}`);
  });
}

test("a member's patches are about its patch size across", () => {
  // Along lines through the stand, the runs of the member's ground: their mean length is a patch's breadth
  // cut at random, which is pi/4 of a round patch's breadth, and less where patches are cut near their edge.
  for (const size of [1, 2.5]) {
    const mix = { species: 0, members: [{ species: 1, share: 0.2, patchSize: size }] };
    const chances = mixChances(mix);
    let runs = 0;
    let total = 0;
    for (let line = 0; line < 200; line++) {
      let run = 0;
      for (let x = 0; x < 300; x += 0.02) {
        if (mixAt(mix, chances, x, line * 7.31) === 1) run += 0.02;
        else if (run > 0) {
          runs++;
          total += run;
          run = 0;
        }
      }
    }
    const mean = total / runs;
    assert.ok(mean > size * 0.45 && mean < size * 1.1, `patches of ${size} m: runs ${mean.toFixed(2)} m long`);
  }
});

test("the same place is the same grass every time", () => {
  const mix = MIXES.links;
  const a = mixChances(mix);
  const b = mixChances(mix);
  assert.deepEqual(a, b);
  for (let k = 0; k < 500; k++) assert.equal(mixAt(mix, a, k * 1.7, k * -0.9), mixAt(mix, b, k * 1.7, k * -0.9));
});

test("a mix that cannot be had is refused", () => {
  assert.throws(() => mixChances({ species: 0, members: [{ species: 1, share: 0.7, patchSize: 1 }, { species: 2, share: 0.4, patchSize: 1 }] }), /whole stand/);
  assert.throws(() => mixChances({ species: 0, members: [{ species: 1, share: 0.9, patchSize: 1 }] }), /at most/);
  assert.throws(() => mixChances({ species: 0, members: [{ species: 1, share: 0.2, patchSize: 0 }] }));
  const most = mostCover(0);
  assert.ok(most > 0.5 && most < 0.75, `most cover ${most}`);
});
