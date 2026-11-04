/**
 * Arcade-leaning airship flight model. Deterministic and pure: everything the
 * step needs comes in through arguments so it can be unit-tested headless.
 *
 * Conventions: heading 0 faces north (-Z); positive heading turns left
 * (counter-clockwise seen from above), matching three.js rotation.y.
 */
import { clamp, damp, wrapAngle } from '../core/math';
import type { ShipStats } from './upgrades';
import { CLOUD_LEVEL, MAX_ALTITUDE } from './world';

export interface ShipState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  yawRate: number;
  /** Engine telegraph setting, -0.35 (astern) .. 1 (full ahead). */
  throttle: number;
  roll: number;
  pitch: number;
  hull: number;
  fuel: number;
}

export interface FlightInput {
  /** Rate of throttle change, -1..1. */
  throttle: number;
  /** -1 = turn left, 1 = turn right. */
  rudder: number;
  /** -1 = descend, 1 = climb. */
  lift: number;
  boost: boolean;
}

export interface FlightEnv {
  windX: number;
  windZ: number;
  /** Vertical air speed from updrafts. */
  updraft: number;
  /** Optional sphere collision query. */
  collide?: (x: number, y: number, z: number, r: number) => { nx: number; ny: number; nz: number; depth: number } | null;
}

export interface FlightEvents {
  impact: number;
  damage: number;
  undercloud: boolean;
  outOfFuel: boolean;
}

export const SHIP_RADIUS = 9;
export const MIN_THROTTLE = -0.35;
export const BOOST_FACTOR = 1.45;

export function forwardOf(heading: number): { x: number; z: number } {
  return { x: -Math.sin(heading), z: -Math.cos(heading) };
}

export function rightOf(heading: number): { x: number; z: number } {
  return { x: Math.cos(heading), z: -Math.sin(heading) };
}

export function newShip(x: number, y: number, z: number, heading: number, stats: ShipStats): ShipState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, heading, yawRate: 0, throttle: 0, roll: 0, pitch: 0, hull: stats.maxHull, fuel: stats.fuelCapacity };
}

/** Speed through the air (excludes wind drift). */
export function airSpeed(s: ShipState, env: FlightEnv): number {
  return Math.hypot(s.vx - env.windX, s.vz - env.windZ);
}

export function stepFlight(s: ShipState, input: FlightInput, stats: ShipStats, env: FlightEnv, dt: number): FlightEvents {
  const ev: FlightEvents = { impact: 0, damage: 0, undercloud: false, outOfFuel: false };
  dt = clamp(dt, 0, 0.1);

  // Engine telegraph.
  s.throttle = clamp(s.throttle + clamp(input.throttle, -1, 1) * 0.65 * dt, MIN_THROTTLE, 1);
  const hasFuel = s.fuel > 0;
  if (!hasFuel) ev.outOfFuel = true;
  const boosting = input.boost && hasFuel && s.throttle > 0.2;
  // Out of aether: emergency sails give a quarter power so you are never stranded.
  const power = (hasFuel ? 1 : 0.28) * (boosting ? BOOST_FACTOR : 1);
  const targetSpeed = s.throttle * stats.maxSpeed * power;

  const f = forwardOf(s.heading);
  const r = rightOf(s.heading);
  // Velocity relative to the moving air mass.
  const ax = s.vx - env.windX;
  const az = s.vz - env.windZ;
  let fwd = ax * f.x + az * f.z;
  let lat = ax * r.x + az * r.z;
  fwd = damp(fwd, targetSpeed, stats.accel * (boosting ? 1.6 : 1), dt);
  lat = damp(lat, 0, 1.7, dt); // keel effect: sideslip bleeds off, giving a little drift.
  s.vx = env.windX + f.x * fwd + r.x * lat;
  s.vz = env.windZ + f.z * fwd + r.z * lat;

  // Rudder with inertia; airships can pivot slowly even at rest.
  const speedFactor = 0.45 + 0.55 * clamp(Math.abs(fwd) / 15, 0, 1);
  const targetYaw = -clamp(input.rudder, -1, 1) * stats.turnRate * 0.62 * speedFactor;
  s.yawRate = damp(s.yawRate, targetYaw, 2.4, dt);
  s.heading = wrapAngle(s.heading + s.yawRate * dt);

  // Altitude: ballast/lift control eases towards a target climb rate.
  let targetVy = clamp(input.lift, -1, 1) * stats.climbRate + env.updraft;
  if (s.y < CLOUD_LEVEL + 4) {
    // The Undercloud is dense and crushing: buoyancy forces you back up.
    targetVy = Math.max(targetVy, 14);
    ev.undercloud = true;
  }
  if (s.y > MAX_ALTITUDE) targetVy = Math.min(targetVy, -8);
  s.vy = damp(s.vy, targetVy, 1.5, dt);

  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;

  // Collision response: push out, reflect a little, scrape speed, take damage.
  if (env.collide) {
    for (let iter = 0; iter < 2; iter++) {
      const c = env.collide(s.x, s.y, s.z, SHIP_RADIUS);
      if (!c) break;
      s.x += c.nx * c.depth;
      s.y += c.ny * c.depth;
      s.z += c.nz * c.depth;
      const vn = s.vx * c.nx + s.vy * c.ny + s.vz * c.nz;
      if (vn < 0) {
        const bounce = 1.35;
        s.vx -= c.nx * vn * bounce;
        s.vy -= c.ny * vn * bounce;
        s.vz -= c.nz * vn * bounce;
        s.vx *= 0.8;
        s.vz *= 0.8;
        ev.impact = Math.max(ev.impact, -vn);
      }
    }
    if (ev.impact > 7) {
      ev.damage = (ev.impact - 7) * 1.4 * (1 - stats.armor);
      if (Math.abs(s.throttle) > 0.5) s.throttle *= 0.6;
    }
  }
  if (ev.undercloud) ev.damage += 6 * dt * (1 - stats.armor);
  s.hull = clamp(s.hull - ev.damage, 0, stats.maxHull);

  // Fuel burn scales with throttle; boosting burns triple.
  if (hasFuel) {
    s.fuel = Math.max(0, s.fuel - Math.abs(s.throttle) * stats.fuelBurn * (boosting ? 3 : 1) * dt);
  }

  // Visual attitude: bank into turns, nose follows climb.
  s.roll = damp(s.roll, clamp(s.yawRate * fwd * 0.03, -0.45, 0.45), 3, dt);
  s.pitch = damp(s.pitch, clamp(s.vy * 0.012, -0.25, 0.25), 2, dt);
  return ev;
}
