/**
 * Save/load: JSON serialisation with versioning and validation, autosave and
 * manual slots in localStorage, and file export/import.
 */
import { FogGrid } from './fog';
import { GOOD_IDS } from './goods';
import { PORT_BY_ID } from './ports';
import { SAVE_VERSION, type GameState } from './state';
import { UPGRADES, MAX_UPGRADE_LEVEL } from './upgrades';
import { emptyCargo } from './economy';

export const SAVE_PREFIX = 'skyharbor.save.';
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type SlotId = (typeof SLOTS)[number];

export interface SaveMeta {
  slot: SlotId;
  savedAt: number;
  shipName: string;
  day: number;
  coins: number;
  storyStep: number;
  location: string;
}

interface SaveFile {
  format: 'skyharbor-save';
  version: number;
  savedAt: number;
  state: Omit<GameState, 'fog'> & { fog: string };
}

export function serialize(state: GameState, savedAt = Date.now()): string {
  const file: SaveFile = {
    format: 'skyharbor-save',
    version: SAVE_VERSION,
    savedAt,
    state: { ...state, fog: state.fog.encode() },
  };
  return JSON.stringify(file);
}

export class SaveError extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Upgrade older save files in place. */
function migrate(file: SaveFile): SaveFile {
  // v1 is the first public format; future migrations chain here.
  return file;
}

export function deserialize(json: string): GameState {
  let file: SaveFile;
  try {
    file = JSON.parse(json) as SaveFile;
  } catch {
    throw new SaveError('This file is not a valid save (bad JSON).');
  }
  if (!file || file.format !== 'skyharbor-save' || !file.state) throw new SaveError('This file is not a Skyharbor save.');
  if (!isNum(file.version) || file.version > SAVE_VERSION) throw new SaveError('This save comes from a newer version of Skyharbor.');
  file = migrate(file);
  const s = file.state;
  const ship = s.ship;
  if (!ship || ![ship.x, ship.y, ship.z, ship.heading, ship.hull, ship.fuel].every(isNum)) throw new SaveError('Save is corrupted (ship).');
  if (!isNum(s.coins) || !isNum(s.time) || !isNum(s.seed)) throw new SaveError('Save is corrupted (core values).');
  if (!s.markets || typeof s.markets !== 'object') throw new SaveError('Save is corrupted (markets).');
  for (const u of UPGRADES) {
    const lvl = s.upgrades?.[u.id];
    if (!isNum(lvl) || lvl < 0 || lvl > MAX_UPGRADE_LEVEL) throw new SaveError('Save is corrupted (upgrades).');
  }
  const cargo = emptyCargo();
  const cargoCost = emptyCargo();
  for (const g of GOOD_IDS) {
    cargo[g] = Math.max(0, Math.floor(Number(s.cargo?.[g]) || 0));
    cargoCost[g] = Number(s.cargoCost?.[g]) || 0;
  }
  if (s.docked !== null && !(s.docked in PORT_BY_ID)) throw new SaveError('Save is corrupted (port).');
  const fog = typeof s.fog === 'string' ? FogGrid.decode(s.fog) : new FogGrid();
  return { ...s, cargo, cargoCost, fog, version: SAVE_VERSION } as GameState;
}

export function metaFor(slot: SlotId, state: GameState, savedAt: number): SaveMeta {
  return {
    slot,
    savedAt,
    shipName: state.shipName,
    day: Math.floor(state.time / 24) + 1,
    coins: Math.round(state.coins),
    storyStep: state.story.step,
    location: state.docked ? PORT_BY_ID[state.docked].name : 'Open sky',
  };
}

/** Minimal storage interface so tests can pass an in-memory implementation. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SaveManager {
  constructor(private store: KeyValueStore) {}

  save(slot: SlotId, state: GameState): SaveMeta {
    const savedAt = Date.now();
    const meta = metaFor(slot, state, savedAt);
    this.store.setItem(SAVE_PREFIX + slot, serialize(state, savedAt));
    this.store.setItem(SAVE_PREFIX + slot + '.meta', JSON.stringify(meta));
    return meta;
  }

  load(slot: SlotId): GameState | null {
    const raw = this.store.getItem(SAVE_PREFIX + slot);
    if (!raw) return null;
    return deserialize(raw);
  }

  meta(slot: SlotId): SaveMeta | null {
    try {
      const raw = this.store.getItem(SAVE_PREFIX + slot + '.meta');
      return raw ? (JSON.parse(raw) as SaveMeta) : null;
    } catch {
      return null;
    }
  }

  remove(slot: SlotId): void {
    this.store.removeItem(SAVE_PREFIX + slot);
    this.store.removeItem(SAVE_PREFIX + slot + '.meta');
  }

  /** Most recently saved slot, for the Continue button. */
  latest(): SaveMeta | null {
    let best: SaveMeta | null = null;
    for (const s of SLOTS) {
      const m = this.meta(s);
      if (m && (!best || m.savedAt > best.savedAt)) best = m;
    }
    return best;
  }
}

/** A storage that silently degrades when localStorage is unavailable. */
export function safeLocalStorage(): KeyValueStore {
  const mem = new Map<string, string>();
  const fallback: KeyValueStore = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
  try {
    const ls = globalThis.localStorage;
    const probe = '__skyharbor_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      getItem: (k) => {
        try {
          return ls.getItem(k);
        } catch {
          return fallback.getItem(k);
        }
      },
      setItem: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          fallback.setItem(k, v);
        }
      },
      removeItem: (k) => {
        try {
          ls.removeItem(k);
        } catch {
          fallback.removeItem(k);
        }
      },
    };
  } catch {
    return fallback;
  }
}
