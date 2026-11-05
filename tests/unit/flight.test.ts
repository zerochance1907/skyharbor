import { describe, expect, it } from 'vitest';
import { BOOST_FACTOR, MIN_THROTTLE, newShip, stepFlight, forwardOf, type FlightEnv, type FlightInput } from '../../src/sim/flight';
import { computeStats, defaultUpgrades } from '../../src/sim/upgrades';
import { Rng } from '../../src/core/rng';
import { World } from '../../src/sim/world';

const stats = computeStats(defaultUpgrades());
const calm: FlightEnv = { windX: 0, windZ: 0, updraft: 0 };
const idle: FlightInput = { throttle: 0, rudder: 0, lift: 0, boost: false };

function run(steps: number, input: FlightInput, env = calm, ship = newShip(0, 200, 0, 0, stats)) {
  for (let i = 0; i < steps; i++) stepFlight(ship, input, stats, env, 1 / 60);
  return ship;
}

describe('flight physics invariants', () => {
  it('full throttle accelerates forward (north at heading 0)', () => {
    const s = run(600, { ...idle, throttle: 1 });
    expect(s.throttle).toBe(1);
    expect(s.z).toBeLessThan(-100);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
  });

  it('never exceeds max speed (boost included) through the air', () => {
    const rng = new Rng(3);
    const s = newShip(0, 200, 0, 0, stats);
    for (let i = 0; i < 5000; i++) {
      const input = { throttle: rng.range(-1, 1), rudder: rng.range(-1, 1), lift: rng.range(-1, 1), boost: rng.chance(0.5) };
      stepFlight(s, input, stats, calm, 1 / 60);
      expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(stats.maxSpeed * BOOST_FACTOR + 1e-6);
      expect(s.throttle).toBeGreaterThanOrEqual(MIN_THROTTLE);
      expect(s.throttle).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.x + s.y + s.z + s.heading)).toBe(true);
      expect(Math.abs(s.heading)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  it('with zero throttle and no wind the ship comes to rest', () => {
    const s = run(300, { ...idle, throttle: 1 });
    s.throttle = 0;
    run(1800, idle, calm, s);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(0.5);
  });

  it('drifts with the wind when idle', () => {
    const s = run(1200, idle, { windX: 6, windZ: 0, updraft: 0 });
    expect(s.vx).toBeCloseTo(6, 1);
    expect(s.x).toBeGreaterThan(50);
  });

  it('rudder right turns clockwise (heading decreases)', () => {
    const s = run(120, { ...idle, throttle: 1, rudder: 1 });
    expect(s.heading).toBeLessThan(0);
    expect(s.roll).not.toBe(0);
  });

  it('climbs, descends and is pushed out of the Undercloud', () => {
    const up = run(300, { ...idle, lift: 1 });
    expect(up.y).toBeGreaterThan(230);
    const down = run(2000, { ...idle, lift: -1 }, calm, newShip(0, 30, 0, 0, stats));
    expect(down.y).toBeGreaterThan(-15);
    expect(down.hull).toBeLessThan(stats.maxHull);
  });

  it('burns fuel with throttle and keeps moving on emergency sails', () => {
    const s = newShip(0, 200, 0, 0, stats);
    s.fuel = 1;
    run(600, { ...idle, throttle: 1 }, calm, s);
    expect(s.fuel).toBe(0);
    const z0 = s.z;
    const ev = stepFlight(s, { ...idle, throttle: 1 }, stats, calm, 1 / 60);
    expect(ev.outOfFuel).toBe(true);
    run(600, { ...idle, throttle: 1 }, calm, s);
    expect(s.z).toBeLessThan(z0 - 10);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(stats.maxSpeed * 0.3);
  });

  it('fuel never increases and is unused at zero throttle', () => {
    const s = newShip(0, 200, 0, 0, stats);
    run(600, idle, calm, s);
    expect(s.fuel).toBe(stats.fuelCapacity);
  });

  it('is deterministic', () => {
    const a = run(900, { throttle: 0.7, rudder: 0.3, lift: 0.2, boost: false });
    const b = run(900, { throttle: 0.7, rudder: 0.3, lift: 0.2, boost: false });
    expect(a).toEqual(b);
  });

  it('updrafts lift the ship', () => {
    const s = run(300, idle, { windX: 0, windZ: 0, updraft: 12 });
    expect(s.y).toBeGreaterThan(240);
  });

  it('collides with islands, bounces and takes damage on hard impact', () => {
    const w = new World(1907);
    const home = w.fixedIslands().find((i) => i.portId === 'skyharbor')!;
    const surf = w.surface(home, 0, 0)!;
    // Dive straight down onto the island at speed.
    const s = newShip(home.x, surf.top + 40, home.z, 0, stats);
    s.vy = -60;
    const env: FlightEnv = { ...calm, collide: (x, y, z, r) => w.collide(x, y, z, r) };
    let maxImpact = 0;
    for (let i = 0; i < 120; i++) maxImpact = Math.max(maxImpact, stepFlight(s, { ...idle, lift: -1 }, stats, env, 1 / 60).impact);
    expect(maxImpact).toBeGreaterThan(7);
    expect(s.hull).toBeLessThan(stats.maxHull);
    expect(s.y).toBeGreaterThan(surf.top);
  });

  it('forward vector matches heading convention', () => {
    expect(forwardOf(0).z).toBeCloseTo(-1);
    expect(forwardOf(-Math.PI / 2).x).toBeCloseTo(1);
  });
});
