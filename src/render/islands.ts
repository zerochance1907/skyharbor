/**
 * Island meshes and chunk streaming. Each island gets a cheap far mesh at once
 * and a detailed near mesh (with instanced trees, rocks and ruins) built
 * lazily under a per-frame time budget. Chunks out of range are disposed.
 */
import * as THREE from 'three';
import { hashInts } from '../core/rng';
import { BIOMES } from '../sim/biomes';
import { CHUNK_SIZE, World, type DecorationType, type IslandDesc } from '../sim/world';
import { flatMaterial } from './builder';
import { decorationGeometry } from './decorations';
import { animated, buildStructures } from './structures';
import { makeNoiseTexture } from './textures';

interface IslandEntry {
  desc: IslandDesc;
  root: THREE.Group;
  far: THREE.Mesh | null;
  near: THREE.Group | null;
  structures: THREE.Object3D | null;
  nearQueued: boolean;
}

interface ChunkEntry {
  key: string;
  cx: number;
  cz: number;
  islands: IslandEntry[];
}

export interface IslandQuality {
  chunkRadius: number;
  nearDistance: number;
  detail: number;
}

const tmpColor = new THREE.Color();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpN = new THREE.Vector3();

/** Build an island's terrain as flat-shaded, per-face coloured triangles. */
export function buildIslandGeometry(world: World, isl: IslandDesc, rings: number, segs: number): THREE.BufferGeometry {
  const pal = BIOMES[isl.biome].palette;
  const positions: number[] = [];
  const colors: number[] = [];
  const top: THREE.Vector3[][] = [];
  const bot: THREE.Vector3[][] = [];
  const skirt = 8 + (isl.seed % 7) + isl.radius * 0.06;
  const ts: number[] = [];
  for (let i = 0; i <= rings; i++) ts.push(Math.pow(i / rings, 0.75));
  const edges: number[] = [];
  for (let j = 0; j < segs; j++) edges.push(world.edgeRadius(isl, (j / segs) * Math.PI * 2));
  for (let i = 0; i <= rings; i++) {
    const rowT: THREE.Vector3[] = [];
    const rowB: THREE.Vector3[] = [];
    for (let j = 0; j < segs; j++) {
      const jitter = i > 0 && i < rings ? (((hashInts(isl.seed, i, j) % 1000) / 1000) - 0.5) * 0.35 : 0;
      const a = ((j + jitter) / segs) * Math.PI * 2;
      const edge = i === rings ? edges[j] : world.edgeRadius(isl, a);
      const d = ts[i] * edge * (i === rings ? 1 : 0.999);
      const lx = Math.cos(a) * d;
      const lz = Math.sin(a) * d;
      const mask = 1 - ts[i];
      const ty = isl.y + world.topOffset(isl, lx, lz, mask);
      let by = isl.y + Math.min(world.bottomOffset(isl, lx, lz, mask), -skirt);
      if (i === 0) by -= isl.radius * isl.depth * 0.18;
      rowT.push(new THREE.Vector3(isl.x + lx, ty, isl.z + lz));
      rowB.push(new THREE.Vector3(isl.x + lx, by, isl.z + lz));
    }
    top.push(rowT);
    bot.push(rowB);
  }
  let faceId = 0;
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, kind: 0 | 1 | 2) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    tmpA.subVectors(b, a);
    tmpB.subVectors(c, a);
    tmpN.crossVectors(tmpA, tmpB).normalize();
    tmpC.set((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
    const h = hashInts(isl.seed, faceId++);
    const r = (h % 1000) / 1000;
    const rel = tmpC.y - isl.y;
    if (kind === 0) {
      const dCenter = Math.hypot(tmpC.x - isl.x, tmpC.z - isl.z) / isl.radius;
      if (tmpN.y < 0.6 || dCenter > 0.92) tmpColor.set(r < 0.5 ? pal.rock : pal.rockDark);
      else if (isl.biome === 'frost' && rel > 30) tmpColor.set(0xf7fbff);
      else if (isl.biome === 'ember' && r < 0.06 && isl.kind !== 'port') tmpColor.set(pal.accent);
      else tmpColor.set(r < 0.55 ? pal.grass : pal.grassAlt);
      if (isl.kind === 'port' && dCenter > 0.12 && dCenter < 0.8 && tmpN.y > 0.9 && r < 0.35) tmpColor.lerp(new THREE.Color(0xb8a68a), 0.5);
    } else if (kind === 1) {
      tmpColor.set(Math.floor(rel / 4) % 2 === 0 ? pal.rock : pal.rockDark);
    } else {
      const band = Math.floor(-rel / 9) % 2 === 0;
      tmpColor.set(band ? pal.underside : pal.rockDark);
      if ((isl.biome === 'crystal' || isl.biome === 'ember') && r < 0.07) tmpColor.set(pal.accent);
    }
    const k = 0.93 + r * 0.14;
    for (let q = 0; q < 3; q++) colors.push(tmpColor.r * k, tmpColor.g * k, tmpColor.b * k);
  };
  for (let j = 0; j < segs; j++) {
    const j1 = (j + 1) % segs;
    // centre fans
    const ct = new THREE.Vector3(isl.x, isl.y + world.topOffset(isl, 0, 0, 1), isl.z);
    pushTri(ct, top[1][j1], top[1][j], 0);
    pushTri(bot[0][0], bot[1][j], bot[1][j1], 2);
    for (let i = 1; i < rings; i++) {
      pushTri(top[i][j], top[i][j1], top[i + 1][j], 0);
      pushTri(top[i][j1], top[i + 1][j1], top[i + 1][j], 0);
      pushTri(bot[i][j], bot[i + 1][j], bot[i][j1], 2);
      pushTri(bot[i][j1], bot[i + 1][j], bot[i + 1][j1], 2);
    }
    // cliff skirt
    pushTri(top[rings][j], top[rings][j1], bot[rings][j], 1);
    pushTri(top[rings][j1], bot[rings][j1], bot[rings][j], 1);
  }
  // Use the deepest centre for all bottom fans.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

let waterMat: THREE.ShaderMaterial | null = null;
const waterUniforms = {
  uTime: { value: 0 },
  uNoise: { value: null as THREE.Texture | null },
  uFogColor: { value: new THREE.Color() },
};

function waterMaterial(): THREE.ShaderMaterial {
  if (!waterMat) {
    waterUniforms.uNoise.value = makeNoiseTexture(64, 77);
    waterMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vColor; varying float vDepth;
        void main(){ vUv = uv; vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform sampler2D uNoise; uniform vec3 uFogColor;
        varying vec2 vUv; varying vec3 vColor; varying float vDepth;
        void main(){
          float n = texture2D(uNoise, vec2(vUv.x * 0.6, vUv.y * 0.02 - uTime * 0.35)).r;
          float streak = smoothstep(0.35, 0.75, n);
          vec3 col = mix(vColor * 0.85, vec3(1.0), streak * 0.7);
          float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
          float bottom = smoothstep(0.0, 0.25, vUv.y);
          float a = (0.55 + streak * 0.4) * edge * bottom;
          col = mix(col, uFogColor, smoothstep(300.0, 2600.0, vDepth));
          gl_FragColor = vec4(col, a);
        }`,
    });
  }
  return waterMat;
}

/** Ribbon waterfalls spilling off the rim and down into the clouds. */
function buildWaterfalls(world: World, isl: IslandDesc): THREE.Mesh | null {
  const falls = world.waterfalls(isl);
  if (!falls.length) return null;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color(BIOMES[isl.biome].palette.water);
  for (const f of falls) {
    const base = pos.length / 3;
    const ox = Math.cos(f.angle);
    const oz = Math.sin(f.angle);
    const px = -oz;
    const pz = ox;
    const steps = 18;
    const h = f.top + 20;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const y = f.top - h * t;
      const out = 2 + 14 * (1 - Math.pow(1 - Math.min(t * 3, 1), 2)) + t * 6;
      const w = f.width * (1 + t * 1.8);
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? -0.5 : 0.5;
        pos.push(f.x + ox * out + px * w * side, y, f.z + oz * out + pz * w * side);
        uv.push(s, (1 - t) * h);
        col.push(c.r, c.g, c.b);
      }
      if (k < steps) {
        const a = base + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    // A short lip of water across the rim.
    const lb = pos.length / 3;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -0.5 : 0.5;
      pos.push(f.x - ox * 14 + px * f.width * side, f.top + 0.4, f.z - oz * 14 + pz * f.width * side);
      uv.push(s, h + 10);
      col.push(c.r, c.g, c.b);
    }
    idx.push(lb, lb + 1, base, lb + 1, base + 1, base);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, waterMaterial());
  m.renderOrder = 3;
  return m;
}

export class IslandRenderer {
  readonly group = new THREE.Group();
  private chunks = new Map<string, ChunkEntry>();
  private queue: IslandEntry[] = [];
  private quality: IslandQuality;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  /** Increments whenever new islands finish building (used by tests/warm-up). */
  builtCount = 0;
  hallLit = false;

  constructor(
    scene: THREE.Scene,
    private world: World,
    quality: IslandQuality,
  ) {
    this.quality = quality;
    scene.add(this.group);
  }

  /**
   * Apply a new quality preset. When mesh detail changes, every island that is
   * already loaded is rebuilt: far meshes are regenerated in place (so nothing
   * pops out) and near meshes are dropped and re-queued at the new detail.
   * Returns the number of islands rebuilt.
   */
  setQuality(q: IslandQuality): number {
    const detailChanged = q.detail !== this.quality.detail;
    this.quality = q;
    if (!detailChanged) return 0;
    let rebuilt = 0;
    for (const c of this.chunks.values()) {
      for (const e of c.islands) {
        if (e.far) {
          e.root.remove(e.far);
          e.far.geometry.dispose();
        }
        e.far = this.buildFar(e.desc);
        e.root.add(e.far);
        if (e.near) {
          e.root.remove(e.near);
          disposeObject(e.near);
          e.near = null;
        }
        e.nearQueued = false;
        rebuilt++;
      }
    }
    this.queue.length = 0;
    return rebuilt;
  }

  /** Detail level of the far mesh for an island at the current quality. */
  farSegments(desc: IslandDesc): number {
    return Math.max(8, Math.round((desc.radius < 30 ? 7 : 14) * this.quality.detail));
  }

  private buildFar(desc: IslandDesc): THREE.Mesh {
    const far = new THREE.Mesh(buildIslandGeometry(this.world, desc, desc.radius < 30 ? 2 : 4, this.farSegments(desc)), flatMaterial());
    far.matrixAutoUpdate = false;
    return far;
  }

  /** Loaded islands, for tests and debugging. */
  loaded(): { desc: IslandDesc; far: THREE.Mesh | null; near: THREE.Object3D | null }[] {
    const out: { desc: IslandDesc; far: THREE.Mesh | null; near: THREE.Object3D | null }[] = [];
    for (const c of this.chunks.values()) for (const e of c.islands) out.push({ desc: e.desc, far: e.far, near: e.near });
    return out;
  }

  setHallLit(lit: boolean): void {
    if (this.hallLit === lit) return;
    this.hallLit = lit;
    // Rebuild Skyharbor structures so the Guild dome shows its new state.
    for (const c of this.chunks.values()) {
      for (const e of c.islands) {
        if (e.desc.portId === 'skyharbor' && e.structures) {
          e.root.remove(e.structures);
          disposeObject(e.structures);
          e.structures = buildStructures(this.world, e.desc, this.hallLit);
          if (e.structures) e.root.add(e.structures);
        }
      }
    }
  }

  get loadedIslands(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.islands.length;
    return n;
  }

  update(cam: THREE.Vector3, budgetMs: number, time: number, fogColor: THREE.Color): void {
    waterUniforms.uTime.value = time;
    waterUniforms.uFogColor.value.copy(fogColor);
    const [ccx, ccz] = World.chunkOf(cam.x, cam.z);
    const R = this.quality.chunkRadius;
    // Load chunks in range, nearest first.
    const wanted: [number, number, number][] = [];
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
        const key = `${ccx + dx},${ccz + dz}`;
        if (!this.chunks.has(key)) wanted.push([ccx + dx, ccz + dz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    const t0 = performance.now();
    for (const [cx, cz] of wanted) {
      this.loadChunk(cx, cz);
      if (performance.now() - t0 > budgetMs * 0.5) break;
    }
    // Unload far chunks.
    for (const [key, c] of this.chunks) {
      const dx = c.cx - ccx;
      const dz = c.cz - ccz;
      if (dx * dx + dz * dz > (R + 1.5) * (R + 1.5)) {
        for (const e of c.islands) this.disposeIsland(e);
        this.chunks.delete(key);
      }
    }
    // LOD switching.
    const nearD = this.quality.nearDistance;
    for (const c of this.chunks.values()) {
      for (const e of c.islands) {
        const d = Math.hypot(e.desc.x - cam.x, e.desc.z - cam.z) - e.desc.radius;
        if (d < nearD + 150 && !e.near && !e.nearQueued) {
          e.nearQueued = true;
          this.queue.push(e);
        }
        if (e.near) {
          const showNear = d < nearD;
          e.near.visible = showNear;
          if (e.far) e.far.visible = !showNear;
          if (d > nearD + 700) {
            e.root.remove(e.near);
            disposeObject(e.near);
            e.near = null;
            if (e.far) e.far.visible = true;
          }
        }
      }
    }
    // Build near meshes under the time budget, nearest first.
    if (this.queue.length) {
      this.queue.sort((a, b) => Math.hypot(a.desc.x - cam.x, a.desc.z - cam.z) - Math.hypot(b.desc.x - cam.x, b.desc.z - cam.z));
      while (this.queue.length && performance.now() - t0 < budgetMs) {
        const e = this.queue.shift()!;
        e.nearQueued = false;
        if (!this.chunks.has(chunkKeyOf(e.desc))) continue;
        this.buildNear(e);
      }
    }
  }

  /** Force everything around a point to build immediately (loading screens). */
  warm(cam: THREE.Vector3, fog: THREE.Color): void {
    this.update(cam, 1e9, 0, fog);
    this.update(cam, 1e9, 0, fog);
  }

  private loadChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const entry: ChunkEntry = { key, cx, cz, islands: [] };
    for (const desc of this.world.chunkIslands(cx, cz)) {
      const root = new THREE.Group();
      const far = this.buildFar(desc);
      root.add(far);
      const structures = buildStructures(this.world, desc, this.hallLit);
      if (structures) root.add(structures);
      this.group.add(root);
      entry.islands.push({ desc, root, far, near: null, structures, nearQueued: false });
      this.builtCount++;
    }
    this.chunks.set(key, entry);
  }

  private buildNear(e: IslandEntry): void {
    const desc = e.desc;
    const group = new THREE.Group();
    const small = desc.radius < 30;
    const rings = Math.round((small ? 4 : desc.radius > 100 ? 12 : 9) * this.quality.detail);
    const segs = Math.round((small ? 12 : desc.radius > 100 ? 44 : 32) * this.quality.detail);
    const terrain = new THREE.Mesh(buildIslandGeometry(this.world, desc, Math.max(3, rings), Math.max(10, segs)), flatMaterial());
    terrain.matrixAutoUpdate = false;
    group.add(terrain);
    const decos = this.world.decorations(desc);
    const byType = new Map<DecorationType, typeof decos>();
    for (const d of decos) {
      const list = byType.get(d.type) ?? [];
      list.push(d);
      byType.set(d.type, list);
    }
    for (const [type, list] of byType) {
      const geo = decorationGeometry(desc.biome, type);
      const inst = new THREE.InstancedMesh(geo, flatMaterial(), list.length);
      list.forEach((d, i) => {
        this.q.setFromAxisAngle(this.up, d.rot);
        this.v.set(d.x, d.y, d.z);
        this.s.setScalar(d.scale);
        this.m4.compose(this.v, this.q, this.s);
        inst.setMatrixAt(i, this.m4);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
    const falls = buildWaterfalls(this.world, desc);
    if (falls) group.add(falls);
    e.near = group;
    e.root.add(group);
    if (e.far) e.far.visible = false;
  }

  private disposeIsland(e: IslandEntry): void {
    this.group.remove(e.root);
    if (e.far) e.far.geometry.dispose();
    if (e.near) disposeObject(e.near);
    if (e.structures) disposeObject(e.structures);
    e.far = null;
    e.near = null;
  }
}

function chunkKeyOf(d: IslandDesc): string {
  return `${Math.floor(d.x / CHUNK_SIZE)},${Math.floor(d.z / CHUNK_SIZE)}`;
}

/** Dispose geometries owned by an object tree (shared decoration geometry is kept). */
export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    animated.delete(c);
    if (c instanceof THREE.InstancedMesh) {
      c.dispose();
      return;
    }
    if (c instanceof THREE.Mesh && !c.userData.sharedGeometry) c.geometry.dispose();
  });
}
