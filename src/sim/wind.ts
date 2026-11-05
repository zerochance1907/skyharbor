/**
 * Wind field: a slowly veering prevailing wind, gusts, and a few great
 * "sky currents" - rivers of fast air that save fuel if you ride them.
 */
import { Noise } from '../core/noise';
import { hashInts } from '../core/rng';

export interface Vec2 {
  x: number;
  z: number;
}

export class WindField {
  private noise: Noise;
  private currentNoise: Noise;

  constructor(seed: number) {
    this.noise = new Noise(hashInts(seed, 31));
    this.currentNoise = new Noise(hashInts(seed, 32));
  }

  /** Strength in [0, 1] of the sky current at (x, z). */
  currentStrength(x: number, z: number): number {
    const n = this.currentNoise.noise2(x / 3200, z / 3200);
    const a = Math.abs(n);
    return a < 0.07 ? 1 - a / 0.07 : 0;
  }

  /** Direction along the current (unit vector perpendicular to the noise gradient). */
  currentDirection(x: number, z: number): Vec2 {
    const e = 40;
    const gx = this.currentNoise.noise2((x + e) / 3200, z / 3200) - this.currentNoise.noise2((x - e) / 3200, z / 3200);
    const gz = this.currentNoise.noise2(x / 3200, (z + e) / 3200) - this.currentNoise.noise2(x / 3200, (z - e) / 3200);
    const len = Math.hypot(gx, gz) || 1;
    // Rotate the gradient 90 degrees; the sign of the noise picks the flow direction.
    const sign = this.currentNoise.noise2(x / 9000 + 7, z / 9000) >= 0 ? 1 : -1;
    return { x: (-gz / len) * sign, z: (gx / len) * sign };
  }

  /**
   * Wind velocity (units/s) at a position and time (hours).
   * `strength` is the weather-driven base wind speed.
   */
  at(x: number, z: number, timeHours: number, strength: number): Vec2 {
    const veer = this.noise.noise2(timeHours * 0.05, 3.3) * Math.PI;
    const local = this.noise.noise2(x / 2000 + timeHours * 0.02, z / 2000) * 0.6;
    const ang = veer + local;
    const gust = 1 + this.noise.noise2(x / 300 + timeHours * 2.5, z / 300) * 0.35;
    let wx = Math.cos(ang) * strength * gust;
    let wz = Math.sin(ang) * strength * gust;
    const c = this.currentStrength(x, z);
    if (c > 0) {
      const d = this.currentDirection(x, z);
      wx += d.x * 26 * c;
      wz += d.z * 26 * c;
    }
    return { x: wx, z: wz };
  }
}
