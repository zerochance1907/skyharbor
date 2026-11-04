/**
 * Parchment world map with fog of war. Only charted cells show islands; ports
 * are always marked (the Guild charts listed them), shards and landmarks show
 * once their area is charted. Pan by dragging, zoom with the wheel or buttons.
 */
import type { Game } from '../game';
import { clamp, TAU } from '../core/math';
import { BIOMES } from '../sim/biomes';
import { FOG_CELL, FOG_HALF, FOG_DIM } from '../sim/fog';
import { LANDMARKS, PORTS } from '../sim/ports';
import { FRAGMENTS, objectiveTarget } from '../sim/story';
import { h, hex } from './dom';

export class WorldMap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cx = 0;
  private cz = 0;
  private scale = 0.08; // pixels per world unit
  private drag: { x: number; y: number } | null = null;
  private pinch: number | null = null;
  private pointers = new Map<number, { x: number; y: number }>();

  constructor(
    private game: Game,
    close: () => void,
  ) {
    this.canvas = h('canvas', {});
    const zoom = (k: number) => () => {
      this.scale = clamp(this.scale * k, 0.02, 0.6);
      this.draw();
    };
    this.el = h(
      'div',
      { id: 'map', class: 'screen hidden' },
      this.canvas,
      h('div', { class: 'title' }, 'CHART OF THE SUNDERED SKY'),
      h('div', { class: 'tools' }, h('button', { class: 'btn', onclick: zoom(1.3) }, '+'), h('button', { class: 'btn', onclick: zoom(1 / 1.3) }, '−'), h('button', { class: 'btn', onclick: () => this.centre() }, 'Centre'), h('button', { class: 'btn primary', 'data-testid': 'close-map', onclick: close }, 'Close')),
      h(
        'div',
        { class: 'legend panel' },
        h('div', {}, '▲ You · ⚓ Port · ✦ Compass shard · ◆ Objective'),
        h('div', {}, ...Object.values(BIOMES).map((b) => h('span', { style: `color:${hex(b.id === 'ember' ? b.palette.foliageAlt : b.id === 'frost' ? 0xbcd2e6 : b.palette.grass)};margin-right:10px` }, '● ' + b.name))),
        h('div', { class: 'muted' }, 'Faint arrows mark sky currents. Uncharted sky stays blank.'),
      ),
    );
    this.canvas.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.scale = clamp(this.scale * (d / this.pinch), 0.02, 0.6);
        this.pinch = d;
        this.draw();
        return;
      }
      if (!this.drag) return;
      this.cx -= (e.clientX - this.drag.x) / this.scale;
      this.cz -= (e.clientY - this.drag.y) / this.scale;
      this.drag = { x: e.clientX, y: e.clientY };
      this.draw();
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.drag = null;
      this.pinch = null;
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.scale = clamp(this.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.02, 0.6);
        this.draw();
      },
      { passive: false },
    );
    window.addEventListener('resize', () => !this.el.classList.contains('hidden') && this.draw());
  }

  centre(): void {
    const s = this.game.state;
    if (s) {
      this.cx = s.ship.x;
      this.cz = s.ship.z;
    }
    this.draw();
  }

  show(): void {
    this.centre();
  }

  draw(): void {
    const s = this.game.state;
    if (!s) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    const g = this.canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sc = this.scale;
    const toX = (x: number) => (x - this.cx) * sc + W / 2;
    const toY = (z: number) => (z - this.cz) * sc + H / 2;
    // Parchment.
    g.fillStyle = '#e8dcc0';
    g.fillRect(0, 0, W, H);
    const x0 = this.cx - W / 2 / sc;
    const x1 = this.cx + W / 2 / sc;
    const z0 = this.cz - H / 2 / sc;
    const z1 = this.cz + H / 2 / sc;
    // Charted sky: pale blue cells.
    const c0x = Math.max(0, Math.floor((x0 + FOG_HALF) / FOG_CELL));
    const c1x = Math.min(FOG_DIM - 1, Math.floor((x1 + FOG_HALF) / FOG_CELL));
    const c0z = Math.max(0, Math.floor((z0 + FOG_HALF) / FOG_CELL));
    const c1z = Math.min(FOG_DIM - 1, Math.floor((z1 + FOG_HALF) / FOG_CELL));
    g.fillStyle = '#cfe3ea';
    const cell = FOG_CELL * sc + 0.6;
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (s.fog.isCellRevealed(cx, cz)) g.fillRect(toX(cx * FOG_CELL - FOG_HALF), toY(cz * FOG_CELL - FOG_HALF), cell, cell);
      }
    }
    // Grid lines every 1000 spans.
    g.strokeStyle = 'rgba(90,70,40,0.12)';
    g.lineWidth = 1;
    for (let x = Math.ceil(x0 / 1000) * 1000; x < x1; x += 1000) {
      g.beginPath();
      g.moveTo(toX(x), 0);
      g.lineTo(toX(x), H);
      g.stroke();
    }
    for (let z = Math.ceil(z0 / 1000) * 1000; z < z1; z += 1000) {
      g.beginPath();
      g.moveTo(0, toY(z));
      g.lineTo(W, toY(z));
      g.stroke();
    }
    // Sky currents (in charted areas).
    const step = Math.max(160, 40 / sc);
    g.strokeStyle = 'rgba(60,110,140,0.35)';
    g.lineWidth = 1.5;
    for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
      for (let z = Math.floor(z0 / step) * step; z < z1; z += step) {
        if (!s.fog.isRevealed(x, z)) continue;
        const str = this.game.wind.currentStrength(x, z);
        if (str < 0.3) continue;
        const d = this.game.wind.currentDirection(x, z);
        const len = step * 0.4 * sc;
        const px = toX(x);
        const py = toY(z);
        g.beginPath();
        g.moveTo(px - d.x * len, py - d.z * len);
        g.lineTo(px + d.x * len, py + d.z * len);
        g.lineTo(px + d.x * len - (d.x - d.z) * 4, py + d.z * len - (d.z + d.x) * 4);
        g.stroke();
      }
    }
    // Islands in charted cells.
    const islands = this.game.world.islandsInRect(Math.max(x0, -FOG_HALF), Math.max(z0, -FOG_HALF), Math.min(x1, FOG_HALF), Math.min(z1, FOG_HALF));
    for (const isl of islands) {
      if (!s.fog.isRevealed(isl.x, isl.z)) continue;
      const b = BIOMES[isl.biome].palette;
      g.fillStyle = hex(isl.biome === 'frost' ? 0xa9bdd0 : b.grass);
      g.strokeStyle = 'rgba(70,50,30,0.6)';
      g.lineWidth = 1;
      g.beginPath();
      const N = 14;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU;
        const r = this.game.world.edgeRadius(isl, a);
        const px = toX(isl.x + Math.cos(a) * r);
        const py = toY(isl.z + Math.sin(a) * r);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.fill();
      g.stroke();
      if (isl.ruins && sc > 0.06) {
        g.fillStyle = '#5a4a3a';
        g.fillRect(toX(isl.x) - 2, toY(isl.z) - 4, 4, 8);
      }
    }
    // Storm wall.
    const meridian = LANDMARKS.find((l) => l.kind === 'finale')!;
    if (s.fog.isRevealed(meridian.x, meridian.z) || s.story.step >= 6) {
      g.strokeStyle = 'rgba(60,60,90,0.4)';
      g.lineWidth = 900 * sc * 0.6;
      g.beginPath();
      g.arc(toX(meridian.x), toY(meridian.z), 650 * sc, 0, TAU);
      g.stroke();
    }
    g.textAlign = 'center';
    // Contract hints and targets.
    for (const c of s.contracts.active) {
      if (c.hint && c.status === 'active') {
        g.strokeStyle = 'rgba(160,60,40,0.8)';
        g.setLineDash([6, 5]);
        g.lineWidth = 2;
        g.beginPath();
        g.arc(toX(c.hint.x), toY(c.hint.z), c.hint.r * sc, 0, TAU);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = '#7a2a1a';
        g.font = 'italic 12px Georgia, serif';
        g.fillText('lost ruin?', toX(c.hint.x), toY(c.hint.z));
      }
      if (c.kind === 'salvage' && c.target && c.status === 'active') {
        g.strokeStyle = '#2a7a4a';
        g.lineWidth = 3;
        const px = toX(c.target.x);
        const py = toY(c.target.z);
        g.beginPath();
        g.moveTo(px - 6, py - 6);
        g.lineTo(px + 6, py + 6);
        g.moveTo(px + 6, py - 6);
        g.lineTo(px - 6, py + 6);
        g.stroke();
      }
    }
    // Landmarks.
    for (const l of LANDMARKS) {
      if (!s.discoveredLandmarks.includes(l.id) && !s.fog.isRevealed(l.x, l.z)) continue;
      g.fillStyle = '#3d2e1e';
      g.font = 'italic 13px Georgia, serif';
      g.fillText('⌘ ' + l.name, toX(l.x), toY(l.z) + 4);
    }
    // Fragments.
    for (const f of FRAGMENTS) {
      if (s.fragments.includes(f.id) || !s.fog.isRevealed(f.x, f.z)) continue;
      g.fillStyle = '#b8862a';
      g.font = 'bold 16px Georgia, serif';
      g.fillText('✦', toX(f.x), toY(f.z) + 5);
    }
    // Ports.
    for (const p of PORTS) {
      const known = s.discoveredPorts.includes(p.id);
      const px = toX(p.x);
      const py = toY(p.z);
      g.fillStyle = known ? '#2b1f12' : 'rgba(43,31,18,0.5)';
      g.beginPath();
      g.arc(px, py, 5, 0, TAU);
      g.fill();
      g.font = `${known ? 'bold ' : ''}14px Georgia, serif`;
      g.fillText(`⚓ ${p.name}${known ? '' : ' ?'}`, px, py - 10);
    }
    // Objective.
    const obj = objectiveTarget(s.story);
    if (obj) {
      g.fillStyle = '#c0463a';
      g.font = 'bold 18px Georgia, serif';
      g.fillText('◆', toX(obj.x), toY(obj.z) + 26);
    }
    // NPC ships near you.
    for (const n of this.game.npcs) {
      if (n.state === 'sinking') continue;
      g.fillStyle = n.role === 'merchant' ? '#2a7a4a' : '#a02a1a';
      g.beginPath();
      g.arc(toX(n.x), toY(n.z), 3.5, 0, TAU);
      g.fill();
    }
    // Player.
    const px = toX(s.ship.x);
    const py = toY(s.ship.z);
    g.save();
    g.translate(px, py);
    g.rotate(-s.ship.heading);
    g.fillStyle = '#c0463a';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(-7, 8);
    g.lineTo(0, 4);
    g.lineTo(7, 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // Compass rose.
    g.save();
    g.translate(W - 70, H - 80);
    g.strokeStyle = '#5a4630';
    g.fillStyle = '#5a4630';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, 0, 34, 0, TAU);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(0, -40);
      g.lineTo(6, 0);
      g.lineTo(-6, 0);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.fillStyle = '#5a4630';
    g.font = 'bold 13px Georgia, serif';
    g.fillText('N', W - 70, H - 126);
    g.fillText(`Charted ${(s.fog.coverage * 100).toFixed(1)}%`, W - 70, H - 30);
  }
}
