/** Player settings persisted in localStorage. */
import type { QualityPreset } from '../render/renderer';
import { safeLocalStorage } from '../sim/save';

export type Action =
  | 'throttleUp'
  | 'throttleDown'
  | 'left'
  | 'right'
  | 'ascend'
  | 'descend'
  | 'boost'
  | 'firePort'
  | 'fireStarboard'
  | 'interact'
  | 'map'
  | 'journal'
  | 'pause';

export const ACTION_LABELS: Record<Action, string> = {
  throttleUp: 'Throttle up',
  throttleDown: 'Throttle down',
  left: 'Turn left',
  right: 'Turn right',
  ascend: 'Climb',
  descend: 'Descend',
  boost: 'Aether boost',
  firePort: 'Fire port (left)',
  fireStarboard: 'Fire starboard (right)',
  interact: 'Dock / interact',
  map: 'World map',
  journal: 'Journal',
  pause: 'Pause',
};

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  throttleUp: ['KeyW', 'ArrowUp'],
  throttleDown: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  ascend: ['Space', 'KeyR'],
  descend: ['KeyC', 'KeyV'],
  boost: ['ShiftLeft', 'ShiftRight'],
  firePort: ['KeyQ', 'KeyZ'],
  fireStarboard: ['KeyE', 'KeyX'],
  interact: ['KeyF', 'Enter'],
  map: ['KeyM', 'Tab'],
  journal: ['KeyJ', 'KeyL'],
  pause: ['Escape', 'KeyP'],
};

export interface Settings {
  quality: QualityPreset;
  master: number;
  music: number;
  sfx: number;
  invertY: boolean;
  sensitivity: number;
  showFps: boolean;
  touch: 'auto' | 'on' | 'off';
  bindings: Record<Action, string[]>;
}

const KEY = 'skyharbor.settings';

export function defaultSettings(): Settings {
  const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return {
    quality: mobile ? 'low' : 'medium',
    master: 0.8,
    music: 0.6,
    sfx: 0.8,
    invertY: false,
    sensitivity: 1,
    showFps: false,
    touch: 'auto',
    bindings: structuredClone(DEFAULT_BINDINGS),
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = safeLocalStorage().getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    const bindings = { ...d.bindings };
    for (const a of Object.keys(bindings) as Action[]) {
      const b = s.bindings?.[a];
      if (Array.isArray(b) && b.every((k) => typeof k === 'string')) bindings[a] = b.slice(0, 2);
    }
    return {
      ...d,
      ...s,
      quality: s.quality === 'low' || s.quality === 'high' || s.quality === 'medium' ? s.quality : d.quality,
      bindings,
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  safeLocalStorage().setItem(KEY, JSON.stringify(s));
}

export function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    ControlLeft: 'L-Ctrl',
    AltLeft: 'L-Alt',
  };
  return map[code] ?? code;
}
