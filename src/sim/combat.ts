/** Sky-pirate AI, broadside cannons and ballistics. Pure. */
import { Rng } from '../core/rng';
import { angleDiff, clamp, damp, wrapAngle } from '../core/math';
import { forwardOf, rightOf } from './flight';

export interface Cannonball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  damage: number;
  owner: 'player' | 'enemy';
}

export type NpcRole = 'pirate' | 'flagship' | 'merchant';

export interface Npc {
  id: number;
  role: NpcRole;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  vy: number;
  heading: number;
  hp: number;
  maxHp: number;
  speed: number;
  reload: number;
  state: 'patrol' | 'chase' | 'flee' | 'sinking' | 'travel' | 'arrived';
  sinkTime: number;
  /** Side the pirate prefers to fight on (+1 starboard, -1 port). */
  side: number;
  /** Merchant destination. */
  dest?: { x: number; y: number; z: number };
  contractId?: string;
  cannons: number;
  damage: number;
}

export const BALL_SPEED = 150;
export const BALL_GRAVITY = 28;
export const BALL_LIFE = 2.6;
export const HIT_RADIUS = 13;

/** Fire a broadside. side: -1 = port (left), +1 = starboard (right). */
export function fireBroadside(
  x: number,
  y: number,
  z: number,
  vx: number,
  vz: number,
  heading: number,
  side: number,
  count: number,
  damage: number,
  owner: Cannonball['owner'],
  rng: Rng,
): Cannonball[] {
  const f = forwardOf(heading);
  const r = rightOf(heading);
  const out: Cannonball[] = [];
  for (let i = 0; i < count; i++) {
    const along = count === 1 ? 0 : (i / (count - 1) - 0.5) * 12;
    const spread = rng.range(-0.04, 0.04);
    const dx = r.x * side + f.x * spread;
    const dz = r.z * side + f.z * spread;
    out.push({
      x: x + f.x * along + r.x * side * 5,
      y: y - 1,
      z: z + f.z * along + r.z * side * 5,
      vx: vx + dx * BALL_SPEED,
      vy: 10 + rng.range(-2, 2),
      vz: vz + dz * BALL_SPEED,
      life: BALL_LIFE,
      damage,
      owner,
    });
  }
  return out;
}

export interface Target {
  x: number;
  y: number;
  z: number;
  id: number;
  team: 'player' | 'enemy';
  /** Hit radius; defaults to HIT_RADIUS. */
  r?: number;
}

export interface Hit {
  ball: Cannonball;
  targetId: number;
}

/** Advance cannonballs; returns hits and removes spent balls in place. */
export function stepBalls(balls: Cannonball[], targets: Target[], dt: number): Hit[] {
  const hits: Hit[] = [];
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    b.vy -= BALL_GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.life -= dt;
    let hit = false;
    for (const t of targets) {
      if (t.team === b.owner) continue;
      const d2 = (t.x - b.x) ** 2 + (t.y - b.y) ** 2 + (t.z - b.z) ** 2;
      const r = t.r ?? HIT_RADIUS;
      if (d2 < r * r) {
        hits.push({ ball: b, targetId: t.id });
        hit = true;
        break;
      }
    }
    if (hit || b.life <= 0) balls.splice(i, 1);
  }
  return hits;
}

export function makePirate(id: number, x: number, y: number, z: number, rng: Rng, flagship = false): Npc {
  const hp = flagship ? 260 : rng.range(60, 95);
  return {
    id,
    role: flagship ? 'flagship' : 'pirate',
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: rng.range(-Math.PI, Math.PI),
    hp,
    maxHp: hp,
    speed: flagship ? 40 : rng.range(32, 38),
    reload: rng.range(1, 3),
    state: 'patrol',
    sinkTime: 0,
    side: rng.chance(0.5) ? 1 : -1,
    cannons: flagship ? 3 : rng.int(1, 2),
    damage: flagship ? 11 : 7,
  };
}

export function makeMerchant(id: number, x: number, y: number, z: number, dest: { x: number; y: number; z: number }, contractId: string): Npc {
  return {
    id,
    role: 'merchant',
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: Math.atan2(-(dest.x - x), -(dest.z - z)),
    hp: 120,
    maxHp: 120,
    speed: 26,
    reload: 0,
    state: 'travel',
    sinkTime: 0,
    side: 1,
    dest,
    contractId,
    cannons: 0,
    damage: 0,
  };
}

export interface NpcFire {
  npc: Npc;
  side: number;
}

/** Heading that faces from (x,z) toward (tx,tz) under our conventions. */
export function headingTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

/** Returns true when a point is inside terrain (plus the caller's margin). */
export type Blocked = (x: number, y: number, z: number) => boolean;

const AVOID_OFFSETS = [0.35, 0.7, 1.05, 1.4, 1.8, 2.3];

/** True when the straight path along `heading` is clear for `range` units. */
export function pathClear(x: number, y: number, z: number, heading: number, range: number, blocked: Blocked): boolean {
  const f = forwardOf(heading);
  for (const t of [0.3, 0.6, 1]) if (blocked(x + f.x * range * t, y, z + f.z * range * t)) return false;
  return true;
}

/**
 * Look-ahead obstacle avoidance. Probes the desired heading and then fans out
 * left and right (preferring `side` first) until it finds a clear lane.
 * When no lane is clear the ship keeps its course and climbs over.
 */
