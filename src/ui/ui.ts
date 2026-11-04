/**
 * DOM user interface: title, HUD, port menus (market, contracts, shipwright,
 * paint, harbour), dialogue, journal, settings, saves, map and touch controls.
 */
import type { Game } from '../game';
import { clamp, formatCoins, headingToDegrees, TAU } from '../core/math';
import { ACTION_LABELS, DEFAULT_BINDINGS, keyLabel, type Action } from '../input/settings';
import { BIOMES } from '../sim/biomes';
import { bestTrade, buyPrice, maxAffordable, sellPrice, unitPrice } from '../sim/economy';
import { GOODS, GOOD_BY_ID, type GoodId } from '../sim/goods';
import { LANDMARK_BY_ID, PORTS, PORT_BY_ID, type PortId } from '../sim/ports';
import { SLOTS, type SlotId } from '../sim/save';
import { dayOf, type Emblem, type Paint, type PaintPattern } from '../sim/state';
import { FRAGMENTS, STORY } from '../sim/story';
import { MAX_UPGRADE_LEVEL, UPGRADES, computeStats, upgradeCost } from '../sim/upgrades';
import { MAX_ACTIVE_CONTRACTS } from '../sim/contracts';
import { WorldMap } from './map';
import { clear, h, hex } from './dom';

type HudData = ReturnType<Game['hudData']>;
type ToastKind = 'info' | 'good' | 'bad';
export type PortTab = 'market' | 'contracts' | 'shipwright' | 'paint' | 'harbor';

const PAINT_COLORS = [0xe9dcc0, 0xf4f1e8, 0xc0463a, 0x8a1a1e, 0xe8833a, 0xe7c35a, 0x7fbf5a, 0x3f7a5a, 0x5fa8c8, 0x3a5ea8, 0x2f3a6a, 0x9c86d8, 0xd18ad8, 0x6b4a32, 0x8a5a3b, 0x2b2a30];
const GUILD_GOLD = 0xffd77a;

export class UI {
  readonly root: HTMLElement;
  private hud: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private screens: Record<string, HTMLElement> = {};
  private toasts: HTMLElement;
  private radar: HTMLCanvasElement;
  private map: WorldMap;
  private dialogCb: (() => void) | null = null;
  private dialogLines: string[] = [];
  private dialogIndex = 0;
  portTab: PortTab = 'market';
  private portId: PortId | null = null;
  private journalTab = 'story';
  private settingsReturn: (() => void) | null = null;
  private touchEl: HTMLElement;
  private compassTape: HTMLElement;

  constructor(private game: Game) {
    this.root = document.getElementById('ui')!;
    this.hud = this.buildHud();
    this.toasts = h('div', { id: 'toasts' });
    this.root.append(this.hud, this.toasts);
    this.radar = this.els.radar as HTMLCanvasElement;
    this.compassTape = this.els.tape;
    this.map = new WorldMap(game, () => this.toggleMap());
    for (const id of ['title', 'newgame', 'pause', 'saves', 'settings', 'port', 'dialog', 'journal', 'ending', 'credits']) {
      const s = h('div', { id, class: 'screen hidden' });
      this.screens[id] = s;
      this.root.append(s);
    }
    this.screens.map = this.map.el;
    this.root.append(this.map.el);
    this.touchEl = this.buildTouch();
    this.root.append(this.touchEl);
    this.applyTouchVisibility();
    this.showHud(false);
  }

  // ------------------------------------------------------------ helpers

  keyFor(a: Action): string {
    return keyLabel(this.game.settings.bindings[a][0]);
  }

  private open(id: string): void {
    this.screens[id].classList.remove('hidden');
    this.syncPause();
  }

  private close(id: string): void {
    this.screens[id].classList.add('hidden');
    this.syncPause();
  }

  private isOpen(id: string): boolean {
    return !this.screens[id].classList.contains('hidden');
  }

  /** Any overlay that should pause the simulation and swallow flight input. */
  blockingOpen(): boolean {
    return ['pause', 'saves', 'settings', 'dialog', 'journal', 'map', 'ending', 'newgame', 'credits'].some((id) => this.isOpen(id));
  }

  endingOpen(): boolean {
    return this.isOpen('ending');
  }

  /** Re-derive pause and input state from which overlays are open. */
  syncPause(): void {
    const g = this.game;
    g.paused = g.mode !== 'title' && this.blockingOpen();
    g.input.enabled = !this.blockingOpen() && g.mode === 'play';
  }

  hideAllScreens(): void {
    for (const id of Object.keys(this.screens)) this.screens[id].classList.add('hidden');
    this.syncPause();
  }

  showHud(v: boolean): void {
    this.hud.classList.toggle('hidden', !v);
    this.applyTouchVisibility();
  }

