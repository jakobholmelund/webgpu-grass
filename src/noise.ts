// The noise the grass is varied by: one small texture that repeats without a
// seam, four fields of different coarseness in its four channels.

import * as THREE from "three/webgpu";

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(seed, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 8) / 16777216;
}

/** Smooth value noise, `cells` lattice cells to the texture's side, so it wraps. */
function tileNoise(size: number, cells: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const ux = tx * tx * (3 - 2 * tx);
      const uy = ty * ty * (3 - 2 * ty);
      const a = hash(x0 % cells, y0 % cells, seed);
      const b = hash((x0 + 1) % cells, y0 % cells, seed);
      const c = hash(x0 % cells, (y0 + 1) % cells, seed);
      const d = hash((x0 + 1) % cells, (y0 + 1) % cells, seed);
      out[y * size + x] = a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    }
  }
  return out;
}

/** 256 x 256, repeating: 4, 16, 64 and 32 cells to a side in r, g, b and a. */
export function makeNoiseTexture(): THREE.DataTexture {
  const size = 256;
  const channels = [tileNoise(size, 4, 11), tileNoise(size, 16, 23), tileNoise(size, 64, 37), tileNoise(size, 32, 53)];
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(channels[c][i] * 255);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
