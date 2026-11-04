import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import {
  buy,
  buyPrice,
  cargoUsed,
  createMarkets,
  driftMarkets,
  emptyCargo,
  maxAffordable,
  quoteBuy,
  quoteSell,
  sell,
  sellPrice,
  unitPrice,
} from '../../src/sim/economy';
import { GOODS, GOOD_IDS } from '../../src/sim/goods';
import { PORTS } from '../../src/sim/ports';

describe('economy', () => {
  it('has at least ten goods and every port stocks them', () => {
    expect(GOODS.length).toBeGreaterThanOrEqual(10);
    const m = createMarkets(1);
    for (const p of PORTS) for (const g of GOOD_IDS) expect(m[p.id][g].stock).toBeGreaterThan(0);
  });

  it('markets are deterministic per seed', () => {
    expect(createMarkets(5)).toEqual(createMarkets(5));
    expect(createMarkets(5)).not.toEqual(createMarkets(6));
  });

  it('producers sell cheaper than consumers buy', () => {
    const m = createMarkets(3);
    // Iceglass is produced at Rimeholt and demanded at Skyharbor.
    expect(buyPrice('rimeholt', 'iceglass', m.rimeholt.iceglass)).toBeLessThan(sellPrice('skyharbor', 'iceglass', m.skyharbor.iceglass));
  });

  it('price rises as stock falls (scarcity)', () => {
    const m = createMarkets(3);
    const mg = m.skyharbor.grain;
    expect(unitPrice('skyharbor', 'grain', mg, 10)).toBeGreaterThan(unitPrice('skyharbor', 'grain', mg, 200));
  });

  it('buying then immediately selling never makes a profit', () => {
    const m = createMarkets(9);
    for (const g of GOOD_IDS) {
      const cargo = emptyCargo();
      const ctx = { coins: 100000, cargo, capacity: 1000, reserved: 0 };
      const r = buy(m.skyharbor, 'skyharbor', g, 5, ctx);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const s = sell(m.skyharbor, 'skyharbor', g, 5, { ...ctx, coins: r.coins });
      expect(s.ok).toBe(true);
      if (s.ok) expect(s.coins).toBeLessThan(100000);
    }
  });

  it('quotes grow with quantity and match the trade totals', () => {
    const m = createMarkets(2);
    const mg = m.cinderquay.emberite;
    expect(quoteBuy('cinderquay', 'emberite', mg, 10)).toBeGreaterThan(quoteBuy('cinderquay', 'emberite', mg, 9));
    expect(quoteSell('cinderquay', 'emberite', mg, 10) / 10).toBeLessThanOrEqual(quoteSell('cinderquay', 'emberite', mg, 1));
    const cargo = emptyCargo();
    const before = quoteBuy('cinderquay', 'emberite', mg, 3);
    const r = buy(m.cinderquay, 'cinderquay', 'emberite', 3, { coins: 5000, cargo, capacity: 50, reserved: 0 });
    expect(r.ok && r.total).toBe(before);
  });

  it('enforces coin, capacity and stock limits', () => {
    const m = createMarkets(2);
    const cargo = emptyCargo();
    expect(buy(m.skyharbor, 'skyharbor', 'aether', 1, { coins: 1, cargo, capacity: 20, reserved: 0 }).ok).toBe(false);
    expect(buy(m.skyharbor, 'skyharbor', 'timber', 11, { coins: 99999, cargo, capacity: 20, reserved: 0 }).ok).toBe(false); // weight 2
    expect(buy(m.skyharbor, 'skyharbor', 'grain', 5, { coins: 99999, cargo, capacity: 20, reserved: 18 }).ok).toBe(false);
    expect(buy(m.skyharbor, 'skyharbor', 'grain', 100000, { coins: 1e9, cargo, capacity: 1e9, reserved: 0 }).ok).toBe(false);
    expect(sell(m.skyharbor, 'skyharbor', 'grain', 1, { coins: 0, cargo, capacity: 20, reserved: 0 }).ok).toBe(false);
    expect(buy(m.skyharbor, 'skyharbor', 'grain', 0, { coins: 100, cargo, capacity: 20, reserved: 0 }).ok).toBe(false);
  });

  it('maxAffordable is exactly purchasable', () => {
    const m = createMarkets(4);
    const cargo = emptyCargo();
    const ctx = { coins: 333, cargo, capacity: 20, reserved: 0 };
    const q = maxAffordable('skyharbor', 'tea', m.skyharbor.tea, ctx);
    expect(q).toBeGreaterThan(0);
    expect(buy(structuredClone(m.skyharbor), 'skyharbor', 'tea', q, { ...ctx, cargo: emptyCargo() }).ok).toBe(true);
    expect(buy(structuredClone(m.skyharbor), 'skyharbor', 'tea', q + 1, { ...ctx, cargo: emptyCargo() }).ok).toBe(false);
  });

  it('cargo weight counts heavy goods double', () => {
    const c = emptyCargo();
    c.timber = 3;
    c.grain = 2;
    expect(cargoUsed(c)).toBe(8);
    expect(cargoUsed(c, 4)).toBe(12);
  });

  it('drift is deterministic, bounded and relaxes towards targets', () => {
    const a = createMarkets(1);
    const b = createMarkets(1);
    a.skyharbor.grain.stock = 0;
    b.skyharbor.grain.stock = 0;
    driftMarkets(a, new Rng(5), 48);
    driftMarkets(b, new Rng(5), 48);
    expect(a).toEqual(b);
    expect(a.skyharbor.grain.stock).toBeGreaterThan(40);
    for (let i = 0; i < 500; i++) driftMarkets(a, new Rng(i), 1);
    for (const p of PORTS)
      for (const g of GOOD_IDS) {
        expect(a[p.id][g].trend).toBeGreaterThanOrEqual(0.6);
        expect(a[p.id][g].trend).toBeLessThanOrEqual(1.6);
        expect(a[p.id][g].stock).toBeGreaterThanOrEqual(0);
      }
  });
});
