/**
 * Deterministic world generation. Everything here is pure maths over a seed:
 * the renderer turns these descriptors into meshes, and physics uses the very
 * same functions for collision, so what you see is what you hit.
 */
import { Noise } from '../core/noise';
import { Rng, hashInts, hashString } from '../core/rng';
import { clamp, smoothstep, TAU } from '../core/math';
import { BIOMES, type BiomeId } from './biomes';
import { LANDMARKS, PORTS, type PortId } from './ports';
import { FRAGMENTS } from './story';

export const CHUNK_SIZE = 700;
/** Top of the endless cloud sea. Below this the Undercloud crushes hulls. */
export const CLOUD_LEVEL = 0;
export const MAX_ALTITUDE = 720;

export type IslandKind = 'wild' | 'rock' | 'port' | 'ruin' | 'finale' | 'wreck';

export interface IslandDesc {
  id: string;
  kind: IslandKind;
  x: number;
  y: number;
  z: number;
  radius: number;
  biome: BiomeId;
  seed: number;
  hills: number;
  spikes: number;
  depth: number;
  waterfalls: number;
  ruins: boolean;
  portId?: PortId;
  landmarkId?: string;
}

export interface Surface {
  /** Absolute world-space height of the top surface. */
  top: number;
  /** Absolute world-space height of the underside. */
  bottom: number;
  /** 0 at the rim, 1 at the centre. */
  mask: number;
  /** Rim radius in the queried direction. */
  edge: number;
}

export type DecorationType = 'tree' | 'tree2' | 'rock' | 'ruinColumn' | 'ruinArch' | 'crystal' | 'shrub';

export interface Decoration {
  type: DecorationType;
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
}

export interface Waterfall {
  x: number;
  z: number;
  top: number;
  angle: number;
  width: number;
}

export interface Collision {
  nx: number;
  ny: number;
  nz: number;
  depth: number;
  island: IslandDesc;
}

