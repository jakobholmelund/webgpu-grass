// The lab's own leaf pictures, drawn here so there is something to put on a
// leaf before anyone brings a photograph. Each runs root (bottom) to tip
// (top), the leaf's breadth across it.
//
// "detail" pictures are grey: mid grey leaves the leaf's colour alone, and
// lighter or darker lightens or darkens it. "colour" pictures are the leaf's
// colour, and their transparency its outline.

const W = 64;
const H = 256;

function canvas(): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const c = new OffscreenCanvas(W, H);
  return [c, c.getContext("2d")!];
}

/** A grass leaf's ribs: a pale midrib, fine veins beside it, the edges a little darker. */
function ribbed(): OffscreenCanvas {
  const [c, g] = canvas();
  g.fillStyle = "rgb(128 128 128)";
  g.fillRect(0, 0, W, H);
  const edge = g.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, "rgb(0 0 0 / 0.28)");
  edge.addColorStop(0.22, "rgb(0 0 0 / 0)");
  edge.addColorStop(0.78, "rgb(0 0 0 / 0)");
  edge.addColorStop(1, "rgb(0 0 0 / 0.28)");
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue;
    g.fillStyle = i % 2 ? "rgb(255 255 255 / 0.10)" : "rgb(0 0 0 / 0.12)";
    g.fillRect((i * W) / 8 - 1, 0, 2, H);
  }
  g.fillStyle = "rgb(255 255 255 / 0.34)";
  g.fillRect(W / 2 - 2, 0, 4, H);
  g.fillStyle = "rgb(0 0 0 / 0.22)";
  g.fillRect(W / 2 - 4, 0, 2, H);
  return c;
}

/** A tired leaf: browned towards its tip, with dark blotches. */
function blotched(): OffscreenCanvas {
  const [c, g] = canvas();
  g.fillStyle = "rgb(128 128 128)";
  g.fillRect(0, 0, W, H);
  const tip = g.createLinearGradient(0, H, 0, 0);
  tip.addColorStop(0, "rgb(128 128 128 / 0)");
  tip.addColorStop(0.55, "rgb(128 128 128 / 0)");
  tip.addColorStop(1, "rgb(205 160 95 / 0.95)");
  g.fillStyle = tip;
  g.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 2 + rnd() * 5;
    const spot = g.createRadialGradient(x, y, 0, x, y, r);
    spot.addColorStop(0, "rgb(70 45 25 / 0.75)");
    spot.addColorStop(1, "rgb(70 45 25 / 0)");
    g.fillStyle = spot;
    g.fillRect(x - r, y - r * 2, r * 2, r * 4);
  }
  return c;
}

