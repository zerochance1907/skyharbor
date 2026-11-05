/** Procedurally generated textures (no image files anywhere in the game). */
import * as THREE from 'three';
import { Rng } from '../core/rng';

/** Tileable multi-octave value noise packed into a single-channel texture. */
export function makeNoiseTexture(size = 256, seed = 7): THREE.DataTexture {
  const rng = new Rng(seed);
  const data = new Uint8Array(size * size * 4);
  const octaves = [4, 8, 16, 32, 64];
  const grids = octaves.map((n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rng.next();
    return { n, g };
  });
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      let norm = 0;
      for (const { n, g } of grids) {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fade(fx - x0);
        const ty = fade(fy - y0);
        const a = g[(y0 % n) * n + (x0 % n)];
        const b = g[(y0 % n) * n + ((x0 + 1) % n)];
        const c = g[((y0 + 1) % n) * n + (x0 % n)];
        const d = g[((y0 + 1) % n) * n + ((x0 + 1) % n)];
        v += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
        norm += amp;
        amp *= 0.5;
      }
      v /= norm;
      const i = (y * size + x) * 4;
      // R: full fbm, G: coarse, B: fine detail (offset), A: 255
      data[i] = Math.round(v * 255);
      data[i + 1] = Math.round(grids[0].g[Math.floor((y / size) * 4) * 4 + Math.floor((x / size) * 4)] * 255);
      data[i + 2] = Math.round(((v * 7.13) % 1) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Soft round puff with a little lumpy edge, for billboard clouds and smoke. */
export function makePuffTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rng = new Rng(99);
  for (let i = 0; i < 14; i++) {
    const r = size * rng.range(0.16, 0.3);
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, size * 0.18);
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Emblems painted on the envelope; original line-art drawn with canvas. */
export function makeEmblemTexture(kind: string, color: string): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, s, s);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 6;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const cx = s / 2;
  const cy = s / 2;
  if (kind === 'compass') {
    g.beginPath();
    g.arc(cx, cy, 44, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52);
      g.lineTo(cx + Math.cos(a + 0.5) * 12, cy + Math.sin(a + 0.5) * 12);
      g.lineTo(cx + Math.cos(a - 0.5) * 12, cy + Math.sin(a - 0.5) * 12);
      g.closePath();
      g.fill();
    }
  } else if (kind === 'star') {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 20 : 50;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  } else if (kind === 'whale') {
    g.beginPath();
    g.ellipse(cx - 6, cy + 4, 38, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(cx + 28, cy + 4);
    g.lineTo(cx + 54, cy - 16);
    g.lineTo(cx + 46, cy + 4);
    g.lineTo(cx + 54, cy + 22);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0)';
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(cx - 26, cy - 2, 4, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  } else if (kind === 'feather') {
    g.beginPath();
    g.moveTo(cx - 40, cy + 40);
    g.quadraticCurveTo(cx - 10, cy - 30, cx + 40, cy - 46);
    g.quadraticCurveTo(cx + 20, cy + 10, cx - 40, cy + 40);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - 44, cy + 46);
    g.quadraticCurveTo(cx, cy - 6, cx + 36, cy - 40);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
