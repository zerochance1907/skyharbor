import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { IslandRenderer } from '../../src/render/islands';
import { World } from '../../src/sim/world';

const LOW = { chunkRadius: 1, nearDistance: 420, detail: 0.7 };
const HIGH = { chunkRadius: 1, nearDistance: 420, detail: 1.15 };

describe('island quality presets', () => {
  it('rebuilds already-loaded islands when the preset changes', () => {
    const world = new World(1234);
    const r = new IslandRenderer(new THREE.Scene(), world, LOW);
    r.warm(new THREE.Vector3(0, 100, 0), new THREE.Color());
    const before = r.loaded();
    expect(before.length).toBeGreaterThan(0);
    const vertsBefore = before.map((e) => e.far!.geometry.getAttribute('position').count);

    const rebuilt = r.setQuality(HIGH);
    expect(rebuilt).toBe(before.length);
    const after = r.loaded();
    expect(after.length).toBe(before.length);
    const vertsAfter = after.map((e) => e.far!.geometry.getAttribute('position').count);
    // Higher detail never produces fewer vertices, and at least one island gains some.
    vertsAfter.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(vertsBefore[i]));
    expect(vertsAfter.some((v, i) => v > vertsBefore[i])).toBe(true);
    // Near meshes were dropped and get rebuilt at the new detail on the next update.
    expect(after.every((e) => e.near === null)).toBe(true);
    r.warm(new THREE.Vector3(0, 100, 0), new THREE.Color());
    expect(r.loaded().some((e) => e.near !== null)).toBe(true);
  });

  it('does nothing when detail is unchanged', () => {
    const world = new World(1234);
    const r = new IslandRenderer(new THREE.Scene(), world, LOW);
    r.warm(new THREE.Vector3(0, 100, 0), new THREE.Color());
    expect(r.setQuality({ ...LOW, chunkRadius: 2 })).toBe(0);
  });
});

describe('cloud puff sorting', () => {
  it('orders billboards farthest first', async () => {
    const { backToFrontOrder } = await import('../../src/render/clouds');
    const xyz = new Float32Array([10, 0, 0, 300, 0, 0, -50, 0, 0, 0, 200, 0]);
    const order = new Uint32Array(4);
    backToFrontOrder(xyz, 4, 0, 0, 0, order, new Float32Array(4));
    expect([...order]).toEqual([1, 3, 2, 0]);
  });
});
