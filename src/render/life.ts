/** Ambient sky life: flocks of birds and great drifting sky-whales. */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { MeshBuilder, flatMaterial, glowMaterial, mat } from './builder';

interface Flock {
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  speed: number;
  phase: number;
  birds: { r: number; a: number; y: number; s: number }[];
  start: number;
}

export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private flocks: Flock[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private uniforms = { uTime: { value: 0 } };
  private rng = new Rng(808);

  constructor(scene: THREE.Scene, count: number) {
    const b = new MeshBuilder();
    // Body + two wings (wing tips flap in the vertex shader by |x|).
    b.add(new THREE.ConeGeometry(0.35, 2, 4), 0x40403f, mat(0, 0, 0, -Math.PI / 2, 0, 0));
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.5, 2.6, 0, 0.3, 0, 0, 0.6, 0, 0, -0.5, 0, 0, 0.6, -2.6, 0, 0.3], 3));
    b.add(wing, 0xf2efe6);
    const mat2 = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat2.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float ph = float(gl_InstanceID) * 1.37;
         transformed.y += sin(uTime * 9.0 + ph) * abs(position.x) * 0.55;`,
      );
    };
    const perFlock = 9;
    const flocks = Math.max(1, Math.floor(count / perFlock));
    this.mesh = new THREE.InstancedMesh(b.build(), mat2, flocks * perFlock);
    this.mesh.frustumCulled = false;
    for (let f = 0; f < flocks; f++) {
      const fl: Flock = { cx: 0, cy: 0, cz: 0, radius: 0, speed: 0, phase: 0, birds: [], start: f * perFlock };
      for (let i = 0; i < perFlock; i++) fl.birds.push({ r: this.rng.range(-12, 12), a: this.rng.range(-0.25, 0.25), y: this.rng.range(-6, 6), s: this.rng.range(0.8, 1.3) });
      this.flocks.push(fl);
    }
    scene.add(this.mesh);
  }

  private respawn(fl: Flock, cam: THREE.Vector3): void {
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(150, 900);
    fl.cx = cam.x + Math.cos(a) * d;
    fl.cz = cam.z + Math.sin(a) * d;
    fl.cy = Math.max(40, cam.y + this.rng.range(-80, 120));
    fl.radius = this.rng.range(60, 180);
    fl.speed = this.rng.range(0.12, 0.25) * (this.rng.chance(0.5) ? 1 : -1);
    fl.phase = this.rng.range(0, Math.PI * 2);
  }

  update(cam: THREE.Vector3, time: number, night: number): void {
    this.uniforms.uTime.value = time;
    this.mesh.visible = night < 0.85;
    for (const fl of this.flocks) {
      if (fl.radius === 0 || Math.hypot(fl.cx - cam.x, fl.cz - cam.z) > 1300) this.respawn(fl, cam);
      const base = fl.phase + time * fl.speed;
      fl.birds.forEach((b, i) => {
        const a = base + b.a;
        const r = fl.radius + b.r;
        const x = fl.cx + Math.cos(a) * r;
        const z = fl.cz + Math.sin(a) * r;
        const y = fl.cy + b.y + Math.sin(time * 0.7 + i) * 3;
        const sg = Math.sign(fl.speed);
        const dx = -Math.sin(a) * sg;
        const dz = Math.cos(a) * sg;
        this.e.set(0, Math.atan2(-dx, -dz), Math.sin(time + i) * 0.2, 'YXZ');
        this.q.setFromEuler(this.e);
        this.v.set(x, y, z);
        this.s.setScalar(b.s * 1.6);
        this.m.compose(this.v, this.q, this.s);
        this.mesh.setMatrixAt(fl.start + i, this.m);
      });
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

interface Whale {
  root: THREE.Group;
  tail: THREE.Group;
  cx: number;
  cz: number;
  radius: number;
  speed: number;
  phase: number;
  depth: number;
  scale: number;
}

function whaleGeometry(): { body: THREE.BufferGeometry; tail: THREE.BufferGeometry; spots: THREE.BufferGeometry } {
  const b = new MeshBuilder();
  const back = 0x46557a;
  const belly = 0xb7c6dc;
  b.sphere(1, 1, back, 0, 0.6, 0, 7, 5, 22);
  b.sphere(1, 1, belly, 0, -1.4, -2, 6, 3.6, 19);
  b.add(new THREE.BoxGeometry(14, 0.6, 5), back, mat(-8, -1.6, -6, 0, 0.5, 0.35));
  b.add(new THREE.BoxGeometry(14, 0.6, 5), back, mat(8, -1.6, -6, 0, -0.5, -0.35));
  b.add(new THREE.ConeGeometry(1.4, 4, 4), back, mat(0, 6.4, 4, -0.4, 0, 0));
  const t = new MeshBuilder();
  t.cone(3.5, 14, 6, back, 0, 0, 0);
  t.add(new THREE.BoxGeometry(18, 0.6, 6), back, mat(0, 0, 8, 0, 0, 0));
  const tailGeo = t.build();
  tailGeo.rotateX(Math.PI / 2);
  const s = new MeshBuilder();
  for (let i = 0; i < 9; i++) {
    for (const side of [-1, 1]) s.sphere(0.55, 0, 0x8af7ff, side * (5.4 - Math.abs(i - 4) * 0.25), 1.6 + Math.sin(i) * 0.6, -14 + i * 3.4);
  }
  return { body: b.build(), tail: tailGeo, spots: s.build() };
}

export class SkyWhales {
  private whales: Whale[] = [];
  private rng = new Rng(4242);
  private spotMat: THREE.MeshBasicMaterial;
  /** Distance to the nearest whale, for whale-song audio. */
  nearest = Infinity;

  constructor(scene: THREE.Scene, count: number) {
    const g = whaleGeometry();
    this.spotMat = glowMaterial().clone();
    this.spotMat.transparent = true;
    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(g.body, flatMaterial());
      body.userData.sharedGeometry = true;
      const spots = new THREE.Mesh(g.spots, this.spotMat);
      const tail = new THREE.Group();
      tail.position.set(0, 0, 19);
      tail.add(new THREE.Mesh(g.tail, flatMaterial()));
      root.add(body, spots, tail);
      scene.add(root);
      this.whales.push({ root, tail, cx: 0, cz: 0, radius: 0, speed: 0, phase: 0, depth: 0, scale: 1 });
    }
  }

  private respawn(w: Whale, cam: THREE.Vector3): void {
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(500, 1600);
    w.cx = cam.x + Math.cos(a) * d;
    w.cz = cam.z + Math.sin(a) * d;
    w.radius = this.rng.range(500, 900);
    w.speed = this.rng.range(0.025, 0.04) * (this.rng.chance(0.5) ? 1 : -1);
    w.phase = this.rng.range(0, Math.PI * 2);
    w.depth = this.rng.range(30, 110);
    w.scale = this.rng.range(1.2, 2.1);
    w.root.scale.setScalar(w.scale);
  }

  update(cam: THREE.Vector3, time: number, night: number): void {
    this.spotMat.opacity = 0.25 + night * 0.75;
    this.nearest = Infinity;
    for (const w of this.whales) {
      if (w.radius === 0 || Math.hypot(w.cx - cam.x, w.cz - cam.z) > 2600) this.respawn(w, cam);
      const a = w.phase + time * w.speed;
      const x = w.cx + Math.cos(a) * w.radius;
      const z = w.cz + Math.sin(a) * w.radius;
      // Slow porpoising in and out of the cloud sea.
      const wave = Math.sin(time * 0.05 + w.phase * 3);
      const y = 10 + wave * w.depth;
      const dirX = -Math.sin(a) * Math.sign(w.speed);
      const dirZ = Math.cos(a) * Math.sign(w.speed);
      w.root.position.set(x, y, z);
      w.root.rotation.set(-Math.cos(time * 0.05 + w.phase * 3) * 0.25, Math.atan2(-dirX, -dirZ), 0, 'YXZ');
      w.tail.rotation.x = Math.sin(time * 0.9 + w.phase) * 0.35;
      this.nearest = Math.min(this.nearest, Math.hypot(x - cam.x, y - cam.y, z - cam.z));
    }
  }
}
