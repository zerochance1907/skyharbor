/** Biome definitions: palettes and generation parameters. Pure data. */
export type BiomeId = 'meadow' | 'frost' | 'ember' | 'crystal';

export interface BiomePalette {
  grass: number;
  grassAlt: number;
  rock: number;
  rockDark: number;
  underside: number;
  foliage: number;
  foliageAlt: number;
  trunk: number;
  accent: number;
  water: number;
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  description: string;
  palette: BiomePalette;
  /** Hilliness of the island top. */
  hills: number;
  /** How spiky the island is (frost spires, ember crags). */
  spikes: number;
  /** Tree density 0..1. */
  trees: number;
  rocks: number;
  waterfallChance: number;
  /** Underside depth relative to radius. */
  depth: number;
  /** Pirate danger 0..1 */
  danger: number;
  /** Storm likelihood modifier. */
  storminess: number;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  meadow: {
    id: 'meadow',
    name: 'Meadow Isles',
    description: 'Gentle green islands of orchards, sheep and windmills.',
    palette: {
      grass: 0x7fbf5a,
      grassAlt: 0xa4cf63,
      rock: 0x9b8a72,
      rockDark: 0x6e604f,
      underside: 0x5d4f43,
      foliage: 0x4f9a46,
      foliageAlt: 0x77b84d,
      trunk: 0x6b4a32,
      accent: 0xf3d36b,
      water: 0x8fd6f0,
    },
    hills: 14,
    spikes: 0.1,
    trees: 0.65,
    rocks: 0.25,
    waterfallChance: 0.55,
    depth: 0.75,
    danger: 0.15,
    storminess: 0.6,
  },
  frost: {
    id: 'frost',
    name: 'Frost Spires',
    description: 'Needle peaks of blue ice wrapped in snow and silent pines.',
    palette: {
      grass: 0xe8f1f7,
      grassAlt: 0xcfe2ee,
      rock: 0x8a9db5,
      rockDark: 0x5f7290,
      underside: 0x4a5a74,
      foliage: 0x2f5d57,
      foliageAlt: 0x3f7468,
      trunk: 0x4e3b30,
      accent: 0x9fe3ff,
      water: 0xbdeeff,
    },
    hills: 22,
    spikes: 0.85,
    trees: 0.4,
    rocks: 0.45,
    waterfallChance: 0.3,
    depth: 1.05,
    danger: 0.35,
    storminess: 1.2,
  },
  ember: {
    id: 'ember',
    name: 'Ember Rocks',
    description: 'Scorched basalt crags veined with glowing emberite.',
    palette: {
      grass: 0x5a3a33,
      grassAlt: 0x7a4634,
      rock: 0x3d3236,
      rockDark: 0x2a2226,
      underside: 0x231c1f,
      foliage: 0xc2562c,
      foliageAlt: 0xe8833a,
      trunk: 0x2b2020,
      accent: 0xff7a2f,
      water: 0xff9b4a,
    },
    hills: 18,
    spikes: 0.6,
    trees: 0.18,
    rocks: 0.7,
    waterfallChance: 0.35,
    depth: 0.9,
    danger: 0.8,
    storminess: 0.9,
  },
  crystal: {
    id: 'crystal',
    name: 'Crystal Reefs',
    description: 'Pastel reefs of singing crystal that drink the starlight.',
    palette: {
      grass: 0x9fd8c9,
      grassAlt: 0xc4b5f0,
      rock: 0x7f86b8,
      rockDark: 0x575d8f,
      underside: 0x403f6b,
      foliage: 0xe59ff2,
      foliageAlt: 0x8cf0e6,
      trunk: 0x6d5aa0,
      accent: 0xb6fff4,
      water: 0xc9f7ff,
    },
    hills: 10,
    spikes: 0.45,
    trees: 0.45,
    rocks: 0.5,
    waterfallChance: 0.4,
    depth: 0.85,
    danger: 0.45,
    storminess: 0.8,
  },
};

export const BIOME_IDS: BiomeId[] = ['meadow', 'frost', 'ember', 'crystal'];
