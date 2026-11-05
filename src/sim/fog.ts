/** Fog-of-war grid for the world map, stored as a compact bitset. */
export const FOG_CELL = 100;
export const FOG_HALF = 8000;
export const FOG_DIM = (FOG_HALF * 2) / FOG_CELL; // 160

export class FogGrid {
  readonly bits: Uint8Array;
  revealedCount = 0;

  constructor(bits?: Uint8Array) {
    this.bits = bits ?? new Uint8Array(Math.ceil((FOG_DIM * FOG_DIM) / 8));
    this.revealedCount = 0;
    for (let i = 0; i < this.bits.length; i++) {
      let b = this.bits[i];
      while (b) {
        this.revealedCount += b & 1;
        b >>= 1;
      }
    }
  }

  private index(cx: number, cz: number): number {
    return cz * FOG_DIM + cx;
  }

  isCellRevealed(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= FOG_DIM || cz >= FOG_DIM) return false;
    const i = this.index(cx, cz);
    return (this.bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  isRevealed(x: number, z: number): boolean {
    return this.isCellRevealed(Math.floor((x + FOG_HALF) / FOG_CELL), Math.floor((z + FOG_HALF) / FOG_CELL));
  }

  /** Reveal a disc; returns the number of newly charted cells. */
  reveal(x: number, z: number, r: number): number {
    let added = 0;
    const c0x = Math.max(0, Math.floor((x - r + FOG_HALF) / FOG_CELL));
    const c1x = Math.min(FOG_DIM - 1, Math.floor((x + r + FOG_HALF) / FOG_CELL));
    const c0z = Math.max(0, Math.floor((z - r + FOG_HALF) / FOG_CELL));
    const c1z = Math.min(FOG_DIM - 1, Math.floor((z + r + FOG_HALF) / FOG_CELL));
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const wx = cx * FOG_CELL - FOG_HALF + FOG_CELL / 2;
        const wz = cz * FOG_CELL - FOG_HALF + FOG_CELL / 2;
        if ((wx - x) ** 2 + (wz - z) ** 2 > r * r) continue;
        const i = this.index(cx, cz);
        const mask = 1 << (i & 7);
        if (!(this.bits[i >> 3] & mask)) {
          this.bits[i >> 3] |= mask;
          added++;
        }
      }
    }
    this.revealedCount += added;
    return added;
  }

  /** Fraction of the charted region (0..1). */
  get coverage(): number {
    return this.revealedCount / (FOG_DIM * FOG_DIM);
  }

  encode(): string {
    let s = '';
    for (let i = 0; i < this.bits.length; i++) s += String.fromCharCode(this.bits[i]);
    return btoa(s);
  }

  static decode(data: string): FogGrid {
    const raw = atob(data);
    const bits = new Uint8Array(Math.ceil((FOG_DIM * FOG_DIM) / 8));
    for (let i = 0; i < Math.min(raw.length, bits.length); i++) bits[i] = raw.charCodeAt(i);
    return new FogGrid(bits);
  }
}
