// The package's public face. The lab (../lab) imports from here and from
// nowhere else in the package, and nothing in the package imports from the
// game: scripts/grass-boundary.test.mjs holds both.

export { DEFAULT_LAYERS, type Grass, type GrassLayer, type GrassThing, MAX_THINGS, MAX_TRAIL, thingMiddleFor, standTone, type GrassLayers, type GrassOptions, type PlaceKnown, type WorldLight, MAX_LEAF_TEXTURES, type NearLayer, type Specimen, type SpecimenKind, createGrass } from "./engine";
export { type FieldMap, type GrassMap, type HeightGrid, type HeightSource, type MapSource, type MowSource, type MowStripes, NO_GRASS, type SpeciesMapSource, heightAt, fieldMap, heightGrid, mowStripes, speciesMap } from "./field";
export { GRASSES, type GrassName, MAX_SPECIES, MORE_GRASSES, MORE_PLANTS, MORE_TURF, type PatchKind, STARTER_SPECIES, TURF_SPECIES, type Species, type TextureMode, type TipShape, checkSpecies, cloneSpecies } from "./species";
export { type Bloom, FLOWERS, type Flower, MAX_BLOOMS, MAX_FLOWERS, MAX_PETALS } from "./flowers";
export { probePlacement } from "./placement";
export { RANK_SIDE, finePlace, grassRanks, rankMatrix, rankOf } from "./rank";
