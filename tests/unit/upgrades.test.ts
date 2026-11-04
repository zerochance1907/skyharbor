import { describe, expect, it } from 'vitest';
import { MAX_UPGRADE_LEVEL, UPGRADES, computeStats, defaultUpgrades, purchaseUpgrade, upgradeCost } from '../../src/sim/upgrades';

describe('upgrades', () => {
  it('covers hull, engine, cargo, lantern and cannons', () => {
    const ids = UPGRADES.map((u) => u.id);
    for (const id of ['hull', 'engine', 'cargo', 'lantern', 'cannons']) expect(ids).toContain(id);
  });

  it('every level strictly improves its stat', () => {
    const base = defaultUpgrades();
    for (let lvl = 1; lvl <= MAX_UPGRADE_LEVEL; lvl++) {
      const prev = computeStats({ ...base, hull: lvl - 1, engine: lvl - 1, cargo: lvl - 1, lantern: lvl - 1, cannons: lvl - 1, tank: lvl - 1 });
      const next = computeStats({ ...base, hull: lvl, engine: lvl, cargo: lvl, lantern: lvl, cannons: lvl, tank: lvl });
      expect(next.maxHull).toBeGreaterThan(prev.maxHull);
      expect(next.maxSpeed).toBeGreaterThan(prev.maxSpeed);
      expect(next.cargoCapacity).toBeGreaterThan(prev.cargoCapacity);
      expect(next.lanternRange).toBeGreaterThan(prev.lanternRange);
      expect(next.cannonsPerSide).toBeGreaterThan(prev.cannonsPerSide);
      expect(next.reload).toBeLessThan(prev.reload);
      expect(next.fuelCapacity).toBeGreaterThan(prev.fuelCapacity);
    }
  });

  it('costs increase per level and stop at max', () => {
    for (const u of UPGRADES) {
      for (let l = 1; l < MAX_UPGRADE_LEVEL; l++) expect(u.levels[l + 1].cost).toBeGreaterThan(u.levels[l].cost);
      expect(upgradeCost(u.id, MAX_UPGRADE_LEVEL)).toBeNull();
    }
  });

  it('purchase checks coins and returns new level without mutating', () => {
    const lv = defaultUpgrades();
    const poor = purchaseUpgrade(lv, 'engine', 10);
    expect(poor.ok).toBe(false);
    const rich = purchaseUpgrade(lv, 'engine', 10000);
    expect(rich).toEqual({ ok: true, coins: 10000 - UPGRADES.find((u) => u.id === 'engine')!.levels[1].cost, level: 1 });
    expect(lv.engine).toBe(0);
    expect(purchaseUpgrade({ ...lv, hull: MAX_UPGRADE_LEVEL }, 'hull', 1e9).ok).toBe(false);
  });
});
