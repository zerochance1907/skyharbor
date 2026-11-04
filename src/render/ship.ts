/**
 * Procedural airship: a painted envelope over a lofted wooden gondola. Every
 * upgrade adds visible parts (plating, propellers, pods, lanterns, guns,
 * aether globes) and the paint scheme recolours the envelope pattern.
 */
import * as THREE from 'three';
import type { Paint } from '../sim/state';
import type { UpgradeLevels } from '../sim/upgrades';
import { MeshBuilder, flatMaterial, glowMaterial, mat } from './builder';
import { makeEmblemTexture } from './textures';

export interface ShipLook {
  paint: Paint;
  upgrades: UpgradeLevels;
  scale?: number;
}

function hullGeometry(len: number, beam: number, depth: number, color: THREE.Color, deckColor: THREE.Color): THREE.BufferGeometry {
  // Lofted hull: sections along z (bow at -z).
  const b = new MeshBuilder();
  const N = 10;
  const sec: { z: number; w: number; d: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -len / 2 + t * len;
    const bowT = 1 - t;
    const w = beam * Math.pow(Math.sin(Math.min(1, t * 1.05 + 0.04) * Math.PI), 0.55) * (bowT > 0.85 ? 0.5 : 1);
    const d = depth * (0.55 + 0.45 * Math.sin(t * Math.PI));
    sec.push({ z, w: Math.max(w, 0.15), d });
  }
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const dark = color.clone().multiplyScalar(0.8);
  for (let i = 0; i < N; i++) {
    const a = sec[i];
    const c = sec[i + 1];
    // deck
    b.tri(V(-a.w, 0, a.z), V(a.w, 0, a.z), V(-c.w, 0, c.z), deckColor);
    b.tri(V(a.w, 0, a.z), V(c.w, 0, c.z), V(-c.w, 0, c.z), deckColor);
    for (const s of [-1, 1]) {
      const col = i % 2 ? color : dark;
      // side upper (deck edge to chine) and lower (chine to keel)
      const p1 = V(s * a.w, 0, a.z);
      const p2 = V(s * c.w, 0, c.z);
      const q1 = V(s * a.w * 0.8, -a.d * 0.55, a.z);
      const q2 = V(s * c.w * 0.8, -c.d * 0.55, c.z);
      const k1 = V(0, -a.d, a.z);
      const k2 = V(0, -c.d, c.z);
      if (s > 0) {
        b.tri(p1, q1, p2, col);
        b.tri(p2, q1, q2, col);
        b.tri(q1, k1, q2, col);
        b.tri(q2, k1, k2, col);
      } else {
        b.tri(p1, p2, q1, col);
        b.tri(p2, q2, q1, col);
        b.tri(q1, q2, k1, col);
        b.tri(q2, k2, k1, col);
      }
    }
  }
  // transom (stern) cap
  const e = sec[N];
  b.tri(V(-e.w, 0, e.z), V(e.w, 0, e.z), V(0, -e.d, e.z), dark);
  return b.build();
}

