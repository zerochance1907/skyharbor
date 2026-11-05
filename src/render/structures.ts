/**
 * Hand-built port towns and story landmarks, assembled from primitives and
 * merged into a few draw calls per site. Windows glow at night through a
 * shared material whose colour the renderer animates.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { BIOMES, type BiomeId } from '../sim/biomes';
import { PORT_BY_ID, type PortDef } from '../sim/ports';
import type { IslandDesc, World } from '../sim/world';
import { MeshBuilder, flatMaterial, glowMaterial, mat } from './builder';

/** Objects that spin or bob; updated each frame by the game. */
export const animated = new Set<THREE.Object3D>();
/** World positions of chimneys and forges that emit smoke. */
export const smokeEmitters = new Map<string, THREE.Vector3[]>();

export const windowMaterial = new THREE.MeshBasicMaterial({ color: 0x2a2a30 });
const beamMaterial = new THREE.MeshBasicMaterial({
  color: 0xfff2c0,
  transparent: true,
  opacity: 0.18,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const veilMaterial = new THREE.MeshBasicMaterial({
  color: 0x7af5e0,
  transparent: true,
  opacity: 0.22,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** Update night-dependent materials and animated parts. */
export function updateStructures(time: number, night: number): void {
  windowMaterial.color.setRGB(0.16 + night * 0.84, 0.15 + night * 0.62, 0.17 + night * 0.25);
  beamMaterial.opacity = 0.05 + night * 0.22;
  veilMaterial.opacity = 0.1 + night * 0.25 + Math.sin(time * 0.7) * 0.05;
  for (const o of animated) {
    const spin = o.userData.spin as number | undefined;
    if (spin) o.rotation[(o.userData.axis as 'x' | 'y' | 'z') ?? 'y'] = time * spin + (o.userData.phase ?? 0);
    const bob = o.userData.bob as number | undefined;
    if (bob) o.position.y = (o.userData.baseY as number) + Math.sin(time * 0.8 + (o.userData.phase ?? 0)) * bob;
  }
}

interface Kit {
  walls: number[];
  roofs: number[];
  trim: number;
  snow: boolean;
}

const KITS: Record<BiomeId, Kit> = {
  meadow: { walls: [0xf1e6cf, 0xe8d6b5, 0xf5efe0], roofs: [0xc0573e, 0xa8483a, 0x5f7f9c], trim: 0x6b4a32, snow: false },
  frost: { walls: [0xa9b4c2, 0x8f9cad, 0xc6ced8], roofs: [0x40597a, 0x2f4763, 0x51698a], trim: 0x3b3a44, snow: true },
  ember: { walls: [0x4a3c3c, 0x5c4840, 0x3a3034], roofs: [0xb4652e, 0x8e4a26, 0xc7823c], trim: 0x241c1c, snow: false },
  crystal: { walls: [0xf2f0fb, 0xe4f5f1, 0xf5e9f7], roofs: [0x9c86d8, 0x6fc7c0, 0xd18ad8], trim: 0x5d548c, snow: false },
};

class Site {
  solid = new MeshBuilder();
  glow = new MeshBuilder();
  windows = new MeshBuilder();
  group = new THREE.Group();
  constructor(
    public world: World,
    public isl: IslandDesc,
  ) {}

  /** Height of the island top at local polar coordinates. */
  groundAt(lx: number, lz: number): number {
    const s = this.world.surface(this.isl, lx, lz);
    return s ? s.top : this.isl.y;
  }

  house(lx: number, lz: number, rot: number, w: number, h: number, d: number, kit: Kit, rng: Rng): void {
    const gy = this.groundAt(lx, lz) - 0.6;
    const x = this.isl.x + lx;
    const z = this.isl.z + lz;
    const wall = rng.pick(kit.walls);
    const roof = rng.pick(kit.roofs);
    const m = mat(x, gy, z, 0, rot, 0);
    const local = (px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => m.clone().multiply(mat(px, py, pz, rx, ry, rz));
    this.solid.add(new THREE.BoxGeometry(w, h, d), wall, local(0, h / 2, 0));
    this.solid.add(new THREE.BoxGeometry(w + 0.6, 0.6, d + 0.6), kit.trim, local(0, 0.3, 0));
    // Gable roof as a 3-sided prism.
    const roofH = h * 0.55;
    const prism = new THREE.CylinderGeometry(1, 1, d + 1.2, 3, 1);
    this.solid.add(prism, roof, local(0, h + roofH * 0.33, 0, Math.PI / 2, 0, 0).multiply(new THREE.Matrix4().makeScale((w * 0.62), 1, roofH * 0.68)));
    if (kit.snow) {
      const cap = new THREE.CylinderGeometry(1, 1, d + 1.3, 3, 1);
      this.solid.add(cap, 0xf4f8fc, local(0, h + roofH * 0.55, 0, Math.PI / 2, 0, 0).multiply(new THREE.Matrix4().makeScale(w * 0.35, 1, roofH * 0.38)));
    }
    if (rng.chance(0.5)) {
      this.solid.add(new THREE.BoxGeometry(1.4, 4, 1.4), kit.trim, local(w * 0.25, h + roofH * 0.6, d * 0.2));
    }
    // Windows and a door.
    const nWin = Math.max(1, Math.floor(w / 4));
    for (let i = 0; i < nWin; i++) {
      const wx = -w / 2 + (i + 0.5) * (w / nWin);
      this.windows.add(new THREE.BoxGeometry(1.4, 1.6, 0.3), 0xffffff, local(wx, h * 0.6, d / 2 + 0.05));
      this.windows.add(new THREE.BoxGeometry(1.4, 1.6, 0.3), 0xffffff, local(wx, h * 0.6, -d / 2 - 0.05));
    }
    this.solid.add(new THREE.BoxGeometry(1.8, 3, 0.3), kit.trim, local(0, 1.5, d / 2 + 0.1));
  }

  finish(): THREE.Group {
    const meshes: [MeshBuilder, THREE.Material][] = [
      [this.solid, flatMaterial()],
      [this.glow, glowMaterial()],
      [this.windows, windowMaterial],
    ];
    for (const [b, m] of meshes) {
      if (b.triangleCount === 0) continue;
      const mesh = new THREE.Mesh(b.build(), m);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    return this.group;
  }
}

export function buildStructures(world: World, isl: IslandDesc, hallLit: boolean): THREE.Group | null {
  if (isl.kind === 'port' && isl.portId) return buildPort(world, isl, PORT_BY_ID[isl.portId], hallLit);
  if (isl.landmarkId === 'observatory') return buildObservatory(world, isl);
  if (isl.landmarkId === 'cinder_vault') return buildVault(world, isl);
  if (isl.landmarkId === 'meridian') return buildMeridian(world, isl);
  if (isl.landmarkId === 'wreck_courier') return buildWreck(world, isl);
  return null;
}

function buildDock(site: Site, p: PortDef): void {
  const { isl, world } = site;
  const a = p.dockAngle;
  const edge = world.edgeRadius(isl, a);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const start = edge - 22;
  const end = p.radius + 26;
  const len = end - start;
  const mid = (start + end) / 2;
  const y = site.groundAt(ca * (edge - 24), sa * (edge - 24)) + 0.2;
  const rot = -a + Math.PI / 2;
  const deckM = mat(isl.x + ca * mid, y, isl.z + sa * mid, 0, rot, 0);
  const L = (px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => deckM.clone().multiply(mat(px, py, pz, rx, ry, rz));
  const wood = 0x8b6440;
  const dark = 0x5a3d26;
  // Planked deck.
  const planks = Math.floor(len / 2.2);
  for (let i = 0; i < planks; i++) {
    site.solid.add(new THREE.BoxGeometry(11, 0.7, 2.0), i % 2 ? wood : 0x9a7048, L(0, 0, -len / 2 + i * 2.2 + 1.1));
  }
  // Rails, posts, struts down to the island underside.
  for (let i = 0; i <= 5; i++) {
    const zz = -len / 2 + (i / 5) * len;
    for (const sx of [-5.2, 5.2]) {
      site.solid.add(new THREE.BoxGeometry(0.6, 3, 0.6), dark, L(sx, 1.5, zz));
      if (i > 1) site.solid.add(new THREE.BoxGeometry(0.7, 22, 0.7), dark, L(sx * 0.8, -9, zz - 4, -0.45, 0, 0));
    }
  }
  site.solid.add(new THREE.BoxGeometry(0.4, 0.4, len), dark, L(-5.2, 2.8, 0));
  site.solid.add(new THREE.BoxGeometry(0.4, 0.4, len), dark, L(5.2, 2.8, 0));
  // Lamps at the end of the pier.
  for (const sx of [-5.2, 5.2]) {
    site.solid.add(new THREE.CylinderGeometry(0.25, 0.25, 6, 5), dark, L(sx, 3, len / 2 - 1));
    site.glow.add(new THREE.IcosahedronGeometry(0.9, 0), 0xffd27a, L(sx, 6.4, len / 2 - 1));
  }
  // Cargo crane.
  site.solid.add(new THREE.BoxGeometry(1.2, 14, 1.2), dark, L(-4, 7, -len / 2 + 8));
  site.solid.add(new THREE.BoxGeometry(1, 1, 14), dark, L(-4, 14, -len / 2 + 13));
  site.solid.add(new THREE.BoxGeometry(2.4, 2, 2.4), 0xa0784c, L(-4, 9, -len / 2 + 19));
  // Crates.
  site.solid.add(new THREE.BoxGeometry(2.4, 2.4, 2.4), 0xb48a52, L(3, 1.5, -len / 2 + 4, 0, 0.3, 0));
  site.solid.add(new THREE.BoxGeometry(2, 2, 2), 0x9c7444, L(3.4, 3.6, -len / 2 + 4.3, 0, 0.8, 0));
  // Mooring flag post.
  site.solid.add(new THREE.CylinderGeometry(0.2, 0.2, 10, 4), dark, L(4.5, 5, len / 2 - 4));
  site.glow.add(new THREE.BoxGeometry(0.1, 2, 3.4), BIOMES[p.biome].palette.accent, L(4.5, 9, len / 2 - 2.3));
}

function buildPort(world: World, isl: IslandDesc, p: PortDef, hallLit: boolean): THREE.Group {
  const site = new Site(world, isl);
  const kit = KITS[p.biome];
  const rng = new Rng(isl.seed);
  buildDock(site, p);
  // Houses in a ring, leaving the dock approach clear.
  const n = p.home ? 14 : rng.int(8, 12);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
    let da = Math.abs(((a - p.dockAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < 0.45) continue;
    const r = isl.radius * rng.range(0.38, 0.7);
    if (p.home && i % 3 === 0) da = 0;
    site.house(Math.cos(a) * r, Math.sin(a) * r, -a + Math.PI / 2, rng.range(7, 11), rng.range(5, 8), rng.range(7, 10), kit, rng);
  }
  const key = `port:${p.id}`;
  smokeEmitters.delete(key);
  buildLandmark(site, p, hallLit, rng);
  const g = site.finish();
  g.name = key;
  return g;
}

function addSpinner(site: Site, obj: THREE.Object3D, spin: number, axis: 'x' | 'y' | 'z' = 'y', phase = 0): void {
  obj.userData.spin = spin;
  obj.userData.axis = axis;
  obj.userData.phase = phase;
  obj.userData.animated = true;
  animated.add(obj);
  site.group.add(obj);
}

function buildLandmark(site: Site, p: PortDef, hallLit: boolean, rng: Rng): void {
  const { isl } = site;
  const cx = isl.x;
  const cz = isl.z;
  const cy = site.groundAt(0, 0) - 0.5;
  const s = site.solid;
  const g = site.glow;
  switch (p.landmark) {
    case 'lighthouse': {
      // Cartographers' Hall on the hill.
      s.box(34, 3, 26, 0xd8cfb8, cx, cy + 1.5, cz);
      s.box(28, 14, 20, 0xeee5cf, cx, cy + 10, cz);
      for (let i = 0; i < 6; i++) s.cylinder(1, 1, 13, 8, 0xf6f0e0, cx - 12.5 + i * 5, cy + 9.5, cz + 11.5);
      s.box(30, 2, 3, 0xd8cfb8, cx, cy + 17, cz + 11.5);
      s.cylinder(9, 10, 4, 16, 0xd8cfb8, cx, cy + 19, cz);
      const domeGeo = new THREE.SphereGeometry(9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      (hallLit ? g : s).add(domeGeo, hallLit ? 0xffd77a : 0x6f6a5c, mat(cx, cy + 21, cz));
      (hallLit ? g : s).add(new THREE.IcosahedronGeometry(1.6, 0), hallLit ? 0xfff2b0 : 0x8a8270, mat(cx, cy + 31, cz));
      // Lighthouse on the rim, opposite the dock.
      const la = p.dockAngle + 2.4;
      const lr = isl.radius * 0.8;
      const lx = Math.cos(la) * lr;
      const lz = Math.sin(la) * lr;
      const ly = site.groundAt(lx, lz) - 0.5;
      for (let i = 0; i < 6; i++) s.cylinder(4.2 - i * 0.35, 4.5 - i * 0.35, 5, 10, i % 2 ? 0xc0463a : 0xf4f1e8, cx + lx, ly + 2.5 + i * 5, cz + lz);
      s.cylinder(3.4, 3.4, 1, 10, 0x333333, cx + lx, ly + 30.5, cz + lz);
      g.cylinder(2.3, 2.3, 4, 8, 0xfff0b0, cx + lx, ly + 33, cz + lz);
      s.cone(3, 3, 10, 0xc0463a, cx + lx, ly + 36.5, cz + lz);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(14, 160, 12, 1, true), beamMaterial);
      beam.geometry.rotateZ(Math.PI / 2);
      beam.geometry.translate(80, 0, 0);
      beam.position.set(cx + lx, ly + 33, cz + lz);
      addSpinner(site, beam, 0.6);
      // A windmill too: Skyharbor grows its own grain.
      windmill(site, Math.cos(p.dockAngle - 1.6) * isl.radius * 0.55, Math.sin(p.dockAngle - 1.6) * isl.radius * 0.55, 0xf1e6cf, 0xa8483a);
      break;
    }
    case 'windmill':
      windmill(site, 0, 0, 0xf1e6cf, 0xc0573e);
      windmill(site, isl.radius * 0.5, -isl.radius * 0.2, 0xe8d6b5, 0x5f7f9c);
      for (let i = 0; i < 10; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(20, isl.radius * 0.8);
        const hx = Math.cos(a) * r;
        const hz = Math.sin(a) * r;
        s.box(1.6, 1.4, 1.6, 0xe7c35a, cx + hx, site.groundAt(hx, hz) + 0.4, cz + hz);
      }
      break;
    case 'lanterns': {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        const r = isl.radius * 0.55;
        const x0 = Math.cos(a) * r;
        const z0 = Math.sin(a) * r;
        const a1 = a + Math.PI / 3;
        const x1 = Math.cos(a1) * r;
        const z1 = Math.sin(a1) * r;
        const y0 = site.groundAt(x0, z0);
        const y1 = site.groundAt(x1, z1);
        s.cylinder(0.4, 0.5, 16, 5, 0x5a3d26, cx + x0, y0 + 8, cz + z0);
        for (let i = 1; i < 10; i++) {
          const t = i / 10;
          const sag = Math.sin(t * Math.PI) * 4;
          const col = [0xff9a4a, 0xffd06a, 0xff6a5a, 0xffe4a0][i % 4];
          g.sphere(0.9, 0, col, cx + x0 + (x1 - x0) * t, y0 + 15 + (y1 - y0) * t - sag, cz + z0 + (z1 - z0) * t, 1, 1.3, 1);
        }
      }
      s.cylinder(6, 7, 18, 8, 0xe8d6b5, cx, cy + 9, cz);
      s.cone(8, 8, 8, 0xa8483a, cx, cy + 22, cz);
      g.sphere(2, 0, 0xffd06a, cx, cy + 28, cz);
      break;
    }
    case 'icetower':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const r = i === 0 ? 0 : 16;
        const h = i === 0 ? 46 : 26 + i * 3;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = site.groundAt(x, z);
        s.cylinder(4.5, 5.5, h, 6, 0x9fb6cf, cx + x, y + h / 2, cz + z);
        g.cylinder(3, 3, 3, 6, 0x9fe3ff, cx + x, y + h * 0.75, cz + z);
        s.cone(5.5, 9, 6, 0xe8f3fb, cx + x, y + h + 4.5, cz + z);
      }
      break;
    case 'spindle': {
      s.cone(14, 140, 7, 0xbfe2f2, cx, cy + 70, cz);
      g.cone(6, 60, 7, 0xd7f5ff, cx, cy + 105, cz);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        s.box(6, 7, 4, 0xa9b4c2, cx + Math.cos(a) * 24, cy + 3.5, cz + Math.sin(a) * 24, -a);
      }
      s.cylinder(26, 26, 1.2, 24, 0x8f9cad, cx, cy + 7.5, cz);
      break;
    }
    case 'forge': {
      s.box(26, 12, 18, 0x3a3034, cx, cy + 6, cz);
      const emit: THREE.Vector3[] = [];
      for (let i = 0; i < 3; i++) {
        const x = cx - 8 + i * 8;
        s.cylinder(2.2, 2.8, 26, 8, 0x2a2226, x, cy + 13, cz - 5);
        g.cylinder(2.3, 2.3, 1.5, 8, 0xff7a2f, x, cy + 26.5, cz - 5);
        emit.push(new THREE.Vector3(x, cy + 28, cz - 5));
      }
      g.box(10, 5, 0.5, 0xff9b4a, cx, cy + 3, cz + 9.1);
      smokeEmitters.set(`port:${p.id}`, emit);
      break;
    }
    case 'kiln': {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        s.box(9, 10 + (i % 3) * 3, 5, 0x3d3236, cx + Math.cos(a) * 30, cy + 5, cz + Math.sin(a) * 30, -a);
      }
      s.sphere(10, 1, 0x5c4840, cx, cy + 2, cz, 1, 0.7, 1);
      g.sphere(3, 0, 0xff7a2f, cx, cy + 9, cz);
      smokeEmitters.set(`port:${p.id}`, [new THREE.Vector3(cx, cy + 12, cz)]);
      break;
    }
    case 'prism': {
      const prism = new THREE.Mesh(
        new MeshBuilder()
          .add(new THREE.OctahedronGeometry(10, 0), 0xb6fff4, new THREE.Matrix4().makeScale(1, 2.4, 1))
          .build(),
        glowMaterial(),
      );
      prism.position.set(cx, cy + 40, cz);
      prism.userData.baseY = cy + 40;
      prism.userData.bob = 3;
      addSpinner(site, prism, 0.25);
      s.cylinder(10, 14, 6, 6, 0x7f86b8, cx, cy + 3, cz);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        s.add(new THREE.OctahedronGeometry(3, 0), 0xe59ff2, mat(cx + Math.cos(a) * 12, cy + 8, cz + Math.sin(a) * 12).multiply(new THREE.Matrix4().makeScale(0.7, 2.5, 0.7)));
      }
      break;
    }
    case 'veil': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const x = Math.cos(a) * 20;
        const z = Math.sin(a) * 20;
        s.box(3, 30, 3, 0xf2f0fb, cx + x, cy + 15, cz + z);
        const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(26, 60, 1, 1), veilMaterial);
        ribbon.position.set(cx + x * 1.2, cy + 60, cz + z * 1.2);
        ribbon.rotation.y = -a;
        addSpinner(site, ribbon, 0.05, 'y', a);
      }
      s.cylinder(12, 14, 14, 10, 0xe4f5f1, cx, cy + 7, cz);
      s.add(new THREE.SphereGeometry(12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x9c86d8, mat(cx, cy + 14, cz));
      break;
    }
  }
}

function windmill(site: Site, lx: number, lz: number, wall: number, roof: number): void {
  const { isl } = site;
  const y = site.groundAt(lx, lz) - 0.5;
  const x = isl.x + lx;
  const z = isl.z + lz;
  site.solid.cylinder(3.5, 5, 16, 8, wall, x, y + 8, z);
  site.solid.cone(4.5, 6, 8, roof, x, y + 19, z);
  const blades = new THREE.Mesh(
    new MeshBuilder()
      .box(1.2, 26, 0.3, 0x8b6440, 0, 0, 0)
      .box(26, 1.2, 0.3, 0x8b6440, 0, 0, 0)
      .box(3, 10, 0.2, 0xf4ecd8, 1.6, 7, 0.2)
      .box(3, 10, 0.2, 0xf4ecd8, -1.6, -7, 0.2)
      .box(10, 3, 0.2, 0xf4ecd8, 7, -1.6, 0.2)
      .box(10, 3, 0.2, 0xf4ecd8, -7, 1.6, 0.2)
      .build(),
    flatMaterial(),
  );
  const holder = new THREE.Group();
  holder.position.set(x, y + 15, z);
  holder.lookAt(isl.x, y + 15, isl.z);
  blades.position.z = -5;
  holder.add(blades);
  blades.userData.spin = 0.8;
  blades.userData.axis = 'z';
  animated.add(blades);
  site.group.add(holder);
}

function buildObservatory(world: World, isl: IslandDesc): THREE.Group {
  const site = new Site(world, isl);
  const s = site.solid;
  const cy = site.groundAt(0, 0) - 0.5;
  const { x: cx, z: cz } = isl;
  const stone = 0xd4ccb6;
  s.cylinder(30, 32, 3, 20, 0xbdb39b, cx, cy + 1.5, cz);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const h = i % 4 === 0 ? 6 : 18 + (i % 3) * 3;
    s.cylinder(1.6, 1.8, h, 8, stone, cx + Math.cos(a) * 26, cy + 3 + h / 2, cz + Math.sin(a) * 26);
  }
  s.add(new THREE.SphereGeometry(27, 14, 6, 0, Math.PI * 1.1, 0, Math.PI / 2.6), 0x8a9db5, mat(cx, cy + 22, cz, 0, 0.7, 0));
  // The great telescope pointing south-east, lens missing.
  s.box(8, 8, 8, 0x7a6a4a, cx, cy + 7, cz);
  s.cylinder(3, 4, 34, 10, 0xb08d4a, cx + 8, cy + 20, cz + 8, 0.9, Math.PI / 4, 0);
  s.cylinder(4.5, 4.5, 2, 10, 0x8a6a2a, cx + 19, cy + 28, cz + 19, 0.9, Math.PI / 4, 0);
  return site.finish();
}