  toast(text: string, kind: ToastKind = 'info', ms = 4000): void {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4) this.toasts.lastChild?.remove();
    window.setTimeout(() => t.classList.add('out'), ms);
    window.setTimeout(() => t.remove(), ms + 450);
  }

  private click(): void {
    this.game.audio.click();
  }

  // ------------------------------------------------------------ title & new game

  showTitle(): void {
    this.hideAllScreens();
    const s = this.screens.title;
    clear(s);
    const latest = this.game.saves.latest();
    s.append(
      h('div', {}, h('h1', { class: 'logo' }, 'SKYHARBOR'), h('div', { class: 'tag' }, 'Chart the endless sky. Find the vanished Cartographers.')),
      h(
        'div',
        { class: 'menu' },
        latest
          ? h('button', { class: 'btn primary big', 'data-testid': 'continue', onclick: () => this.startFromSlot(latest.slot) }, `Continue — Day ${latest.day}, ${latest.location}`)
          : null,
        h('button', { class: `btn big ${latest ? '' : 'primary'}`, 'data-testid': 'new-game', onclick: () => this.showNewGame() }, 'New Voyage'),
        h('button', { class: 'btn big', onclick: () => this.showSaves('load') }, 'Load Game'),
        h('button', { class: 'btn big', onclick: () => this.showSettings(() => this.showTitle()) }, 'Settings'),
        h('button', { class: 'btn big', onclick: () => this.showCredits() }, 'Credits'),
      ),
      h('div', { class: 'foot' }, 'An original game. Every model, texture and note is generated in code.'),
    );
    this.open('title');
  }

  private startFromSlot(slot: SlotId): void {
    this.click();
    const err = this.game.loadSlot(slot);
    if (err) this.toast(err, 'bad');
  }

  private showNewGame(): void {
    this.click();
    const s = this.screens.newgame;
    clear(s);
    const name = h('input', { type: 'text', value: 'Wayfarer', maxlength: 24, 'data-testid': 'ship-name' });
    const seed = h('input', { type: 'number', value: 1907, min: 0, max: 999999999, 'data-testid': 'seed' });
    const begin = () => {
      this.close('newgame');
      this.close('title');
      this.game.startNewGame(Math.abs(Math.floor(Number(seed.value) || 1907)), name.value.trim());
    };
    s.append(
      h(
        'div',
        { class: 'panel modal' },
        h('h2', {}, 'A New Voyage'),
        h('p', {}, 'A year ago the Cartographers’ Guild vanished from Skyharbor without a word. You have a small airship, 400 coin and a harbormaster who wants to talk.'),
        h('label', { class: 'field' }, 'Ship name', name),
        h('label', { class: 'field' }, h('span', {}, 'World seed ', h('span', { class: 'muted' }, '(islands and markets)')), seed),
        h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: () => (seed.value = String(Math.floor(Math.random() * 999999))) }, 'Random seed'), h('div', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => this.close('newgame') }, 'Back'), h('button', { class: 'btn primary', 'data-testid': 'start-voyage', onclick: begin }, 'Cast Off')),
      ),
    );
    this.open('newgame');
    name.focus();
  }

  private showCredits(): void {
    const s = this.screens.credits;
    clear(s);
    s.append(
      h(
        'div',
        { class: 'panel modal' },
        h('h2', {}, 'Credits'),
        h('p', {}, 'Skyharbor — design, code, models, music and sound by zerochance1907.'),
        h('p', {}, 'Every island, ship, cloud, texture, emblem, melody and sound effect is generated procedurally in TypeScript at runtime. No image, model or audio files are used.'),
        h('p', {}, 'Built with Three.js (MIT), Vite, TypeScript, Vitest and Playwright.'),
        h('div', { class: 'row' }, h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => this.close('credits') }, 'Close')),
      ),
    );
    this.open('credits');
  }

  showControlsHint(): void {
    const el = this.els.hint;
    el.classList.remove('hidden');
    const k = (a: Action) => h('kbd', {}, this.keyFor(a));
    clear(el).append(
      h('div', {}, k('throttleUp'), ' ', k('throttleDown'), ' throttle · ', k('left'), ' ', k('right'), ' rudder'),
      h('div', {}, k('ascend'), ' climb · ', k('descend'), ' descend · ', k('boost'), ' boost'),
      h('div', {}, k('firePort'), ' ', k('fireStarboard'), ' broadsides · ', k('interact'), ' dock'),
      h('div', {}, k('map'), ' map · ', k('journal'), ' journal · drag mouse to look'),
      h('button', { class: 'btn small', style: 'margin-top:4px', onclick: () => el.classList.add('hidden') }, 'Got it'),
    );
    window.setTimeout(() => el.classList.add('hidden'), 30000);
  }

  // ------------------------------------------------------------ pause, saves, settings

  togglePause(): void {
    if (this.game.mode === 'title') return;
    for (const id of ['settings', 'saves', 'map', 'journal', 'credits']) {
      if (this.isOpen(id)) {
        if (id === 'settings' && this.settingsReturn) {
          this.close('settings');
          this.settingsReturn();
          this.settingsReturn = null;
        } else this.close(id);
        return;
      }
    }
    if (this.isOpen('dialog') || this.isOpen('ending')) return;
    if (this.isOpen('pause')) {
      this.close('pause');
      return;
    }
    this.showPause();
  }

  private showPause(): void {
    const s = this.screens.pause;
    clear(s);
    s.append(
      h(
        'div',
        { class: 'panel modal', style: 'text-align:center' },
        h('h2', {}, 'Paused'),
        h('p', { class: 'muted' }, `${this.game.state?.shipName ?? ''} · Day ${dayOf(this.game.state?.time ?? 0) + 1}`),
        h(
          'div',
          { style: 'display:flex;flex-direction:column;gap:8px;align-items:center;margin-top:12px' },
          h('button', { class: 'btn primary big', onclick: () => this.close('pause') }, 'Resume'),
          h('button', { class: 'btn big', onclick: () => this.showSaves('save') }, 'Save / Load'),
          h('button', { class: 'btn big', onclick: () => this.toggleMap() }, 'World Map'),
          h('button', { class: 'btn big', onclick: () => this.toggleJournal() }, 'Journal'),
          h('button', { class: 'btn big', onclick: () => this.showSettings(() => this.showPause()) }, 'Settings'),
          h('button', { class: 'btn big danger', onclick: () => this.game.quitToTitle() }, 'Save & Quit to Title'),
        ),
      ),
    );
    this.open('pause');
  }

  private showSaves(mode: 'save' | 'load'): void {
    this.click();
    const s = this.screens.saves;
    const render = () => {
      clear(s);
      const rows = SLOTS.map((slot) => {
        const m = this.game.saves.meta(slot);
        const label = slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(-1)}`;
        return h(
          'div',
          { class: 'card row' },
          h('div', {}, h('div', { class: 'title' }, label), h('div', { class: 'meta' }, m ? `${m.shipName} · Day ${m.day} · ${m.location} · ${formatCoins(m.coins)} coin · ${new Date(m.savedAt).toLocaleString()}` : 'Empty')),
          h('div', { class: 'spacer' }),
          this.game.state && slot !== 'auto'
            ? h('button', { class: 'btn small', onclick: () => { if (this.game.saveSlot(slot)) { this.toast(`Saved to ${label}.`, 'good'); render(); } else this.toast('Could not save (storage full?).', 'bad'); } }, 'Save')
            : null,
          m ? h('button', { class: 'btn small', onclick: () => { const err = this.game.loadSlot(slot); if (err) this.toast(err, 'bad'); } }, 'Load') : null,
          m && slot !== 'auto' ? h('button', { class: 'btn small danger', onclick: () => { this.game.saves.remove(slot); render(); } }, 'Delete') : null,
        );
      });
      const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' }) as HTMLInputElement;
      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        const err = this.game.importSave(await f.text());
        if (err) this.toast(err, 'bad');
        else this.toast('Save imported.', 'good');
      });
      s.append(
        h(
          'div',
          { class: 'panel modal' },
          h('h2', {}, mode === 'save' ? 'Save & Load' : 'Load Game'),
          ...rows,
          h(
            'div',
            { class: 'row', style: 'margin-top:10px' },
            this.game.state ? h('button', { class: 'btn', onclick: () => this.exportSave() }, 'Export save file') : null,
            h('button', { class: 'btn', onclick: () => file.click() }, 'Import save file'),
            file,
            h('div', { class: 'spacer' }),
            h('button', { class: 'btn primary', onclick: () => this.close('saves') }, 'Close'),
          ),
        ),
      );
    };
    render();
    this.open('saves');
  }

  private exportSave(): void {
    const json = this.game.exportSave();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `skyharbor-${this.game.state?.shipName ?? 'save'}-day${dayOf(this.game.state?.time ?? 0) + 1}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.toast('Save exported.', 'good');
  }

  showSettings(back: () => void): void {
    this.click();
    this.settingsReturn = back;
    for (const id of ['pause', 'title']) if (this.isOpen(id)) this.close(id);
    const s = this.screens.settings;
    const st = structuredClone(this.game.settings);
    const apply = () => this.game.applySettings(structuredClone(st));
    const slider = (key: 'master' | 'music' | 'sfx' | 'sensitivity', min: number, max: number, step: number) => {
      const i = h('input', { type: 'range', min, max, step, value: st[key] }) as HTMLInputElement;
      i.addEventListener('input', () => {
        st[key] = Number(i.value);
        apply();
      });
      return i;
    };
    const check = (key: 'invertY' | 'showFps') => {
      const i = h('input', { type: 'checkbox' }) as HTMLInputElement;
      i.checked = st[key];
      i.addEventListener('change', () => {
        st[key] = i.checked;
        apply();
      });
      return i;
    };
    const select = <T extends string>(value: T, opts: [T, string][], set: (v: T) => void) => {
      const el = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
      el.addEventListener('change', () => {
        set(el.value as T);
        apply();
      });
      return el;
    };
    const binds = h('div', {});
    const renderBinds = () => {
      clear(binds);
      for (const a of Object.keys(ACTION_LABELS) as Action[]) {
        const b = h('button', { class: 'btn small' }, keyLabel(st.bindings[a][0]));
        b.addEventListener('click', () => {
          b.textContent = 'Press a key…';
          this.game.input.captureNextKey((code) => {
            if (code !== 'Escape') {
              // Free the key from any other action.
              for (const other of Object.keys(st.bindings) as Action[]) st.bindings[other] = st.bindings[other].map((c) => (c === code && other !== a ? '' : c)).filter(Boolean);
              st.bindings[a] = [code, ...st.bindings[a].filter((c) => c !== code)].slice(0, 2);
              apply();
            }
            renderBinds();
          });
        });
        binds.append(h('label', { class: 'field' }, h('span', {}, ACTION_LABELS[a], ' ', h('span', { class: 'muted' }, st.bindings[a][1] ? `(also ${keyLabel(st.bindings[a][1])})` : '')), b));
      }
    };
    renderBinds();
    clear(s).append(
      h(
        'div',
        { class: 'panel modal' },
        h('h2', {}, 'Settings'),
        h('h3', {}, 'Graphics'),
        h('label', { class: 'field' }, 'Quality preset', select(st.quality, [['low', 'Low (phones)'], ['medium', 'Medium'], ['high', 'High']], (v) => (st.quality = v))),
        h('label', { class: 'field' }, 'Show FPS', check('showFps')),
        h('h3', {}, 'Audio'),
        h('label', { class: 'field' }, 'Master volume', slider('master', 0, 1, 0.05)),
        h('label', { class: 'field' }, 'Music', slider('music', 0, 1, 0.05)),
        h('label', { class: 'field' }, 'Effects & ambience', slider('sfx', 0, 1, 0.05)),
        h('h3', {}, 'Controls'),
        h('label', { class: 'field' }, 'Invert camera Y', check('invertY')),
        h('label', { class: 'field' }, 'Look sensitivity', slider('sensitivity', 0.3, 2.5, 0.1)),
        h('label', { class: 'field' }, 'Touch controls', select(st.touch, [['auto', 'Automatic'], ['on', 'Always on'], ['off', 'Off']], (v) => (st.touch = v))),
        h('h3', {}, 'Key bindings'),
        binds,
        h(
          'div',
          { class: 'row', style: 'margin-top:12px' },
          h('button', { class: 'btn', onclick: () => { st.bindings = structuredClone(DEFAULT_BINDINGS); apply(); renderBinds(); } }, 'Reset keys'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn primary', onclick: () => { this.close('settings'); const r = this.settingsReturn; this.settingsReturn = null; r?.(); } }, 'Done'),
        ),
      ),
    );
    this.open('settings');
  }

  // ------------------------------------------------------------ dialog & ending

  dialog(speaker: string, lines: string[], reward: number, done: () => void): void {
    this.dialogLines = lines;
    this.dialogIndex = 0;
    this.dialogCb = done;
    const s = this.screens.dialog;
    const lineEl = h('div', { class: 'line' });
    const next = h('button', { class: 'btn primary', 'data-testid': 'dialog-next' }, 'Continue');
    const show = () => {
      lineEl.textContent = this.dialogLines[this.dialogIndex];
      next.textContent = this.dialogIndex < this.dialogLines.length - 1 ? 'Continue' : reward ? `Close (+${reward} coin)` : 'Close';
    };
    next.addEventListener('click', () => {
      this.click();
      if (this.dialogIndex < this.dialogLines.length - 1) {
        this.dialogIndex++;
        show();
      } else {
        this.close('dialog');
        const cb = this.dialogCb;
        this.dialogCb = null;
        cb?.();
        this.syncPause();
      }
    });
    clear(s).append(h('div', { class: 'panel' }, h('div', { class: 'speaker' }, speaker), lineEl, h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Main quest'), h('div', { class: 'spacer' }), next)));
    show();
    this.open('dialog');
  }

  showEnding(): void {
    const g = this.game;
    const st = g.state!;
    const s = this.screens.ending;
    const hours = Math.floor(st.playTime / 3600);
    const mins = Math.floor((st.playTime % 3600) / 60);
    clear(s).append(
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'The Sky Is Charted'),
        h('p', {}, 'The Cartographers’ Guild is home, and the dome over Skyharbor burns gold once more. The sky beyond the Meridian waits.'),
        h(
          'div',
          { class: 'stat-grid' },
          ...[
            ['Days afloat', String(dayOf(st.time) + 1)],
            ['Time played', `${hours}h ${mins}m`],
            ['Distance flown', `${Math.round(st.stats.distance / 100) / 10}k spans`],
            ['Trade profit', formatCoins(st.stats.tradeProfit)],
            ['Corsairs sunk', String(st.stats.piratesSunk)],
            ['Contracts done', String(st.contracts.completed)],
            ['Shards found', `${st.fragments.length}/${FRAGMENTS.length}`],
            ['Sky charted', `${(st.fog.coverage * 100).toFixed(1)}%`],
          ].map(([k, v]) => h('div', {}, h('span', { class: 'muted' }, k + ': '), v)),
        ),
        h('p', { class: 'muted' }, 'Unlocked: Cartographer’s Gold paint at any shipwright.'),
        h('button', { class: 'btn primary big', onclick: () => this.close('ending') }, 'Keep Exploring'),
      ),
    );
    this.open('ending');
  }

  // ------------------------------------------------------------ journal

  toggleJournal(): void {
    if (this.game.mode === 'title') return;
    if (this.isOpen('journal')) {
      this.close('journal');
      return;
    }
    if (this.isOpen('pause')) this.close('pause');
    if (this.isOpen('map')) this.close('map');
    this.renderJournal();
    this.open('journal');
  }

  private renderJournal(): void {
    const g = this.game;
    const st = g.state!;
    const s = this.screens.journal;
    const tabs: [string, string][] = [['story', 'Main Quest'], ['contracts', 'Contracts'], ['log', 'Logbook'], ['atlas', 'Atlas & Records']];
    const body = h('div', { class: 'tab-body' });
    if (this.journalTab === 'story') {
      const cur = STORY[st.story.step];
      if (!st.story.complete) {
        body.append(h('h3', {}, `Current: ${cur.title}`), h('p', {}, cur.summary));
        if (cur.objective.type === 'fragments') body.append(h('p', { class: 'good' }, `Shards: ${st.fragments.length}/${cur.objective.count}`));
      } else body.append(h('h3', {}, 'The Guild is home.'), h('p', {}, 'The main quest is complete. The sky is yours.'));
      const done = st.story.complete ? STORY.length : st.story.step;
      for (let i = done - 1; i >= 0; i--) {
        const step = STORY[i];
        body.append(h('div', { class: 'card' }, h('div', { class: 'title' }, `✓ ${step.title}`), h('div', { class: 'quote' }, `${step.outro.speaker}: “${step.outro.lines[step.outro.lines.length - 1]}”`)));
      }
    } else if (this.journalTab === 'contracts') {
      if (!st.contracts.active.length) body.append(h('p', {}, 'No active contracts. Visit a port’s contract board.'));
      for (const c of st.contracts.active) body.append(this.contractCard(c, true));
      body.append(h('p', { class: 'muted' }, `Completed ${st.contracts.completed} · Failed ${st.contracts.failed} · Reputation ${st.reputation}`));
    } else if (this.journalTab === 'log') {
      for (const e of st.journal) body.append(h('div', { class: 'log-entry' }, h('span', { class: 'd' }, `Day ${e.day + 1}`), e.text));
    } else {
      body.append(h('h3', {}, `Ports charted ${st.discoveredPorts.length}/${PORTS.length}`));
      body.append(h('div', { class: 'grid2' }, ...PORTS.map((p) => h('div', { class: 'card' }, h('div', { class: 'title' }, st.discoveredPorts.includes(p.id) ? p.name : '??? '), h('div', { class: 'meta' }, st.discoveredPorts.includes(p.id) ? `${BIOMES[p.biome].name} · sells ${p.produces.map((g2) => GOOD_BY_ID[g2].name).join(', ')}` : BIOMES[p.biome].name)))));
      body.append(h('h3', {}, `Compass shards ${st.fragments.length}/${FRAGMENTS.length}`), h('p', {}, 'Shards glow with a tall golden pillar of light. Each one charts the sky around it.'));
      body.append(h('h3', {}, 'Landmarks'), h('p', {}, st.discoveredLandmarks.length ? st.discoveredLandmarks.map((l) => LANDMARK_BY_ID[l]?.name ?? l).join(' · ') : 'None yet.'));
      body.append(
        h('h3', {}, 'Records'),
        h('div', { class: 'stat-grid' }, ...[
          ['Distance', `${Math.round(st.stats.distance)} spans`],
          ['Trade profit', formatCoins(st.stats.tradeProfit)],
          ['Goods traded', String(st.stats.goodsTraded)],
          ['Corsairs sunk', String(st.stats.piratesSunk)],
          ['Sky charted', `${(st.fog.coverage * 100).toFixed(1)}%`],
          ['Reputation', String(st.reputation)],
        ].map(([k, v]) => h('div', {}, h('span', { class: 'muted' }, k + ': '), v))),
      );
    }
    clear(s).append(
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'port-head row' }, h('h2', {}, 'Captain’s Journal'), h('div', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => this.close('journal') }, 'Close')),
        h('div', { class: 'tabs' }, ...tabs.map(([id, label]) => h('button', { class: `tab ${this.journalTab === id ? 'active' : ''}`, onclick: () => { this.journalTab = id; this.renderJournal(); } }, label))),
        body,
      ),
    );
  }

  // ------------------------------------------------------------ map

  toggleMap(): void {
    if (this.game.mode === 'title') return;
    if (this.isOpen('map')) {
      this.close('map');
      return;
    }
    if (this.isOpen('pause')) this.close('pause');
    if (this.isOpen('journal')) this.close('journal');
    this.open('map');
    this.map.show();
  }

  // ------------------------------------------------------------ port

  showPort(id: PortId): void {
    this.portId = id;
    this.portTab = 'market';
    this.renderPort();
    this.open('port');
    this.game.input.enabled = false;
  }

  hidePort(): void {
    this.portId = null;
    this.close('port');
  }

  refreshPort(): void {
    if (this.portId && this.isOpen('port')) this.renderPort();
  }

  private renderPort(): void {
    const g = this.game;
    const st = g.state!;
    const p = PORT_BY_ID[this.portId!];
    const s = this.screens.port;
    const scroll = s.querySelector('.tab-body')?.scrollTop ?? 0;
    const tabs: [PortTab, string][] = [['market', 'Market'], ['contracts', 'Contracts'], ['shipwright', 'Shipwright'], ['paint', 'Paint & Name'], ['harbor', 'Harbor']];
    const body = h('div', { class: 'tab-body' });
    if (this.portTab === 'market') this.renderMarket(body);
    else if (this.portTab === 'contracts') this.renderContracts(body);
    else if (this.portTab === 'shipwright') this.renderShipwright(body);
    else if (this.portTab === 'paint') this.renderPaint(body);
    else this.renderHarbor(body);
    clear(s).append(
      h(
        'div',
        { class: 'panel' },
        h(
          'div',
          { class: 'port-head' },
          h('h2', {}, p.name),
          h('div', { class: 'sub' }, `${BIOMES[p.biome].name} · ${p.keeper}`),
          h(
            'div',
            { class: 'stats' },
            h('span', { class: 'coin', 'data-testid': 'port-coins' }, formatCoins(st.coins)),
            h('span', {}, `Cargo ${g.hudData().cargo}/${g.stats.cargoCapacity}`),
            h('span', {}, `Hull ${Math.round(st.ship.hull)}/${g.stats.maxHull}`),
            h('span', {}, `Aether ${Math.round(st.ship.fuel)}/${g.stats.fuelCapacity}`),
          ),
        ),
        h('div', { class: 'tabs' }, ...tabs.map(([id, label]) => h('button', { class: `tab ${this.portTab === id ? 'active' : ''}`, 'data-testid': `tab-${id}`, onclick: () => { this.click(); this.portTab = id; this.renderPort(); } }, label))),
        body,
        h(
          'div',
          { class: 'port-foot' },
          h('button', { class: 'btn', onclick: () => this.toggleMap() }, 'Map'),
          h('button', { class: 'btn', onclick: () => this.toggleJournal() }, 'Journal'),
          h('button', { class: 'btn', onclick: () => this.showPause() }, 'Menu'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn primary', 'data-testid': 'depart', onclick: () => { this.click(); g.undock(); } }, 'Cast Off →'),
        ),
      ),
    );
    const nb = s.querySelector('.tab-body');
    if (nb) nb.scrollTop = scroll;
  }

  private renderMarket(body: HTMLElement): void {
    const g = this.game;
    const st = g.state!;
    const port = this.portId!;
    const market = st.markets[port];
    const rows = GOODS.map((good) => {
      const mg = market[good.id];
      const bp = buyPrice(port, good.id, mg);
      const sp = sellPrice(port, good.id, mg);
      const rel = unitPrice(port, good.id, mg) / good.basePrice;
      const cls = rel < 0.8 ? 'cheap' : rel > 1.25 ? 'dear' : '';
      const held = st.cargo[good.id];
      const best = this.bestKnownSale(good.id, port);
      const maxBuy = maxAffordable(port, good.id, mg, g.tradeContext());
      const act = (qty: number, buying: boolean) => () => {
        const r = g.trade(good.id, qty, buying);
        if (!r.ok) this.toast(r.reason, 'bad', 2500);
        this.renderPort();
      };
      return h(
        'tr',
        { 'data-testid': `row-${good.id}` },
        h('td', {}, h('div', { class: 'name' }, `${good.icon} ${good.name}`), h('div', { class: 'hint' }, best ? `Best known: ${best.price} at ${best.name}` : good.blurb)),
        h('td', { class: 'num' }, String(Math.floor(mg.stock))),
        h('td', { class: `num ${cls}` }, String(bp)),
        h('td', { class: `num ${cls}` }, String(sp)),
        h('td', { class: 'num' }, held ? `${held}${st.cargoCost[good.id] ? ` @${Math.round(st.cargoCost[good.id])}` : ''}` : '—'),
        h(
          'td',
          { style: 'white-space:nowrap' },
          h('button', { class: 'btn small', 'data-testid': `buy-${good.id}`, disabled: maxBuy < 1, onclick: act(1, true) }, 'Buy'),
          ' ',
          h('button', { class: 'btn small opt', disabled: maxBuy < 2, onclick: act(Math.min(5, maxBuy), true) }, `+${Math.max(2, Math.min(5, maxBuy))}`),
          ' ',
          h('button', { class: 'btn small opt', disabled: maxBuy < 1, onclick: act(maxBuy, true) }, 'Max'),
          ' ',
          h('button', { class: 'btn small', 'data-testid': `sell-${good.id}`, disabled: held < 1, onclick: act(1, false) }, 'Sell'),
          ' ',
          h('button', { class: 'btn small opt', disabled: held < 1, onclick: act(held, false) }, 'All'),
        ),
      );
    });
    body.append(
      h('p', { class: 'muted' }, 'Green prices are cheap here, red are dear. Each trade moves the price. Markets drift by the hour.'),
      h('table', { class: 'market' }, h('thead', {}, h('tr', {}, h('th', {}, 'Good'), h('th', { class: 'num' }, 'Stock'), h('th', { class: 'num' }, 'Buy'), h('th', { class: 'num' }, 'Sell'), h('th', { class: 'num' }, 'Hold'), h('th', {}, ''))), h('tbody', {}, ...rows)),
    );
  }

  private bestKnownSale(good: GoodId, here: PortId): { price: number; name: string } | null {
    const st = this.game.state!;
    let best: { price: number; name: string } | null = null;
    for (const pid of st.discoveredPorts) {
      if (pid === here) continue;
      const price = sellPrice(pid, good, st.markets[pid][good]);
      if (!best || price > best.price) best = { price, name: PORT_BY_ID[pid].name };
    }
    return best;
  }

  private contractCard(c: import('../sim/contracts').Contract, active: boolean): HTMLElement {
    const g = this.game;
    const st = g.state!;
    const icon = { delivery: '\u{1F4E6}', salvage: '⚓', escort: '\u{1F6E1}️', ruin: '\u{1F3DB}️' }[c.kind];
    const left = c.deadline !== null ? Math.max(0, c.deadline - st.time) : null;
    const status = c.status === 'ready' ? h('span', { class: 'good' }, ' — ready to hand in') : null;
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'title' }, `${icon} ${c.title}`), status, h('div', { class: 'spacer' }), h('span', { class: 'coin' }, formatCoins(c.reward))),
      h('div', { class: 'meta' }, c.desc),
      h('div', { class: 'row', style: 'margin-top:6px' }, left !== null ? h('span', { class: 'muted' }, `Deadline: ${Math.floor(left)}h ${Math.floor((left % 1) * 60)}m`) : h('span', { class: 'muted' }, 'No deadline'), h('div', { class: 'spacer' }), active ? h('button', { class: 'btn small danger', onclick: () => { g.abandon(c.id); this.renderJournal(); this.refreshPort(); } }, 'Abandon') : h('button', { class: 'btn small primary', 'data-testid': 'accept-contract', onclick: () => { const err = g.acceptContract(c.id); if (err) this.toast(err, 'bad'); else this.toast('Contract accepted.', 'good'); this.renderPort(); } }, 'Accept')),
    );
  }

  private renderContracts(body: HTMLElement): void {
    const st = this.game.state!;
    const offers = st.contracts.offers[this.portId!] ?? [];
    body.append(h('h3', {}, 'Contract Board'), h('p', { class: 'muted' }, `New postings every day. You may hold ${MAX_ACTIVE_CONTRACTS} contracts at once.`));
    if (!offers.length) body.append(h('p', {}, 'The board is bare. Check back tomorrow.'));
    for (const c of offers) body.append(this.contractCard(c, false));
    if (st.contracts.active.length) {
      body.append(h('h3', {}, 'Your Contracts'));
      for (const c of st.contracts.active) body.append(this.contractCard(c, true));
    }
  }

  private renderShipwright(body: HTMLElement): void {
    const g = this.game;
    const st = g.state!;
    const stats = g.stats;
    body.append(
      h('p', { class: 'muted' }, 'Every upgrade is fitted to your ship where you can see it. The camera circles your ship while you browse.'),
      h(
        'div',
        { class: 'grid2' },
        ...UPGRADES.map((u) => {
          const lvl = st.upgrades[u.id];
          const cost = upgradeCost(u.id, lvl);
          const next = lvl < MAX_UPGRADE_LEVEL ? u.levels[lvl + 1] : null;
          return h(
            'div',
            { class: 'card' },
            h('div', { class: 'row' }, h('div', { class: 'title' }, `${u.icon} ${u.name}`), h('div', { class: 'spacer' }), h('span', { class: 'pips' }, ...[0, 1, 2, 3].map((i) => h('span', { class: `pip ${i <= lvl ? 'on' : ''}` })))),
            h('div', { class: 'meta' }, `Fitted: ${u.levels[lvl].name}`),
            next ? h('p', {}, h('b', {}, next.name), ' — ', next.blurb) : h('p', {}, 'The finest grade available.'),
            next ? h('button', { class: 'btn small primary', 'data-testid': `upgrade-${u.id}`, disabled: st.coins < (cost ?? 0), onclick: () => { const err = g.buyUpgrade(u.id); if (err) this.toast(err, 'bad'); else this.toast(`${next.name} fitted!`, 'good'); this.renderPort(); } }, `Fit for ${formatCoins(cost ?? 0)}`) : null,
          );
        }),
      ),
      h('h3', {}, 'Ship statistics'),
      h(
        'div',
        { class: 'stat-grid' },
        ...[
          ['Hull', `${stats.maxHull} (armour ${Math.round(stats.armor * 100)}%)`],
          ['Top speed', `${stats.maxSpeed} kn`],
          ['Climb', `${stats.climbRate} /s`],
          ['Cargo', `${stats.cargoCapacity} slots`],
          ['Guns per side', `${stats.cannonsPerSide} × ${stats.cannonDamage} dmg`],
          ['Reload', `${stats.reload}s`],
          ['Aether tank', `${stats.fuelCapacity}`],
          ['Lantern range', `${stats.lanternRange}`],
        ].map(([k, v]) => h('div', {}, h('span', { class: 'muted' }, k + ': '), v)),
      ),
    );
    void computeStats;
  }

  private renderPaint(body: HTMLElement): void {
    const g = this.game;
    const st = g.state!;
    const paint: Paint = { ...st.paint };
    const colors = st.unlockedPaints.includes('guild') ? [...PAINT_COLORS, GUILD_GOLD] : PAINT_COLORS;
    const apply = () => {
      g.setPaint(paint);
      this.renderPort();
    };
    const swatches = (key: 'envelope' | 'hull' | 'trim' | 'sail') =>
      h('div', { class: 'swatches' }, ...colors.map((c) => h('button', { class: `swatch ${paint[key] === c ? 'sel' : ''}`, style: `background:${hex(c)}`, title: hex(c), onclick: () => { paint[key] = c; apply(); } })));
    const chips = <T extends string>(key: 'pattern' | 'emblem', opts: [T, string][]) =>
      h('div', { class: 'chips' }, ...opts.map(([v, l]) => h('button', { class: `chip ${paint[key] === v ? 'sel' : ''}`, onclick: () => { (paint as unknown as Record<string, string>)[key] = v; apply(); } }, l)));
    const name = h('input', { type: 'text', value: st.shipName, maxlength: 24 }) as HTMLInputElement;
    name.addEventListener('change', () => {
      st.shipName = name.value.trim() || st.shipName;
      this.toast(`Your ship is now the ${st.shipName}.`, 'good');
    });
    body.append(
      h('label', { class: 'field' }, 'Ship name', name),
      h('h3', {}, 'Envelope'),
      swatches('envelope'),
      h('h3', {}, 'Pattern colour & fins'),
      swatches('sail'),
      h('h3', {}, 'Trim & emblem'),
      swatches('trim'),
      h('h3', {}, 'Hull'),
      swatches('hull'),
      h('h3', {}, 'Pattern'),
      chips<PaintPattern>('pattern', [['plain', 'Plain'], ['band', 'Band'], ['stripes', 'Stripes'], ['chevron', 'Chevron']]),
      h('h3', {}, 'Emblem'),
      chips<Emblem>('emblem', [['none', 'None'], ['compass', 'Compass'], ['star', 'Star'], ['whale', 'Sky-whale'], ['feather', 'Feather']]),
      h('p', { class: 'muted' }, 'Paint is free. Drag to look around your ship.'),
    );
  }

  private renderHarbor(body: HTMLElement): void {
    const g = this.game;
    const st = g.state!;
    const p = PORT_BY_ID[this.portId!];
    const tip = bestTrade(st.markets, p.id);
    const refuel = g.refuelCost();
    const repair = g.repairCost();
    const step = STORY[st.story.step];
    let storyHint = '';
    if (!st.story.complete) {
      if (step.objective.type === 'dock' && step.objective.port !== p.id) storyHint = `“Looking for ${PORT_BY_ID[step.objective.port].name}? Check your map.”`;
      else if (step.objective.type === 'fragments') storyHint = '“Shards of light? Sailors swear they’ve seen golden pillars rising from the clouds. Climb high and look around.”';
      else if (step.objective.type === 'reach') storyHint = `“${LANDMARK_BY_ID[step.objective.landmark].name}? Follow the marker on your compass, and mind the weather.”`;
      else if (step.objective.type === 'flagship') storyHint = '“The Black Gannet hunts the open sky. Fit more guns and armour before you face her.”';
    }
    body.append(
      h('p', { class: 'quote' }, p.blurb),
      h('div', { class: 'card' }, h('div', { class: 'title' }, p.keeper), h('p', {}, tip && tip.margin > 5 ? `“${GOOD_BY_ID[tip.good].name} sells for a good ${tip.margin} coin more at ${PORT_BY_ID[tip.to].name}, if you’re hauling.”` : '“Quiet markets today, Captain.”'), storyHint ? h('p', {}, storyHint) : null),
      h(
        'div',
        { class: 'grid2' },
        h('div', { class: 'card' }, h('div', { class: 'title' }, '\u{1F48E} Aether refuel'), h('p', {}, `${Math.round(st.ship.fuel)} / ${g.stats.fuelCapacity}`), h('button', { class: 'btn small primary', 'data-testid': 'refuel', disabled: refuel <= 0, onclick: () => { const e = g.refuel(); if (e) this.toast(e, 'bad'); this.renderPort(); } }, refuel > 0 ? `Refuel (${formatCoins(refuel)})` : 'Full')),
        h('div', { class: 'card' }, h('div', { class: 'title' }, '\u{1F527} Hull repair'), h('p', {}, `${Math.round(st.ship.hull)} / ${g.stats.maxHull}`), h('button', { class: 'btn small primary', 'data-testid': 'repair', disabled: repair <= 0, onclick: () => { const e = g.repair(); if (e) this.toast(e, 'bad'); this.renderPort(); } }, repair > 0 ? `Repair (${formatCoins(repair)})` : 'Sound')),
      ),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => { if (g.saveSlot('slot1')) this.toast('Saved to Slot 1.', 'good'); } }, 'Quick save (Slot 1)')),
    );
  }

  // ------------------------------------------------------------ HUD

  private buildHud(): HTMLElement {
    const e = this.els;
    const box = (id: string, cls = '') => (e[id] = h('div', { id, class: `hud-box ${cls}` }));
    const hud = h('div', { id: 'hud' });
    e.coins = h('div', { class: 'coins coin', 'data-testid': 'hud-coins' });
    e.clock = h('div', { class: 'clock' });
    const tl = h('div', { id: 'hud-tl' }, h('div', { class: 'hud-box' }, e.coins, e.clock));
    e.tape = h('div', { class: 'tape' });
    e.deg = h('div', { class: 'deg' });
    const compass = h('div', { id: 'compass', class: 'hud-box' }, e.tape, h('div', { class: 'center' }), e.deg);
    e.objText = h('div', { class: 'text' });
    e.objSub = h('div', { class: 'muted' });
    const obj = h('div', { id: 'objective', class: 'hud-box' }, h('div', { class: 'label' }, 'Objective'), e.objText, e.objSub);
    e.radar = h('canvas', { id: 'radar', class: 'hud-box', width: 300, height: 300 });
    const tr = h('div', { id: 'hud-tr' }, obj, e.radar);
    e.speed = h('div', { class: 'v' });
    e.alt = h('div', { class: 'v' });
    e.fill = h('div', { class: 'fill' });
    e.zero = h('div', { class: 'zero' });
    const tele = h('div', { id: 'telegraph', class: 'hud-box' }, e.zero, e.fill, h('div', { class: 'cap' }, 'THR'));
    const bl = h('div', { id: 'hud-bl' }, tele, h('div', { class: 'hud-box gauge' }, e.speed, h('div', { class: 'u' }, 'knots')), h('div', { class: 'hud-box gauge' }, e.alt, h('div', { class: 'u' }, 'altitude')));
    const bar = (cls: string, label: string) => {
      const f = h('div', { class: 'f' });
      const t = h('span', {});
      e[cls] = f;
      e[cls + 'T'] = t;
      return h('div', { class: `bar ${cls}` }, f, h('div', { class: 't' }, h('span', {}, label), t));
    };
    e.wind = h('div', { class: 'muted', style: 'text-align:right' });
    const br = h('div', { id: 'hud-br', class: 'hud-box' }, bar('hull', 'HULL'), bar('fuel', 'AETHER'), bar('cargo', 'CARGO'), e.wind);
    e.prompt = h('div', { id: 'prompt', class: 'hud-box hidden', 'data-testid': 'dock-prompt' });
    e.gunL = h('div', { class: 'bar gun' }, h('div', { class: 'f', style: 'background:#e2b65c' }), h('div', { class: 't' }, h('span', {}, '◀ PORT')));
    e.gunR = h('div', { class: 'bar gun' }, h('div', { class: 'f', style: 'background:#e2b65c' }), h('div', { class: 't' }, h('span', {}, 'STBD ▶')));
    const guns = h('div', { id: 'guns' }, e.gunL, e.gunR);
    e.marker = h('div', { id: 'marker' }, h('div', { class: 'dia' }), h('div', { class: 'ml' }));
    e.fps = h('div', { id: 'fps', class: 'hidden' });
    e.hint = h('div', { id: 'hint', class: 'hud-box hidden' });
    hud.append(tl, compass, tr, bl, br, e.prompt, guns, e.marker, e.fps, e.hint);
    void box;
    return hud;
  }

  updateFps(fps: number | null): void {
    this.els.fps.classList.toggle('hidden', fps === null);
    if (fps !== null) this.els.fps.textContent = `${Math.round(fps)} fps`;
  }

  updateHud(d: HudData): void {
    const e = this.els;
    const docked = d.mode === 'docked';
    e.coins.textContent = formatCoins(d.coins);
    const hh = Math.floor(d.hour);
    const mm = Math.floor((d.hour % 1) * 60);
    const icon = d.weather === 'storm' ? '\u26C8\uFE0F' : d.weather === 'cloudy' ? '\u2601\uFE0F' : d.night ? '\u{1F319}' : d.weather === 'calm' ? '\u{1F324}\uFE0F' : '\u2600\uFE0F';
    e.clock.textContent = `Day ${d.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${icon}`;
    e.speed.textContent = String(Math.round(d.speed));
    e.alt.textContent = String(Math.round(d.altitude));
    // Telegraph.
    const H = 112;
    const zeroY = 4 + H * (1 / 1.35);
    e.zero.style.top = `${zeroY}px`;
    const t = d.throttle;
    const len = (Math.abs(t) / 1.35) * H;
    e.fill.style.top = `${t >= 0 ? zeroY - len : zeroY}px`;
    e.fill.style.height = `${Math.max(2, len)}px`;
    e.fill.classList.toggle('astern', t < 0);
    // Bars.
    e.hull.style.width = `${clamp(d.hull, 0, 1) * 100}%`;
    e.hullT.textContent = `${Math.round(d.hullAbs)}`;
    e.fuel.style.width = `${clamp(d.fuel, 0, 1) * 100}%`;
    e.fuelT.textContent = d.fuelAbs <= 0 ? 'EMPTY' : `${Math.round(d.fuelAbs)}`;
    e.cargo.style.width = `${clamp(d.cargo / d.capacity, 0, 1) * 100}%`;
    e.cargoT.textContent = `${d.cargo}/${d.capacity}`;
    const ws = Math.hypot(d.windX, d.windZ);
    const windDir = Math.atan2(-d.windX, -d.windZ);
    e.wind.textContent = `Wind ${Math.round(ws)} kn ${compassPoint(windDir)}${d.current > 0.2 ? ' · SKY CURRENT' : ''}${d.boost ? ' · BOOST' : ''}`;
    // Guns.
    (e.gunL.firstChild as HTMLElement).style.width = `${(1 - d.reloadPort) * 100}%`;
    (e.gunR.firstChild as HTMLElement).style.width = `${(1 - d.reloadStarboard) * 100}%`;
    // Prompt.
    const dock = d.dockPrompt;
    e.prompt.classList.toggle('hidden', !dock || docked);
    if (dock) e.prompt.textContent = document.body.classList.contains('touch') ? `Tap \u2693 to dock at ${PORT_BY_ID[dock].name}` : `Press ${this.keyFor('interact')} to dock at ${PORT_BY_ID[dock].name}`;
    // Objective.
    e.objText.textContent = d.objective;
    e.objSub.textContent = d.marker ? `${d.marker.label} · ${Math.round(d.marker.dist)} spans` : d.nearPortName ? `Near ${d.nearPortName}` : '';
    // Marker.
    const m = d.marker;
    const mk = e.marker;
    if (m && !docked && m.dist > 60) {
      mk.classList.remove('hidden');
      let x = m.x;
      let y = m.y;
      if (!m.visible) {
        const k = Math.max(Math.abs(x) / 0.84, Math.abs(y) / 0.72, 1);
        x /= k;
        y /= k;
      }
      mk.style.left = `${clamp(((x + 1) / 2) * window.innerWidth, 90, window.innerWidth - 90)}px`;
      mk.style.top = `${((1 - y) / 2) * window.innerHeight}px`;
      mk.classList.toggle('edge', !m.visible);
      (mk.lastChild as HTMLElement).textContent = `${m.label} · ${Math.round(m.dist)}`;
    } else mk.classList.add('hidden');
    this.drawCompass(d);
    this.drawRadar(d);
    for (const id of ['hud-bl', 'hud-br', 'guns', 'compass']) {
      const el = id === 'compass' ? this.compassTape.parentElement! : (this.hud.querySelector('#' + id) as HTMLElement);
      el.style.opacity = docked ? '0.35' : '1';
    }
  }

  private drawCompass(d: HudData): void {
    const tape = this.compassTape;
    const w = tape.parentElement!.clientWidth;
    const deg = headingToDegrees(d.heading);
    this.els.deg.textContent = `${deg}°`;
    const pxPerDeg = w / 120;
    clear(tape);
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let a = Math.floor((deg - 70) / 15) * 15; a <= deg + 70; a += 15) {
      const norm = ((a % 360) + 360) % 360;
      const x = w / 2 + (a - deg) * pxPerDeg;
      const lab = labels[norm];
      tape.append(h('div', { class: `tick ${lab ? (lab.length === 1 ? 'major' : '') : 'minor'}`, style: `left:${x}px` }, lab ?? '|'));
    }
    const st = this.game.state!;
    const target = this.game.trackedTarget();
    if (target) {
      const bearing = headingToDegrees(Math.atan2(-(target.x - st.ship.x), -(target.z - st.ship.z)));
      let diff = bearing - deg;
      diff = ((diff + 540) % 360) - 180;
      const x = w / 2 + clamp(diff, -58, 58) * pxPerDeg;
      tape.append(h('div', { class: 'tick target', style: `left:${x}px` }, '◆'));
    }
  }

  private drawRadar(d: HudData): void {
    const c = this.radar;
    const g = c.getContext('2d')!;
    const W = c.width;
    const R = W / 2;
    const range = 900;
    const st = this.game.state!;
    g.clearRect(0, 0, W, W);
    g.save();
    g.translate(R, R);
    g.fillStyle = 'rgba(10,16,30,0.35)';
    g.beginPath();
    g.arc(0, 0, R - 2, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(232,200,130,0.25)';
    g.lineWidth = 2;
    for (const r of [R * 0.33, R * 0.66]) {
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    }
    // Rotate so the ship's heading is up.
    g.rotate(d.heading);
    const k = (R - 8) / range;
    const islands = this.game.world.islandsNear(st.ship.x, st.ship.z, range);
    for (const isl of islands) {
      const x = (isl.x - st.ship.x) * k;
      const y = (isl.z - st.ship.z) * k;
      g.fillStyle = hex(BIOMES[isl.biome].palette.grass) + 'aa';
      if (isl.kind === 'port') g.fillStyle = '#f5d48a';
      g.beginPath();
      g.arc(x, y, Math.max(3, isl.radius * k), 0, TAU);
      g.fill();
    }
    for (const f of FRAGMENTS) {
      if (st.fragments.includes(f.id)) continue;
      const x = (f.x - st.ship.x) * k;
      const y = (f.z - st.ship.z) * k;
      if (x * x + y * y > (R - 8) ** 2) continue;
      g.fillStyle = '#ffe9a8';
      g.fillRect(x - 4, y - 4, 8, 8);
    }
    for (const n of d.enemies) {
      const x = n.dx * k;
      const y = n.dz * k;
      if (x * x + y * y > (R - 6) ** 2) continue;
      g.fillStyle = n.role === 'merchant' ? '#8fe0a2' : '#ff6a5a';
      g.beginPath();
      g.arc(x, y, n.role === 'flagship' ? 9 : 6, 0, TAU);
      g.fill();
    }
    g.restore();
    // Player arrow (always up).
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(R, R - 12);
    g.lineTo(R - 8, R + 9);
    g.lineTo(R, R + 4);
    g.lineTo(R + 8, R + 9);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(244,234,214,0.8)';
    g.font = 'bold 22px system-ui';
    g.textAlign = 'center';
    // North marker on the rim.
    g.fillText('N', R + Math.sin(d.heading) * (R - 18), R - Math.cos(d.heading) * (R - 18) + 8);
  }

  // ------------------------------------------------------------ touch

  private buildTouch(): HTMLElement {
    const t = h('div', { id: 'touch', class: 'hidden' });
    const knob = h('div', { class: 'knob' });
    const stick = h('div', { id: 'stick' }, knob);
    let id: number | null = null;
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const dx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      const dy = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
      knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      this.game.input.setTouchAxis(Math.abs(dx) < 0.15 ? 0 : dx, Math.abs(dy) < 0.2 ? 0 : -dy);
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    stick.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const end = () => {
      id = null;
      knob.style.transform = '';
      this.game.input.setTouchAxis(0, 0);
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    const btn = (label: string, style: string, onDown: () => void, onUp?: () => void) => {
      const b = h('div', { class: 'tbtn', style }, label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('held');
        this.game.audio.start();
        onDown();
      });
      const up = () => {
        b.classList.remove('held');
        onUp?.();
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      return b;
    };
    const inp = this.game.input;
    t.append(
      stick,
      btn('▲', 'right:96px;bottom:150px', () => inp.setTouchHold('ascend', true), () => inp.setTouchHold('ascend', false)),
      btn('▼', 'right:96px;bottom:84px', () => inp.setTouchHold('descend', true), () => inp.setTouchHold('descend', false)),
      btn('⚡', 'right:24px;bottom:184px', () => inp.setTouchHold('boost', true), () => inp.setTouchHold('boost', false)),
      btn('◀', 'right:168px;bottom:24px', () => inp.press('firePort')),
      btn('▶', 'right:24px;bottom:24px', () => inp.press('fireStarboard')),
      btn('⚓', 'right:24px;bottom:104px', () => inp.press('interact')),
      btn('\u{1F5FA}', 'left:12px;top:200px', () => this.toggleMap()),
      btn('☰', 'left:12px;top:266px', () => this.togglePause()),
    );
    return t;
  }

  applyTouchVisibility(): void {
    const mode = this.game.settings.touch;
    const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const on = mode === 'on' || (mode === 'auto' && touchCapable && window.matchMedia('(pointer: coarse)').matches);
    const show = on && !this.hud.classList.contains('hidden');
    this.touchEl.classList.toggle('hidden', !show);
    document.body.classList.toggle('touch', show);
  }
}

function compassPoint(heading: number): string {
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return pts[Math.round(headingToDegrees(heading) / 45) % 8];
}
