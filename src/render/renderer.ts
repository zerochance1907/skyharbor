/** WebGL renderer, quality presets and the post-processing chain. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { installHeightFog } from './heightFog';

export type QualityPreset = 'low' | 'medium' | 'high';

export interface QualitySettings {
  preset: QualityPreset;
  pixelRatio: number;
  chunkRadius: number;
  nearDistance: number;
  detail: number;
  cloudLayers: number;
  cloudClusters: number;
  far: number;
  bloom: boolean;
  grade: boolean;
  birds: number;
  whales: number;
  particles: number;
  rain: number;
  antialias: boolean;
}

export function qualitySettings(preset: QualityPreset): QualitySettings {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  switch (preset) {
    case 'low':
      return { preset, pixelRatio: Math.min(dpr, 1) * 0.8, chunkRadius: 3, nearDistance: 420, detail: 0.7, cloudLayers: 3, cloudClusters: 22, far: 2100, bloom: false, grade: false, birds: 18, whales: 1, particles: 300, rain: 400, antialias: false };
    case 'high':
      return { preset, pixelRatio: Math.min(dpr, 2), chunkRadius: 5, nearDistance: 900, detail: 1.15, cloudLayers: 7, cloudClusters: 70, far: 3600, bloom: true, grade: true, birds: 72, whales: 4, particles: 900, rain: 1600, antialias: true };
    default:
      return { preset: 'medium', pixelRatio: Math.min(dpr, 1.25), chunkRadius: 4, nearDistance: 650, detail: 1, cloudLayers: 5, cloudClusters: 45, far: 2900, bloom: true, grade: true, birds: 45, whales: 3, particles: 600, rain: 1000, antialias: true };
  }
}

/** Gentle vignette + warm grade in one pass. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.35 }, uFlash: { value: 0 }, uDamage: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uFlash; uniform float uDamage; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d) * (1.0 + uVignette));
      c.rgb *= mix(1.0, v, 0.55);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 1.0, 0.95), 0.6);
      c.rgb += uFlash * 0.25;
      float edge = smoothstep(0.35, 0.75, length(d));
      c.rgb = mix(c.rgb, vec3(0.6, 0.05, 0.03), edge * uDamage * 0.6);
      gl_FragColor = c;
    }`,
};

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private renderPass: RenderPass | null = null;
  quality: QualitySettings;
  camera: THREE.PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, quality: QualitySettings) {
    installHeightFog();
    this.camera = camera;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.fog = new THREE.Fog(0xbfe3f5, 400, quality.far);
    this.applyQuality(quality);
    window.addEventListener('resize', () => this.resize());
  }

  applyQuality(q: QualitySettings): void {
    this.quality = q;
    this.renderer.setPixelRatio(q.pixelRatio);
    const fog = this.scene.fog as THREE.Fog;
    fog.far = q.far;
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    if (q.bloom || q.grade) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.antialias ? 4 : 0 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);
      if (q.bloom) {
        this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.45, 0.5, 0.86);
        this.composer.addPass(this.bloom);
      }
      if (q.grade) {
        this.grade = new ShaderPass(GradeShader);
        this.composer.addPass(this.grade);
      }
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.quality.pixelRatio);
    this.composer?.setSize(w, h);
  }

  setEffects(flash: number, damage: number): void {
    if (this.grade) {
      this.grade.uniforms.uFlash.value = flash;
      this.grade.uniforms.uDamage.value = damage;
    }
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
