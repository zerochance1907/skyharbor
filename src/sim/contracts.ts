/**
 * Contract boards: deliveries, salvage runs, escorts and ruin hunts. Offers are
 * generated deterministically per port per day so reloading never rerolls them.
 */
import { Rng, hashInts, hashString } from '../core/rng';
import { dist2, TAU } from '../core/math';
import { GOOD_BY_ID, type GoodId } from './goods';
import { PORTS, PORT_BY_ID, type PortId } from './ports';
import type { World } from './world';

export type ContractKind = 'delivery' | 'salvage' | 'escort' | 'ruin';
export type ContractStatus = 'offered' | 'active' | 'ready' | 'done' | 'failed';

export interface Contract {
  id: string;
  kind: ContractKind;
  from: PortId;
  to: PortId | null;
  good?: GoodId;
  qty?: number;
  /** World target (salvage site, ruin island) and its radius. */
  target?: { x: number; y: number; z: number; r: number };
  /** Approximate search area shown on the map (ruin hunts). */
  hint?: { x: number; z: number; r: number };
  reward: number;
  deadline: number | null;
  title: string;
  desc: string;
  status: ContractStatus;
}

export interface ContractBook {
  offers: Partial<Record<PortId, Contract[]>>;
  offersDay: Partial<Record<PortId, number>>;
  active: Contract[];
  completed: number;
  failed: number;
}

export const MAX_ACTIVE_CONTRACTS = 4;

export function newContractBook(): ContractBook {
  return { offers: {}, offersDay: {}, active: [], completed: 0, failed: 0 };
}

const SALVAGE_NAMES = ['a drifting cargo barge', 'a lost mail sloop', 'a merchant’s jettisoned strongbox', 'a sunken survey skiff', 'a balloon-torn tea clipper'];
const ESCORT_NAMES = ['the cloth-barge Patience', 'the pilgrim ferry Halcyon', 'the tea-clipper Small Mercy', 'the post-sloop Featherpost', 'the ore hauler Old Grumble'];

export function generateOffers(world: World, port: PortId, day: number, nowHours: number): Contract[] {
  const rng = new Rng(hashInts(world.seed, hashString(port), day, 4040));
  const from = PORT_BY_ID[port];
  const others = PORTS.filter((p) => p.id !== port);
  const near = others.filter((p) => dist2(p.x, p.z, from.x, from.z) < 3800);
  const pool = near.length ? near : others;
  const out: Contract[] = [];
  const count = rng.int(3, 4);
  const kinds: ContractKind[] = rng.shuffle<ContractKind>(['delivery', 'salvage', 'escort', 'ruin', 'delivery']);
  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length];
    const id = `${port}-${day}-${i}`;
    if (kind === 'delivery') {
      const to = rng.pick(pool);
      const good = rng.pick(from.produces);
      const qty = rng.int(4, 10);
      const d = dist2(from.x, from.z, to.x, to.z);
      const reward = Math.round(60 + qty * GOOD_BY_ID[good].basePrice * 0.25 + d * 0.09);
      out.push({
        id,
        kind,
        from: port,
        to: to.id,
        good,
        qty,
        reward,
        deadline: nowHours + d / 500 + 8,
        title: `Deliver ${qty} ${GOOD_BY_ID[good].name} to ${to.name}`,
        desc: `${from.keeper} needs ${qty} crates of ${GOOD_BY_ID[good].name.toLowerCase()} carried to ${to.name}. Freight provided; it takes ${qty * GOOD_BY_ID[good].weight} cargo slots.`,
        status: 'offered',
      });
    } else if (kind === 'salvage') {
      const a = rng.range(0, TAU);
      const d = rng.range(700, 1700);
      const x = from.x + Math.cos(a) * d;
      const z = from.z + Math.sin(a) * d;
      const y = rng.range(90, 260);
      const name = rng.pick(SALVAGE_NAMES);
      out.push({
        id,
        kind,
        from: port,
        to: null,
        target: { x, y, z, r: 45 },
        reward: Math.round(140 + d * 0.13),
        deadline: null,
        title: `Salvage ${name}`,
        desc: `Recover the cargo of ${name}, last seen ${Math.round(d)} spans out. Fly through the salvage marker, then sell the find at any port.`,
        status: 'offered',
      });
    } else if (kind === 'escort') {
      const to = rng.pick(pool);
      const d = dist2(from.x, from.z, to.x, to.z);
      const name = rng.pick(ESCORT_NAMES);
      out.push({
        id,
        kind,
        from: port,
        to: to.id,
        reward: Math.round(220 + d * 0.16),
        deadline: null,
        title: `Escort ${name} to ${to.name}`,
        desc: `Keep ${name} safe from corsairs on the run to ${to.name}. Stay close: if you stray too far or she sinks, the contract fails.`,
        status: 'offered',
      });
    } else {
      const target = findRuinIsland(world, from.x, from.z, rng);
      if (!target) continue;
      const d = dist2(from.x, from.z, target.x, target.z);
      const ha = rng.range(0, TAU);
      const hr = rng.range(60, 220);
      out.push({
        id,
        kind,
        from: port,
        to: null,
        target: { x: target.x, y: target.y, z: target.z, r: target.radius + 90 },
        hint: { x: target.x + Math.cos(ha) * hr, z: target.z + Math.sin(ha) * hr, r: 320 },
        reward: Math.round(180 + d * 0.11),
        deadline: null,
        title: 'Find the lost ruin',
        desc: `A Guild-era map in the tavern marks ruins somewhere within the circled area. Find the island with standing stones, then report to any port.`,
        status: 'offered',
      });
    }
  }
  return out;
}