export class World {
  readonly seed: number;
  private biomeNoise: Noise;
  private shapeNoise: Noise;
  private detailNoise: Noise;
  private chunkCache = new Map<string, IslandDesc[]>();
  private fixed: IslandDesc[];

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.biomeNoise = new Noise(hashInts(this.seed, 1));
    this.shapeNoise = new Noise(hashInts(this.seed, 2));
    this.detailNoise = new Noise(hashInts(this.seed, 3));
    this.fixed = [
      ...PORTS.map<IslandDesc>((p) => ({
        id: `port:${p.id}`,
        kind: 'port',
        x: p.x,
        y: p.y,
        z: p.z,
        radius: p.radius,
        biome: p.biome,
        seed: hashString(p.id),
        hills: 3,
        spikes: 0,
        depth: BIOMES[p.biome].depth,
        waterfalls: p.id === 'lanternfall' ? 4 : p.home ? 2 : 1,
        ruins: false,
        portId: p.id,
      })),
      ...LANDMARKS.map<IslandDesc>((l) => ({
        id: `landmark:${l.id}`,
        kind: l.kind,
        x: l.x,
        y: l.y,
        z: l.z,
        radius: l.radius,
        biome: l.biome,
        seed: hashString(l.id),
        hills: l.kind === 'finale' ? 2 : 6,
        spikes: l.kind === 'ruin' ? 0.2 : 0,
        depth: BIOMES[l.biome].depth * (l.kind === 'finale' ? 0.6 : 1),
        waterfalls: l.kind === 'ruin' ? 1 : 0,
        ruins: l.kind !== 'wreck',
        landmarkId: l.id,
      })),
    ];
  }

  /** Large-scale biome field: meadow heartland, frost north, ember east, crystal south. */
  biomeAt(x: number, z: number): BiomeId {
    const d = Math.hypot(x, z);
    const wobble = this.biomeNoise.fbm2(x / 2600, z / 2600, 3) * 0.9;
    if (d + wobble * 500 < 1350) return 'meadow';
    const a = Math.atan2(x, -z) + wobble; // 0 = north, +PI/2 = east
    const w = ((a % TAU) + TAU) % TAU;
    if (w < Math.PI / 4 || w >= (7 * Math.PI) / 4) return 'frost';
    if (w < (3 * Math.PI) / 4) return 'ember';
    if (w < (5 * Math.PI) / 4) return 'crystal';
    return 'meadow';
  }

  /** Islands that belong to a chunk (fixed islands are assigned by their centre). */
  chunkIslands(cx: number, cz: number): IslandDesc[] {
    const key = `${cx},${cz}`;
    const cached = this.chunkCache.get(key);
    if (cached) return cached;
    const list = this.generateChunk(cx, cz);
    if (this.chunkCache.size > 1600) {
      const first = this.chunkCache.keys().next().value;
      if (first !== undefined) this.chunkCache.delete(first);
    }
    this.chunkCache.set(key, list);
    return list;
  }

  static chunkOf(x: number, z: number): [number, number] {
    return [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
  }

  private generateChunk(cx: number, cz: number): IslandDesc[] {
    const out: IslandDesc[] = [];
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    for (const f of this.fixed) {
      if (f.x >= x0 && f.x < x0 + CHUNK_SIZE && f.z >= z0 && f.z < z0 + CHUNK_SIZE) out.push(f);
    }
    const rng = new Rng(hashInts(this.seed, cx, cz, 77));
    const count = rng.weighted([0, 1, 2, 3], [0.18, 0.42, 0.3, 0.1]);
    const tries = count + 3;
    let made = 0;
    for (let t = 0; t < tries && made < count; t++) {
      const big = rng.chance(0.35);
      const radius = big ? rng.range(85, 150) : rng.range(32, 80);
      const margin = radius + 25;
      const x = x0 + rng.range(margin, CHUNK_SIZE - margin);
      const z = z0 + rng.range(margin, CHUNK_SIZE - margin);
      if (!this.clearOfFixed(x, z, radius)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius + 50)) continue;
      const biome = this.biomeAt(x, z);
      const b = BIOMES[biome];
      const y = 70 + (this.biomeNoise.noise2(x / 1800, z / 1800) * 0.5 + 0.5) * 230 + rng.range(-30, 30);
      out.push({
        id: `${cx},${cz},${t}`,
        kind: 'wild',
        x,
        y,
        z,
        radius,
        biome,
        seed: hashInts(this.seed, cx, cz, t),
        hills: b.hills * rng.range(0.6, 1.4),
        spikes: b.spikes * rng.range(0.5, 1.2),
        depth: b.depth * rng.range(0.75, 1.25),
        waterfalls: rng.chance(b.waterfallChance) ? (radius > 90 ? rng.int(1, 2) : 1) : 0,
        ruins: rng.chance(0.14),
      });
      made++;
    }
    // Small floating rocks drifting between islands.
    const rocks = rng.int(1, 4);
    for (let i = 0; i < rocks; i++) {
      const radius = rng.range(8, 20);
      const x = x0 + rng.range(30, CHUNK_SIZE - 30);
      const z = z0 + rng.range(30, CHUNK_SIZE - 30);
      if (!this.clearOfFixed(x, z, radius + 40)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius + 25)) continue;
      const biome = this.biomeAt(x, z);
      out.push({
        id: `${cx},${cz},r${i}`,
        kind: 'rock',
        x,
        y: rng.range(40, 380),
        z,
        radius,
        biome,
        seed: hashInts(this.seed, cx, cz, 900 + i),
        hills: 2,
        spikes: 0.2,
        depth: 1.4,
        waterfalls: 0,
        ruins: false,
      });
    }
    return out;
  }

  private clearOfFixed(x: number, z: number, radius: number): boolean {
    for (const f of this.fixed) {
      const keepOut = f.kind === 'port' ? 260 : 160;
      if (Math.hypot(f.x - x, f.z - z) < f.radius + radius + keepOut) return false;
    }
    // Compass shards float in open sky, never buried in rock.
    for (const f of FRAGMENTS) if (Math.hypot(f.x - x, f.z - z) < radius + 50) return false;
    return true;
  }

  /** Nudge a point upward until a sphere of radius r there is clear of islands. */
  clearAltitude(x: number, y: number, z: number, r: number): number {
    for (let i = 0; i < 40 && this.collide(x, y, z, r); i++) y += 25;
    return y;
  }

  /** All islands whose chunk lies within `range` of (x, z). */
  islandsNear(x: number, z: number, range: number): IslandDesc[] {
    const out: IslandDesc[] = [];
    const c0x = Math.floor((x - range) / CHUNK_SIZE);
    const c1x = Math.floor((x + range) / CHUNK_SIZE);
    const c0z = Math.floor((z - range) / CHUNK_SIZE);
    const c1z = Math.floor((z + range) / CHUNK_SIZE);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        for (const isl of this.chunkIslands(cx, cz)) {
          if (Math.hypot(isl.x - x, isl.z - z) < range + isl.radius) out.push(isl);
        }
      }
    }
    return out;
  }

  /** Rim radius of an island in the direction `angle`. */
  edgeRadius(isl: IslandDesc, angle: number): number {
    if (isl.kind === 'port' || isl.kind === 'finale') {
      const n = this.shapeNoise.noise2(Math.cos(angle) * 1.1 + isl.seed % 97, Math.sin(angle) * 1.1);
      return isl.radius * (0.93 + 0.07 * n);
    }
    const s = (isl.seed % 1000) * 0.37;
    const n =
      this.shapeNoise.noise2(Math.cos(angle) * 1.2 + s, Math.sin(angle) * 1.2 - s) * 0.7 +
      this.shapeNoise.noise2(Math.cos(angle) * 3.1 - s, Math.sin(angle) * 3.1 + s) * 0.3;
    return isl.radius * (0.8 + 0.2 * n);
  }

  /**
   * Surface heights at a local offset (lx, lz) from an island's centre.
   * Returns null outside the rim.
   */
  surface(isl: IslandDesc, lx: number, lz: number): Surface | null {
    const d = Math.hypot(lx, lz);
    const angle = Math.atan2(lz, lx);
    const edge = this.edgeRadius(isl, angle);
    if (d > edge) return null;
    const mask = 1 - d / edge;
    return { top: isl.y + this.topOffset(isl, lx, lz, mask), bottom: isl.y + this.bottomOffset(isl, lx, lz, mask), mask, edge };
  }

  topOffset(isl: IslandDesc, lx: number, lz: number, mask: number): number {
    const s = (isl.seed % 1000) * 0.13;
    const f = 1 / Math.max(35, isl.radius * 0.6);
    const rim = smoothstep(0, 0.08, mask) * 3;
    if (isl.kind === 'port') {
      // Flattened town plateau with a gentle central hill.
      const hill = smoothstep(0.35, 1, mask) * 10 + this.detailNoise.fbm2(lx * f + s, lz * f, 2) * 1.2;
      return rim + hill;
    }
    if (isl.kind === 'finale') return rim + smoothstep(0, 0.4, mask) * 4;
    const hills = isl.hills * (this.detailNoise.fbm2(lx * f + s, lz * f - s, 3) * 0.5 + 0.5) * smoothstep(0, 0.45, mask);
    const dome = isl.hills * 0.6 * mask;
    let spikes = 0;
    if (isl.spikes > 0.05) {
      const r = this.shapeNoise.ridged2(lx * f * 1.7 + s, lz * f * 1.7, 3);
      spikes = Math.pow(r, 4) * isl.spikes * isl.radius * 0.75 * smoothstep(0.15, 0.6, mask);
    }
    return rim + hills + dome + spikes;
  }

  bottomOffset(isl: IslandDesc, lx: number, lz: number, mask: number): number {
    const s = (isl.seed % 1000) * 0.21;
    const f = 1 / Math.max(25, isl.radius * 0.35);
    const n = this.detailNoise.fbm2(lx * f - s, lz * f + s, 3) * 0.5 + 0.5;
    const depth = isl.depth * isl.radius;
    return -4 - depth * Math.pow(mask, 0.6) * (0.55 + 0.45 * n);
  }

  /** Deterministic decorations for an island (trees, rocks, ruins). */
  decorations(isl: IslandDesc): Decoration[] {
    const out: Decoration[] = [];
    if (isl.kind === 'finale' || isl.kind === 'wreck') return out;
    const rng = new Rng(hashInts(isl.seed, 4242));
    const b = BIOMES[isl.biome];
    const area = Math.PI * isl.radius * isl.radius;
    const treeCount = isl.kind === 'rock' ? 0 : Math.floor((area / 900) * b.trees * (isl.kind === 'port' ? 0.35 : 1));
    const rockCount = Math.floor((area / 2200) * b.rocks) + (isl.kind === 'rock' ? 1 : 0);
    const place = (minMask: number, maxMask: number): { x: number; z: number; s: Surface } | null => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const a = rng.range(0, TAU);
        const d = Math.sqrt(rng.next()) * isl.radius;
        const lx = Math.cos(a) * d;
        const lz = Math.sin(a) * d;
        const s = this.surface(isl, lx, lz);
        if (!s || s.mask < minMask || s.mask > maxMask) continue;
        // Keep the port town (mid-ring) clear of trees and rocks.
        if (isl.kind === 'port' && s.mask > 0.1 && s.mask < 0.75) continue;
        return { x: lx, z: lz, s };
      }
      return null;
    };
    for (let i = 0; i < treeCount; i++) {
      const p = place(0.08, 1);
      if (!p) continue;
      // Avoid steep spike flanks.
      const slope = Math.abs(this.slopeAt(isl, p.x, p.z));
      if (slope > 1.2) continue;
      const crystal = isl.biome === 'crystal' && rng.chance(0.45);
      out.push({
        type: crystal ? 'crystal' : rng.chance(0.5) ? 'tree' : rng.chance(0.6) ? 'tree2' : 'shrub',
        x: isl.x + p.x,
        y: p.s.top - 0.5,
        z: isl.z + p.z,
        scale: rng.range(0.7, 1.4),
        rot: rng.range(0, TAU),
      });
    }
    for (let i = 0; i < rockCount; i++) {
      const p = place(0.0, 1);
      if (!p) continue;
      out.push({ type: isl.biome === 'crystal' && rng.chance(0.5) ? 'crystal' : 'rock', x: isl.x + p.x, y: p.s.top - 0.8, z: isl.z + p.z, scale: rng.range(0.6, 1.8) * (isl.kind === 'rock' ? 0.6 : 1), rot: rng.range(0, TAU) });
    }
    if (isl.ruins) {
      const ring = rng.int(5, 9);
      const cr = isl.radius * rng.range(0.15, 0.35);
      const ca = rng.range(0, TAU);
      const cd = isl.radius * rng.range(0, 0.25);
      const cx = Math.cos(ca) * cd;
      const cz = Math.sin(ca) * cd;
      for (let i = 0; i < ring; i++) {
        if (rng.chance(0.25)) continue;
        const a = (i / ring) * TAU;
        const lx = cx + Math.cos(a) * cr;
        const lz = cz + Math.sin(a) * cr;
        const s = this.surface(isl, lx, lz);
        if (!s) continue;
        out.push({ type: rng.chance(0.3) ? 'ruinArch' : 'ruinColumn', x: isl.x + lx, y: s.top - 0.5, z: isl.z + lz, scale: rng.range(0.7, 1.3), rot: a + Math.PI / 2 });
      }
    }
    return out;
  }

  slopeAt(isl: IslandDesc, lx: number, lz: number): number {
    const e = 2;
    const a = this.surface(isl, lx + e, lz);
    const b = this.surface(isl, lx - e, lz);
    const c = this.surface(isl, lx, lz + e);
    const d = this.surface(isl, lx, lz - e);
    if (!a || !b || !c || !d) return 9;
    return Math.hypot((a.top - b.top) / (2 * e), (c.top - d.top) / (2 * e));
  }

  /** Waterfalls spill from the rim down into the clouds. */
  waterfalls(isl: IslandDesc): Waterfall[] {
    const out: Waterfall[] = [];
    const rng = new Rng(hashInts(isl.seed, 555));
    for (let i = 0; i < isl.waterfalls; i++) {
      const angle = rng.range(0, TAU);
      const edge = this.edgeRadius(isl, angle) * 0.985;
      const lx = Math.cos(angle) * edge;
      const lz = Math.sin(angle) * edge;
      const s = this.surface(isl, lx * 0.98, lz * 0.98);
      if (!s) continue;
      out.push({ x: isl.x + lx, z: isl.z + lz, top: s.top - 0.3, angle, width: rng.range(4, 9) * (isl.radius > 100 ? 1.4 : 1) });
    }
    return out;
  }

  /**
   * Sphere-vs-island collision. Returns the push-out normal and depth for the
   * deepest contact, or null when clear.
   */
  collide(x: number, y: number, z: number, r: number): Collision | null {
    let best: Collision | null = null;
    for (const isl of this.islandsNear(x, z, r + 10)) {
      const lx = x - isl.x;
      const lz = z - isl.z;
      const d = Math.hypot(lx, lz);
      const angle = Math.atan2(lz, lx);
      const edge = this.edgeRadius(isl, angle);
      if (d > edge + r) continue;
      const dc = Math.min(d, edge - 0.01);
      const sx = d > 0 ? (lx / d) * dc : 0;
      const sz = d > 0 ? (lz / d) * dc : 0;
      const s = this.surface(isl, sx, sz);
      if (!s) continue;
      if (y > s.top + r || y < s.bottom - r) continue;
      const up = s.top + r - y;
      const down = y - (s.bottom - r);
      const side = edge + r - d;
      let c: Collision;
      if (up <= down && up <= side) c = { nx: 0, ny: 1, nz: 0, depth: up, island: isl };
      else if (down <= side) c = { nx: 0, ny: -1, nz: 0, depth: down, island: isl };
      else c = { nx: d > 0 ? lx / d : 1, ny: 0, nz: d > 0 ? lz / d : 0, depth: side, island: isl };
      if (!best || c.depth > best.depth) best = c;
    }
    return best;
  }

  /** Vertical air speed from updrafts along island cliffs (thermals). */
  updraft(x: number, y: number, z: number): number {
    let lift = 0;
    for (const isl of this.islandsNear(x, z, 90)) {
      if (isl.kind === 'rock') continue;
      const lx = x - isl.x;
      const lz = z - isl.z;
      const d = Math.hypot(lx, lz);
      const edge = this.edgeRadius(isl, Math.atan2(lz, lx));
      const band = 80;
      const off = d - edge;
      if (off < -25 || off > band) continue;
      const top = isl.y + 30;
      if (y < isl.y - isl.depth * isl.radius || y > top + 120) continue;
      const strength = isl.biome === 'ember' ? 16 : isl.biome === 'frost' ? 9 : 11;
      const radial = 1 - clamp(Math.abs(off - 10) / band, 0, 1);
      const vertical = 1 - clamp((y - top) / 120, 0, 1);
      lift = Math.max(lift, strength * radial * vertical);
    }
    return lift;
  }

  /** Every island inside a rectangle (used by the map screen). */
  islandsInRect(x0: number, z0: number, x1: number, z1: number): IslandDesc[] {
    const out: IslandDesc[] = [];
    for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++) {
      for (let cz = Math.floor(z0 / CHUNK_SIZE); cz <= Math.floor(z1 / CHUNK_SIZE); cz++) {
        out.push(...this.chunkIslands(cx, cz));
      }
    }
    return out;
  }

  fixedIslands(): readonly IslandDesc[] {
    return this.fixed;
  }
}
