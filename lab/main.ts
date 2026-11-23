// The grass lab: a plot of ground, the package's grass on it, and a panel
// that edits the species, the style and the field while you look.
//
// It uses the package through its public face only (../src/index.ts), as a
// stranger's project would: what the lab cannot do through that, the
// package cannot do.
//
//   pnpm exec vite, then /grass/lab/
//   ?plot=3      the whole plot one species (its row)
//   ?eye=0.15    start at this eye height (m)
//   ?show=blade  start on a specimen: blade, plant, tuft or clump

import * as THREE from "three/webgpu";
import { dot, float, length, max, mix, normalWorld, normalize, positionGeometry, positionWorld, pow, smoothstep, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import GUI from "three/addons/libs/lil-gui.module.min.js";
import { MAX_LEAF_TEXTURES, TURF_SPECIES, type Species, type SpecimenKind, checkSpecies, cloneSpecies, createGrass, heightAt, heightGrid, mowStripes, speciesMap } from "../src/index";
import { LEAF_ART } from "./leafart";
import { makeHeights, makeMap } from "./world";
import { SCENES, type Scene } from "./scenes";
import { REFERENCES } from "./reference";

// (v2: a leaf's width became its whole breadth, where it had been half of it.)
// (v3: the lab starts from the named turf grasses, eight of them.)
const STORE_KEY = "grass-lab-preset-v3";
/** Which lab this is, shown in the status strip: so a picture of it says what was drawn. Change it with the grass. */
const LAB_BUILD = "b42";
const query = new URLSearchParams(location.search);

interface Preset {
  version: 1;
  species: Species[];
  style: { broad: number; flat: number };
  look: { clumpSize: number; macro: number; edgeWobble: number; groundShade: number; stripes?: number; mown?: boolean };
}

function fail(text: string): never {
  document.getElementById("fail-text")!.textContent = text;
  document.getElementById("fail")!.classList.add("on");
  throw new Error(text);
}

async function start() {
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  if (!("gpu" in navigator)) fail("This page needs WebGPU, which this browser does not have.");
  // (Timestamps: the graphics card times its own passes, for the benchmark. They cost a little.)
  // (Not see-through: a far leaf is drawn with less than its whole pixel (alpha to coverage), and on a
  // canvas that keeps its alpha the page behind shows through those pixels as pale flecks.)
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false, trackTimestamp: true });
  try {
    await renderer.init();
  } catch (err) {
    fail(`WebGPU could not be started here: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) fail("This page needs WebGPU; only WebGL is available here.");
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  // The sky: pale at the horizon (the haze the plot fades into), bluer overhead, lighter about the sun.
  const SKY = new THREE.Color("#c6d6e2");
  const OVERHEAD = new THREE.Color("#5f93cf");
  const DUSK = new THREE.Color("#ecd3b6");
  const DEEP = new THREE.Color("#4672b4");
  const scene = new THREE.Scene();
  scene.background = SKY;
  scene.fog = new THREE.Fog(SKY, 38, 120);
  const skySun = uniform(new THREE.Vector3(0, 1, 0));
  // (And the hour shows in it: a low sun warms the horizon on its own side and deepens the blue overhead,
  // and warms the light on the grass with it. See `tick`.)
  const skyHorizon = uniform(SKY.clone());
  const skyOverhead = uniform(OVERHEAD.clone());
  const skyLow = uniform(0);
  const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  {
    const up = normalize(positionGeometry);
    const blue = mix(skyHorizon, skyOverhead, pow(smoothstep(float(0), float(0.75), up.y), float(0.6)));
    const toSun = max(dot(up, skySun), float(0));
    const glare = vec3(1.0, 0.93, 0.78).mul(pow(toSun, float(6)).mul(0.22).add(pow(toSun, float(220)).mul(1.4)));
    // (The glow of a low sun: along the horizon, on the sun's side of the sky.)
    const sunFlat = normalize(vec3(skySun.x, 0, skySun.z).add(vec3(1e-4, 0, 0)));
    const upFlat = normalize(vec3(up.x, 0, up.z).add(vec3(1e-4, 0, 0)));
    const glow = vec3(1.0, 0.62, 0.3).mul(pow(max(dot(upFlat, sunFlat), float(0)), float(2.5))).mul(float(1).sub(smoothstep(float(0), float(0.4), up.y))).mul(skyLow).mul(0.5);
    skyMat.colorNode = vec4(blue.add(glare.add(glow).mul(smoothstep(float(-0.02), float(0.04), up.y))), 1);
  }
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 400);

  // The plot, and the package's grass on it.
  const heights = makeHeights();
  const plotAsked = query.get("plot");
  const field = { plot: plotAsked !== null && Number.isInteger(Number(plotAsked)) ? Number(plotAsked) : -1 };
  let species = cloneSpecies(TURF_SPECIES);
  const map = speciesMap(makeMap(field.plot >= 0 ? field.plot : null, species.length));
  // (Mown up and down the strip of turf, a little off its line, by a mower two and a half metres wide.)
  const mow = mowStripes({ width: 2.5, heading: 12 });
  const grass = createGrass({ height: heightGrid(heights), map, mow, species });
  scene.add(grass.object);

  // The ground: the plot's heights as a mesh, coloured and lit as the grass on it is.
  let ground!: THREE.Mesh;
  {
    const { nx, nz, x0, z0, cell } = heights;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) pos.set([x0 + i * cell, heights.heights[j * nx + i], z0 + j * cell], (j * nx + i) * 3);
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let o = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        idx.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], o);
        o += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = vec4(grass.groundColor(vec2(positionWorld.x, positionWorld.z)).mul(grass.light(normalWorld)), 1);
    ground = new THREE.Mesh(geo, mat);
    scene.add(ground);
  }

  // The view: an eye carried over the ground at a height.
  const eyeAsked = Number(query.get("eye"));
  const view = { x: 10.6, z: 21, eye: eyeAsked > 0 ? eyeAsked : 0.5, yaw: 0.36, pitch: -0.13, fov: 50 };
  // (?at=x,z,eye,yaw,pitch,fov: exactly a view, as "Copy view" writes it.)
  const atAsked = (query.get("at") ?? "").split(",").map(Number);
  if (atAsked.length === 6 && atAsked.every(Number.isFinite)) [view.x, view.z, view.eye, view.yaw, view.pitch, view.fov] = atAsked;
  // (A sun a third of the way up and off to one side: light that rakes the grass and comes through it.)
  const light = { sunAzimuth: 300, sunElevation: 32, windHeading: 70, windSpeed: 3 };
  const sunAsked = (query.get("sun") ?? "").split(",").map(Number);
  if (sunAsked.length === 2 && sunAsked.every(Number.isFinite)) [light.sunAzimuth, light.sunElevation] = sunAsked;
  const show = { tufts: true, fineLeaves: true };

  // The bench: a little grass on its own on a stand, in place of the plot, turned about by dragging.
  const BENCH_AT = { x: 0, y: heightAt(heights, 0, 0), z: 0 };
  const specimen = grass.createSpecimen(BENCH_AT);
  scene.add(specimen.object);
  // (A round of soil that pales away into the backdrop at its rim: nothing with an edge to look at but the grass.)
  const standMat = new THREE.MeshBasicNodeMaterial({ fog: false });
  const soil = new THREE.Color("#5f5142");
  const rim = length(uv().sub(0.5)).mul(2);
  standMat.colorNode = vec4(mix(vec3(soil.r, soil.g, soil.b), vec3(SKY.r, SKY.g, SKY.b), smoothstep(float(0.42), float(1), rim)), 1);
  const stand = new THREE.Mesh(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2), standMat);
  stand.position.set(BENCH_AT.x, BENCH_AT.y, BENCH_AT.z);
  scene.add(stand);
  const KINDS: Record<string, SpecimenKind | null> = { "The plot": null, "One blade": "blade", "One plant": "plant", "One tuft": "tuft", "One clump": "clump" };
  const asked = query.get("show");
  const bench = { show: Object.keys(KINDS).find((label) => KINDS[label] === asked) ?? "The plot", another: 1, yaw: 0.7, pitch: 0.22, zoom: 1 };

  // The leaves' pictures: the lab's own, and any brought in from files.
  const pictures: Record<string, CanvasImageSource> = Object.fromEntries(Object.entries(LEAF_ART).map(([name, art]) => [name, art.picture()]));
  grass.setLeafTextures(pictures);

  // The ground under each species: made from the species' own leaves, and made again a moment after
  // the species changes; or, for a species given one, a picture from a file.
  const groundFromFile = new Set<number>();
  const bakeTimers = new Map<number, number>();
  const bakeSoon = (row: number, wait = 500) => {
    if (groundFromFile.has(row)) return;
    clearTimeout(bakeTimers.get(row));
    bakeTimers.set(row, window.setTimeout(() => void grass.bakeGround(renderer, row), wait));
  };
  const bakeAll = () => species.forEach((_, row) => bakeSoon(row, 0));
  const groundPicker = document.createElement("input");
  groundPicker.type = "file";
  groundPicker.accept = "image/*";
  const keys = new Set<string>();
  addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest?.("input, textarea, select")) return;
    keys.add(e.key.toLowerCase());
  });
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  addEventListener("blur", () => keys.clear());
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    if (KINDS[bench.show]) {
      bench.yaw -= e.movementX * 0.008;
      bench.pitch = Math.min(1.45, Math.max(-0.05, bench.pitch + e.movementY * 0.008));
      return;
    }
    view.yaw -= e.movementX * 0.004;
    view.pitch = Math.min(1.2, Math.max(-1.5, view.pitch - e.movementY * 0.004));
  });
  const endDrag = () => {
    dragging = false;
    canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (KINDS[bench.show]) {
      bench.zoom = Math.min(6, Math.max(0.15, bench.zoom * Math.exp(e.deltaY * 0.0015)));
      return;
    }
    view.eye = Math.min(30, Math.max(0.03, view.eye * Math.exp(e.deltaY * 0.0015)));
    refreshNumbers();
    refreshEye();
  }, { passive: false });

  // The panel: the lab's own bar, rail and inspector (index.html, lab.css), with lil-gui for the rows of numbers.
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const hud = el("status-line");
  const speciesGui = new GUI({ container: el("species-gui"), title: "" });
  const sceneGui = new GUI({ container: el("scene-gui"), title: "" });
  const refreshNumbers = () => [speciesGui, sceneGui].forEach((g) => g.controllersRecursive().forEach((c) => c.updateDisplay()));
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(preset()));
    } catch {
      // No storage here (a private window): the lab works without it.
    }
  };
  const preset = (): Preset => ({
    version: 1,
    species: cloneSpecies(species),
    style: { ...grass.style },
    look: { clumpSize: grass.look.clumpSize, macro: grass.look.macro, edgeWobble: grass.look.edgeWobble, groundShade: grass.look.groundShade, stripes: grass.look.stripes, mown: grass.look.mown },
  });
  /** Take a preset in; the reason if it cannot be. */
  const load = (value: unknown): string | null => {
    const p = value as Partial<Preset> | null;
    if (typeof p !== "object" || p === null || p.version !== 1) return "not a grass lab preset (version 1)";
    const bad = checkSpecies(p.species);
    if (bad) return bad;
    const num = (o: unknown, keys: string[]) => typeof o === "object" && o !== null && keys.every((k) => Number.isFinite((o as Record<string, unknown>)[k]));
    if (!num(p.style, ["broad", "flat"]) || !num(p.look, ["clumpSize", "macro", "edgeWobble", "groundShade"])) return "style or look is missing a number";
    species = cloneSpecies(p.species!);
    Object.assign(grass.style, { broad: p.style!.broad, flat: p.style!.flat });
    Object.assign(grass.look, { clumpSize: p.look!.clumpSize, macro: p.look!.macro, edgeWobble: p.look!.edgeWobble, groundShade: p.look!.groundShade, stripes: Number.isFinite(p.look!.stripes) ? p.look!.stripes : 1, mown: p.look!.mown === true });
    grass.setSpecies(species);
    rebuildSpecies();
    refreshNumbers();
    bakeAll();
    return null;
  };

  /** A row of buttons of which one is pressed. Returns what presses the right one again after a change from elsewhere. */
  const segment = <T,>(host: HTMLElement, options: [string, T][], current: () => T | null, pick: (value: T) => void) => {
    const buttons = options.map(([label, value]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", () => {
        pick(value);
        refresh();
      });
      host.append(b);
      return [b, value] as const;
    });
    const refresh = () => buttons.forEach(([b, value]) => b.setAttribute("aria-pressed", String(current() === value)));
    refresh();
    return refresh;
  };

  /**
   * A setting shown in the unit a person would say it in, and kept in the
   * unit the package has it in: `per` of the shown unit to one of the kept
   * (a width kept in metres is shown in millimetres with `per` 1000; a
   * share kept as 0..1 is shown as a percentage with `per` 100).
   */
  const shownAs = (folder: GUI, target: object, key: string, per: number, min: number, max: number, label: string, decimals = 0) => {
    const kept = target as Record<string, number>;
    const proxy = {
      get v() {
        return kept[key] * per;
      },
      set v(x: number) {
        kept[key] = x / per;
      },
    };
    return folder.add(proxy, "v", min, max).name(label).decimals(decimals);
  };

  // The scene: what holds for every species.
  const viewPanel = sceneGui.addFolder("View");
  viewPanel.add(view, "eye", 0.03, 30).name("eye height (m)").decimals(2).onChange(() => refreshEye());
  viewPanel.add(view, "fov", 20, 90, 1).name("field of view (°)");
  viewPanel.add(show, "tufts").name("far tufts");
  viewPanel.add(show, "fineLeaves").name("near leaves");
  const stylePanel = sceneGui.addFolder("Style");
  shownAs(stylePanel, grass.style, "broad", 100, 0, 100, "fewer, broader (%)").onChange(save);
  shownAs(stylePanel, grass.style, "flat", 100, 0, 100, "flatter shading (%)").onChange(save);
  const lightPanel = sceneGui.addFolder("Light and wind");
  lightPanel.add(light, "sunAzimuth", 0, 360, 1).name("sun heading (°)");
  lightPanel.add(light, "sunElevation", 4, 88, 1).name("sun height (°)");
  lightPanel.add(light, "windHeading", 0, 360, 1).name("wind heading (°)");
  lightPanel.add(light, "windSpeed", 0, 16, 0.1).name("wind (m/s)");
  shownAs(lightPanel, grass.look, "shadow", 100, 0, 100, "shade of taller grass (%)");
  shownAs(lightPanel, grass.look, "occlusion", 100, 0, 100, "sky hidden by it (%)");
  shownAs(lightPanel, grass.look, "depth", 100, 0, 100, "light lost in the stand (%)");
  lightPanel.add(grass.look, "leafShadows").name("leaves shadow each other");
  // What a close look is made of: each can be turned down to nothing to see what it adds.
  const detailPanel = sceneGui.addFolder("Detail");
  shownAs(detailPanel, grass.look, "fold", 100, 0, 250, "fold of near leaves (%)");
  shownAs(detailPanel, grass.look, "relief", 100, 0, 200, "depth of the ground (%)");
  detailPanel.add(grass.look, "leafPixels", 0, 3, 0.05).name("drop leaves thinner than (px)");
  const fieldPanel = sceneGui.addFolder("Field");
  shownAs(fieldPanel, grass.look, "clumpSize", 100, 20, 300, "clump size (cm)").onChange(save);
  shownAs(fieldPanel, grass.look, "macro", 100, 0, 100, "colour drift (%)").onChange(save);
  shownAs(fieldPanel, grass.look, "site", 100, 0, 100, "colour follows the ground (%)");
  shownAs(fieldPanel, grass.look, "edgeWobble", 100, 0, 60, "border wobble (cm)").onChange(save);
  shownAs(fieldPanel, grass.look, "groundShade", 100, 50, 110, "ground under it (%)").onChange(save);
  // How the plot was mown: it shows on the species the mower lays over (Species, Behaviour).
  const mowPanel = sceneGui.addFolder("Mowing");
  mowPanel.add(grass.look, "mown").name("mown in stripes").onChange(save);
  mowPanel.add(mow, "width", 0.4, 6).name("pass width (m)").decimals(1);
  mowPanel.add(mow, "heading", 0, 180, 1).name("heading (°)");
  shownAs(mowPanel, grass.look, "stripes", 100, 0, 150, "how much it shows (%): 100 is as the light makes it").onChange(save);

  // The bar: what is looked at, and from where.
  /** Put the species being edited on the bench, as what the bench shows. */
  const setBench = () => {
    const kind = KINDS[bench.show];
    if (kind) specimen.set(kind, chosen.row, bench.another);
  };
  const refreshBar = () => {
    const onBench = KINDS[bench.show] !== null;
    el("eye-group").hidden = onBench;
    el("hour-group").hidden = onBench;
    el("bench-group").hidden = !onBench;
    el("status-keys").textContent = `${LAB_BUILD} · ` + (onBench ? "Drag to turn it · wheel: nearer and further · H: picture only" : "Drag to look · W A S D to walk (Shift: faster) · wheel: eye height · H: picture only");
  };
  const refreshShow = segment(el("show"), [["Plot", "The plot"], ["Blade", "One blade"], ["Plant", "One plant"], ["Tuft", "One tuft"], ["Clump", "One clump"]], () => bench.show, (label) => {
    bench.show = label;
    setBench();
    refreshBar();
  });
  const EYES: [string, number][] = [["Ankle", 0.15], ["Knee", 0.5], ["Standing", 1.7], ["Overhead", 12]];
  const refreshEye = segment(el("eye"), EYES, () => EYES.find(([, eye]) => Math.abs(view.eye - eye) < eye * 0.02)?.[1] ?? null, (eye) => {
    view.eye = eye;
    view.pitch = eye > 5 ? -0.9 : eye > 1 ? -0.3 : -0.12;
    refreshNumbers();
  });
  // The time of day: the sun's height and heading in one press (the sliders are under Scene, Light and wind).
  const HOURS: [string, [number, number]][] = [["Dawn", [95, 8]], ["Morning", [125, 28]], ["Noon", [180, 68]], ["Evening", [280, 12]]];
  const refreshLight = segment(el("hour"), HOURS, () => HOURS.find(([, [az, up]]) => az === light.sunAzimuth && up === light.sunElevation)?.[1] ?? null, ([az, up]) => {
    light.sunAzimuth = az;
    light.sunElevation = up;
    refreshNumbers();
  });
  el("another").addEventListener("click", () => {
    bench.another = (bench.another % 40) + 1;
    setBench();
  });
  const setBare = (on: boolean) => {
    document.body.classList.toggle("bare", on);
    el("bare").setAttribute("aria-pressed", String(on));
  };
  el("bare").addEventListener("click", () => setBare(!document.body.classList.contains("bare")));
  // A link to exactly what is on the screen: the view, the plot, the light, and the species as they are
  // now (as a preset in the link itself), with the picture's size and this build's stamp for whoever opens it.
  el("copy-view").addEventListener("click", () => {
    const q = new URLSearchParams();
    q.set("at", [view.x, view.z, view.eye, view.yaw, view.pitch, view.fov].map((n) => Number(n.toFixed(3))).join(","));
    if (field.plot >= 0) q.set("plot", String(field.plot));
    q.set("sun", `${light.sunAzimuth},${light.sunElevation}`);
    q.set("size", `${canvas.width}x${canvas.height}`);
    q.set("build", LAB_BUILD);
    q.set("preset", JSON.stringify(preset()));
    navigator.clipboard.writeText(`${location.origin}${location.pathname}?${q.toString()}`).then(() => said("The link to this view is copied."), () => said("The link could not be copied."));
  });
  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "h" || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.("input, textarea, select")) return;
    setBare(!document.body.classList.contains("bare"));
  });
  for (const b of el("tabs").querySelectorAll("button")) {
    b.addEventListener("click", () => {
      for (const other of el("tabs").querySelectorAll("button")) {
        other.setAttribute("aria-pressed", String(other === b));
        el(`tab-${other.dataset.tab}`).hidden = other !== b;
      }
    });
  }

  // The species: the rail to choose one, the inspector to change it.
  const chosen = { row: Math.max(0, Math.min(species.length - 1, field.plot >= 0 ? field.plot : 2)) };
  const tallLabel = (m: number) => (m < 0.02 ? `${(m * 1000).toFixed(1).replace(/\.0$/, "")} mm` : `${(m * 100).toFixed(0)} cm`);
  const setPlot = (row: number) => {
    field.plot = row;
    map.set(makeMap(row >= 0 ? row : null, species.length).ids);
    el("fill").setAttribute("aria-pressed", String(row >= 0));
  };
  el("fill").addEventListener("click", () => setPlot(field.plot >= 0 ? -1 : chosen.row));
  el("fill").setAttribute("aria-pressed", String(field.plot >= 0));
  /** The rail and the inspector's heading, from the species as they are now. */
  const refreshRail = () => {
    const rows = species.map((sp, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.title = sp.name;
      b.setAttribute("aria-current", String(i === chosen.row));
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = sp.color;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = sp.name;
      const tall = document.createElement("span");
      tall.className = "tall";
      tall.textContent = tallLabel(sp.height);
      b.append(swatch, name, tall);
      b.addEventListener("click", () => {
        chosen.row = i;
        if (field.plot >= 0) setPlot(i);
        rebuildSpecies();
      });
      li.append(b);
      return li;
    });
    el("species").replaceChildren(...rows);
    el("who-swatch").style.background = species[chosen.row].color;
    const nameBox = el<HTMLInputElement>("who-name");
    if (document.activeElement !== nameBox) nameBox.value = species[chosen.row].name;
  };
  el<HTMLInputElement>("who-name").addEventListener("input", (e) => {
    species[chosen.row].name = (e.target as HTMLInputElement).value;
    refreshRail();
    refreshPhoto();
    save();
  });
  el<HTMLInputElement>("who-name").addEventListener("blur", (e) => {
    const box = e.target as HTMLInputElement;
    if (box.value.trim() === "") species[chosen.row].name = box.value = "Unnamed grass";
    refreshRail();
    save();
  });

  const filePicker = document.createElement("input");
  filePicker.type = "file";
  filePicker.accept = "image/*";
  filePicker.multiple = true;
  /** Take pictures in from files, each under its file's name; the species being edited is given the first of them. */
  const addPictures = async (files: File[]) => {
    let first: string | null = null;
    const left: string[] = [];
    for (const file of files) {
      const name = file.name.replace(/\.[^.]+$/, "");
      if (!(name in pictures) && Object.keys(pictures).length >= MAX_LEAF_TEXTURES) {
        left.push(`${file.name} (no room: the leaves share ${MAX_LEAF_TEXTURES} pictures)`);
        continue;
      }
      try {
        pictures[name] = await createImageBitmap(file);
        first ??= name;
      } catch {
        left.push(`${file.name} (not a picture)`);
      }
    }
    if (left.length > 0) said(`Not taken in: ${left.join(", ")}.`);
    if (first === null) return;
    grass.setLeafTextures(pictures);
    Object.assign(species[chosen.row], { leafTexture: first, textureMode: "color", textureCutout: false });
    grass.setSpecies(species);
    rebuildSpecies();
    save();
    bakeAll();
  };
  filePicker.addEventListener("change", () => {
    const files = [...(filePicker.files ?? [])];
    filePicker.value = "";
    void addPictures(files);
  });

  /** Which of the inspector's folders are shut, by title, so that making it again leaves them as they were. */
  // The photograph: a real stand of the species being edited, beside the drawn one, to set it against.
  const photo = { on: true };
  const refreshPhoto = () => {
    const ref = REFERENCES.find((r) => r.species === species[chosen.row]?.name);
    el("open-photo").hidden = !ref;
    el("open-photo").setAttribute("aria-pressed", String(photo.on));
    el("photo").hidden = !ref || !photo.on;
    if (!ref) return;
    const img = el<HTMLImageElement>("photo-img");
    const src = new URL(`./reference/${ref.file}`, import.meta.url).href;
    if (img.src !== src) img.src = src;
    img.alt = ref.shows;
    el("photo-shows").textContent = ref.shows;
    const credit = el<HTMLAnchorElement>("photo-credit");
    credit.textContent = `${ref.credit} · ${ref.licence}`;
    credit.href = ref.source;
  };
  el("open-photo").addEventListener("click", () => {
    photo.on = !photo.on;
    refreshPhoto();
  });
  el("photo-close").addEventListener("click", () => {
    photo.on = false;
    refreshPhoto();
  });
  el("photo-big").addEventListener("click", () => el("photo").classList.toggle("big"));

  const shut = new Set<string>();
  function rebuildSpecies() {
    refreshPhoto();
    for (const f of speciesGui.folders) (f._closed ? shut.add(f._title) : shut.delete(f._title));
    [...speciesGui.controllers].forEach((c) => c.destroy());
    [...speciesGui.folders].forEach((f) => f.destroy());
    chosen.row = Math.min(chosen.row, species.length - 1);
    const s = species[chosen.row];
    const changed = () => {
      grass.setSpecies(species);
      refreshRail();
      save();
      bakeSoon(chosen.row);
    };
    const folder = (title: string) => {
      const f = speciesGui.addFolder(title);
      if (shut.has(title)) f.close();
      return f;
    };
    const standPanel = folder("Stand");
    shownAs(standPanel, s, "height", 100, 0.3, 90, "height (cm)", 1).onChange(changed);
    shownAs(standPanel, s, "heightSpread", 100, 0, 100, "height spread (%)").onChange(changed);
    // (100% is a full sward; above it, more leaves to a plant.)
    shownAs(standPanel, s, "density", 100, 5, 200, "density (%)").onChange(changed);
    standPanel.add(s, "tufted").name("tufts far off").onChange(changed);
    const leafPanel = folder("Leaf");
    shownAs(leafPanel, s, "width", 1000, 0.5, 20, "width (mm)", 1).onChange(changed);
    shownAs(leafPanel, s, "widthSpread", 1000, 0, 20, "width spread (mm)", 1).onChange(changed);
    leafPanel.add(s, "tip", ["point", "cut", "square"]).onChange(changed);
    shownAs(leafPanel, s, "splay", 100, 0, 200, "splay (%)").onChange(changed);
    shownAs(leafPanel, s, "droop", 100, 0, 200, "droop (%)").onChange(changed);
    // (A leaf is turned up to 60 degrees from square-on at a twist of 1.)
    shownAs(leafPanel, s, "twist", 60, 0, 60, "twist (°)").onChange(changed);
    shownAs(leafPanel, s, "seedHead", 100, 0, 100, "seed head (%)").onChange(changed);
    const habitPanel = folder("Behaviour");
    shownAs(habitPanel, s, "stiffness", 100, 0, 100, "stiffness (%)").onChange(changed);
    shownAs(habitPanel, s, "clump", 100, 0, 100, "clumping (%)").onChange(changed);
    shownAs(habitPanel, s, "disorder", 100, 0, 100, "disorder (%)").onChange(changed);
    shownAs(habitPanel, s, "lay", 100, 0, 100, "laid by the mower (%)").onChange(changed);
    const colourPanel = folder("Colour");
    colourPanel.addColor(s, "color").name("colour").onChange(changed);
    (["red", "green", "blue"] as const).forEach((ch, i) => shownAs(colourPanel, s.tipTint, String(i), 100, 60, 160, `tip ${ch} (%)`).onChange(changed));
    (["red", "green", "blue"] as const).forEach((ch, i) => shownAs(colourPanel, s.seedTint, String(i), 100, 60, 200, `seed head ${ch} (%)`).onChange(changed));
    shownAs(colourPanel, s, "rootShade", 100, 10, 100, "root brightness (%)").onChange(changed);
    shownAs(colourPanel, s, "variation", 100, 0, 60, "leaf to leaf (%)").onChange(changed);
    shownAs(colourPanel, s, "dry", 100, 0, 100, "dead leaves (%)", 1).onChange(changed);
    shownAs(colourPanel, s, "sheen", 100, 0, 200, "sheen (%)").onChange(changed);

    // A leaf's picture: the pictures stood in a row to pick from, then how the one picked is used.
    const picturePanel = folder("Leaf picture");
    const row = document.createElement("div");
    row.id = "pictures";
    const nameLine = document.createElement("div");
    nameLine.id = "picture-name";
    const tiles: [HTMLButtonElement, string][] = [];
    const press = () => {
      tiles.forEach(([b, name]) => b.setAttribute("aria-pressed", String(s.leafTexture === name)));
      nameLine.replaceChildren(...(s.leafTexture ? [Object.assign(document.createElement("b"), { textContent: s.leafTexture })] : ["A plain leaf"]));
    };
    const tile = (name: string, label: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", () => {
        s.leafTexture = name;
        // (One of the lab's own pictures knows what it is for.)
        const art = LEAF_ART[name];
        if (art) Object.assign(s, { textureMode: art.mode, textureCutout: art.cutout });
        changed();
        press();
        refreshNumbers();
      });
      tiles.push([b, name]);
      row.append(b);
      return b;
    };
    tile("", "A plain leaf").className = "none";
    for (const [name, picture] of Object.entries(pictures)) {
      const thumb = document.createElement("canvas");
      thumb.width = 48;
      thumb.height = 148;
      thumb.getContext("2d")!.drawImage(picture, 0, 0, thumb.width, thumb.height);
      tile(name, name).append(thumb);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add";
    add.textContent = "+";
    add.title = "Add pictures from files";
    add.setAttribute("aria-label", "Add pictures from files");
    add.addEventListener("click", () => filePicker.click());
    row.append(add);
    picturePanel.$children.append(row, nameLine);
    press();
    picturePanel.add(s, "textureMode", { "its light and dark": "detail", "its colour": "color" }).name("it gives the leaf").onChange(changed);
    shownAs(picturePanel, s, "textureStrength", 100, 0, 100, "how much shows (%)").onChange(changed);
    picturePanel.add(s, "textureCutout").name("cut to its outline").onChange(changed);
    shownAs(folder("Cut"), s, "cutTip", 100, 0, 100, "cut ends gone to straw (%)").onChange(changed);
    // Its edge: mown to a line, or left to run into its neighbour.
    const edgePanel = folder("Edge");
    shownAs(edgePanel, s, "edgeBlend", 100, 0, 200, "strays into it (cm): 0 is mown").onChange(changed);
    // Patches: another grass come in, or this one doing worse, over part of its ground.
    const patchPanel = folder("Patches");
    patchPanel.add(s, "patchKind", ["colonies", "blotches"]).name("they are").onChange(changed);
    shownAs(patchPanel, s, "patch", 100, 0, 100, "share of the ground (%)").onChange(changed);
    shownAs(patchPanel, s, "patchSite", 100, -100, 100, "hollows (-) or crowns (+)").onChange(changed);
    shownAs(patchPanel, s, "patchSize", 100, 5, 400, "across (cm)").onChange(changed);
    shownAs(patchPanel, s, "patchTall", 100, 30, 200, "height there (%)").onChange(changed);
    (["red", "green", "blue"] as const).forEach((ch, i) => shownAs(patchPanel, s.patchTint, String(i), 100, 50, 160, `${ch} there (%)`).onChange(changed));
    // The ground under it: what lies there, seen between the leaves.
    const groundPanel = folder("Ground");
    shownAs(groundPanel, s, "groundDetail", 100, 0, 100, "leaves lying on it (%)").onChange(changed);
    shownAs(groundPanel, s, "groundTile", 100, 10, 300, "its picture covers (cm)").onChange(changed);
    groundPanel.add({ file: () => groundPicker.click() }, "file").name("A picture from a file…");
    groundPanel.add({ own: () => { groundFromFile.delete(chosen.row); bakeSoon(chosen.row, 0); } }, "own").name("Made from the species");
    refreshRail();
    setBench();
  }
  groundPicker.addEventListener("change", async () => {
    const file = groundPicker.files?.[0];
    groundPicker.value = "";
    if (!file) return;
    try {
      grass.setGroundPicture(chosen.row, await createImageBitmap(file));
      groundFromFile.add(chosen.row);
    } catch {
      said(`${file.name} could not be read as a picture.`);
    }
  });
  rebuildSpecies();
  refreshBar();
  refreshShow();

  // The gallery: its scenes, each one press. A scene sets everything the lab has.
  const LOOK_AS_MADE = { site: 0.5, mown: false, depth: 0.5, clumpSize: 0.85, macro: 0.3, edgeWobble: 0.03, groundShade: 1, stripes: 1, shadow: 0.6, occlusion: 0.45 };
  const gallery = el<HTMLDialogElement>("gallery");
  const at = { scene: -1 };
  const refreshCaption = () => {
    const sc = SCENES[at.scene];
    el("caption").hidden = !sc;
    if (!sc) return;
    el("caption-title").textContent = sc.title;
    el("caption-blurb").textContent = sc.blurb;
    el("caption-count").textContent = `${at.scene + 1} of ${SCENES.length}`;
    for (const card of el("gallery-cards").querySelectorAll("button")) card.setAttribute("aria-current", String(card.dataset.scene === sc.id));
  };
  const applyScene = (index: number) => {
    const sc: Scene | undefined = SCENES[(index + SCENES.length) % SCENES.length];
    if (!sc) return;
    at.scene = SCENES.indexOf(sc);
    species = cloneSpecies(sc.species);
    groundFromFile.clear();
    grass.setSpecies(species);
    Object.assign(grass.style, sc.style ?? { broad: 0, flat: 0 });
    Object.assign(grass.look, LOOK_AS_MADE, sc.look ?? {});
    if (sc.mow) {
      mow.width = sc.mow[0];
      mow.heading = sc.mow[1];
      grass.look.mown = true;
    }
    Object.assign(view, sc.view);
    [light.sunAzimuth, light.sunElevation] = sc.sun;
    [light.windHeading, light.windSpeed] = sc.wind;
    chosen.row = Math.min(sc.row, species.length - 1);
    setPlot(sc.plot);
    bench.show = sc.show ?? "The plot";
    Object.assign(bench, { yaw: 0.7, pitch: 0.22, zoom: 1 });
    setBench();
    refreshBar();
    refreshShow();
    refreshEye();
    refreshLight();
    rebuildSpecies();
    refreshNumbers();
    bakeAll();
    save();
    refreshCaption();
  };
  el("gallery-cards").replaceChildren(...SCENES.map((sc, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.dataset.scene = sc.id;
    const picture = document.createElement("span");
    picture.className = "picture";
    // (Until its picture is there, a card is its grass's own colour.)
    const main = sc.species[sc.row];
    picture.style.background = `linear-gradient(to top, color-mix(in srgb, ${main.color} 78%, black), ${main.color} 58%, #c6d6e2 58%, #7fa7d6)`;
    const img = new Image();
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    picture.append(img);
    img.src = new URL(`./thumbs/${sc.id}.jpg`, import.meta.url).href;
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = sc.title;
    const blurb = document.createElement("span");
    blurb.className = "blurb";
    blurb.textContent = sc.blurb;
    card.append(picture, title, blurb);
    card.addEventListener("click", () => {
      applyScene(i);
      gallery.close();
    });
    return card;
  }));
  el("open-gallery").addEventListener("click", () => gallery.showModal());
  el("gallery-close").addEventListener("click", () => gallery.close());
  gallery.addEventListener("click", (e) => {
    if (e.target === gallery) gallery.close();
  });
  el("caption-prev").addEventListener("click", () => applyScene(at.scene - 1));
  el("caption-next").addEventListener("click", () => applyScene(at.scene + 1));
  el("caption-all").addEventListener("click", () => gallery.showModal());
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.("input, textarea, select, dialog")) return;
    if (e.key === "g" || e.key === "G") gallery.showModal();
    if (e.key === "]") applyScene(at.scene + 1);
    if (e.key === "[") applyScene(at.scene - 1);
  });

  // Presets: the lab's state as JSON, to keep and to hand to a game.
  const box = el<HTMLDialogElement>("preset");
  const text = el<HTMLTextAreaElement>("preset-text");
  const note = el("preset-note");
  const starter = (): Preset => ({ version: 1, species: cloneSpecies(TURF_SPECIES), style: { broad: 0, flat: 0 }, look: { clumpSize: 0.85, macro: 0.3, edgeWobble: 0.03, groundShade: 1 } });
  el("open-preset").addEventListener("click", () => {
    text.value = JSON.stringify(preset(), null, 2);
    note.textContent = "";
    box.showModal();
  });
  el("preset-close").addEventListener("click", () => box.close());
  el("preset-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(text.value).then(() => (note.textContent = "Copied."), () => (note.textContent = "Could not copy: select the text instead."));
  });
  el("preset-reset").addEventListener("click", () => {
    load(starter());
    save();
    text.value = JSON.stringify(preset(), null, 2);
    note.textContent = "Back to the lab's own grasses.";
  });
  el("preset-load").addEventListener("click", () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.value);
    } catch {
      note.textContent = "That is not JSON.";
      return;
    }
    const bad = load(parsed);
    note.textContent = bad ? `Not loaded: ${bad}.` : "Loaded.";
    if (!bad) save();
  });
  try {
    // (A preset in the link, from "Copy view", goes before what the lab kept; neither is kept over the other.)
    const linked = query.get("preset");
    const kept = localStorage.getItem(STORE_KEY);
    if (linked) load(JSON.parse(linked));
    else if (kept && !query.has("fresh")) load(JSON.parse(kept));
  } catch {
    // Nothing kept, or not readable: the starter species stand.
  }
  // (A first visit, or a link that asks for one, starts on a scene with the gallery open over it.)
  const sceneAsked = SCENES.findIndex((sc) => sc.id === query.get("scene"));
  let keptAny = false;
  try {
    keptAny = localStorage.getItem(STORE_KEY) !== null && !query.has("fresh");
  } catch {
    // No storage: a first visit every time.
  }
  if (sceneAsked >= 0) applyScene(sceneAsked);
  else if (!query.get("preset") && !keptAny && !query.has("at") && !query.has("plot") && !query.has("show")) {
    applyScene(1);
    if (!query.has("quiet")) gallery.showModal();
  }
  refreshCaption();
  bakeAll();

  /** Say something in the status strip that stays a few seconds, over the running readout. */
  let saidUntil = 0;
  function said(message: string) {
    hud.textContent = message;
    saidUntil = performance.now() + 6000;
  }
  const fwd = new THREE.Vector3();
  let frames = 0;
  let drawn = 0;
  let counting = false;
  let fpsSince = performance.now();
  let fps = 0;
  let last = performance.now() / 1000;

  function tick(now: number) {
    const dt = Math.min(0.1, Math.max(0, now - last));
    last = now;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // (A pane out of view has no size, and there is no picture of no size to draw.)
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.fov = view.fov;
    const onBench = KINDS[bench.show] !== null;
    grass.object.visible = ground.visible = !onBench;
    specimen.object.visible = stand.visible = onBench;

    const speed = (1.2 + view.eye * 1.5) * (keys.has("shift") ? 4 : 1) * dt;
    const along = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
    const across = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
    const fx = -Math.sin(view.yaw);
    const fz = -Math.cos(view.yaw);
    if (onBench) {
      // The eye goes round the specimen, far enough off to hold all of it.
      specimen.update(now);
      const tall = specimen.height;
      const span = Math.max(tall, specimen.radius * 2) * 1.3;
      const away = ((span / 2 / Math.tan((view.fov * Math.PI) / 360)) * bench.zoom) / Math.min(1, camera.aspect);
      const mid = BENCH_AT.y + tall * 0.45;
      camera.position.set(BENCH_AT.x + Math.sin(bench.yaw) * Math.cos(bench.pitch) * away, mid + Math.sin(bench.pitch) * away, BENCH_AT.z + Math.cos(bench.yaw) * Math.cos(bench.pitch) * away);
      camera.lookAt(BENCH_AT.x, mid, BENCH_AT.z);
      camera.near = away * 0.05;
      stand.scale.setScalar(Math.max(specimen.radius * 2.6, tall * 1.2, 0.02));
    } else {
      view.x = Math.min(60, Math.max(-60, view.x + (fx * along - fz * across) * speed));
      view.z = Math.min(60, Math.max(-60, view.z + (fz * along + fx * across) * speed));
      camera.position.set(view.x, heightAt(heights, view.x, view.z) + view.eye, view.z);
      camera.rotation.set(view.pitch, view.yaw, 0, "YXZ");
      camera.near = 0.02;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);

    const sunAz = (light.sunAzimuth * Math.PI) / 180;
    const sunEl = (light.sunElevation * Math.PI) / 180;
    grass.environment.sun.set(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.cos(sunAz) * Math.cos(sunEl));
    skySun.value.copy(grass.environment.sun);
    // The hour's light: white and high at noon, warm and long at either end of the day.
    const low = 1 - Math.min(1, Math.max(0, (light.sunElevation - 5) / 27));
    const lowS = low * low * (3 - 2 * low);
    grass.environment.sunTint.set(1.14 + 0.2 * lowS, 1.04 - 0.12 * lowS, 0.86 - 0.3 * lowS);
    grass.environment.shadeTint.set(0.6 - 0.08 * lowS, 0.7 - 0.1 * lowS, 0.88 - 0.04 * lowS);
    skyHorizon.value.copy(SKY).lerp(DUSK, lowS);
    skyOverhead.value.copy(OVERHEAD).lerp(DEEP, lowS);
    skyLow.value = lowS;
    (scene.fog as THREE.Fog).color.copy(skyHorizon.value);
    const windAz = (light.windHeading * Math.PI) / 180;
    grass.environment.wind.set(Math.sin(windAz), Math.cos(windAz), light.windSpeed);
    grass.show.tufts = show.tufts;
    grass.show.leaves = show.fineLeaves;

    // The fine leaves go where the picture's lower third meets the ground (the foreground is where a leaf is
    // largest), or a few metres ahead when it does not.
    camera.getWorldDirection(fwd);
    const hLen = Math.hypot(fwd.x, fwd.z);
    // (Further off through a longer lens.)
    const ahead = Math.min(Math.min(12, 3 * (Math.tan((25 * Math.PI) / 180) / Math.tan((view.fov * Math.PI) / 360))), Math.max(0.4, view.eye / Math.tan(Math.max(-view.pitch + (view.fov * Math.PI) / 720, 0.05))));
    const lookX = view.x + (fwd.x / Math.max(hLen, 1e-3)) * ahead;
    const lookZ = view.z + (fwd.z / Math.max(hLen, 1e-3)) * ahead;
    const lookAt = hLen > 1e-3 ? { x: lookX, y: heightAt(heights, lookX, lookZ), z: lookZ } : undefined;
    grass.update(renderer, camera, now, lookAt);
    renderer.render(scene, camera);

    // (How many plants were drawn: asked of the graphics card now and then, as it is a wait.)
    if (!counting && frames % 30 === 0) {
      counting = true;
      grass.countDrawn(renderer).then((n) => (drawn = n), () => undefined).finally(() => (counting = false));
    }
    frames++;
    const wall = performance.now();
    if (wall - fpsSince > 500) {
      fps = (frames * 1000) / (wall - fpsSince);
      frames = 0;
      fpsSince = wall;
      if (wall > saidUntil) hud.textContent = onBench
        ? `${bench.show} · ${species[chosen.row].name} · ${tallLabel(specimen.height)} tall`
        : `${fps.toFixed(0)} frames a second · ${(drawn / 1000).toFixed(0)}k of ${(grass.stats.plants / 1000).toFixed(0)}k plants drawn · eye at ${view.eye < 1 ? `${(view.eye * 100).toFixed(0)} cm` : `${view.eye.toFixed(1)} m`}`;
    }
  }
  renderer.setAnimationLoop(() => {
    if (!measuring) tick(performance.now() / 1000);
  });

  // The benchmark: five fixed views, the graphics card's own time for each.
  let measuring = false;
  const BENCH_VIEWS: [string, { x: number; z: number; eye: number; yaw: number; pitch: number }][] = [
    ["Standing, the mixed plot", { x: 14, z: 12, eye: 1.7, yaw: 0.9, pitch: -0.22 }],
    ["Knee height, the mown strip", { x: 10.6, z: 21, eye: 0.5, yaw: 0.36, pitch: -0.13 }],
    ["Ankle height, the rough's edge", { x: 9.5, z: 4, eye: 0.2, yaw: 0.5, pitch: -0.16 }],
    ["1.3 m, in the meadow", { x: 38, z: -16, eye: 1.3, yaw: -0.927, pitch: -0.35 }],
    ["Overhead, 12 m", { x: -4, z: 2, eye: 12, yaw: 0.3, pitch: -0.9 }],
  ];
  const measure = async () => {
    if (measuring) return null;
    measuring = true;
    const was = { ...view, show: bench.show };
    bench.show = "The plot";
    const rows: { view: string; compute: number; draw: number }[] = [];
    try {
      for (const [name, at] of BENCH_VIEWS) {
        Object.assign(view, at, { fov: 50 });
        for (let i = 0; i < 20; i++) tick(last + 1 / 60);
        await renderer.resolveTimestampsAsync("compute");
        await renderer.resolveTimestampsAsync("render");
        const frames = 40;
        let compute = 0;
        let draw = 0;
        for (let i = 0; i < frames; i++) {
          tick(last + 1 / 60);
          compute += Number(await renderer.resolveTimestampsAsync("compute")) || 0;
          draw += Number(await renderer.resolveTimestampsAsync("render")) || 0;
        }
        rows.push({ view: name, compute: compute / frames, draw: draw / frames });
      }
    } finally {
      Object.assign(view, was);
      bench.show = was.show;
      measuring = false;
      refreshEye();
      refreshNumbers();
    }
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const info = (await navigator.gpu.requestAdapter())?.info;
    const lines = [
      `${[info?.vendor, info?.architecture].filter(Boolean).join(" ") || "unknown graphics"} · ${size.x} x ${size.y} · ${(grass.stats.plants / 1000).toFixed(0)}k plants`,
      "",
      "view                              compute    draw    total",
      ...rows.map((r) => `${r.view.padEnd(32)} ${r.compute.toFixed(2).padStart(6)} ms ${r.draw.toFixed(2).padStart(6)} ms ${(r.compute + r.draw).toFixed(2).padStart(6)} ms`),
    ];
    return { rows, text: lines.join("\n") };
  };
  const benchBox = el<HTMLDialogElement>("bench");
  el("open-bench").addEventListener("click", async () => {
    el("bench-text").textContent = "Measuring…";
    el("bench-note").textContent = "";
    benchBox.showModal();
    const found = await measure();
    if (found) el("bench-text").textContent = found.text;
  });
  el("bench-close").addEventListener("click", () => benchBox.close());
  el("bench-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(el("bench-text").textContent ?? "").then(() => (el("bench-note").textContent = "Copied."), () => (el("bench-note").textContent = "Could not copy: select the text instead."));
  });

  // For checking the lab by script: a pane out of view draws no frames of its own.
  (window as unknown as Record<string, unknown>).__grassLab = {
    view,
    light,
    show,
    grass,
    measure,
    bakeAll,
    mow,
    setBare,
    refreshShow,
    refreshBar,
    bench,
    specimen,
    setBench,
    addPictures,
    /** Draw `n` frames, `dt` seconds apart. */
    frame(n = 1, dt = 1 / 60) {
      for (let i = 0; i < n; i++) tick(last + dt);
      return last;
    },
    preset,
    load,
    scenes: SCENES,
    applyScene,
    /** The picture as it is now, as a JPEG `wide` pixels across (3:2, cut from its middle). */
    shot(wide = 720) {
      tick(last + 1 / 60);
      const out = document.createElement("canvas");
      out.width = wide;
      out.height = Math.round((wide * 2) / 3);
      const cut = Math.min(canvas.width, (canvas.height * 3) / 2);
      out.getContext("2d")!.drawImage(canvas, (canvas.width - cut) / 2, (canvas.height - (cut * 2) / 3) / 2, cut, (cut * 2) / 3, 0, 0, out.width, out.height);
      return out.toDataURL("image/jpeg", 0.86);
    },
  };
}

start().catch((err) => console.error(err));