function buildVault(world: World, isl: IslandDesc): THREE.Group {
  const site = new Site(world, isl);
  const cy = site.groundAt(0, 0) - 0.5;
  const { x: cx, z: cz } = isl;
  site.solid.box(30, 18, 24, 0x3d3236, cx, cy + 9, cz);
  site.solid.box(34, 3, 28, 0x2a2226, cx, cy + 19, cz);
  site.glow.box(8, 12, 0.6, 0xff7a2f, cx, cy + 6, cz + 12.1);
  for (const sx of [-12, 12]) site.solid.cylinder(2, 2.2, 22, 6, 0x5a4a44, cx + sx, cy + 11, cz + 13);
  return site.finish();
}

function buildMeridian(world: World, isl: IslandDesc): THREE.Group {
  const site = new Site(world, isl);
  const cy = site.groundAt(0, 0) - 0.5;
  const { x: cx, z: cz } = isl;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = isl.radius * 0.82;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    site.solid.box(6, 50, 6, 0x575d8f, x, cy + 25, z, -a);
    site.solid.box(6, 4, 26, 0x7f86b8, x, cy + 52, z, -a);
    site.glow.box(1, 30, 1, 0xffd77a, x, cy + 25, z, -a);
  }
  // Chart table at the centre.
  site.solid.cylinder(8, 9, 4, 12, 0x6d5aa0, cx, cy + 2, cz);
  site.glow.cylinder(7, 7, 0.4, 12, 0xfff2b0, cx, cy + 4.2, cz);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(isl.radius * 0.9, 2.2, 6, 48), glowMaterial());
  ring.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(ring.geometry.getAttribute('position').count * 3).fill(1).map((v, i) => (i % 3 === 2 ? 0.5 : v)), 3));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(cx, cy + 90, cz);
  ring.userData.baseY = cy + 90;
  ring.userData.bob = 4;
  animated.add(ring);
  site.group.add(ring);
  // Orbiting stones.
  const orbit = new THREE.Group();
  orbit.position.set(cx, cy + 40, cz);
  const ob = new MeshBuilder();
  const rng = new Rng(isl.seed);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = isl.radius * rng.range(1.1, 1.4);
    ob.add(new THREE.DodecahedronGeometry(rng.range(4, 9), 0), 0x575d8f, mat(Math.cos(a) * r, rng.range(-30, 30), Math.sin(a) * r));
  }
  orbit.add(new THREE.Mesh(ob.build(), flatMaterial()));
  addSpinner(site, orbit, 0.04);
  return site.finish();
}

