/**
 * The endless cloud sea: stacked noise-shaded layers that read as a volume,
 * plus instanced billboard cumulus clusters that wrap around the camera.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { makeNoiseTexture, makePuffTexture } from './textures';

const seaVert = /* glsl */ `
uniform float uLayer;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const seaFrag = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uLayer;
uniform float uLayers;
uniform vec2 uWind;
uniform vec3 uLit;
uniform vec3 uShadow;
uniform vec3 uFogColor;
uniform vec3 uCam;
uniform float uFar;
uniform float uStorm;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz;
  vec2 drift = uWind * uTime;
  float n = texture2D(uNoise, (p + drift) / 2600.0).r * 0.55
          + texture2D(uNoise, (p + drift * 1.6) / 900.0 + 0.37).r * 0.3
          + texture2D(uNoise, (p - drift * 0.7) / 300.0 + 0.71).r * 0.15;
  n = smoothstep(0.28, 0.72, n);
  float h = uLayer / max(uLayers - 1.0, 1.0);
  float threshold = mix(0.18, 0.64, h) - uStorm * 0.1;
  float a = smoothstep(threshold, threshold + 0.08, n);
  if (h < 0.01) a = 1.0;
  if (a < 0.01) discard;
  float lightK = mix(0.25, 1.0, h) * (0.8 + 0.2 * n);
  vec3 col = mix(uShadow, uLit, lightK);
  float d = length(vWorld.xz - uCam.xz);
  float fade = smoothstep(uFar * 0.45, uFar * 1.05, d);
  col = mix(col, uFogColor, fade * 0.95);
  gl_FragColor = vec4(col, a);
}`;

