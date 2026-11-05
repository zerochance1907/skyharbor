/**
 * Geometry builder that bakes flat per-face vertex colours and merges many
 * primitive parts into one BufferGeometry: one draw call per model.
 */
import * as THREE from 'three';

export class MeshBuilder {
  private positions: number[] = [];
  private colors: number[] = [];
  private tmpColor = new THREE.Color();

  /** Add an arbitrary geometry with a transform and a flat colour. */
  add(geom: THREE.BufferGeometry, color: number | THREE.Color, matrix?: THREE.Matrix4, colorJitter = 0, seed = 1): this {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const c = color instanceof THREE.Color ? color : this.tmpColor.set(color);
    let s = seed;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (matrix) v.applyMatrix4(matrix);
      this.positions.push(v.x, v.y, v.z);
    }
    for (let f = 0; f < pos.count / 3; f++) {
      let k = 1;
      if (colorJitter > 0) {
        s = (s * 16807) % 2147483647;
        k = 1 - colorJitter + ((s % 1000) / 1000) * colorJitter * 2;
      }
      for (let j = 0; j < 3; j++) this.colors.push(c.r * k, c.g * k, c.b * k);
    }
    if (g !== geom) g.dispose();
    geom.dispose();
    return this;
  }

  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, mat(x, y, z, rx, ry, rz));
  }

  cylinder(rt: number, rb: number, h: number, seg: number, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1), color, mat(x, y, z, rx, ry, rz));
  }

  cone(r: number, h: number, seg: number, color: number, x = 0, y = 0, z = 0, ry = 0): this {
    return this.add(new THREE.ConeGeometry(r, h, seg, 1), color, mat(x, y, z, 0, ry, 0));
  }

  sphere(r: number, detail: number, color: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): this {
    const m = mat(x, y, z).multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, m);
  }

  /** Raw triangle with one colour. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): this {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let j = 0; j < 3; j++) this.colors.push(color.r, color.g, color.b);
    return this;
  }

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  m.setPosition(x, y, z);
  return m;
}

/** Shared flat-shaded vertex-colour material. */
let sharedFlat: THREE.MeshLambertMaterial | null = null;
export function flatMaterial(): THREE.MeshLambertMaterial {
  if (!sharedFlat) sharedFlat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return sharedFlat;
}

let sharedGlow: THREE.MeshBasicMaterial | null = null;
/** Unlit vertex-colour material for glowing bits (lanterns, crystals, lava). */
export function glowMaterial(): THREE.MeshBasicMaterial {
  if (!sharedGlow) sharedGlow = new THREE.MeshBasicMaterial({ vertexColors: true });
  return sharedGlow;
}

export function shade(hex: number, k: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}