export function avoidHeading(
  x: number,
  y: number,
  z: number,
  desired: number,
  speed: number,
  side: number,
  blocked: Blocked,
): { heading: number; climb: number } {
  const range = Math.max(90, speed * 3);
  if (pathClear(x, y, z, desired, range, blocked)) return { heading: desired, climb: 0 };
  const s = side >= 0 ? 1 : -1;
  for (const off of AVOID_OFFSETS) {
    for (const sign of [s, -s]) {
      const h = wrapAngle(desired + off * sign);
      if (pathClear(x, y, z, h, range, blocked)) return { heading: h, climb: off > 1.4 ? 20 : 0 };
    }
  }
  return { heading: desired, climb: 45 };
}

function steer(n: Npc, targetHeading: number, targetSpeed: number, targetY: number, dt: number, blocked?: Blocked): void {
  if (blocked) {
    const a = avoidHeading(n.x, n.y, n.z, targetHeading, Math.max(targetSpeed, Math.hypot(n.vx, n.vz)), n.side, blocked);
    targetHeading = a.heading;
    if (a.climb) targetY = Math.max(targetY, n.y + a.climb);
  }
  const diff = angleDiff(n.heading, targetHeading);
  n.heading = wrapAngle(n.heading + clamp(diff, -0.7 * dt, 0.7 * dt));
  const f = forwardOf(n.heading);
  const sp = damp(Math.hypot(n.vx, n.vz), targetSpeed, 0.8, dt);
  n.vx = f.x * sp;
  n.vz = f.z * sp;
  n.vy = damp(n.vy, clamp((targetY - n.y) * 0.5, -14, 14), 1.2, dt);
  n.x += n.vx * dt;
  n.y += n.vy * dt;
  n.z += n.vz * dt;
}

/**
 * Pirate brain: patrol, chase into a broadside position, fire when the player
 * is abeam, flee when badly hurt. `safe` means the player is near a port.
 */
export function stepPirate(n: Npc, px: number, py: number, pz: number, safe: boolean, dt: number, rng: Rng, blocked?: Blocked): NpcFire | null {
  if (n.state === 'sinking') {
    n.sinkTime += dt;
    n.vy = damp(n.vy, -18, 0.6, dt);
    n.y += n.vy * dt;
    n.x += n.vx * dt * 0.6;
    n.z += n.vz * dt * 0.6;
    n.heading += dt * 0.25;
    return null;
  }
  const dx = px - n.x;
  const dz = pz - n.z;
  const dist = Math.hypot(dx, dz);
  if (n.hp < n.maxHp * 0.22 && n.role !== 'flagship') n.state = 'flee';
  else if (safe && n.role !== 'flagship') n.state = 'patrol';
  else if (dist < (n.role === 'flagship' ? 1400 : 650)) n.state = 'chase';
  else if (dist > 900) n.state = 'patrol';

  n.reload -= dt;
  if (n.state === 'patrol') {
    steer(n, n.heading + Math.sin(n.id + n.x * 0.001) * 0.3, n.speed * 0.45, n.y, dt, blocked);
    return null;
  }
  if (n.state === 'flee') {
    steer(n, headingTo(px, pz, n.x, n.z), n.speed * 1.05, n.y + 6, dt, blocked);
    return null;
  }
  // Chase: aim for a point abeam of the player at broadside range.
  const ideal = 110;
  const toAngle = Math.atan2(dz, dx);
  // Circle the player: pick a point offset around the target.
  const orbit = toAngle + Math.PI + n.side * 0.9;
  const tx = px + Math.cos(orbit) * ideal;
  const tz = pz + Math.sin(orbit) * ideal;
  const speed = dist > 300 ? n.speed : n.speed * 0.75;
  steer(n, headingTo(n.x, n.z, tx, tz), speed, py, dt, blocked);
  // Fire when the player is roughly abeam on either side.
  if (n.reload <= 0 && dist < 280 && Math.abs(py - n.y) < 50) {
    const r = rightOf(n.heading);
    const dot = (dx * r.x + dz * r.z) / (dist || 1);
    if (Math.abs(dot) > 0.86) {
      n.reload = (n.role === 'flagship' ? 2.4 : 3.4) + rng.range(0, 1.2);
      return { npc: n, side: dot > 0 ? 1 : -1 };
    }
  }
  return null;
}

/** Merchant autopilot toward its destination. Returns true on arrival. */
export function stepMerchant(n: Npc, dt: number, blocked?: Blocked): boolean {
  if (n.state === 'sinking') {
    n.sinkTime += dt;
    n.vy = damp(n.vy, -18, 0.6, dt);
    n.y += n.vy * dt;
    return false;
  }
  if (!n.dest || n.state === 'arrived') return n.state === 'arrived';
  const d = Math.hypot(n.dest.x - n.x, n.dest.z - n.z);
  if (d < 60) {
    n.state = 'arrived';
    n.vx = 0;
    n.vz = 0;
    return true;
  }
  steer(n, headingTo(n.x, n.z, n.dest.x, n.dest.z), d < 250 ? n.speed * 0.5 : n.speed, n.dest.y + 30, dt, d < 250 ? undefined : blocked);
  return false;
}

export function applyDamage(n: Npc, amount: number): boolean {
  if (n.state === 'sinking') return false;
  n.hp -= amount;
  if (n.hp <= 0) {
    n.hp = 0;
    n.state = 'sinking';
    return true;
  }
  return false;
}