const puffVert = /* glsl */ `
attribute vec3 instanceTint;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
uniform vec3 uCam;
uniform float uFar;
void main() {
  vUv = uv;
  vTint = instanceTint;
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = length(instanceMatrix[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = center + (right * position.x + up * position.y) * scale;
  float d = length(center - uCam);
  vFade = (1.0 - smoothstep(uFar * 0.55, uFar, d)) * smoothstep(scale * 0.6, scale * 1.6, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const puffFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLit;
uniform vec3 uShadow;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
void main() {
  vec4 t = texture2D(uMap, vUv);
  // vTint.x: vertical light factor, vTint.y: fog amount
  float shade = mix(0.0, 1.0, vTint.x) * (0.8 + 0.2 * (1.0 - vUv.y));
  vec3 col = mix(uShadow, uLit, clamp(shade + (vUv.y - 0.5) * 0.4, 0.0, 1.0));
  col = mix(col, uFogColor, vTint.y);
  float a = t.a * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

/**
 * Fill `order` with indices of `xyz` (packed x,y,z triples) sorted farthest
 * first from the camera, so alpha-blended billboards composite correctly.
 */
export function backToFrontOrder(xyz: Float32Array, count: number, cx: number, cy: number, cz: number, order: Uint32Array, dist: Float32Array): void {
  for (let i = 0; i < count; i++) {
    const dx = xyz[i * 3] - cx;
    const dy = xyz[i * 3 + 1] - cy;
    const dz = xyz[i * 3 + 2] - cz;
    dist[i] = dx * dx + dy * dy + dz * dz;
    order[i] = i;
  }
  order.subarray(0, count).sort((a, b) => dist[b] - dist[a]);
}

export interface CloudQuality {
  layers: number;
  clusters: number;
  far: number;
}

export class Clouds {
  readonly group = new THREE.Group();
  private sea: THREE.Mesh[] = [];
  private seaUniforms: Record<string, THREE.IUniform>[] = [];
  private puffMesh: THREE.InstancedMesh | null = null;
  private puffUniforms: Record<string, THREE.IUniform>;
  private clusters: { x: number; y: number; z: number; puffs: { ox: number; oy: number; oz: number; s: number; lit: number }[]; start: number }[] = [];
  private noise: THREE.DataTexture;
  private puffTex: THREE.CanvasTexture;
  private wrap = 6000;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sv = new THREE.Vector3();
  private far = 3000;
  private puffs: { cl: number; ox: number; oy: number; oz: number; s: number; lit: number }[] = [];
  private puffPos = new Float32Array(0);
  private puffOrder = new Uint32Array(0);
  private puffDist = new Float32Array(0);
  private puffTint: THREE.InstancedBufferAttribute | null = null;

  constructor(scene: THREE.Scene, quality: CloudQuality) {
    this.noise = makeNoiseTexture(256, 1234);
    this.puffTex = makePuffTexture(128);
    this.puffUniforms = {
      uMap: { value: this.puffTex },
      uLit: { value: new THREE.Color(0xffffff) },
      uShadow: { value: new THREE.Color(0x9aa8c0) },
      uFogColor: { value: new THREE.Color(0xbfe3f5) },
      uCam: { value: new THREE.Vector3() },
      uFar: { value: 3000 },
    };
    scene.add(this.group);
    this.setQuality(quality);
  }

  setQuality(q: CloudQuality): void {
    for (const m of this.sea) {
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.sea = [];
    this.seaUniforms = [];
    this.far = q.far;
    const size = q.far * 2.4;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < q.layers; i++) {
      const uniforms: Record<string, THREE.IUniform> = {
        uNoise: { value: this.noise },
        uTime: { value: 0 },
        uLayer: { value: i },
        uLayers: { value: q.layers },
        uWind: { value: new THREE.Vector2(4, 2) },
        uLit: { value: new THREE.Color(0xffffff) },
        uShadow: { value: new THREE.Color(0x9aa8c0) },
        uFogColor: { value: new THREE.Color(0xbfe3f5) },
        uCam: { value: new THREE.Vector3() },
        uFar: { value: q.far },
        uStorm: { value: 0 },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: seaVert,
        fragmentShader: seaFrag,
        uniforms,
        transparent: i > 0,
        depthWrite: i === 0,
        fog: false,
      });
      const mesh = new THREE.Mesh(i === 0 ? geo : geo.clone(), mat);
      mesh.position.y = -40 + (i / Math.max(q.layers - 1, 1)) * 38;
      mesh.renderOrder = -10 + i;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.sea.push(mesh);
      this.seaUniforms.push(uniforms);
    }
    this.buildPuffs(q.clusters);
  }

  private buildPuffs(count: number): void {
    if (this.puffMesh) {
      this.group.remove(this.puffMesh);
      this.puffMesh.geometry.dispose();
      (this.puffMesh.material as THREE.Material).dispose();
      this.puffMesh = null;
    }
    const rng = new Rng(4321);
    this.clusters = [];
    let total = 0;
    for (let c = 0; c < count; c++) {
      const low = rng.chance(0.55);
      const cluster = {
        x: rng.range(-this.wrap / 2, this.wrap / 2),
        y: low ? rng.range(10, 60) : rng.range(160, 480),
        z: rng.range(-this.wrap / 2, this.wrap / 2),
        puffs: [] as { ox: number; oy: number; oz: number; s: number; lit: number }[],
        start: total,
      };
      const n = rng.int(7, 14);
      const w = rng.range(70, 160);
      for (let i = 0; i < n; i++) {
        const oy = rng.range(0, w * 0.45) * (i / n);
        cluster.puffs.push({
          ox: rng.range(-w, w),
          oy,
          oz: rng.range(-w * 0.6, w * 0.6),
          s: rng.range(55, 110) * (1 - (oy / (w * 0.45)) * 0.35),
          lit: 0.35 + (oy / (w * 0.45)) * 0.65,
        });
      }
      total += n;
      this.clusters.push(cluster);
    }
    this.puffs = [];
    this.clusters.forEach((cl, ci) => cl.puffs.forEach((p) => this.puffs.push({ cl: ci, ...p })));
    this.puffPos = new Float32Array(total * 3);
    this.puffOrder = new Uint32Array(total);
    this.puffDist = new Float32Array(total);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.puffTint = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
    this.puffTint.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instanceTint', this.puffTint);
    const mat = new THREE.ShaderMaterial({
      vertexShader: puffVert,
      fragmentShader: puffFrag,
      uniforms: this.puffUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.puffMesh = new THREE.InstancedMesh(geo, mat, total);
    this.puffMesh.frustumCulled = false;
    this.puffMesh.renderOrder = 5;
    this.puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.puffMesh);
    this.writePuffs(new THREE.Vector3());
  }

  /** Write every puff instance sorted back to front from the camera. */
  private writePuffs(cam: THREE.Vector3): void {
    const mesh = this.puffMesh;
    if (!mesh || !this.puffTint) return;
    const n = this.puffs.length;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[i];
      const cl = this.clusters[p.cl];
      this.puffPos[i * 3] = cl.x + p.ox;
      this.puffPos[i * 3 + 1] = cl.y + p.oy;
      this.puffPos[i * 3 + 2] = cl.z + p.oz;
    }
    backToFrontOrder(this.puffPos, n, cam.x, cam.y, cam.z, this.puffOrder, this.puffDist);
    const tint = this.puffTint.array as Float32Array;
    for (let slot = 0; slot < n; slot++) {
      const i = this.puffOrder[slot];
      this.v.set(this.puffPos[i * 3], this.puffPos[i * 3 + 1], this.puffPos[i * 3 + 2]);
      this.sv.setScalar(this.puffs[i].s);
      this.m.compose(this.v, this.q, this.sv);
      mesh.setMatrixAt(slot, this.m);
      tint[slot * 3] = this.puffs[i].lit;
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.puffTint.needsUpdate = true;
  }

  update(cam: THREE.Vector3, time: number, windX: number, windZ: number, lit: THREE.Color, shadow: THREE.Color, fog: THREE.Color, storm: number, dt: number): void {
    for (const mesh of this.sea) {
      mesh.position.x = Math.round(cam.x / 50) * 50;
      mesh.position.z = Math.round(cam.z / 50) * 50;
    }
    for (const u of this.seaUniforms) {
      u.uTime.value = time;
      (u.uWind.value as THREE.Vector2).set(windX * 0.6 + 3, windZ * 0.6 + 1.5);
      (u.uLit.value as THREE.Color).copy(lit);
      (u.uShadow.value as THREE.Color).copy(shadow);
      (u.uFogColor.value as THREE.Color).copy(fog);
      (u.uCam.value as THREE.Vector3).copy(cam);
      u.uStorm.value = storm;
    }
    const pu = this.puffUniforms;
    (pu.uLit.value as THREE.Color).copy(lit);
    (pu.uShadow.value as THREE.Color).copy(shadow);
    (pu.uFogColor.value as THREE.Color).copy(fog);
    (pu.uCam.value as THREE.Vector3).copy(cam);
    pu.uFar.value = this.far;
    // Drift and wrap clusters toroidally around the camera.
    const half = this.wrap / 2;
    for (const cl of this.clusters) {
      cl.x += windX * dt * 0.8;
      cl.z += windZ * dt * 0.8;
      if (cl.x - cam.x > half) cl.x -= this.wrap;
      else if (cl.x - cam.x < -half) cl.x += this.wrap;
      if (cl.z - cam.z > half) cl.z -= this.wrap;
      else if (cl.z - cam.z < -half) cl.z += this.wrap;
    }
    this.writePuffs(cam);
  }
}
