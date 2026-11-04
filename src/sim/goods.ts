/** Trade goods. Pure data. */
export type GoodId =
  | 'grain'
  | 'wool'
  | 'timber'
  | 'tea'
  | 'iceglass'
  | 'furs'
  | 'emberite'
  | 'clockwork'
  | 'spice'
  | 'lanternoil'
  | 'silk'
  | 'aether'
  | 'medicine';

export interface GoodDef {
  id: GoodId;
  name: string;
  basePrice: number;
  /** Cargo slots per unit. */
  weight: number;
  icon: string;
  blurb: string;
  /** How strongly the price swings (volatility). */
  volatility: number;
}

export const GOODS: GoodDef[] = [
  { id: 'grain', name: 'Sky Grain', basePrice: 12, weight: 1, icon: '\u{1F33E}', blurb: 'Golden wind-wheat from the meadow terraces.', volatility: 0.6 },
  { id: 'wool', name: 'Cloudwool', basePrice: 18, weight: 1, icon: '\u{1F9F6}', blurb: 'Impossibly light fleece from high-pasture sheep.', volatility: 0.7 },
  { id: 'timber', name: 'Drift Timber', basePrice: 22, weight: 2, icon: '\u{1FAB5}', blurb: 'Buoyant hardwood, prized by shipwrights.', volatility: 0.6 },
  { id: 'tea', name: 'Highland Tea', basePrice: 28, weight: 1, icon: '\u{1F375}', blurb: 'Smoky leaves that keep night crews awake.', volatility: 0.8 },
  { id: 'iceglass', name: 'Iceglass', basePrice: 46, weight: 1, icon: '\u{1F9CA}', blurb: 'Glass that never melts, cut from frost spires.', volatility: 0.9 },
  { id: 'furs', name: 'Snow Furs', basePrice: 38, weight: 1, icon: '\u{1F9E5}', blurb: 'Warm pelts traded by the spire hunters.', volatility: 0.8 },
  { id: 'emberite', name: 'Emberite Ore', basePrice: 54, weight: 2, icon: '\u{1F525}', blurb: 'Warm-to-the-touch ore that powers forges.', volatility: 1.0 },
  { id: 'clockwork', name: 'Clockwork Parts', basePrice: 72, weight: 1, icon: '⚙️', blurb: 'Precision gears from the Cinderquay foundries.', volatility: 0.9 },
  { id: 'spice', name: 'Ashpepper Spice', basePrice: 64, weight: 1, icon: '\u{1F336}️', blurb: 'A fiery spice grown in volcanic ash.', volatility: 1.2 },
  { id: 'lanternoil', name: 'Lantern Oil', basePrice: 30, weight: 1, icon: '\u{1FA94}', blurb: 'Clean-burning oil pressed from glowfruit.', volatility: 0.7 },
  { id: 'silk', name: 'Mothsilk', basePrice: 84, weight: 1, icon: '\u{1F9F5}', blurb: 'Shimmering cloth spun by giant cloud-moths.', volatility: 1.0 },
  { id: 'aether', name: 'Aether Crystals', basePrice: 96, weight: 1, icon: '\u{1F48E}', blurb: 'Raw lift-crystal. Every airship hungers for it.', volatility: 1.1 },
  { id: 'medicine', name: 'Remedies', basePrice: 58, weight: 1, icon: '⚗️', blurb: 'Tinctures brewed by the Pale Spindle sisters.', volatility: 0.9 },
];

export const GOOD_BY_ID: Record<GoodId, GoodDef> = Object.fromEntries(GOODS.map((g) => [g.id, g])) as Record<
  GoodId,
  GoodDef
>;

export const GOOD_IDS: GoodId[] = GOODS.map((g) => g.id);
