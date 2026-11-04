/**
 * Port markets. Each port keeps a stock and a demand trend for every good.
 * Prices respond to stock (scarcity raises them), port specialisation and a
 * drifting trend; buying and selling move stock so every trade nudges prices.
 */
import { Rng, hashInts, hashString } from '../core/rng';
import { clamp } from '../core/math';
import { GOODS, GOOD_BY_ID, GOOD_IDS, type GoodId } from './goods';
import { PORTS, PORT_BY_ID, type PortId } from './ports';

export interface MarketGood {
  stock: number;
  target: number;
  trend: number;
}

export type Market = Record<GoodId, MarketGood>;
export type Markets = Record<PortId, Market>;
export type Cargo = Record<GoodId, number>;

export const BUY_SPREAD = 1.07;
export const SELL_SPREAD = 0.93;

export function emptyCargo(): Cargo {
  return Object.fromEntries(GOOD_IDS.map((g) => [g, 0])) as Cargo;
}

/** Specialisation multiplier: producers sell cheap, consumers pay dear. */
export function portModifier(port: PortId, good: GoodId): number {
  const p = PORT_BY_ID[port];
  const jitter = 0.92 + ((hashInts(hashString(port), hashString(good)) % 1000) / 1000) * 0.16;
  if (p.produces.includes(good)) return 0.62 * jitter;
  if (p.demands.includes(good)) return 1.5 * jitter;
  return jitter;
}

export function targetStock(port: PortId, good: GoodId): number {
  const p = PORT_BY_ID[port];
  if (p.produces.includes(good)) return 140;
  if (p.demands.includes(good)) return 18;
  return 55;
}

export function createMarkets(seed: number): Markets {
  const rng = new Rng(hashInts(seed, 1001));
  const markets = {} as Markets;
  for (const p of PORTS) {
    const m = {} as Market;
    for (const g of GOODS) {
      const target = targetStock(p.id, g.id);
      m[g.id] = { stock: Math.round(target * rng.range(0.75, 1.25)), target, trend: rng.range(0.9, 1.1) };
    }
    markets[p.id] = m;
  }
  return markets;
}

/** Mid-market unit price at a given stock level. */
export function unitPrice(port: PortId, good: GoodId, mg: MarketGood, stock = mg.stock): number {
  const base = GOOD_BY_ID[good].basePrice;
  const scarcity = clamp(Math.pow(mg.target / Math.max(stock, 1), 0.5), 0.5, 2.6);
  return base * portModifier(port, good) * mg.trend * scarcity;
}

export function buyPrice(port: PortId, good: GoodId, mg: MarketGood): number {
  return Math.max(1, Math.round(unitPrice(port, good, mg) * BUY_SPREAD));
}

export function sellPrice(port: PortId, good: GoodId, mg: MarketGood): number {
  return Math.max(1, Math.round(unitPrice(port, good, mg) * SELL_SPREAD));
}

/** Total cost to buy `qty` units, with the price climbing as stock is drained. */
export function quoteBuy(port: PortId, good: GoodId, mg: MarketGood, qty: number): number {
  let total = 0;
  for (let i = 0; i < qty; i++) total += Math.max(1, Math.round(unitPrice(port, good, mg, mg.stock - i) * BUY_SPREAD));
  return total;
}

/** Total proceeds from selling `qty` units, with the price sagging as stock grows. */
export function quoteSell(port: PortId, good: GoodId, mg: MarketGood, qty: number): number {
  let total = 0;
  for (let i = 0; i < qty; i++) total += Math.max(1, Math.round(unitPrice(port, good, mg, mg.stock + i) * SELL_SPREAD));
  return total;
}

export function cargoUsed(cargo: Cargo, extra = 0): number {
  let used = extra;
  for (const g of GOOD_IDS) used += cargo[g] * GOOD_BY_ID[g].weight;
  return used;
}

export interface TradeContext {
  coins: number;
  cargo: Cargo;
  capacity: number;
  /** Cargo slots used by contract freight. */
  reserved: number;
}

export type TradeResult = { ok: true; coins: number; total: number } | { ok: false; reason: string };

