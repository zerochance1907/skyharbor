/**
 * Visual effects: smoke and spark particles, cannonballs, lightning, rain,
 * wind streaks and glowing beacons for shards, salvage and loot.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Cannonball } from '../sim/combat';
import { MeshBuilder, flatMaterial, glowMaterial } from './builder';
import { makePuffTexture } from './textures';

const particleVert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (600.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}`;
const particleFrag = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private startAlpha: Float32Array;
  private next = 0;
  private geo: THREE.BufferGeometry;

  constructor(
    scene: THREE.Scene,
    private count: number,
    additive: boolean,
    tex: THREE.Texture,
    private lift: number,
  ) {
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.startAlpha = new Float32Array(count);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms: { uMap: { value: tex } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, color: THREE.Color, alpha = 1): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.alpha[i] = alpha;
    this.startAlpha[i] = alpha;
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] += this.lift * dt;
      this.vel[i * 3] *= 1 - dt * 0.6;
      this.vel[i * 3 + 2] *= 1 - dt * 0.6;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.startAlpha[i] * Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 12 + 0.2);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export type MarkerKind = 'fragment' | 'salvage' | 'loot' | 'objective';

export interface Marker {
  id: string;
  kind: MarkerKind;
  group: THREE.Group;
  x: number;
  y: number;
  z: number;
}

function pillarTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  private smoke: ParticlePool;
  private sparks: ParticlePool;
  private balls: THREE.InstancedMesh;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private streaks: THREE.LineSegments;
  private streakPos: Float32Array;
  private streakSeeds: Float32Array;
  private bolts: { mesh: THREE.Mesh; life: number }[] = [];
  private markers = new Map<string, Marker>();
  private pillarTex = pillarTexture();
  private rng = new Rng(77);
  private m = new THREE.Matrix4();
  private scene: THREE.Scene;
  private tmp = new THREE.Color();
  private rainCount: number;

  constructor(scene: THREE.Scene, quality: { particles: number; rain: number }) {
    this.scene = scene;
    const puff = makePuffTexture(64);
    this.smoke = new ParticlePool(scene, quality.particles, false, puff, 4);
    this.sparks = new ParticlePool(scene, Math.floor(quality.particles / 2), true, puff, -6);
    const ballGeo = new THREE.IcosahedronGeometry(1.1, 0);
    this.balls = new THREE.InstancedMesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0x1c1c1c }), 160);
    this.balls.count = 0;
    this.balls.frustumCulled = false;
    scene.add(this.balls);

    this.rainCount = quality.rain;
    this.rainPos = new Float32Array(this.rainCount * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab8cc, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    for (let i = 0; i < this.rainCount; i++) this.resetDrop(i, new THREE.Vector3(), true);

    const n = 90;
    this.streakPos = new Float32Array(n * 6);
    this.streakSeeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) this.streakSeeds[i] = this.rng.next();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.streaks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.streaks.frustumCulled = false;
    scene.add(this.streaks);
  }

  private resetDrop(i: number, cam: THREE.Vector3, randomY: boolean): void {
    const x = cam.x + this.rng.range(-160, 160);
    const z = cam.z + this.rng.range(-160, 160);
    const y = cam.y + (randomY ? this.rng.range(-80, 140) : 140);
    this.rainPos.set([x, y, z, x, y - 6, z], i * 6);
  }

  smokePuff(x: number, y: number, z: number, scale = 1, dark = false): void {
    this.tmp.set(dark ? 0x3a3a3e : 0xd9d9dc);
    this.smoke.emit(x, y, z, this.rng.range(-2, 2), this.rng.range(1, 4), this.rng.range(-2, 2), this.rng.range(2, 4), 8 * scale, 6 * scale, this.tmp, dark ? 0.7 : 0.5);
  }

  muzzle(x: number, y: number, z: number, dx: number, dz: number): void {
    for (let i = 0; i < 6; i++) {
      this.tmp.set(0xffb060);
      this.sparks.emit(x, y, z, dx * 30 + this.rng.range(-6, 6), this.rng.range(-3, 6), dz * 30 + this.rng.range(-6, 6), 0.3, 5, 4, this.tmp);
      this.tmp.set(0xcfcfd2);
      this.smoke.emit(x, y, z, dx * 12 + this.rng.range(-3, 3), this.rng.range(0, 3), dz * 12 + this.rng.range(-3, 3), this.rng.range(1.2, 2), 5, 9, this.tmp, 0.55);
    }
  }

  explosion(x: number, y: number, z: number, big = false): void {
    const n = big ? 40 : 14;
    for (let i = 0; i < n; i++) {
      this.tmp.set(i % 3 === 0 ? 0xffe08a : 0xff7a2f);
      const s = big ? 30 : 16;
      this.sparks.emit(x, y, z, this.rng.range(-s, s), this.rng.range(-s * 0.5, s), this.rng.range(-s, s), this.rng.range(0.3, 0.8), big ? 10 : 6, 10, this.tmp);
    }
    for (let i = 0; i < n / 2; i++) this.smokePuff(x + this.rng.range(-4, 4), y, z + this.rng.range(-4, 4), big ? 2 : 1.2, true);
  }

  splash(x: number, y: number, z: number): void {
    for (let i = 0; i < 5; i++) {
      this.tmp.set(0xffffff);
      this.smoke.emit(x, y, z, this.rng.range(-5, 5), this.rng.range(2, 8), this.rng.range(-5, 5), 1.4, 10, 12, this.tmp, 0.5);
    }
  }

  sparkle(x: number, y: number, z: number, color: number): void {
    this.tmp.set(color);
    for (let i = 0; i < 24; i++) this.sparks.emit(x, y, z, this.rng.range(-14, 14), this.rng.range(-8, 18), this.rng.range(-14, 14), this.rng.range(0.6, 1.4), 4, 2, this.tmp);
  }

  /** Engine exhaust trail behind the ship. */
  exhaust(x: number, y: number, z: number, throttle: number, boost: boolean): void {
    if (this.rng.next() > 0.25 + throttle * 0.6) return;
    this.tmp.set(boost ? 0x9af7e8 : 0xe8e6e0);
    this.smoke.emit(x, y, z, this.rng.range(-1, 1), this.rng.range(0, 1.5), this.rng.range(-1, 1), boost ? 0.9 : 1.6, 2.5, 5, this.tmp, boost ? 0.55 : 0.28);
  }

  lightning(x: number, z: number, top: number, bottom: number): void {
    const pts: THREE.Vector3[] = [];
    let cx = x;
    let cz = z;
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const y = top - ((top - bottom) * i) / steps;
      pts.push(new THREE.Vector3(cx, y, cz));
      cx += this.rng.range(-18, 18);
      cz += this.rng.range(-18, 18);
    }
    const pos: number[] = [];
    const w = 2.2;
    for (let i = 0; i < steps; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      for (const [ox, oz] of [[w, 0], [0, w]]) {
        pos.push(a.x - ox, a.y, a.z - oz, a.x + ox, a.y, a.z + oz, b.x - ox, b.y, b.z - oz);
        pos.push(a.x + ox, a.y, a.z + oz, b.x + ox, b.y, b.z + oz, b.x - ox, b.y, b.z - oz);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe8f0ff, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.bolts.push({ mesh, life: 0.35 });
  }

  addMarker(id: string, kind: MarkerKind, x: number, y: number, z: number): void {
    if (this.markers.has(id)) return;
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const color = kind === 'fragment' ? 0xffd77a : kind === 'salvage' ? 0x8affc0 : kind === 'loot' ? 0xffb060 : 0x9fe3ff;
    if (kind === 'fragment') {
      const shard = new THREE.Mesh(new MeshBuilder().add(new THREE.OctahedronGeometry(3, 0), 0xffe9a8, new THREE.Matrix4().makeScale(0.7, 1.5, 0.7)).build(), glowMaterial());
      shard.name = 'spin';
      group.add(shard);
    } else if (kind === 'salvage' || kind === 'loot') {
      const b = new MeshBuilder();
      if (kind === 'salvage') {
        b.box(4, 3, 3, 0xa0784c).box(4.2, 0.4, 3.2, 0x5a3d26, 0, 1.2, 0).box(4.2, 0.4, 3.2, 0x5a3d26, 0, -1.2, 0);
        b.sphere(2.4, 0, 0xd9cfb8, 0, 4.5, 0, 1, 1.2, 1);
      } else {
        b.cylinder(1.2, 1.2, 2.6, 7, 0x8b6440, -1.5, 0, 0).cylinder(1.2, 1.2, 2.6, 7, 0x8b6440, 1.5, 0, 0.5).box(2.4, 2.4, 2.4, 0xb48a52, 0, 0.4, -2);
      }
      const crate = new THREE.Mesh(b.build(), flatMaterial());
      crate.name = 'bob';
      group.add(crate);
    }
    const pillarH = kind === 'loot' ? 60 : 600;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(kind === 'fragment' ? 2.5 : 3, kind === 'fragment' ? 2.5 : 3, pillarH, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, map: this.pillarTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    pillar.position.y = pillarH / 2 - 4;
    group.add(pillar);
    this.scene.add(group);
    this.markers.set(id, { id, kind, group, x, y, z });
  }

  removeMarker(id: string): void {
    const m = this.markers.get(id);
    if (!m) return;
    this.scene.remove(m.group);
    m.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.material instanceof THREE.MeshBasicMaterial && o.material.map === this.pillarTex) o.material.dispose();
      }
    });
    this.markers.delete(id);
  }

  hasMarker(id: string): boolean {
    return this.markers.has(id);
  }

  markerIds(): string[] {
    return [...this.markers.keys()];
  }

  update(dt: number, time: number, cam: THREE.Vector3, balls: Cannonball[], rainAmount: number, windX: number, windZ: number, current: number, ship: THREE.Vector3, night = 0): void {
    this.smoke.update(dt);
    this.sparks.update(dt);
    // Cannonballs.
    const n = Math.min(balls.length, 160);
    for (let i = 0; i < n; i++) {
      this.m.makeTranslation(balls[i].x, balls[i].y, balls[i].z);
      this.balls.setMatrixAt(i, this.m);
    }
    this.balls.count = n;
    this.balls.instanceMatrix.needsUpdate = true;
    // Lightning fades.
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.35) * (Math.sin(time * 90) > -0.3 ? 1 : 0.3);
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
      }
    }
    // Rain.
    const rm = this.rain.material as THREE.LineBasicMaterial;
    rm.opacity = Math.min(0.55, rainAmount * 0.6);
    this.rain.visible = rainAmount > 0.05;
    if (this.rain.visible) {
      const fall = 160 * dt;
      for (let i = 0; i < this.rainCount; i++) {
        const o = i * 6;
        this.rainPos[o] += windX * dt;
        this.rainPos[o + 2] += windZ * dt;
        this.rainPos[o + 1] -= fall;
        this.rainPos[o + 3] = this.rainPos[o] - windX * 0.05;
        this.rainPos[o + 5] = this.rainPos[o + 2] - windZ * 0.05;
        this.rainPos[o + 4] = this.rainPos[o + 1] + 7;
        if (this.rainPos[o + 1] < cam.y - 90 || Math.abs(this.rainPos[o] - cam.x) > 170 || Math.abs(this.rainPos[o + 2] - cam.z) > 170) this.resetDrop(i, cam, false);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    // Wind streaks show air flow and sky currents.
    const ws = Math.hypot(windX, windZ);
    const sm = this.streaks.material as THREE.LineBasicMaterial;
    sm.opacity = Math.min(0.35, Math.max(0, ws - 4) / 80 + current * 0.3) * (1 - night * 0.8);
    const dirX = ws > 0.01 ? windX / ws : 1;
    const dirZ = ws > 0.01 ? windZ / ws : 0;
    const count = this.streakPos.length / 6;
    for (let i = 0; i < count; i++) {
      const s = this.streakSeeds;
      const phase = (s[i * 4] + time * (0.15 + ws * 0.01)) % 1;
      const along = (phase - 0.5) * 200;
      const side = (s[i * 4 + 1] - 0.5) * 160;
      const up = (s[i * 4 + 2] - 0.5) * 50;
      const len = 4 + s[i * 4 + 3] * 10 + current * 14;
      const x = ship.x + dirX * along - dirZ * side;
      const z = ship.z + dirZ * along + dirX * side;
      const y = ship.y + up;
      this.streakPos.set([x, y, z, x + dirX * len, y, z + dirZ * len], i * 6);
    }
    this.streaks.geometry.attributes.position.needsUpdate = true;
    // Markers spin and bob.
    for (const m of this.markers.values()) {
      const spin = m.group.getObjectByName('spin');
      if (spin) spin.rotation.y = time * 1.8;
      const bob = m.group.getObjectByName('bob');
      if (bob) {
        bob.position.y = Math.sin(time * 1.5 + m.x) * 1.2;
        bob.rotation.y = time * 0.3;
      }
      const d = Math.hypot(m.x - cam.x, m.z - cam.z);
      m.group.visible = d < 6000;
    }
  }
}
