/** The complete saveable game state and new-game construction. */
import { createMarkets, emptyCargo, type Cargo, type Markets } from './economy';
import { newShip, type ShipState } from './flight';
import { FogGrid } from './fog';
import { newContractBook, type ContractBook } from './contracts';
import { PORT_BY_ID, approachPosition, type PortId } from './ports';
import { newStory, type StoryState } from './story';
import { computeStats, defaultUpgrades, type UpgradeLevels } from './upgrades';
import { initialWeather, type WeatherState } from './weather';
import { hashInts } from '../core/rng';

export type PaintPattern = 'plain' | 'stripes' | 'band' | 'chevron';
export type Emblem = 'none' | 'compass' | 'star' | 'whale' | 'feather';

export interface Paint {
  envelope: number;
  hull: number;
  trim: number;
  sail: number;
  pattern: PaintPattern;
  emblem: Emblem;
}

export interface JournalEntry {
  day: number;
  text: string;
  kind: 'story' | 'trade' | 'contract' | 'discovery' | 'combat';
}

export interface GameStats {
  distance: number;
  tradeProfit: number;
  goodsTraded: number;
  piratesSunk: number;
  contractsDone: number;
  daysAfloat: number;
}

export interface GameState {
  version: number;
  seed: number;
  /** Game time in hours since the voyage began (starts mid-morning). */
  time: number;
  playTime: number;
  coins: number;
  shipName: string;
  ship: ShipState;
  upgrades: UpgradeLevels;
  paint: Paint;
  unlockedPaints: string[];
  cargo: Cargo;
  /** Average price paid per good, for profit hints. */
  cargoCost: Cargo;
  markets: Markets;
  marketHour: number;
  contracts: ContractBook;
  story: StoryState;
  fragments: string[];
  discoveredPorts: PortId[];
  discoveredLandmarks: string[];
  fog: FogGrid;
  docked: PortId | null;
  lastPort: PortId;
  reputation: number;
  stats: GameStats;
  journal: JournalEntry[];
  weather: WeatherState;
  rng: number;
}

export const SAVE_VERSION = 1;
export const HOURS_PER_SECOND = 1 / 30; // a full day lasts 12 real minutes
export const START_HOUR = 9;

export const DEFAULT_PAINT: Paint = {
  envelope: 0xe9dcc0,
  hull: 0x8a5a3b,
  trim: 0xc9a14a,
  sail: 0xb8433a,
  pattern: 'band',
  emblem: 'compass',
};

export function newGame(seed: number, shipName = 'Wayfarer'): GameState {
  const upgrades = defaultUpgrades();
  const stats = computeStats(upgrades);
  const home = PORT_BY_ID.skyharbor;
  const start = approachPosition(home);
  // Start a little further out, facing the dock.
  const sx = start.x + 140;
  const sz = start.z + 40;
  const heading = Math.atan2(-(start.x - sx), -(start.z - sz));
  const ship = newShip(sx, home.y + 18, sz, heading, stats);
  const fog = new FogGrid();
  fog.reveal(home.x, home.z, 700);
  return {
    version: SAVE_VERSION,
    seed: seed >>> 0,
    time: START_HOUR,
    playTime: 0,
    coins: 400,
    shipName,
    ship,
    upgrades,
    paint: { ...DEFAULT_PAINT },
    unlockedPaints: [],
    cargo: emptyCargo(),
    cargoCost: emptyCargo(),
    markets: createMarkets(seed),
    marketHour: START_HOUR,
    contracts: newContractBook(),
    story: newStory(),
    fragments: [],
    discoveredPorts: ['skyharbor'],
    discoveredLandmarks: [],
    fog,
    docked: null,
    lastPort: 'skyharbor',
    reputation: 0,
    stats: { distance: 0, tradeProfit: 0, goodsTraded: 0, piratesSunk: 0, contractsDone: 0, daysAfloat: 0 },
    journal: [{ day: 0, text: 'Cast off from Skyharbor aboard the ' + shipName + '. The harbormaster wants a word.', kind: 'story' }],
    weather: initialWeather(),
    rng: hashInts(seed, 9001),
  };
}

export function dayOf(time: number): number {
  return Math.floor(time / 24);
}

export function hourOf(time: number): number {
  return ((time % 24) + 24) % 24;
}

export function addJournal(s: GameState, text: string, kind: JournalEntry['kind']): void {
  s.journal.unshift({ day: dayOf(s.time), text, kind });
  if (s.journal.length > 120) s.journal.length = 120;
}