/** Largest quantity the player could buy right now. */
export function maxAffordable(port: PortId, good: GoodId, mg: MarketGood, ctx: TradeContext): number {
  const space = Math.floor((ctx.capacity - cargoUsed(ctx.cargo, ctx.reserved)) / GOOD_BY_ID[good].weight);
  let qty = 0;
  let cost = 0;
  const limit = Math.min(space, Math.floor(mg.stock));
  while (qty < limit) {
    const next = Math.max(1, Math.round(unitPrice(port, good, mg, mg.stock - qty) * BUY_SPREAD));
    if (cost + next > ctx.coins) break;
    cost += next;
    qty++;
  }
  return qty;
}

/** Buy goods: mutates market stock and cargo on success. */
export function buy(market: Market, port: PortId, good: GoodId, qty: number, ctx: TradeContext): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'Invalid quantity.' };
  const mg = market[good];
  if (qty > mg.stock) return { ok: false, reason: 'The market has no more to sell.' };
  const weight = GOOD_BY_ID[good].weight * qty;
  if (cargoUsed(ctx.cargo, ctx.reserved) + weight > ctx.capacity) return { ok: false, reason: 'Not enough cargo space.' };
  const total = quoteBuy(port, good, mg, qty);
  if (total > ctx.coins) return { ok: false, reason: 'Not enough coin.' };
  mg.stock -= qty;
  ctx.cargo[good] += qty;
  return { ok: true, coins: ctx.coins - total, total };
}

/** Sell goods: mutates market stock and cargo on success. */
export function sell(market: Market, port: PortId, good: GoodId, qty: number, ctx: TradeContext): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'Invalid quantity.' };
  if (ctx.cargo[good] < qty) return { ok: false, reason: 'You do not carry that much.' };
  const mg = market[good];
  const total = quoteSell(port, good, mg, qty);
  mg.stock += qty;
  ctx.cargo[good] -= qty;
  return { ok: true, coins: ctx.coins + total, total };
}

export interface MarketEvent {
  port: PortId;
  good: GoodId;
  kind: 'shortage' | 'glut';
}

/**
 * Let markets breathe over `hours` of game time: stock relaxes toward its
 * target, trends random-walk, and occasional shortages or gluts strike.
 */
export function driftMarkets(markets: Markets, rng: Rng, hours: number): MarketEvent[] {
  const events: MarketEvent[] = [];
  const relax = 1 - Math.exp(-0.06 * hours);
  for (const p of PORTS) {
    const m = markets[p.id];
    for (const g of GOODS) {
      const mg = m[g.id];
      mg.stock += (mg.target - mg.stock) * relax + rng.range(-1, 1) * Math.sqrt(hours) * 1.5;
      mg.stock = clamp(mg.stock, 0, mg.target * 4 + 40);
      const vol = g.volatility * 0.03 * Math.sqrt(hours);
      mg.trend += rng.range(-vol, vol) + (1 - mg.trend) * 0.04 * hours;
      mg.trend = clamp(mg.trend, 0.6, 1.6);
      if (rng.chance(0.0025 * hours)) {
        if (rng.chance(0.5)) {
          mg.stock *= 0.3;
          mg.trend = clamp(mg.trend + 0.25, 0.6, 1.6);
          events.push({ port: p.id, good: g.id, kind: 'shortage' });
        } else {
          mg.stock = mg.stock * 1.8 + 20;
          mg.trend = clamp(mg.trend - 0.2, 0.6, 1.6);
          events.push({ port: p.id, good: g.id, kind: 'glut' });
        }
      }
    }
  }
  return events;
}

/** Best known profitable route from a port: used for tavern rumours. */
export function bestTrade(markets: Markets, from: PortId): { good: GoodId; to: PortId; margin: number } | null {
  let best: { good: GoodId; to: PortId; margin: number } | null = null;
  for (const g of GOOD_IDS) {
    const b = buyPrice(from, g, markets[from][g]);
    for (const p of PORTS) {
      if (p.id === from) continue;
      const s = sellPrice(p.id, g, markets[p.id][g]);
      const margin = s - b;
      if (!best || margin > best.margin) best = { good: g, to: p.id, margin };
    }
  }
  return best;
}

export const FUEL_PRICE = 2;
export const REPAIR_PRICE = 1.5;
