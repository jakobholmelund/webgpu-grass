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

A first visit opens on the *Gallery* (G): fourteen scenes, each one press, each
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
  name no species; they read the row. Nor need a row be a grass: `stem`
  makes its leaves round, stiff stems and `tussock` stands it in tussocks
  with open ground between, which together are a rush (`MORE_PLANTS.rush`,
  soft rush, for a marsh; the lab's "Soft rush" scene), and `flower` puts a
  rush's brown tuft of flowers on the side of some of its stems. Up to
  sixteen species (`MAX_SPECIES`). What a species costs is mostly its
  ground picture, 4 MB here and a third more on the graphics card, and the
  grass keeps as many as it is given species; `speciesMap` keeps a channel
  to each row its map may hold (`rows`), four to a texture.
- **Style** (`grass.style`) is how it is drawn, apart from what it is.
- **Light and wind** (`grass.environment`) are the host's to set.
- **The ground** is the host's mesh. `grass.groundColor(xz)` and
  `grass.light(normal)` give it the colour and light the grass takes, so the
  two are one colour and nothing shows where the leaves thin out.

## Heights of cut

`TURF_SPECIES` are a golf course's surfaces at heights in real use:

| Surface | Here | In use |
| --- | --- | --- |
| Green | 3.2 mm | 2.3 to 3.2 mm at US championships, 3.5 to 4.5 mm at Opens, 4 to 7 mm UK summer play |
| Collar | 8 mm | 6 to 9 mm at championships, 10 to 12 mm everyday; about 1.2 m wide |
| Fairway | 11 mm | 8 to 12 mm at championships, 9 to 13 mm US, 14 to 19 mm UK |
| First cut | 32 mm | 25 to 35 mm, one mower's pass (about 2 m) to 4 m wide |
| Rough | 64 mm | about 64 mm for member play, 76 to 89 mm at a US Open, 100 mm UK |
| Deep rough | 125 mm | 100 to 150 mm |
| Fescue in seed | 30 cm | 15 to 30 cm standing, unmown or cut once a year |
| Hay meadow | 60 cm | 50 cm to 1 m before the cut |

From STRI and European Tour guidance, the USGA's fairway article, and
championship set-up sheets (GCSAA, Oakmont, the Open venues). Each mown band
is a separate mower at a fixed height, so its edges are steps
(`edgeBlend` 0); rough into native grass is not kept, and is not sharp.

## Other courses' grasses

`GRASSES` holds every species here by a name, and a host makes its own list
from it, as a course has the grasses it has: `TURF_SPECIES` (a cool, wet
parkland's: bent greens, rye fairways), `MORE_TURF` (a bermuda fairway, a
bluegrass lawn), `MORE_PLANTS` (soft rush) and `MORE_GRASSES`:

| Name | What | Height |
| --- | --- | --- |
| `poaGreen` | A green gone over to annual meadow-grass: lighter, broader-leaved, seeding at a green's height, the bent left in it in darker patches | 3.2 mm |
| `kikuyuFairway`, `kikuyuRough` | Kikuyu, a warm coast's: a dense springy mat of broad stiff folded leaves | 13 mm, 50 mm |
| `fescueGreen`, `fescueFairway` | A links': fine fescue, needle-leaved, the densest turf, grey-green and browning on the crowns where it is not watered | 4.5 mm, 10 mm |
| `marram` | The dunes behind a links: rolled grey-green leaves in tussocks, many dead | 80 cm |

The lab's *A links*, *Marram on the dunes* and *Kikuyu on a warm coast*
show them. Their habit was set by eye, as the others' was. Kikuyu has its
own flowers, its stamens: white threads out of the mat after a mowing.
Marram carries its pale seed spikes on a few of its stems (`seedShare`,
the share of a species' stems in seed, which then stand a fifth over the
leaves) and stands in tussocks further apart than the field's clumps
(`clumpScale`, a multiple of `look.clumpSize`), with open ground between.

## Where the numbers come from

A species' leaf breadth and, for the grass nobody mows, its height are set
against these floras, which can be read and reused freely:

| Source | What | Terms |
| --- | --- | --- |
| [Flora of Australia](https://profiles.ala.org.au/opus/foa) | The turf grasses as they grow wild there: creeping bent, perennial rye, Kentucky bluegrass, annual meadow-grass, red fescue, bermuda; JSON for each | CC BY, © Commonwealth of Australia |
| A. S. Hitchcock, *Manual of the Grasses of the United States*, 2nd ed. (USDA, 1950), [Internet Archive](https://archive.org/details/manualofgrasseso200hitc_0) | Creeping bent, annual meadow-grass, American and European beachgrass | Public domain (a US government work) |
| *Flora Iberica* XVII and XIX(II), through [Plazi](https://tb.plazi.org) | Marram, kikuyu, soft rush | Plazi publishes its treatments as CC0 |
| Wessapak et al., Cenchrus in Thailand, *PhytoKeys* 234 (2023) | Kikuyu | CC BY |

Each species' note in `species.ts` gives the figures it was set against.
A mown grass is drawn at the narrow end of its range, as a mown leaf is.
The floras give no petal counts or flower sizes in a form that can be
reused, so the flowers' are from the floras' prose (Stace; Clapham, Tutin
and Moore). How a leaf leans, droops and twists is not measured anywhere
here: it was set by eye.

## Where its light and wind come from

- **Light lost in the stand.** Roots are as dark as exp(-K L) makes them
  (Monsi and Saeki), with the leaf area index from measured mown turf (Lee
  et al. 2011) and K from the sun's height (Campbell and Norman 1998).
  `look.depth` sets how far that is followed over a species' own
  `rootShade`; it is half by default, by eye.
- **A leaf's shine** is white, Fresnel-weighted and narrower along the leaf
  than across (roughness 0.18 and 0.46, from wheat leaves: Comar et al.).
  **Light through it** follows Barre-Brisebois and Bouchard (GDC 2011).
- **Wind.** A two-scale gust field scrolled downwind, as Sucker Punch
  describe for Ghost of Tsushima (GDC 2021), which also pales the far
  ground; over it every leaf swings in a small figure of eight, which
  Guerrilla found is most of what reads as wind (Sanders, GDC 2018).
- **Patches.** A species can have part of its ground in patches of another
  colour and height (`patch`, `patchSize`, `patchTint`, `patchTall`):
  annual meadow-grass in a bent green, green left in a parched lawn. They
  are a tint and a height, not other plants: no clover leaf is drawn.
  `patchKind` says which of three things they are. Colonies: discs grown
  out from where a plant landed, many small and few large, alike within
  and each a little unlike the next, gathered in drifts, with seedlings
  about them (annual meadow-grass on greens was measured at 10 cm to 2.5 m
  across, 50 cm on average: Poole and Johnston, WSU). Runners: the same for
  a plant that spreads by its runners and hardly by seed, so no seedlings
  (creeping bent in a meadow-grass green, white clover). Blotches: odd
  shapes with hazy edges, as drought makes. A colony's edge is ragged at a
  few runners' breadth, and no colony is cut off by the grid it is placed
  on.
- **The lie of the ground.** Where the map gives its `bounds`, each place
  is known as a crown (above the ground 2.5 m round it) or a hollow
  (below the ground 9 m round it). The grass is lusher in the hollows and
  paler on the crowns (`look.site`), and a species' patches take to one or
  the other (`patchSite`): meadow-grass to the wet, drought to the crowns.
  It is the ground's shape only: not shade, not which way a slope faces,
  not where the sprinklers reach.
- **Mowing stripes** are off unless `look.mown` is set: then leaves are
  laid one way and back in passes (`mowStripes`). Nothing is painted: a
  stand of leaves that all face one way sends back light by how much of
  each face the sun strikes and the eye sees (single scattering in an
  oriented canopy, after Ross 1981), with a leaf's under face darker than
  its upper. So the stripes are strong from the air, faint from a stance
  on the fairway, and change with the sun and as the eye goes round.

- **Colour.** A species' colour is a leaf's, worked out with the PROSPECT-D
  leaf model (Feret et al. 2017): what a leaf holding so much chlorophyll
  sends back of sun and sky, as linear sRGB, every species at one
  brightness. A grass leaf sends back about half as much red as green and
  a quarter as much blue, which is a good deal more red than a green
  picked by eye, and what the photographs show too. Through a leaf comes
  as much green, nearly as much red and almost no blue, and the light
  through the leaves is tinted so. The chlorophyll per square centimetre
  is an estimate for each grass (38 to 60 ug): no source gives it species
  against species. A leaf's wax, which greys fescue and bluegrass, is not
  in the model: it is added as a little more light sent back, most of it
  blue, by estimate.

## Flowers

A species can have up to four flowers in it (`blooms`). Each names a
flower (`"daisy"`, `"buttercup"`, `"dandelion"`, `"clover"`,
`"speedwell"`, `"selfheal"`, `"kikuyu"`, `"oxeye"`, `"redClover"`,
`"catsear"`, `"knapweed"`, `"yarrow"`, `"harebell"`, `"birdsfoot"`,
`"plantain"`, or one of the host's own, given as `flowers` when the grass
is made) and says how many to the square metre in the heart of one of its
colonies (`perM2`), the share of the stand's ground its colonies take
(`cover`), and where on the ground they take (`site`: creeping buttercup in
the wet hollows, cat's-ear on the dry banks, by the lie of the ground as a
species' patches go). A flower with `where: "patches"` grows only in the
species' patches, as white clover flowers where the clover is. Up to
sixteen kinds of flower are drawn at once.

Flowers grow as the plants of open grassland do, not evenly. Each flower
comes in colonies, a plant's runners or its own seed about where it took:
thickest at a centre and thinning out from it, some small and a few large
(`Flower.colony`, the radius most of one's flowers stand in, broad for a
creeper such as yarrow or white clover, small for one that only seeds near
itself). Ecologists draw clumped plants the same way (a Thomas cluster
process); no one has fitted one to these flowers, so the sizes are set from
how far each creeps in a year and how far seed falls (see `FLOWERS`). The colonies stand only where the ground suits that flower: a
slow noise of its own over some thirty metres, so one bank has it and the
next has none; the lie of the ground (`site`); and out of the trees' shade,
where a host says how much of the day's light a place goes without
(`world.shelter`; `Flower.light`, the least light it flowers in). A few
strays grow between colonies, and a flower's heads come up a few together,
from one plant. So most of a stand's
ground has none of a given flower and some has it thick. A flower stands
at its own height; in grass as tall as it is or taller it reaches up by up
to two fifths again, and no more, so a short flower in long grass is down
among the leaves.

A grass's seed heads (`seedShare`, the share of its stems in seed) come in
patches too: some ground a few metres across thick with heads and the next
with hardly one, and a slower swell over tens of metres; `seedShare` is
the share over the stand as a whole.

A `Flower` is plain data, as a species is: its form, how many petals, how
long and broad, how far they rise from flat (or, below nothing, hang), the
centre's breadth and how tall it is, how tall it stands, two colours. The
forms: a disc, petals about a centre (a daisy; with lift, a clover's ball;
with a tall centre, a knapweed's brush over its dark knob; hanging, a
grass's stamens); a spike, florets up a core (selfheal, plantain); an
umbel, florets over a low domed top (yarrow; a few large ones, a trefoil's
pea flowers); a bell, a cup that hangs from its stalk (harebell). Each is
as near as so few surfaces come: a pea flower is a cupped petal, a stalk has
no branches or leaves, and heather, a shrub, is not a flower in grass.

Within a few strides of the eye a flower is its petals, its centre and its
stalk; from there to about nineteen metres it is a dot of its colour, and
beyond that nothing. It nods in the wind and is lit and shaded as the
grass about it is, but not tinted as the grass is to match its ground: a
host that puts its ground's colours in `world.tint` gives the light alone
as `world.light`, which flowers take. `look.blooms = false` draws none.
Where each place has a flower, and which, is worked out once a frame in a
compute pass. In `TURF_SPECIES` the mown surfaces, the rough among them,
have none: a course keeps them clear. The deep rough has cat's-ear,
bird's-foot trefoil, ox-eye daisies and creeping buttercup; the fescue
cat's-ear, ox-eye daisies, harebells and yarrow; the meadow buttercups, red
clover, ox-eye daisies and knapweed. A lawn (`MORE_TURF.bluegrass`) has
daisies, clover and speedwell. Which grow where is from the floras; how
many was set by eye.

Not done: a ball or a foot does not flatten or hide a flower, flowers cast
no shadow, nothing flowers by the season (a host that has a date can
change `blooms`), and a daisy's thirty-odd rays are drawn as sixteen.

The way a head is built, each petal a small curved surface with nearer
and further drawings of it, follows
[Inkwell's WebGPU flower field](https://github.com/siliconjungle/inkwell-webgpu-flowers)
(MIT). None of its code or art is used.

## Things in the grass

`grass.setThings([{ x, y, z, radius, clear, keepSeen }])` tells the grass
what lies in it: up to four spheres (a ball, a stone). The grass under one
is pressed down beneath it, no leaf goes through it, and the leaves against
it are held still in the wind. `clear` is a nest pressed round it. With
`keepSeen` the leaves between the eye and the thing are kept under
the line of sight to its middle, so its top half shows and how deep it sits
can be read off: grass taller than a ball otherwise hides the ball. Give
`keepSeen` a share, 0 to 1, and that much of the thing shows from its top
down (`true` is a half). The thing itself is the host's to draw, and it
casts no shadow on the grass yet.

A thing with `flat: true` is not a sphere but a place something stands
on, a foot: the grass there is pressed to a third of its height.

`grass.setTrail(points)` is where something has gone through the grass: the
grass is laid over along the track as the thing passes and is back up in
about a second, since dry grass keeps no track. Wet grass (`look.wet`, 0 to
1) is slower up and its leaves along the track are a little darker for some
minutes: a faint line, on the leaves only. A dew track as a green shows it
(dark through pale) is not drawn yet.

The grass remembers what went through it: a grid of 4 cm cells over the 30 m
about the eye, wrapping round as the eye moves (after bevy-grass's trample
buffer). Each frame one pass fades every cell at the grass's own pace and
stamps in the trail and anything standing on the grass (`flat`), so a track
and a footprint stay after the points and the foot are gone: crushed and
laid over until the grass is back up, wiped of its wet for some minutes. A
plant reads four cells, however many things went through; the pass costs
about 0.15 ms a frame. A track further than 15 m or so from the eye is let
go. `grass.setStir({ x, z, dx, dz })` is a
stir of the air at a place, a club swung through: the grass within a
stride is pushed out and along.

A ball's lie in rough is how much of it stands above the grass: the grass
holds it up. `thingMiddleFor(grassTall, radius, showing)` gives the height
of its middle above the ground for a share `showing` of it to stand above
grass that tall, taking the top of a stand as its plants' mean height. No
two plants are the same height, so at any one place it is that give or
take a few millimetres. The lab's "A ball in the grass" panel sets it.

## In a host

As a dependency, from this repository at a commit you have looked at:

```bash
pnpm add github:jakobholmelund/webgpu-grass#<commit>
```

It is TypeScript source (`src/index.ts`), for a bundler that takes
TypeScript, and `three` is a peer: the host's own copy, r187.

What stands over the grass and is not grass is the host's to tell it, as
`createGrass({ ..., world })`: functions of a place, any of them left
out.

- `world.sun(xz)`: how much of the sun reaches the place, 0 to 1. A
  cloud's shadow, a tree's. The sky still lights it.
- `world.sky(xz)`: how much of the sky it sees, 0 to 1. Under a crown, in
  a hollow.
- `world.tint(xz)`: what the grass's colour is multiplied by. Wet grass.
- `world.shelter(xz)`: how much of the day's light the place goes without,
  0 open to 1 under a closed crown, for what grows there: a flower flowers
  less the less light it has (by 0.72 for each tenth lost, as meadow herbs
  at a forest's edge do) and not at all below its least (`Flower.light`).
  It should not move with the sun or the leaves' sway.
- `world.air(colour, at)`: the air between a leaf and the eye, for a host
  with haze of its own: the colour that reaches the eye.

The shaders call them in the compute pass and in fragment shaders both, so
a texture in one is looked up at a set level. The lab's "clouds' shadows"
is one: twenty lines in `lab/main.ts`.

A host that draws its own ground under the grass, in its own colours,
multiplies that colour by `grass.groundShade(xz)`: what the stand does to
the ground under it (dark between the leaves near the eye, the stand's
mean where the leaves are too far off to draw, its picture from above,
its patches, the grass's own shade). It takes the host's colour to be the
stand's as a whole, so give each species that colour over
`standTone(species)` for its leaves. It adds four textures to the
ground's shader, and a shader stage has sixteen on any machine: three if
the host gives its own tiling noise as `createGrass({ noise })`. The lab's
`?hostground` draws its ground this way.

The leaves are thickest about the eye and thin out from it. A picture of
something on the ground some way off (a ball at a golfer's feet, seen from
four metres behind) wants them about the thing instead:
`grass.update(renderer, camera, time, { x, y, z, focus: true })`.

A course that already keeps a field for each of its surfaces has its map
already. `fieldMap({ fields, species, x0, z0, width, depth, edgePerLead })`
takes those textures, a channel to a surface, and says which species each
channel is: a place belongs to the surface whose field is highest there.
`speciesMap`, for a plain grid of species numbers, is the same thing with
the fields made for you.

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
- **Things in the grass.** A ball, feet and a trail press it, and the grass
  remembers them (see "Things in the grass"), but nothing in it casts a
  shadow on it, and a dew track, dark through pale, is not drawn: the grid
  is where its wiped dew is kept, and the dew itself is the host's to draw.
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
- **The far tufts.** Beyond its leaves a tufted stand is drawn as tufts
  (`layers.far`, to 48 m), and an unmown one from 4 cm tall also where
  its own leaves are too thin to be seen nearer. A tuft is eight broad
  blades standing for a bunch of leaves: three of its species' leaves
  broad, and never narrower than 5.5 mm, so a fine fescue's tufts stand
  for its many leaves by breadth, not by number. That is coarser than the
  stand it stands for; fewer are kept further off and from higher up, each
  broadened for those left out (to three times); and over the last part of
  their range they take the ground's flat colour as the ground takes the
  stand's. From high overhead a stand of them shows as small stars.
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
- **The game.** Couch Golf Club draws its grass with this on its WebGPU
  renderer, pinned to a commit. Its standard renderer, and phones, still
  draw the game's own.

`STARTER_SPECIES` are the game's surfaces turned into rows, and a hay
meadow. `TURF_SPECIES`, which the lab starts from, are a golf course's eight surfaces
(creeping bent, perennial rye as fairway and as rough, red fescue, fescue
in seed, a hay meadow, bermuda, Kentucky bluegrass): their mowing heights
and leaf widths are the species' own, their colour is a leaf's by the leaf
model above, and their habit was set by eye beside photographs of the real
grass. The habit is a likeness, not a measurement: no leaf was measured
from a photograph. The photographs are
not here (their licences are not this one's): put your own in
`lab/reference/` with a `list.ts` (see `lab/reference.ts`; the folder is
ignored by git) and *Photo* on the bar shows each beside its species.

## Licence

MIT (`LICENSE`).
