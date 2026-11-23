# Grass

Grass for three.js on WebGPU, written in TSL: fields of real leaves, from a
3.5 mm putting green to a knee-deep meadow, by species, with a lab to set
them in. It began as the grass of Couch Golf Club, a browser golf game, and
was pulled out so any three.js project can use it.

It is early. It is not on npm yet: take `src/` as it is, or run the lab.
WebGPU only (three.js r187, `three/webgpu`).

```
src/   the package: imports three and nothing else
lab/   the lab: a plot of ground and a panel to edit the grass on it
```

`pnpm test` holds the two walls: the package imports only three, and the lab
reaches the package only through `src/index.ts`, so the lab can do only what
your project could.

## The lab

```bash
pnpm install
pnpm dev
```

Then open the address it prints (the lab is at `/lab/`). Drag to look, W A S D to walk, the wheel for eye
height. `?plot=3` fills the plot with one species (its row), `?eye=0.15`
sets the eye height, `?fresh` ignores what the lab kept from last time.

A first visit opens on the *Gallery* (G): ten scenes, each one press, each
setting everything the lab has (the species, what grows on the plot, the
eye, the hour, the wind, the mowing, the style). The scene that is on is
named at the foot of the picture, with the ones either side a press away
(`[` and `]`); `?scene=striped-fairway` opens on one. They are data
(`lab/scenes.ts`), and their pictures in the gallery were taken from this
lab (`lab/thumbs`). *Dawn*, *Morning*, *Noon* and *Evening* on the bar set
the sun, and the sky and the light's colour follow its height.

The bar along the top chooses what is looked at and from how high. The rail
on the left chooses a species; the inspector on the right changes it
(*Species*) or what holds for all of them (*Scene*: view, style, light and
wind, field). *Preset* shows all of it as JSON, and loads JSON back. H puts
the panels away.

*Blade*, *Plant*, *Tuft* and *Clump* on the bar put the chosen species on a
bench in place of the plot: one blade, one plant, one tuft as the far field
draws it, or one clump (`?show=blade`). It is drawn by the field's own leaf
shader (`grass.createSpecimen`), so it is what the field draws, seen close.

*Leaf picture* puts a picture on a species' leaves: its light and dark over
the leaf's own colour, or its colour as the leaf's, and optionally its
transparency as the leaf's outline. The lab draws nine of its own, by arithmetic and from no photograph or
bought texture, so they can live here: five leaf surfaces (fresh, flecked,
olive, spent, a stalk) and four simpler ones
(`lab/leafart.ts`) and takes more from files (several at once). A picture from a file is not
kept in a preset: only its name is.

## The contract

```ts
const grass = createGrass({
  height: heightGrid({ heights, nx, nz, x0, z0, cell }),
  map: speciesMap({ ids, nx, nz, x0, z0, cell }),
  species: STARTER_SPECIES,
});
scene.add(grass.object);
// each frame, before rendering:
grass.update(renderer, camera, timeSeconds, lookAt);
```

- **Height** and **map** are sources: objects the shaders sample at any
  place. `heightGrid` and `speciesMap` make them from plain grids. A host
  with its own terrain writes its own (`HeightSource`, `MapSource`).
- **Species** are rows of plain data (`species.ts`): height, leaf width, how
  the tip ends, splay, stiffness, clumping, colour and so on. The shaders
  name no species; they read the row.
- **Style** (`grass.style`) is how it is drawn, apart from what it is.
- **Light and wind** (`grass.environment`) are the host's to set.
- **The ground** is the host's mesh. `grass.groundColor(xz)` and
  `grass.light(normal)` give it the colour and light the grass takes, so the
  two are one colour and nothing shows where the leaves thin out.

## What it does not do yet

- **Light.** Leaves are unlit materials, coloured in the compute pass by a
  sun tint and a shade tint. three's own lights and shadows do nothing to
  them, and they cast no shadow.
- **Borders from the host's own shapes.** `speciesMap` smooths a grid of
  species numbers into a field for each species and puts the border where
  two are equal, so a painted grid gives clean lines that cut its corners.
  It rounds away anything narrower than three or four cells, and a corner
  is as round as the smoothing. A host with exact outlines (a course's
  distance fields) still wants a source of its own.
- **Height across a border.** Each stand is full height up to its line; the
  game raises rough out of semi-rough over a stride.
- **Things in the grass.** Nothing presses it down: no feet, no ball, no
  trail.
- **Mowing beyond straight passes.** `mowStripes` is passes side by side,
  there and back. A species says how far the mower lays it over
  (`Species.lay`); laid grass leans that way, and it and the ground under it
  are lighter seen along the lay and darker against it, so the stripes
  change places as the eye goes round them. Not yet: the laps round the
  edge, a second cut across the first, the step up to longer grass at a
  mown line and its shadow, wear, and a stripe that follows the sun as
  well as the eye.