function findRuinIsland(world: World, x: number, z: number, rng: Rng) {
  const candidates = world.islandsInRect(x - 2800, z - 2800, x + 2800, z + 2800).filter((i) => {
    if (i.kind !== 'wild' || !i.ruins) return false;
    const d = dist2(i.x, i.z, x, z);
    return d > 700 && d < 2800;
  });
  return candidates.length ? rng.pick(candidates) : null;
}

/** Cargo slots occupied by active delivery freight. */
export function reservedSlots(book: ContractBook): number {
  let n = 0;
  for (const c of book.active) {
    if (c.kind === 'delivery' && c.status === 'active' && c.good && c.qty) n += c.qty * GOOD_BY_ID[c.good].weight;
  }
  return n;
}

export type AcceptResult = { ok: true } | { ok: false; reason: string };

export function acceptContract(book: ContractBook, port: PortId, id: string, freeSlots: number): AcceptResult {
  const offers = book.offers[port] ?? [];
  const c = offers.find((o) => o.id === id);
  if (!c || c.status !== 'offered') return { ok: false, reason: 'That contract is no longer posted.' };
  if (book.active.filter((a) => a.status === 'active' || a.status === 'ready').length >= MAX_ACTIVE_CONTRACTS)
    return { ok: false, reason: `You can hold at most ${MAX_ACTIVE_CONTRACTS} contracts.` };
  if (c.kind === 'escort' && book.active.some((a) => a.kind === 'escort' && a.status === 'active'))
    return { ok: false, reason: 'You are already escorting a ship.' };
  if (c.kind === 'delivery' && c.good && c.qty && c.qty * GOOD_BY_ID[c.good].weight > freeSlots)
    return { ok: false, reason: 'Not enough free cargo space for the freight.' };
  c.status = 'active';
  book.active.push(c);
  book.offers[port] = offers.filter((o) => o.id !== id);
  return { ok: true };
}

export interface ContractPayout {
  contract: Contract;
  reward: number;
}

/** Resolve contracts on docking at `port`. Returns payouts for completed ones. */
export function resolveOnDock(book: ContractBook, port: PortId): ContractPayout[] {
  const paid: ContractPayout[] = [];
  for (const c of book.active) {
    let ok = false;
    if (c.kind === 'delivery' && c.status === 'active' && c.to === port) ok = true;
    if ((c.kind === 'salvage' || c.kind === 'ruin') && c.status === 'ready') ok = true;
    if (c.kind === 'escort' && c.status === 'ready' && c.to === port) ok = true;
    if (ok) {
      c.status = 'done';
      book.completed++;
      paid.push({ contract: c, reward: c.reward });
    }
  }
  book.active = book.active.filter((c) => c.status === 'active' || c.status === 'ready');
  return paid;
}

/** Per-tick checks: deadlines and proximity objectives. Returns contracts whose status changed. */
export function updateContracts(book: ContractBook, nowHours: number, x: number, y: number, z: number): Contract[] {
  const changed: Contract[] = [];
  for (const c of book.active) {
    if (c.status === 'active' && c.deadline !== null && nowHours > c.deadline) {
      c.status = 'failed';
      book.failed++;
      changed.push(c);
      continue;
    }
    if (c.status === 'active' && (c.kind === 'salvage' || c.kind === 'ruin') && c.target) {
      const d = Math.hypot(c.target.x - x, (c.target.y - y) * (c.kind === 'ruin' ? 0.3 : 1), c.target.z - z);
      if (d < c.target.r) {
        c.status = 'ready';
        changed.push(c);
      }
    }
  }
  book.active = book.active.filter((c) => c.status !== 'failed');
  return changed;
}

export function failContract(book: ContractBook, id: string): Contract | null {
  const c = book.active.find((a) => a.id === id);
  if (!c) return null;
  c.status = 'failed';
  book.failed++;
  book.active = book.active.filter((a) => a !== c);
  return c;
}

/** Abandon a contract by choice (counts as failed). */
export function abandonContract(book: ContractBook, id: string): Contract | null {
  return failContract(book, id);
}

/** Make sure a port's board is fresh for today. */
export function refreshOffers(book: ContractBook, world: World, port: PortId, day: number, nowHours: number): Contract[] {
  if (book.offersDay[port] !== day || !book.offers[port]) {
    const taken = new Set(book.active.map((c) => c.id));
    book.offers[port] = generateOffers(world, port, day, nowHours).filter((c) => !taken.has(c.id));
    book.offersDay[port] = day;
  }
  return book.offers[port] ?? [];
}
