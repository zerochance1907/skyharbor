/** Weather state machine (clear / calm / cloudy / storm) with smooth blending. */
import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import { LANDMARK_BY_ID } from './ports';

export type WeatherKind = 'clear' | 'calm' | 'cloudy' | 'storm';

export interface WeatherState {
  kind: WeatherKind;
  /** Hours until the next change. */
  remaining: number;
  /** Smoothed 0..1 storm amount (drives visuals and wind). */
  storm: number;
  /** Smoothed 0..1 overcast amount. */
  overcast: number;
}

export const WEATHER_WIND: Record<WeatherKind, number> = { clear: 5, calm: 1.5, cloudy: 8, storm: 15 };

export function initialWeather(): WeatherState {
  return { kind: 'clear', remaining: 6, storm: 0, overcast: 0.1 };
}

export function nextWeather(rng: Rng, prev: WeatherKind): WeatherKind {
  const table: Record<WeatherKind, number[]> = {
    // clear, calm, cloudy, storm
    clear: [0.35, 0.3, 0.3, 0.05],
    calm: [0.45, 0.2, 0.3, 0.05],
    cloudy: [0.3, 0.1, 0.3, 0.3],
    storm: [0.25, 0.15, 0.6, 0],
  };
  return rng.weighted<WeatherKind>(['clear', 'calm', 'cloudy', 'storm'], table[prev]);
}

export function stepWeather(w: WeatherState, rng: Rng, dtHours: number): boolean {
  w.remaining -= dtHours;
  let changed = false;
  if (w.remaining <= 0) {
    w.kind = nextWeather(rng, w.kind);
    w.remaining = w.kind === 'storm' ? rng.range(1.5, 3.5) : rng.range(3, 9);
    changed = true;
  }
  const targetStorm = w.kind === 'storm' ? 1 : 0;
  const targetOvercast = w.kind === 'storm' ? 1 : w.kind === 'cloudy' ? 0.6 : w.kind === 'calm' ? 0.2 : 0.05;
  const k = 1 - Math.exp(-dtHours * 1.6);
  w.storm += (targetStorm - w.storm) * k;
  w.overcast += (targetOvercast - w.overcast) * k;
  return changed;
}

/** The permanent storm wall around the Hollow Meridian. */
export function stormWallAt(x: number, z: number): number {
  const m = LANDMARK_BY_ID.meridian;
  const d = Math.hypot(x - m.x, z - m.z);
  return clamp(1 - (d - 450) / 650, 0, 1) * (d > 260 ? 1 : clamp(d / 260, 0, 1));
}

/** Local storm intensity combining global weather and the storm wall. */
export function localStorm(w: WeatherState, x: number, z: number): number {
  return Math.max(w.storm, stormWallAt(x, z));
}