- **A ground with relief.** Each species has a picture of what lies on its
  ground, seen from straight above, which shows between the leaves and
  fades to the species' plain colour with distance. `grass.bakeGround`
  makes it from the species' own leaves (the lab does, again whenever a
  species changes); `grass.setGroundPicture` takes a photograph instead.
  Only its light and dark are used. A baked picture carries how high each
  of its leaves stands, and from that is seen with parallax and lit by its
  slope to the sun (`look.relief`); a photograph brings no heights, so
  what is lighter in it is taken to stand higher. It has no shadows of its
  own, it repeats every `groundTile`, and at 1,024 pixels to the tile it
  is a blur from a few centimetres off.
- **A leaf's cross-section.** A leaf bends in an arc and keeps its length.
  The leaves nearest the eye (the two near squares, and a specimen) are
  folded along the rib in their geometry, each half facing its own way
  (`look.fold`); further off a leaf is a flat strip, where it is too
  small in the picture for the fold to show.
- **How far leaves are drawn.** A leaf is drawn while it is most of a pixel
  wide in the picture and not once it is a third of one
  (`look.leafPixels`). The squares' reach follows that in one step only:
  a wider square of leaves (`layers.wide`, to 18 m) is drawn as far as
  the broadest species' leaf is still half a pixel wide beyond the
  others' 9 m, and not at all on a small picture or for a fine-leaved
  grass. It is chosen by the broadest species in the table, not by what
  grows in view, and beyond 18 m the leaves end whatever the display.
  `grass.countDrawn` says how many plants a frame drew.
- **Rushes, brush.** Left in the game.
- **Thin leaves on a see-through canvas.** A leaf thinner than a pixel is
  drawn a pixel wide and that much see-through (alpha to coverage, where
  the picture has several samples to a pixel), so far grass thins and does
  not fatten. That writes alpha below one into the picture: on a canvas
  that keeps its alpha the page behind shows through as pale flecks,
  worst in a band where a square of leaves thins out. The host's renderer
  must be opaque (`alpha: false`), as the lab's is. With four samples the
  thinning is coarse, and soft on a small picture.
- **Leaf pictures at a distance.** They have no smaller copies: their detail
  fades out by nine metres, and a cut-out's outline flickers far off. There
  are no normal maps, and the pictures share sixteen layers of 64 by 256.
- **Shadows from anything but grass.** The grass keeps a picture of how
  tall it stands over the map's ground (if the map says what ground it
  covers), and leaves and ground look a little way towards the sun in it:
  taller grass shades shorter grass and bare ground on the side away from
  the sun, and takes some of the sky from what stands beside it. It knows
  nothing of the terrain's own slopes, of trees or of a golfer: there is no
  way yet for a host to hand in its own shadows, and three's lights and
  shadow maps still do nothing here. The shadow is five steps long (1.2 m),
  so the tallest grass at the lowest sun is cut short.
- **A specimen's wind.** It sways on a plain sine, not the field's gusts.
- **Cost on anything but one machine.** *Measure* in the lab times the
  graphics card's own passes over five fixed views. On an Apple M-series
  laptop at 2,048 by 1,536, a frame of grass and ground is 7 to 13 ms:
  under 1 ms of compute, about 2 ms of ground, the rest leaves. Two runs
  differ by up to a fifth. Only plants that grow and are in view are drawn
  (the compute pass compacts them and counts them into the draw's own
  arguments), which took a fifth to a third off the heavier views; what
  is left is mostly the drawing of leaves that are seen. No phone and no
  other card has been measured.
- **The near squares' leaves.** Close to the ground two finer squares of
  leaves switch on (5 mm and 1 cm apart, a mown sward's own density) and
  off again as the eye rises. A species' density above 1 (more leaves to
  a plant) shows only in them.
- **Any eye.** The squares of fine leaves were tuned for an eye a metre and
  a half up. Lower, the host must aim them at the foreground (`lookAt`), as
  the lab does; inside grass taller than the eye it is a thicket of broad
  leaves.
- **The game.** The game still draws its own grass. Nothing here is used by
  it.

`STARTER_SPECIES` are the game's surfaces turned into rows, and a hay
meadow. `TURF_SPECIES`, which the lab starts from, are eight named grasses
(creeping bent, perennial rye as fairway and as rough, red fescue, fescue
in seed, a hay meadow, bermuda, Kentucky bluegrass): their mowing heights
and leaf widths are the species' own, and their colour and habit were set
by eye beside photographs of the real grass. That is a likeness, not a
measurement: no leaf was measured from a photograph. The photographs are
not here (their licences are not this one's): put your own in
`lab/reference/` with a `list.ts` (see `lab/reference.ts`; the folder is
ignored by git) and *Photo* on the bar shows each beside its species.

## Licence

MIT (`LICENSE`).
