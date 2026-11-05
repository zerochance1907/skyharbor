/** Ship upgrades and derived stats. Pure. */
export type UpgradeId = 'hull' | 'engine' | 'cargo' | 'lantern' | 'cannons' | 'tank';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  levels: { name: string; cost: number; blurb: string }[];
}

export const MAX_UPGRADE_LEVEL = 3;

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'hull',
    name: 'Hull',
    icon: '\u{1F6E1}️',
    levels: [
      { name: 'Driftwood Gondola', cost: 0, blurb: 'Patched planks and good intentions.' },
      { name: 'Oak-Ribbed Hull', cost: 450, blurb: 'Sturdier frame, +50% hull integrity.' },
      { name: 'Copper-Banded Hull', cost: 1400, blurb: 'Copper plating shrugs off grapeshot.' },
      { name: 'Ironclad Keel', cost: 3600, blurb: 'Iron plates and a ram-proof keel.' },
    ],
  },
  {
    id: 'engine',
    name: 'Engine',
    icon: '⚙️',
    levels: [
      { name: 'Single Screw', cost: 0, blurb: 'One propeller and a lot of patience.' },
      { name: 'Twin Screws', cost: 500, blurb: 'A second propeller for more speed.' },
      { name: 'Aether Turbines', cost: 1600, blurb: 'Crystal-fed turbines, faster and nimbler.' },
      { name: 'Stormrunner Drive', cost: 4000, blurb: 'Outrun anything with a sail.' },
    ],
  },
  {
    id: 'cargo',
    name: 'Cargo Hold',
    icon: '\u{1F4E6}',
    levels: [
      { name: 'Deck Crates', cost: 0, blurb: 'Room for a modest haul.' },
      { name: 'Slung Nets', cost: 350, blurb: 'Cargo nets under the gondola.' },
      { name: 'Side Pods', cost: 1100, blurb: 'Two riveted cargo pods.' },
      { name: 'Merchant Belly', cost: 2800, blurb: 'A deep hold for serious traders.' },
    ],
  },
  {
    id: 'lantern',
    name: 'Lantern',
    icon: '\u{1F3EE}',
    levels: [
      { name: 'Oil Lamp', cost: 0, blurb: 'Enough to read the compass by.' },
      { name: 'Brass Lantern', cost: 300, blurb: 'Lights the way and charts more sky.' },
      { name: 'Prism Beacon', cost: 900, blurb: 'A spinning prism charts wide swathes.' },
      { name: 'Starlight Searchlamp', cost: 2200, blurb: 'Turns night into dusk.' },
    ],
  },
  {
    id: 'cannons',
    name: 'Cannons',
    icon: '\u{1F4A5}',
    levels: [
      { name: 'Swivel Guns', cost: 0, blurb: 'One small gun per side.' },
      { name: 'Twin Broadside', cost: 600, blurb: 'Two guns each side.' },
      { name: 'Triple Battery', cost: 1700, blurb: 'Three heavy guns per side.' },
      { name: 'Thunder Deck', cost: 4200, blurb: 'Four rapid long-guns per side.' },
    ],
  },
  {
    id: 'tank',
    name: 'Aether Tank',
    icon: '\u{1F48E}',
    levels: [
      { name: 'Clay Flask', cost: 0, blurb: 'A short hop between ports.' },
      { name: 'Glass Ballast', cost: 400, blurb: 'Half again the range.' },
      { name: 'Twin Globes', cost: 1200, blurb: 'Two glowing aether globes.' },
      { name: 'Heart of the Reef', cost: 3000, blurb: 'Triple the starting range.' },
    ],
  },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<
  UpgradeId,
  UpgradeDef
>;

export type UpgradeLevels = Record<UpgradeId, number>;

export function defaultUpgrades(): UpgradeLevels {
  return { hull: 0, engine: 0, cargo: 0, lantern: 0, cannons: 0, tank: 0 };
}

export interface ShipStats {
  maxHull: number;
  armor: number;
  maxSpeed: number;
  accel: number;
  turnRate: number;
  climbRate: number;
  cargoCapacity: number;
  lanternRange: number;
  cannonsPerSide: number;
  cannonDamage: number;
  reload: number;
  fuelCapacity: number;
  /** Aether per second at full throttle. */
  fuelBurn: number;
}

const T = <T>(arr: readonly T[], lvl: number): T => arr[Math.max(0, Math.min(arr.length - 1, lvl))];

export function computeStats(u: UpgradeLevels): ShipStats {
  return {
    maxHull: T([100, 150, 220, 320], u.hull),
    armor: T([0, 0.1, 0.2, 0.32], u.hull),
    maxSpeed: T([40, 48, 57, 68], u.engine),
    accel: T([0.55, 0.65, 0.75, 0.9], u.engine),
    turnRate: T([0.8, 0.88, 0.97, 1.08], u.engine),
    climbRate: T([16, 19, 22, 26], u.engine),
    cargoCapacity: T([20, 35, 55, 80], u.cargo),
    lanternRange: T([90, 150, 220, 300], u.lantern),
    cannonsPerSide: T([1, 2, 3, 4], u.cannons),
    cannonDamage: T([12, 14, 17, 20], u.cannons),
    reload: T([3, 2.6, 2.2, 1.8], u.cannons),
    fuelCapacity: T([100, 150, 210, 300], u.tank),
    fuelBurn: T([0.55, 0.6, 0.62, 0.66], u.engine),
  };
}

export function upgradeCost(id: UpgradeId, currentLevel: number): number | null {
  if (currentLevel >= MAX_UPGRADE_LEVEL) return null;
  return UPGRADE_BY_ID[id].levels[currentLevel + 1].cost;
}

export type PurchaseResult = { ok: true; coins: number; level: number } | { ok: false; reason: string };

/** Attempt an upgrade purchase; returns the new coin total and level, without mutating. */
export function purchaseUpgrade(levels: UpgradeLevels, id: UpgradeId, coins: number): PurchaseResult {
  const cost = upgradeCost(id, levels[id]);
  if (cost === null) return { ok: false, reason: 'Already at the finest grade.' };
  if (coins < cost) return { ok: false, reason: 'Not enough coin.' };
  return { ok: true, coins: coins - cost, level: levels[id] + 1 };
}
