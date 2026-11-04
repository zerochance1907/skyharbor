/**
 * Sky dome with a time-of-day gradient, sun and moon discs, procedural
 * twinkling stars and aurora-like shimmer, plus the scene's key lights.
 */
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';

interface SkyKey {
  elev: number;
  top: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunI: number;
  ambient: THREE.Color;
}

const C = (h: number) => new THREE.Color(h);
const KEYS: SkyKey[] = [
  { elev: -0.35, top: C(0x050a1c), horizon: C(0x16223f), sun: C(0x4a5c9a), sunI: 0.0, ambient: C(0x3c4c80) },
  { elev: -0.08, top: C(0x111b3d), horizon: C(0x4b3c62), sun: C(0x7a5a8a), sunI: 0.05, ambient: C(0x4a4a7a) },
  { elev: 0.0, top: C(0x2b3f78), horizon: C(0xf08a5d), sun: C(0xff9a5a), sunI: 0.5, ambient: C(0x7a6680) },
  { elev: 0.12, top: C(0x4a72b8), horizon: C(0xf7c08a), sun: C(0xffd29a), sunI: 1.0, ambient: C(0x9aa4c0) },
  { elev: 0.35, top: C(0x3a86d8), horizon: C(0xbfe2f4), sun: C(0xfff3dc), sunI: 1.25, ambient: C(0xb8d0e6) },
  { elev: 1.0, top: C(0x2f78d0), horizon: C(0xb5dcf2), sun: C(0xffffff), sunI: 1.35, ambient: C(0xc4dbee) },
];

export interface SkyInfo {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  night: number;
  horizon: THREE.Color;
  top: THREE.Color;
  sunColor: THREE.Color;
  ambient: THREE.Color;
}

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uTime;
uniform float uOvercast;
uniform float uFlash;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.6, h), 0.7));
  col = mix(col, uBottom, smoothstep(0.0, -0.25, h));

  // Sun glow and disc.
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(sd, 8.0) * 0.35 * (1.0 - uOvercast * 0.7);
  col += uSunColor * pow(sd, 900.0) * 6.0 * (1.0 - uOvercast);

  // Moon: disc with a soft crescent shadow.
  float md = dot(d, uMoonDir);
  float moon = smoothstep(0.9993, 0.9996, md);
  vec3 off = normalize(uMoonDir + vec3(0.012, 0.006, 0.0));
  float shadow = smoothstep(0.9993, 0.9997, dot(d, off));
  col += vec3(0.92, 0.94, 1.0) * moon * (1.0 - shadow * 0.85) * uNight * 1.6 * (1.0 - uOvercast * 0.8);
  col += vec3(0.5, 0.6, 0.9) * pow(max(md, 0.0), 300.0) * 0.25 * uNight;

  // Stars: hashed cells on the dome, twinkling.
  if (uNight > 0.01 && h > 0.0) {
    vec3 cell = floor(d * 220.0);
    float r = hash(cell);
    if (r > 0.992) {
      vec3 c = (cell + 0.5) / 220.0;
      float dist = length(d - normalize(c)) * 220.0;
      float tw = 0.6 + 0.4 * sin(uTime * (2.0 + r * 6.0) + r * 100.0);
      float star = smoothstep(0.6, 0.0, dist) * tw;
      vec3 sc = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash(cell + 3.0));
      col += sc * star * uNight * smoothstep(0.0, 0.2, h) * (1.0 - uOvercast);
    }
    // Faint aether ribbons across the night sky.
    float band = sin(d.x * 3.0 + uTime * 0.05) * 0.5 + sin(d.z * 5.0 - uTime * 0.03) * 0.5;
    float ribbon = smoothstep(0.35, 0.0, abs(h - 0.45 - band * 0.12));
    col += vec3(0.25, 0.9, 0.75) * ribbon * 0.08 * uNight * (1.0 - uOvercast);
  }
  col = mix(col, vec3(0.86, 0.9, 1.0), uFlash * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  readonly dome: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private uniforms: Record<string, THREE.IUniform>;
  private info: SkyInfo = {
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    night: 0,
    horizon: new THREE.Color(),
    top: new THREE.Color(),
    sunColor: new THREE.Color(),
    ambient: new THREE.Color(),
  };

  constructor(scene: THREE.Scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color(0x8a96a8) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uOvercast: { value: 0 },
      uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x5a5048, 0.9);
    scene.add(this.hemi);
  }

  /** Update for a given hour of day (0..24), weather and camera. */
  update(hour: number, overcast: number, storm: number, cam: THREE.Vector3, time: number, flash: number): SkyInfo {
    const a = ((hour - 6) / 24) * Math.PI * 2;
    const sunDir = this.info.sunDir.set(Math.cos(a), Math.sin(a), -0.35).normalize();
    this.info.moonDir.set(-Math.cos(a) * 0.95, -Math.sin(a), 0.3).normalize();
    const elev = sunDir.y;
    // Interpolate keyframes by sun elevation.
    let i = 0;
    while (i < KEYS.length - 2 && elev > KEYS[i + 1].elev) i++;
    const k0 = KEYS[i];
    const k1 = KEYS[i + 1];
    const t = clamp((elev - k0.elev) / (k1.elev - k0.elev), 0, 1);
    const top = this.info.top.copy(k0.top).lerp(k1.top, t);
    const hor = this.info.horizon.copy(k0.horizon).lerp(k1.horizon, t);
    const sunC = this.info.sunColor.copy(k0.sun).lerp(k1.sun, t);
    const amb = this.info.ambient.copy(k0.ambient).lerp(k1.ambient, t);
    let sunI = lerp(k0.sunI, k1.sunI, t);
    const night = smoothstep(0.05, -0.2, elev);
    this.info.night = night;

    // Weather greys the sky.
    const grey = new THREE.Color(0x6c7684).multiplyScalar(lerp(1, 0.25, night));
    const stormGrey = new THREE.Color(0x353c48).multiplyScalar(lerp(1, 0.35, night));
    top.lerp(grey, overcast * 0.55).lerp(stormGrey, storm * 0.7);
    hor.lerp(grey, overcast * 0.45).lerp(stormGrey, storm * 0.65);
    amb.lerp(grey, overcast * 0.3);
    sunI *= 1 - overcast * 0.45 - storm * 0.35;

    const u = this.uniforms;
    (u.uTop.value as THREE.Color).copy(top);
    (u.uHorizon.value as THREE.Color).copy(hor);
    (u.uBottom.value as THREE.Color).copy(hor).multiplyScalar(0.92);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uSunColor.value as THREE.Color).copy(sunC);
    (u.uMoonDir.value as THREE.Vector3).copy(this.info.moonDir);
    u.uNight.value = night;
    u.uTime.value = time;
    u.uOvercast.value = overcast;
    u.uFlash.value = flash;
    this.dome.position.copy(cam);

    // Key light follows the sun by day and the moon by night.
    const lightDir = elev > -0.05 ? sunDir : this.info.moonDir;
    this.sun.position.copy(cam).addScaledVector(lightDir, 500);
    this.sun.target.position.copy(cam);
    this.sun.color.copy(elev > -0.05 ? sunC : new THREE.Color(0x8fa6e0));
    this.sun.intensity = (elev > -0.05 ? sunI : 0.35 * (1 - overcast * 0.6)) + flash * 2.5;
    this.hemi.color.copy(amb);
    this.hemi.groundColor.copy(amb).multiplyScalar(0.45);
    this.hemi.intensity = lerp(1.0, 0.9, night) + flash;
    return this.info;
  }
}
