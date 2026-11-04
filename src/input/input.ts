/**
 * Unified input: keyboard (remappable), mouse look, gamepad (standard
 * mapping) and on-screen touch controls all feed the same action set.
 */
import { clamp } from '../core/math';
import type { FlightInput } from '../sim/flight';
import type { Action, Settings } from './settings';

const ACTIONS: Action[] = ['throttleUp', 'throttleDown', 'left', 'right', 'ascend', 'descend', 'boost', 'firePort', 'fireStarboard', 'interact', 'map', 'journal', 'pause'];

export class Input {
  private down = new Set<string>();
  private pressed = new Set<Action>();
  private lookX = 0;
  private lookY = 0;
  private zoom = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private padPrev: boolean[] = [];
  private touchState = { rudder: 0, throttle: 0, ascend: false, descend: false, boost: false };
  private touchLookId: number | null = null;
  /** When false, flight keys are ignored (menus open). */
  enabled = true;
  /** Set when a key is captured for remapping. */
  private captureCb: ((code: string) => void) | null = null;
  lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';

  constructor(
    canvas: HTMLElement,
    private settings: Settings,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || e.pointerType === 'touch') return;
      this.lookX += e.clientX - this.lastX;
      this.lookY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = () => (this.dragging = false);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => (this.zoom += Math.sign(e.deltaY) * 6), { passive: true });
    // Touch-look on the canvas (right half), the joystick lives in the overlay.
    canvas.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.touchLookId === null) {
          this.touchLookId = t.identifier;
          this.lastX = t.clientX;
          this.lastY = t.clientY;
          this.lastDevice = 'touch';
        }
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.touchLookId) {
          this.lookX += (t.clientX - this.lastX) * 1.4;
          this.lookY += (t.clientY - this.lastY) * 1.4;
          this.lastX = t.clientX;
          this.lastY = t.clientY;
        }
      }
    }, { passive: true });
    const tend = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === this.touchLookId) this.touchLookId = null;
    };
    canvas.addEventListener('touchend', tend);
    canvas.addEventListener('touchcancel', tend);
  }

  setSettings(s: Settings): void {
    this.settings = s;
  }

  /** Capture the next key press (for remapping). */
  captureNextKey(cb: (code: string) => void): void {
    this.captureCb = cb;
  }

  private actionFor(code: string): Action | null {
    for (const a of ACTIONS) if (this.settings.bindings[a].includes(code)) return a;
    return null;
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (this.captureCb && isDown) {
      e.preventDefault();
      const cb = this.captureCb;
      this.captureCb = null;
      cb(e.code);
      return;
    }
    const action = this.actionFor(e.code);
    if (action) {
      e.preventDefault();
      this.lastDevice = 'keyboard';
    }
    if (isDown) {
      if (!this.down.has(e.code) && action) this.pressed.add(action);
      this.down.add(e.code);
    } else {
      this.down.delete(e.code);
    }
  }

  isDown(a: Action): boolean {
    for (const code of this.settings.bindings[a]) if (this.down.has(code)) return true;
    return false;
  }

  /** Edge-triggered: true once per press. */
  consume(a: Action): boolean {
    if (this.pressed.has(a)) {
      this.pressed.delete(a);
      return true;
    }
    return false;
  }

  /** Programmatic press (touch buttons). */
  press(a: Action): void {
    this.pressed.add(a);
    this.lastDevice = 'touch';
  }

  setTouchAxis(rudder: number, throttle: number): void {
    this.touchState.rudder = clamp(rudder, -1, 1);
    this.touchState.throttle = clamp(throttle, -1, 1);
    this.lastDevice = 'touch';
  }

  setTouchHold(key: 'ascend' | 'descend' | 'boost', v: boolean): void {
    this.touchState[key] = v;
  }

  clearPressed(): void {
    this.pressed.clear();
  }

  /** Read the gamepad and generate edge presses; call once per frame. */
  pollGamepad(): { rudder: number; throttle: number; lift: number; boost: boolean; lookX: number; lookY: number } | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) return null;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    const map: [number, Action][] = [
      [0, 'interact'],
      [4, 'firePort'],
      [5, 'fireStarboard'],
      [9, 'pause'],
      [8, 'map'],
      [3, 'journal'],
    ];
    for (const [i, a] of map) {
      if (b(i) && !this.padPrev[i]) {
        this.pressed.add(a);
        this.lastDevice = 'gamepad';
      }
      this.padPrev[i] = b(i);
    }
    const lt = pad.buttons[6]?.value ?? 0;
    const rt = pad.buttons[7]?.value ?? 0;
    const state = {
      rudder: dz(pad.axes[0] ?? 0),
      throttle: -dz(pad.axes[1] ?? 0),
      lift: rt - lt,
      boost: b(1) || b(10),
      lookX: dz(pad.axes[2] ?? 0),
      lookY: dz(pad.axes[3] ?? 0),
    };
    if (state.rudder || state.throttle || state.lift || state.lookX || state.lookY) this.lastDevice = 'gamepad';
    return state;
  }

  flight(pad: ReturnType<Input['pollGamepad']>): FlightInput {
    if (!this.enabled) return { throttle: 0, rudder: 0, lift: 0, boost: false };
    let throttle = (this.isDown('throttleUp') ? 1 : 0) - (this.isDown('throttleDown') ? 1 : 0);
    let rudder = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    let lift = (this.isDown('ascend') ? 1 : 0) - (this.isDown('descend') ? 1 : 0);
    let boost = this.isDown('boost');
    if (pad) {
      throttle += pad.throttle;
      rudder += pad.rudder;
      lift += pad.lift;
      boost ||= pad.boost;
    }
    throttle += this.touchState.throttle;
    rudder += this.touchState.rudder;
    lift += (this.touchState.ascend ? 1 : 0) - (this.touchState.descend ? 1 : 0);
    boost ||= this.touchState.boost;
    return { throttle: clamp(throttle, -1, 1), rudder: clamp(rudder, -1, 1), lift: clamp(lift, -1, 1), boost };
  }

  /** Accumulated camera look (radians) since last call. */
  takeLook(pad: ReturnType<Input['pollGamepad']>, dt: number): { dx: number; dy: number; zoom: number } {
    const s = 0.005 * this.settings.sensitivity;
    let dx = -this.lookX * s;
    let dy = this.lookY * s;
    if (pad) {
      dx -= pad.lookX * 2.4 * dt * this.settings.sensitivity;
      dy += pad.lookY * 1.6 * dt * this.settings.sensitivity;
    }
    if (this.settings.invertY) dy = -dy;
    const zoom = this.zoom;
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    return { dx, dy, zoom };
  }
}
