// The package's public face. The lab (../lab) imports from here and from
// nowhere else in the package, and nothing in the package imports from the
// game: scripts/grass-boundary.test.mjs holds both.

export { DEFAULT_LAYERS, type Grass, type GrassLayer, type GrassLayers, type GrassOptions, MAX_LEAF_TEXTURES, type NearLayer, type Specimen, type SpecimenKind, createGrass } from "./engine";
export { type GrassMap, type HeightGrid, type HeightSource, type MapSource, type MowSource, type MowStripes, NO_GRASS, type SpeciesMapSource, heightAt, heightGrid, mowStripes, speciesMap } from "./field";
export { MAX_SPECIES, MORE_TURF, type PatchKind, STARTER_SPECIES, TURF_SPECIES, type Species, type TextureMode, type TipShape, checkSpecies, cloneSpecies } from "./species";
