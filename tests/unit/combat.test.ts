import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { applyDamage, fireBroadside, makeMerchant, makePirate, stepBalls, stepMerchant, stepPirate, headingTo } from '../../src/sim/combat';
import { forwardOf } from '../../src/sim/flight';

describe('combat', () => {
  it('broadsides fire sideways from the chosen side', () => {
    const rng = new Rng(1);
    const port = fireBroadside(0, 100, 0, 0, 0, 0, -1, 3, 10, 'player', rng);
    const stbd = fireBroadside(0, 100, 0, 0, 0, 0, 1, 3, 10, 'player', rng);
    expect(port).toHaveLength(3);
    for (const b of port) expect(b.vx).toBeLessThan(-100);
    for (const b of stbd) expect(b.vx).toBeGreaterThan(100);
  });

  it('cannonballs hit enemies, ignore friends and expire', () => {
    const rng = new Rng(1);
    const balls = fireBroadside(0, 100, 0, 0, 0, 0, 1, 1, 10, 'player', rng);
    const targets = [
      { x: 60, y: 100, z: 0, id: 5, team: 'enemy' as const },
      { x: 30, y: 100, z: 0, id: 0, team: 'player' as const },
    ];
    const hits = [];
    for (let i = 0; i < 60 && balls.length; i++) hits.push(...stepBalls(balls, targets, 1 / 60));
    expect(hits.map((h) => h.targetId)).toEqual([5]);
    const miss = fireBroadside(0, 100, 0, 0, 0, 0, -1, 1, 10, 'player', rng);
    for (let i = 0; i < 400; i++) stepBalls(miss, targets, 1 / 60);
    expect(miss).toHaveLength(0);
  });

  it('pirates sink at zero hp exactly once', () => {
    const p = makePirate(1, 0, 0, 0, new Rng(2));
    expect(applyDamage(p, 10)).toBe(false);
    expect(applyDamage(p, 1000)).toBe(true);
    expect(p.state).toBe('sinking');
    expect(applyDamage(p, 10)).toBe(false);
  });

  it('pirates chase, close distance and eventually fire', () => {
    const rng = new Rng(3);
    const p = makePirate(1, 600, 100, 0, rng);
    let fired = 0;
    let minD = Infinity;
    for (let i = 0; i < 60 * 60; i++) {
      if (stepPirate(p, 0, 100, 0, false, 1 / 60, rng)) fired++;
      minD = Math.min(minD, Math.hypot(p.x, p.z));
    }
    expect(minD).toBeLessThan(300);
    expect(fired).toBeGreaterThan(0);
  });

  it('pirates break off near ports and flee when crippled', () => {
    const rng = new Rng(4);
    const p = makePirate(1, 300, 100, 0, rng);
    stepPirate(p, 0, 100, 0, true, 1 / 60, rng);
    expect(p.state).toBe('patrol');
    p.hp = p.maxHp * 0.1;
    stepPirate(p, 0, 100, 0, false, 1 / 60, rng);
    expect(p.state).toBe('flee');
  });

  it('merchants travel to their destination', () => {
    const m = makeMerchant(9, 0, 100, 0, { x: 0, y: 100, z: -800 }, 'c1');
    let arrived = false;
    for (let i = 0; i < 60 * 120 && !arrived; i++) arrived = stepMerchant(m, 1 / 60);
    expect(arrived).toBe(true);
  });

  it('headingTo agrees with forwardOf', () => {
    const h = headingTo(0, 0, 100, 0);
    expect(forwardOf(h).x).toBeCloseTo(1);
  });
});
