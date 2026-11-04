import { describe, expect, it } from 'vitest';
import { World, CHUNK_SIZE } from '../../src/sim/world';
import { PORTS } from '../../src/sim/ports';
import { Noise } from '../../src/core/noise';
import { Rng, hashInts } from '../../src/core/rng';

describe('rng and noise', () => {
  it('Rng is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('Rng stays in [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('hashInts mixes inputs', () => {
    expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3));
    expect(hashInts(1, 2, 3)).not.toBe(hashInts(3, 2, 1));
  });
  it('noise is deterministic and bounded', () => {
    const n1 = new Noise(5);
    const n2 = new Noise(5);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const y = i * 0.91;
      expect(n1.noise2(x, y)).toBe(n2.noise2(x, y));
      expect(Math.abs(n1.noise2(x, y))).toBeLessThanOrEqual(1.01);
      expect(Math.abs(n1.noise3(x, y, x - y))).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('world generation', () => {
  it('generates identical chunks for the same seed', () => {
    const a = new World(1234);
    const b = new World(1234);
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        expect(JSON.stringify(a.chunkIslands(cx, cz))).toBe(JSON.stringify(b.chunkIslands(cx, cz)));
      }
    }
  });

  it('different seeds give different worlds', () => {
    const a = new World(1);
    const b = new World(2);
    let same = 0;
    for (let cx = 0; cx < 6; cx++) if (JSON.stringify(a.chunkIslands(cx, 3)) === JSON.stringify(b.chunkIslands(cx, 3))) same++;
    expect(same).toBeLessThan(6);
  });

  it('is independent of chunk query order (no hidden state)', () => {
    const a = new World(99);
    const b = new World(99);
    const first = JSON.stringify(a.chunkIslands(5, -2));
    for (let i = 0; i < 30; i++) b.chunkIslands(i, i * 2);
    expect(JSON.stringify(b.chunkIslands(5, -2))).toBe(first);
  });

  it('keeps islands inside their chunk and apart from each other', () => {
    const w = new World(77);
    for (let cx = -4; cx <= 4; cx++) {
      for (let cz = -4; cz <= 4; cz++) {
        const list = w.chunkIslands(cx, cz).filter((i) => i.kind === 'wild');
        for (const isl of list) {
          expect(isl.x).toBeGreaterThanOrEqual(cx * CHUNK_SIZE);
          expect(isl.x).toBeLessThan((cx + 1) * CHUNK_SIZE);
          expect(isl.y).toBeGreaterThan(0);
        }
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) expect(Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z)).toBeGreaterThan(list[i].radius + list[j].radius);
      }
    }
  });

  it('places every port exactly once and keeps wild islands clear of them', () => {
    const w = new World(5);
    const seen = new Map<string, number>();
    for (let cx = -10; cx <= 10; cx++)
      for (let cz = -10; cz <= 10; cz++)
        for (const i of w.chunkIslands(cx, cz)) {
          if (i.portId) seen.set(i.portId, (seen.get(i.portId) ?? 0) + 1);
          if (i.kind === 'wild') for (const p of PORTS) expect(Math.hypot(p.x - i.x, p.z - i.z)).toBeGreaterThan(p.radius + i.radius + 200);
        }
    for (const p of PORTS) expect(seen.get(p.id)).toBe(1);
  });

  it('has all four biomes with home in the meadows', () => {
    const w = new World(3);
    expect(w.biomeAt(0, 0)).toBe('meadow');
    const found = new Set<string>();
    for (let a = 0; a < 32; a++) found.add(w.biomeAt(Math.cos(a / 5) * 4000, Math.sin(a / 5) * 4000));
    expect(found).toEqual(new Set(['meadow', 'frost', 'ember', 'crystal']));
  });

  it('surface top is above the underside and null outside the rim', () => {
    const w = new World(11);
    const isl = w.chunkIslands(2, 2)[0] ?? w.fixedIslands()[0];
    for (let i = 0; i < 50; i++) {
      const a = i * 0.7;
      const d = (i / 50) * isl.radius * 0.7;
      const s = w.surface(isl, Math.cos(a) * d, Math.sin(a) * d);
      expect(s).not.toBeNull();
      expect(s!.top).toBeGreaterThan(s!.bottom);
    }
    expect(w.surface(isl, isl.radius * 1.5, 0)).toBeNull();
  });

  it('collides inside islands and is clear far away', () => {
    const w = new World(11);
    const port = w.fixedIslands().find((i) => i.portId === 'skyharbor')!;
    const s = w.surface(port, 0, 0)!;
    const inside = w.collide(port.x, s.top - 2, port.z, 9);
    expect(inside).not.toBeNull();
    expect(inside!.depth).toBeGreaterThan(0);
    expect(w.collide(port.x, s.top + 60, port.z, 9)).toBeNull();
    expect(w.collide(port.x + 2000, 900, port.z, 9)).toBeNull();
  });

  it('produces deterministic decorations and waterfalls', () => {
    const a = new World(8);
    const b = new World(8);
    const ia = a.fixedIslands()[0];
    const ib = b.fixedIslands()[0];
    expect(a.decorations(ia)).toEqual(b.decorations(ib));
    expect(a.waterfalls(ia)).toEqual(b.waterfalls(ib));
    expect(a.waterfalls(ia).length).toBeGreaterThan(0);
  });
});