function buildWreck(world: World, isl: IslandDesc): THREE.Group {
  const site = new Site(world, isl);
  const cy = site.groundAt(0, 0) - 0.5;
  const { x: cx, z: cz } = isl;
  const m = mat(cx + 6, cy + 2, cz - 4, 0.25, 0.8, 0.35);
  const L = (px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => m.clone().multiply(mat(px, py, pz, rx, ry, rz));
  site.solid.add(new THREE.BoxGeometry(6, 3, 16), 0x5a3d26, L(0, 1.5, 0));
  site.solid.add(new THREE.BoxGeometry(5, 0.5, 14), 0x7a5634, L(0, 3, 0));
  site.solid.add(new THREE.CylinderGeometry(0.4, 0.4, 10, 5), 0x4a3020, L(0, 7, 2, 0.6, 0, 0));
  // Torn envelope draped over the rocks.
  site.solid.add(new THREE.IcosahedronGeometry(7, 1), 0xd8ccb0, L(-3, 4, -8).multiply(new THREE.Matrix4().makeScale(1.6, 0.35, 1.1)));
  site.glow.add(new THREE.BoxGeometry(1.2, 1, 1.6), 0xffd27a, L(1, 4, 4));
  for (let i = 0; i < 5; i++) site.solid.add(new THREE.BoxGeometry(1.6, 1.6, 1.6), 0xa0784c, L(-6 + i * 3, 0.8, 8 + (i % 2) * 2, 0, i, 0));
  return site.finish();
}
