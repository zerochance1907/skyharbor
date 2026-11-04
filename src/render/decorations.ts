/** Low-poly decoration models (trees, rocks, crystals, ruins) per biome. */
import * as THREE from 'three';
import { BIOMES, type BiomeId } from '../sim/biomes';
import type { DecorationType } from '../sim/world';
import { MeshBuilder, mat } from './builder';

const cache = new Map<string, THREE.BufferGeometry>();

export function decorationGeometry(biome: BiomeId, type: DecorationType): THREE.BufferGeometry {
  const key = `${biome}:${type}`;
  let g = cache.get(key);
  if (!g) {
    g = build(biome, type);
    cache.set(key, g);
  }
  return g;
}

function build(biome: BiomeId, type: DecorationType): THREE.BufferGeometry {
  const p = BIOMES[biome].palette;
  const b = new MeshBuilder();
  const stone = 0xd4ccb6;
  switch (type) {
    case 'rock': {
      const geo = new THREE.DodecahedronGeometry(3, 0);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const k = 0.8 + ((i * 7919) % 13) / 30;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.75, pos.getZ(i) * k);
      }
      b.add(geo, p.rock, mat(0, 1.2, 0), 0.08, 3);
      break;
    }
    case 'ruinColumn':
      b.box(3.2, 1, 3.2, stone, 0, 0.5, 0);
      b.cylinder(1.1, 1.25, 9, 7, stone, 0, 5.5, 0);
      b.cylinder(1.1, 1.1, 2.2, 7, 0xbdb39b, 0.5, 11.2, 0, 0.12, 0, 0.18);
      break;
    case 'ruinArch':
      b.box(2.2, 12, 2.2, stone, -4, 6, 0);
      b.box(2.2, 12, 2.2, stone, 4, 6, 0);
      b.box(11, 2, 2.6, 0xbdb39b, 0, 12.8, 0);
      b.box(3, 0.8, 3, stone, -4, 0.4, 0);
      b.box(3, 0.8, 3, stone, 4, 0.4, 0);
      break;
    case 'crystal':
      b.add(new THREE.OctahedronGeometry(2.2, 0), p.foliage, mat(0, 4, 0).multiply(new THREE.Matrix4().makeScale(0.7, 2.4, 0.7)));
      b.add(new THREE.OctahedronGeometry(1.4, 0), p.foliageAlt, mat(1.6, 2.4, 0.5, 0, 0, -0.5).multiply(new THREE.Matrix4().makeScale(0.6, 2, 0.6)));
      b.add(new THREE.OctahedronGeometry(1.2, 0), p.accent, mat(-1.3, 2, -0.6, 0.3, 0, 0.6).multiply(new THREE.Matrix4().makeScale(0.6, 1.8, 0.6)));
      break;
    case 'shrub':
      b.sphere(2.2, 0, p.foliageAlt, 0, 1.6, 0, 1, 0.8, 1);
      b.sphere(1.5, 0, p.foliage, 1.4, 1.2, 0.6, 1, 0.8, 1);
      break;
    case 'tree':
    case 'tree2':
      buildTree(b, biome, type === 'tree2');
      break;
  }
  return b.build();
}

function buildTree(b: MeshBuilder, biome: BiomeId, alt: boolean): void {
  const p = BIOMES[biome].palette;
  if (biome === 'meadow') {
    b.cylinder(0.5, 0.8, 5, 5, p.trunk, 0, 2.5, 0);
    if (alt) {
      b.cone(3.6, 5, 6, p.foliage, 0, 6.5, 0);
      b.cone(2.8, 4, 6, p.foliageAlt, 0, 9, 0, 0.4);
    } else {
      b.add(new THREE.IcosahedronGeometry(3.4, 0), p.foliage, mat(0, 7, 0), 0.08, 5);
      b.add(new THREE.IcosahedronGeometry(2.2, 0), p.foliageAlt, mat(1.6, 8.6, 0.8), 0.08, 9);
    }
  } else if (biome === 'frost') {
    b.cylinder(0.4, 0.6, 3, 5, p.trunk, 0, 1.5, 0);
    const tiers = alt ? 4 : 3;
    for (let i = 0; i < tiers; i++) {
      const r = 3.4 - i * 0.75;
      b.cone(r, 3.6, 7, i % 2 ? p.foliageAlt : p.foliage, 0, 4 + i * 2.4, 0, i * 0.5);
      b.cone(r * 0.75, 1, 7, 0xf4f9fc, 0, 5.2 + i * 2.4, 0, i * 0.5);
    }
  } else if (biome === 'ember') {
    if (alt) {
      b.cylinder(0.3, 0.6, 6, 5, p.trunk, 0, 3, 0);
      b.cylinder(0.15, 0.3, 3, 4, p.trunk, 1.2, 5, 0, 0, 0, -0.8);
      b.cylinder(0.15, 0.3, 2.6, 4, p.trunk, -1, 4.2, 0.4, 0.3, 0, 0.9);
      b.sphere(0.8, 0, p.accent, 0, 6.4, 0);
    } else {
      b.cone(1.6, 7, 5, p.rockDark, 0, 3.5, 0);
      b.sphere(1.6, 0, p.foliage, 0, 1.2, 0, 1.3, 0.6, 1.3);
      b.sphere(0.9, 0, p.foliageAlt, 0.8, 7, 0);
    }
  } else {
    // Crystal reefs: coral-mushroom trees.
    b.cylinder(0.6, 0.9, 5.5, 6, p.trunk, 0, 2.75, 0);
    b.sphere(3.4, 1, alt ? p.foliageAlt : p.foliage, 0, 6, 0, 1, 0.45, 1);
    b.sphere(1.4, 0, p.accent, 1.6, 7.2, 0.8, 1, 0.6, 1);
  }
}