function envelopeGeometry(paint: Paint, radius: number, length: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 18, 10).toNonIndexed();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors: number[] = [];
  const base = new THREE.Color(paint.envelope);
  const trim = new THREE.Color(paint.trim);
  const sail = new THREE.Color(paint.sail);
  for (let i = 0; i < pos.count; i += 3) {
    // Face centroid in unit-sphere space.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(i + k) / 3;
      cy += pos.getY(i + k) / 3;
      cz += pos.getZ(i + k) / 3;
    }
    let c = base;
    if (paint.pattern === 'stripes') c = Math.floor((cz + 1) * 4) % 2 === 0 ? base : sail;
    else if (paint.pattern === 'band') c = Math.abs(cy) < 0.22 ? trim : base;
    else if (paint.pattern === 'chevron') c = Math.floor((cz + Math.abs(cx) * 0.8 + 1) * 3) % 2 === 0 ? base : sail;
    const k = 0.94 + ((i * 2654435761) % 997) / 997 * 0.08;
    for (let v = 0; v < 3; v++) colors.push(c.r * k, c.g * k, c.b * k);
  }
  // Stretch to a cigar shape, slightly fuller at the front.
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const taper = z > 0 ? 1 - z * 0.18 : 1;
    pos.setXYZ(i, pos.getX(i) * radius * taper, pos.getY(i) * radius * taper, z * length);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export class ShipModel {
  readonly root = new THREE.Group();
  /** Rolls and pitches independently of the yaw on root. */
  readonly body = new THREE.Group();
  private propellers: THREE.Object3D[] = [];
  private spinners: THREE.Object3D[] = [];
  private lanternLight: THREE.PointLight;
  private beam: THREE.Mesh | null = null;
  private globes: THREE.Mesh[] = [];
  private globeMat = new THREE.MeshBasicMaterial({ color: 0x7af5e0 });
  private emblemMats: THREE.MeshBasicMaterial[] = [];
  private parts = new THREE.Group();
  look: ShipLook;
  /** Side cannon muzzle positions (local), filled on rebuild. */
  muzzles: { side: number; pos: THREE.Vector3 }[] = [];

  constructor(look: ShipLook, withLight = false) {
    this.look = look;
    this.root.add(this.body);
    this.body.add(this.parts);
    this.lanternLight = new THREE.PointLight(0xffd59a, 0, 120, 1.6);
    this.lanternLight.position.set(0, 0, -11);
    // Only the player's ship carries a real light: a fixed light count avoids shader recompiles.
    if (withLight) this.body.add(this.lanternLight);
    this.rebuild(look);
    const s = look.scale ?? 1;
    this.root.scale.setScalar(s);
  }

  rebuild(look: ShipLook): void {
    this.look = look;
    for (const c of [...this.parts.children]) {
      this.parts.remove(c);
      c.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    for (const m of this.emblemMats) {
      m.map?.dispose();
      m.dispose();
    }
    this.emblemMats = [];
    this.propellers = [];
    this.spinners = [];
    this.globes = [];
    this.beam = null;
    this.muzzles = [];
    const { paint, upgrades: u } = look;
    const solid = new MeshBuilder();
    const glow = new MeshBuilder();

    // Envelope.
    const envR = 6.2;
    const envL = 17;
    const env = new THREE.Mesh(envelopeGeometry(paint, envR, envL), flatMaterial());
    env.position.y = 9;
    this.parts.add(env);
    // Envelope frame ribs and tail fins.
    for (const z of [-8, 0, 8]) {
      const k = Math.sqrt(1 - (z / envL) ** 2) * envR * (z > 0 ? 1 - (z / envL) * 0.18 : 1);
      solid.add(new THREE.TorusGeometry(k + 0.1, 0.18, 4, 18), paint.trim, mat(0, 9, z));
    }
    const finC = paint.sail;
    solid.add(new THREE.BoxGeometry(0.35, 4.6, 5), finC, mat(0, 12.6, 14.2, -0.35, 0, 0));
    solid.add(new THREE.BoxGeometry(0.35, 3.8, 4.4), finC, mat(0, 5.4, 14.2, 0.35, 0, 0));
    solid.add(new THREE.BoxGeometry(4.4, 0.35, 4.4), finC, mat(-4, 9, 14.2, 0, 0, 0.12));
    solid.add(new THREE.BoxGeometry(4.4, 0.35, 4.4), finC, mat(4, 9, 14.2, 0, 0, -0.12));

    // Emblem decals.
    if (paint.emblem !== 'none') {
      const tex = makeEmblemTexture(paint.emblem, '#' + new THREE.Color(paint.trim).getHexString());
      const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      this.emblemMats.push(m);
      for (const s of [-1, 1]) {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), m);
        d.position.set(s * (envR + 0.08), 9.5, -1);
        d.rotation.y = s * Math.PI / 2;
        this.parts.add(d);
      }
    }

    // Gondola hull.
    const hullColor = new THREE.Color(paint.hull);
    const hull = new THREE.Mesh(hullGeometry(19, 3.6, 4.2, hullColor, new THREE.Color(0xb88c5a)), flatMaterial());
    hull.position.y = -2.2;
    this.parts.add(hull);
    // Rigging struts from deck to envelope.
    for (const z of [-6, 0, 6]) {
      for (const s of [-1, 1]) solid.add(new THREE.CylinderGeometry(0.12, 0.12, 6.6, 3), 0x3b2a1c, mat(s * 2.2, 0.8 + 0.2, z, 0, 0, s * 0.28));
    }
    // Cabin at stern, wheel.
    solid.box(4.6, 2.6, 4.6, 0xa47a4c, 0, -0.9, 5.5);
    solid.box(5.2, 0.4, 5.2, paint.trim, 0, 0.5, 5.5);
    glow.box(0.2, 0.9, 1.2, 0xffd59a, 2.35, -0.6, 5.5);
    glow.box(0.2, 0.9, 1.2, 0xffd59a, -2.35, -0.6, 5.5);

    // HULL upgrades: ribs / copper bands / iron plates and a ram.
    if (u.hull >= 1) for (let i = -3; i <= 3; i++) solid.add(new THREE.BoxGeometry(7.6, 0.5, 0.6), 0x4a3020, mat(0, -3.3, i * 2.4, 0, 0, 0).multiply(new THREE.Matrix4().makeScale(0.92 - Math.abs(i) * 0.08, 1, 1)));
    if (u.hull >= 2) for (const s of [-1, 1]) solid.add(new THREE.BoxGeometry(0.3, 0.7, 15), 0xc77b3a, mat(s * 3.3, -2.9, 0.5));
    if (u.hull >= 3) {
      for (const s of [-1, 1]) for (let i = -2; i <= 2; i++) solid.add(new THREE.BoxGeometry(0.3, 2, 2.6), 0x6f7880, mat(s * 2.9, -4.1, i * 2.9, 0, 0, -s * 0.35));
      solid.add(new THREE.ConeGeometry(1.1, 4, 6), 0x6f7880, mat(0, -3.4, -11.5, -Math.PI / 2, 0, 0));
    }

    // ENGINE: propellers at the stern; turbines from level 2.
    const propCount = [1, 2, 2, 3][u.engine];
    const propXs = propCount === 1 ? [0] : propCount === 2 ? [-3.2, 3.2] : [-3.6, 0, 3.6];
    for (const x of propXs) {
      const y = x === 0 ? -1.6 : -0.6;
      solid.add(new THREE.CylinderGeometry(0.7, 0.9, 3, 8), 0x4a4f55, mat(x, y, 10, Math.PI / 2, 0, 0));
      if (u.engine >= 2) glow.add(new THREE.TorusGeometry(1.2, 0.25, 4, 12), 0x7af5e0, mat(x, y, 9.4));
      if (x !== 0) solid.add(new THREE.BoxGeometry(Math.abs(x), 0.4, 0.8), 0x3b2a1c, mat(x / 2, y, 9));
      const prop = new THREE.Mesh(
        new MeshBuilder()
          .box(0.5, 4.6 + u.engine * 0.5, 0.15, 0x8b6440, 0, 0, 0)
          .box(4.6 + u.engine * 0.5, 0.5, 0.15, 0x8b6440, 0, 0, 0)
          .sphere(0.45, 0, 0xc9a14a, 0, 0, 0)
          .build(),
        flatMaterial(),
      );
      prop.position.set(x, y, 11.7);
      this.parts.add(prop);
      this.propellers.push(prop);
    }
    if (u.engine >= 3) for (const s of [-1, 1]) {
      solid.add(new THREE.CylinderGeometry(1.4, 1.1, 6, 8), 0x5a6068, mat(s * envR * 0.95, 9, 9, Math.PI / 2, 0, 0));
      glow.add(new THREE.CylinderGeometry(1.0, 1.0, 0.3, 8), 0x7af5e0, mat(s * envR * 0.95, 9, 12.1, Math.PI / 2, 0, 0));
    }

    // CARGO: deck crates / nets / side pods / deep belly.
    solid.box(1.8, 1.4, 1.8, 0xb48a52, -1, 0.7, -3, 0.2);
    solid.box(1.5, 1.2, 1.5, 0x9c7444, 1.1, 0.6, -4.5, 0.6);
    if (u.cargo >= 1) solid.add(new THREE.IcosahedronGeometry(2.4, 0), 0x9c8456, mat(0, -6.6, -1).multiply(new THREE.Matrix4().makeScale(1.3, 0.8, 1.7)));
    if (u.cargo >= 2) for (const s of [-1, 1]) {
      solid.add(new THREE.CapsuleGeometry(1.4, 6, 3, 8), paint.hull, mat(s * 4.9, -1.6, -0.5, Math.PI / 2, 0, 0));
      solid.add(new THREE.BoxGeometry(1.6, 0.4, 0.4), 0x3b2a1c, mat(s * 3.9, -1.2, -2));
      solid.add(new THREE.BoxGeometry(1.6, 0.4, 0.4), 0x3b2a1c, mat(s * 3.9, -1.2, 1.5));
    }
    if (u.cargo >= 3) solid.add(new THREE.BoxGeometry(4, 2.2, 10), paint.hull, mat(0, -5.6, 0.5));

    // LANTERN at the bow.
    solid.add(new THREE.CylinderGeometry(0.15, 0.15, 3, 4), 0x3b2a1c, mat(0, 1.2, -8.6));
    const lanternSize = [0.6, 0.9, 1.1, 1.3][u.lantern];
    if (u.lantern === 2) {
      const prism = new THREE.Mesh(new MeshBuilder().add(new THREE.OctahedronGeometry(1.2, 0), 0xb6fff4).build(), glowMaterial());
      prism.position.set(0, 3.2, -8.6);
      this.parts.add(prism);
      this.spinners.push(prism);
    } else {
      glow.sphere(lanternSize, 0, 0xffd59a, 0, 3, -8.6);
      solid.box(lanternSize * 2.2, 0.3, lanternSize * 2.2, 0xc9a14a, 0, 3 + lanternSize, -8.6);
    }
    if (u.lantern >= 3) {
      solid.add(new THREE.CylinderGeometry(1, 1.4, 2, 8), 0xc9a14a, mat(0, -1, -10.6, Math.PI / 2, 0, 0));
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(9, 70, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      beam.geometry.rotateX(-Math.PI / 2);
      beam.geometry.translate(0, 0, -35);
      beam.position.set(0, -1, -11.5);
      beam.rotation.x = -0.12;
      this.parts.add(beam);
      this.beam = beam;
    }
    this.lanternLight.distance = [70, 110, 160, 220][u.lantern];

    // CANNONS along both sides.
    const n = [1, 2, 3, 4][u.cannons];
    const caliber = [0.45, 0.5, 0.6, 0.65][u.cannons];
    for (let i = 0; i < n; i++) {
      const z = n === 1 ? -0.5 : -4.5 + (i / (n - 1)) * 8;
      for (const s of [-1, 1]) {
        solid.add(new THREE.CylinderGeometry(caliber, caliber * 1.25, 2.6, 6), 0x2c2f33, mat(s * 3.6, -0.6, z, 0, 0, s * Math.PI / 2));
        solid.box(1, 0.8, 1.2, 0x5a3d26, s * 2.6, -0.6, z);
        this.muzzles.push({ side: s, pos: new THREE.Vector3(s * 5, -0.6, z) });
      }
    }

    // AETHER TANK: globes on deck that glow with remaining fuel.
    const globeSpots: [number, number, number, number][] =
      u.tank === 0 ? [[0, 1.2, 1.5, 0.8]] : u.tank === 1 ? [[0, 1.6, 1.5, 1.2]] : u.tank === 2 ? [[-1.4, 1.6, 1.5, 1.1], [1.4, 1.6, 1.5, 1.1]] : [[0, 2.2, 1.5, 1.8]];
    for (const [x, y, z, r] of globeSpots) {
      solid.box(r * 1.8, 0.5, r * 1.8, 0xc9a14a, x, 0.3, z);
      const gm = new THREE.Mesh(new THREE.IcosahedronGeometry(r, u.tank === 3 ? 1 : 0), this.globeMat);
      gm.position.set(x, y, z);
      this.parts.add(gm);
      this.globes.push(gm);
    }

    const solidMesh = new THREE.Mesh(solid.build(), flatMaterial());
    this.parts.add(solidMesh);
    if (glow.triangleCount) this.parts.add(new THREE.Mesh(glow.build(), glowMaterial()));
  }

  /** Per-frame animation: propellers spin with throttle, lantern by night. */
  animate(dt: number, throttle: number, night: number, fuelFrac: number, time: number): void {
    const spin = (2 + Math.abs(throttle) * 28) * dt * Math.sign(throttle || 1);
    for (const p of this.propellers) p.rotation.z += spin;
    for (const s of this.spinners) s.rotation.y += dt * 1.5;
    this.lanternLight.intensity = night * (900 + this.look.upgrades.lantern * 700);
    if (this.beam) (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.03 + night * 0.12;
    const pulse = 0.75 + Math.sin(time * 3) * 0.1;
    this.globeMat.color.setRGB(0.25 + 0.2 * fuelFrac, 0.35 + 0.6 * fuelFrac * pulse, 0.4 + 0.5 * fuelFrac * pulse);
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.emblemMats) {
      m.map?.dispose();
      m.dispose();
    }
    this.globeMat.dispose();
  }
}

export const PIRATE_PAINT: Paint = { envelope: 0x2b2a30, hull: 0x2a1f1c, trim: 0xb8433a, sail: 0x7a1f22, pattern: 'stripes', emblem: 'feather' };
export const FLAGSHIP_PAINT: Paint = { envelope: 0x1a1a20, hull: 0x1c1514, trim: 0xd8b04a, sail: 0x8a1a1e, pattern: 'chevron', emblem: 'feather' };
export const MERCHANT_PAINT: Paint = { envelope: 0xd9e4c8, hull: 0x6b5a3a, trim: 0x3f7a5a, sail: 0x3f7a5a, pattern: 'band', emblem: 'star' };