/** A seed head on its stalk, cut out: a thin stem, and spikelets up its top half. */
function seedHead(): OffscreenCanvas {
  const [c, g] = canvas();
  g.fillStyle = "#7d8f4e";
  g.fillRect(W / 2 - 3, H * 0.42, 6, H * 0.58);
  g.fillStyle = "#a79a5c";
  g.fillRect(W / 2 - 2, 6, 4, H * 0.45);
  for (let i = 0; i < 15; i++) {
    const y = 12 + i * 7.2;
    const reach = 7 + Math.min(i, 14 - i) * 2.6;
    for (const side of [-1, 1]) {
      g.save();
      g.translate(W / 2 + side * reach * 0.55, y + (side > 0 ? 3 : 0));
      g.rotate(side * -0.5);
      g.fillStyle = i % 2 ? "#d9c27a" : "#c9ad63";
      g.beginPath();
      g.ellipse(0, 0, reach * 0.62, 3.4, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  return c;
}

/** A broad toothed leaf, cut out: a weed in the lawn. */
function toothedLeaf(): OffscreenCanvas {
  const [c, g] = canvas();
  const half = (t: number) => Math.sin(Math.PI * Math.pow(t, 0.8)) * (W / 2 - 3) * (0.72 + 0.28 * Math.abs(Math.sin(t * 34)));
  g.beginPath();
  g.moveTo(W / 2, H);
  for (let i = 0; i <= 120; i++) g.lineTo(W / 2 - half(i / 120), H - (i / 120) * (H - 2));
  for (let i = 120; i >= 0; i--) g.lineTo(W / 2 + half(i / 120), H - (i / 120) * (H - 2));
  g.closePath();
  const green = g.createLinearGradient(0, H, 0, 0);
  green.addColorStop(0, "#4f7d3a");
  green.addColorStop(1, "#7fa64c");
  g.fillStyle = green;
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = "rgb(215 230 170 / 0.6)";
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(W / 2, H);
  g.lineTo(W / 2, 4);
  g.stroke();
  g.lineWidth = 1.2;
  for (let i = 1; i < 11; i++) {
    const y = H - i * 22;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(W / 2, y);
      g.lineTo(W / 2 + side * W * 0.5, y - 20);
      g.stroke();
    }
  }
  g.restore();
  return c;
}

type Rgb = [number, number, number];

interface Surface {
  /** The leaf's colour at its root, its middle and its tip (sRGB, 0..255). */
  root: Rgb;
  mid: Rgb;
  tip: Rgb;
  /** Veins across the leaf, and how strongly they and the midrib show, 0..1. */
  veins: number;
  ribbing: number;
  /** Blemishes: how many, their colour, and how large (in pixels across). */
  spots: number;
  spotColor: Rgb;
  spotSize: number;
  /** The share of the leaf's length, from the tip, that has dried to `dryColor`. */
  dryTip: number;
  dryColor: Rgb;
  /** A stalk's joints: where up its length (0..1) a darker band crosses it. */
  nodes: number[];
  seed: number;
}

/**
 * A leaf's surface, pixel by pixel, from what a grass leaf has: a pale
 * midrib in a groove, parallel veins, streaks running its length, one half
 * a little darker than the other, darker edges, blemishes that follow the
 * veins, a tip that dries first. Nothing here is taken from a photograph or
 * from anyone's texture: it is all arithmetic, so it can live in the project.
 */
function surface(s: Surface): OffscreenCanvas {
  const [c, g] = canvas();
  const img = g.createImageData(W, H);
  let state = s.seed >>> 0;
  const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  // Smooth noise on a coarse lattice, for the streaks and the mottling.
  const lattice = Array.from({ length: 64 * 64 }, rnd);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = x - xi;
    const ty = y - yi;
    const at = (i: number, j: number) => lattice[(((j % 64) + 64) % 64) * 64 + (((i % 64) + 64) % 64)];
    const ux = tx * tx * (3 - 2 * tx);
    const uy = ty * ty * (3 - 2 * ty);
    return (at(xi, yi) * (1 - ux) + at(xi + 1, yi) * ux) * (1 - uy) + (at(xi, yi + 1) * (1 - ux) + at(xi + 1, yi + 1) * ux) * uy;
  };
  const spots = Array.from({ length: s.spots }, () => ({ x: rnd() * W, y: rnd() * H, r: s.spotSize * (0.5 + rnd()), long: 1.5 + rnd() * 3, dark: 0.5 + rnd() * 0.5 }));
  const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let y = 0; y < H; y++) {
    // (The picture's top row is the leaf's tip.)
    const t = 1 - y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const off = Math.abs(u - 0.5);
      let col = t < 0.5 ? lerp(s.root, s.mid, t * 2) : lerp(s.mid, s.tip, (t - 0.5) * 2);
      // Mottling over the whole leaf, towards yellow and back.
      const mottle = noise(u * 5 + 3, t * 9) - 0.5;
      col = [col[0] * (1 + mottle * 0.16), col[1] * (1 + mottle * 0.06), col[2] * (1 - mottle * 0.1)];
      let shade = 1;
      // Streaks running the leaf's length; veins; the midrib and the groove it lies in.
      shade += (noise(u * 26, t * 2.5 + 7) - 0.5) * 0.2;
      shade += Math.cos(u * Math.PI * 2 * s.veins) * 0.05 * s.ribbing;
      shade += Math.exp(-((off / 0.03) ** 2)) * 0.3 * s.ribbing;
      shade -= Math.exp(-(((off - 0.075) / 0.035) ** 2)) * 0.13 * s.ribbing;
      // One half turned a little from the light, and the edges darker.
      shade += (u < 0.5 ? -0.04 : 0.04) * s.ribbing;
      shade -= Math.max(0, off - 0.36) * 1.3;
      for (const n of s.nodes) shade -= Math.exp(-(((t - n) / 0.012) ** 2)) * 0.3;
      col = [col[0] * shade, col[1] * shade, col[2] * shade];
      // The tip dries first, unevenly; blemishes lie along the veins.
      const dry = Math.min(1, Math.max(0, (t - (1 - s.dryTip) + (noise(u * 7, t * 14) - 0.5) * 0.12) / 0.08));
      col = lerp(col, s.dryColor, dry * 0.9);
      for (const sp of spots) {
        const dx = (x - sp.x) / sp.r;
        const dy = (y - sp.y) / (sp.r * sp.long);
        const d = dx * dx + dy * dy;
        if (d < 1) col = lerp(col, s.spotColor, (1 - d) * sp.dark);
      }
      const k = (y * W + x) * 4;
      img.data[k] = Math.min(255, Math.max(0, col[0]));
      img.data[k + 1] = Math.min(255, Math.max(0, col[1]));
      img.data[k + 2] = Math.min(255, Math.max(0, col[2]));
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const PLAIN = { veins: 9, ribbing: 1, spots: 0, spotColor: [150, 120, 70] as Rgb, spotSize: 1.5, dryTip: 0, dryColor: [190, 165, 105] as Rgb, nodes: [] as number[] };
/** A leaf in full growth. */
const freshLeaf = () => surface({ ...PLAIN, root: [150, 172, 96], mid: [72, 136, 52], tip: [98, 160, 62], seed: 11 });
/** The same, flecked: a leaf a few weeks old, its tip just starting to dry. */
const fleckedLeaf = () => surface({ ...PLAIN, root: [152, 168, 92], mid: [88, 140, 54], tip: [112, 158, 60], spots: 46, spotSize: 1.3, dryTip: 0.06, seed: 23 });
/** A leaf going over: olive, less of a rib. */
const oliveLeaf = () => surface({ ...PLAIN, root: [150, 148, 88], mid: [116, 128, 62], tip: [134, 138, 68], ribbing: 0.7, spots: 12, dryTip: 0.12, seed: 37 });
/** A spent leaf: straw and brown, spotted, dry a third of the way down. */
const spentLeaf = () => surface({ ...PLAIN, root: [158, 142, 92], mid: [146, 124, 74], tip: [170, 146, 96], ribbing: 0.5, spots: 90, spotColor: [86, 58, 34], spotSize: 1.8, dryTip: 0.34, dryColor: [176, 150, 100], seed: 41 });
/** A stalk: closely ribbed, with two joints. */
const stalk = () => surface({ ...PLAIN, root: [164, 172, 102], mid: [128, 156, 74], tip: [150, 164, 84], veins: 14, ribbing: 0.8, nodes: [0.3, 0.63], seed: 53 });

/** The pictures by name, and what each is for (how a species should be set to use it). */
export const LEAF_ART: Record<string, { picture: () => CanvasImageSource; mode: "detail" | "color"; cutout: boolean }> = {
  "Fresh leaf": { picture: freshLeaf, mode: "color", cutout: false },
  "Flecked leaf": { picture: fleckedLeaf, mode: "color", cutout: false },
  "Olive leaf": { picture: oliveLeaf, mode: "color", cutout: false },
  "Spent leaf": { picture: spentLeaf, mode: "color", cutout: false },
  Stalk: { picture: stalk, mode: "color", cutout: false },
  Ribbed: { picture: ribbed, mode: "detail", cutout: false },
  Blotched: { picture: blotched, mode: "detail", cutout: false },
  "Seed head": { picture: seedHead, mode: "color", cutout: true },
  "Toothed leaf": { picture: toothedLeaf, mode: "color", cutout: true },
};
