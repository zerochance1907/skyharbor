/**
 * The Game ties the pure simulation (src/sim) to rendering, audio, input and
 * UI. It owns the frame loop and every piece of runtime-only state (pirates,
 * cannonballs, loot) that does not need to be saved.
 */
import * as THREE from 'three';
import { Rng, hashString } from './core/rng';
import { clamp, damp, dampAngle, dist2, dist3, lerp } from './core/math';
import { AudioEngine, type Mood } from './audio/audio';
import { Input } from './input/input';
import { loadSettings, saveSettings, type Settings } from './input/settings';
import { Renderer, qualitySettings } from './render/renderer';
import { Sky } from './render/sky';
import { Clouds } from './render/clouds';
import { IslandRenderer } from './render/islands';
import { ShipModel, PIRATE_PAINT, FLAGSHIP_PAINT, MERCHANT_PAINT } from './render/ship';
import { Effects } from './render/fx';
import { Birds, SkyWhales } from './render/life';
import { ChaseCamera } from './render/camera';
import { smokeEmitters, updateStructures } from './render/structures';
import { BIOMES } from './sim/biomes';
import {
  abandonContract,
  acceptContract,
  failContract,
  refreshOffers,
  reservedSlots,
  resolveOnDock,
  updateContracts,
  type Contract,
} from './sim/contracts';
import {
  applyDamage,
  fireBroadside,
  makeMerchant,
  makePirate,
  stepBalls,
  stepMerchant,
  stepPirate,
  type Cannonball,
  type Npc,
  type Target,
} from './sim/combat';
import { buy, cargoUsed, driftMarkets, nearbyTrade, sell, FUEL_PRICE, REPAIR_PRICE, type TradeResult } from './sim/economy';
import { stepFlight, forwardOf, rightOf, airSpeed, type FlightInput } from './sim/flight';
import { GOOD_BY_ID, GOOD_IDS, type GoodId } from './sim/goods';
import { LANDMARK_BY_ID, PORTS, PORT_BY_ID, approachPosition, berthPosition, type PortId } from './sim/ports';
import { SaveError, SaveManager, deserialize, safeLocalStorage, serialize, type SlotId } from './sim/save';
import { HOURS_PER_SECOND, addJournal, dayOf, hourOf, newGame, type GameState, type Paint } from './sim/state';
import { FRAGMENTS, STORY, advanceStory, objectiveTarget, type StoryEvent } from './sim/story';
import { computeStats, purchaseUpgrade, type ShipStats, type UpgradeId } from './sim/upgrades';
import { WEATHER_WIND, localStorm, stepWeather, stormWallAt } from './sim/weather';
import { WindField } from './sim/wind';
import { World } from './sim/world';
import { UI } from './ui/ui';

export type Mode = 'title' | 'play' | 'docked';

export interface Loot {
  id: string;
  x: number;
  y: number;
  z: number;
  coins: number;
  good: GoodId | null;
  qty: number;
}

const DEFAULT_SEED = 1907;
const STEP = 1 / 60;
const DOCK_RANGE = 130;
const PLAYER_ID = 0;

export class Game {
  settings: Settings;
  readonly renderer: Renderer;
  readonly chase: ChaseCamera;
  readonly input: Input;
  readonly audio = new AudioEngine();
  readonly saves = new SaveManager(safeLocalStorage());
  readonly ui: UI;
  world: World;
  wind: WindField;
  state: GameState | null = null;
  stats: ShipStats = computeStats({ hull: 0, engine: 0, cargo: 0, lantern: 0, cannons: 0, tank: 0 });
  mode: Mode = 'title';
  /** Simulation paused by an overlay (pause menu, map, journal, dialog). */
  paused = false;

  private sky: Sky;
  private clouds: Clouds;
  private islands: IslandRenderer;
  private fx: Effects;
  private birds: Birds;
  private whales: SkyWhales;
  private ship: ShipModel;
  private npcModels = new Map<number, ShipModel>();
  npcs: Npc[] = [];
  balls: Cannonball[] = [];
  loot: Loot[] = [];
  private rng = new Rng(1);
  private fxRng = new Rng(2);
  private nextNpcId = 1;
  private acc = 0;
  private last = 0;
  private time = 0;
  private flash = 0;
  private damageFlash = 0;
  private reload = { port: 0, starboard: 0 };
  private spawnTimer = 10;
  private autosaveTimer = 60;
  private fogTimer = 0;
  private flagshipTimer = 0;
  private escortAway = 0;
  private escortAmbushed = new Set<string>();
  private dockAnim: { t: number; from: { x: number; y: number; z: number; h: number }; to: { x: number; y: number; z: number; heading: number } } | null = null;
  private lastInput: FlightInput = { throttle: 0, rudder: 0, lift: 0, boost: false };
  private windNow = { x: 0, z: 0 };
  private currentNow = 0;
  private fps = 60;
  private frameCount = 0;
  /** Seconds left in an arrival fade; the sim is frozen while chunks settle. */
  private settle = 0;
  private fpsTime = 0;
  private outOfFuelWarned = false;
  private lowHullWarned = false;
  private nearPort: { id: PortId; dist: number } | null = null;
  private smokeTimer = 0;
  private tmpV = new THREE.Vector3();
  /** Smoothed CPU time of simulation + scene update per frame (excludes GPU). */
  updateMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    const q = qualitySettings(this.settings.quality);
    this.chase = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(canvas, this.chase.camera, q);
    this.world = new World(DEFAULT_SEED);
    this.wind = new WindField(DEFAULT_SEED);
    const scene = this.renderer.scene;
    this.sky = new Sky(scene);
    this.clouds = new Clouds(scene, { layers: q.cloudLayers, clusters: q.cloudClusters, far: q.far });
    this.islands = new IslandRenderer(scene, this.world, { chunkRadius: q.chunkRadius, nearDistance: q.nearDistance, detail: q.detail });
    this.fx = new Effects(scene, { particles: q.particles, rain: q.rain });
    this.birds = new Birds(scene, q.birds);
    this.whales = new SkyWhales(scene, q.whales);
    this.ship = new ShipModel({ paint: newGame(1).paint, upgrades: newGame(1).upgrades }, true);
    scene.add(this.ship.root);
    this.input = new Input(canvas, this.settings);
    this.ui = new UI(this);
    this.audio.setVolumes(this.settings.master, this.settings.music, this.settings.sfx);
    // Title-screen vista over Skyharbor.
    this.chase.mode = 'orbit';
    this.ship.root.visible = false;
    const home = PORT_BY_ID.skyharbor;
    this.islands.warm(new THREE.Vector3(home.x, home.y, home.z), new THREE.Color(0xbfe3f5));
    this.ui.showTitle();
    (window as unknown as { __skyharbor: unknown }).__skyharbor = this.debugApi();
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ lifecycle

  startNewGame(seed: number, shipName: string): void {
    this.audio.start();
    this.setWorld(seed);
    this.loadState(newGame(seed, shipName || 'Wayfarer'));
    this.ui.toast('Fly to the Skyharbor docks and press ' + this.ui.keyFor('interact') + ' to moor.', 'info', 7000);
    this.ui.showControlsHint();
  }

  private setWorld(seed: number): void {
    if (this.world.seed === seed >>> 0) return;
    this.world = new World(seed);
    this.wind = new WindField(seed);
    const scene = this.renderer.scene;
    scene.remove(this.islands.group);
    const q = this.renderer.quality;
    this.islands = new IslandRenderer(scene, this.world, { chunkRadius: q.chunkRadius, nearDistance: q.nearDistance, detail: q.detail });
  }

  loadState(s: GameState): void {
    this.setWorld(s.seed);
    this.state = s;
    this.rng = new Rng(s.rng);
    this.stats = computeStats(s.upgrades);
    this.clearRuntime();
    this.ship.rebuild({ paint: s.paint, upgrades: s.upgrades });
    this.ship.root.visible = true;
    this.chase.mode = 'chase';
    this.chase.snap();
    this.islands.setHallLit(s.story.complete);
    this.syncMarkers();
    this.paused = false;
    this.ui.hideAllScreens();
    if (s.docked) {
      const b = berthPosition(PORT_BY_ID[s.docked]);
      Object.assign(s.ship, { x: b.x, y: b.y, z: b.z, heading: b.heading, vx: 0, vy: 0, vz: 0, throttle: 0 });
      this.mode = 'docked';
      this.ui.showPort(s.docked);
    } else {
      this.mode = 'play';
    }
    this.respawnEscorts();
    this.ui.showHud(true);
    this.ui.syncPause();
    this.arrive();
  }

  /**
   * Hide chunk streaming after a jump (new game, load, wreck, teleport): fade
   * from black, pre-build every island around the ship, compile shaders up
   * front, and hold the simulation until the fade clears.
   */
  arrive(): void {
    const s = this.state;
    if (!s) return;
    this.ui.fadeFromBlack(900);
    this.islands.warm(new THREE.Vector3(s.ship.x, s.ship.y, s.ship.z), new THREE.Color(0xbfe3f5));
    this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera);
    this.settle = 0.6;
    this.acc = 0;
  }

  private clearRuntime(): void {
    for (const id of [...this.npcModels.keys()]) this.removeNpcModel(id);
    this.npcs = [];
    this.balls = [];
    for (const l of this.loot) this.fx.removeMarker(l.id);
    this.loot = [];
    for (const id of this.fx.markerIds()) this.fx.removeMarker(id);
    this.dockAnim = null;
    this.escortAmbushed.clear();
  }

  quitToTitle(): void {
    if (this.state && this.mode !== 'title') this.autosave();
    this.state = null;
    this.clearRuntime();
    this.mode = 'title';
    this.paused = false;
    this.ship.root.visible = false;
    this.chase.mode = 'orbit';
    this.audio.setMood('title');
    this.ui.showHud(false);
    this.ui.showTitle();
  }

  // ------------------------------------------------------------------ saves

  autosave(): void {
    if (!this.state) return;
    this.state.rng = this.rng.state;
    try {
      this.saves.save('auto', this.state);
    } catch {
      /* storage full or unavailable: ignore */
    }
  }

  saveSlot(slot: SlotId): boolean {
    if (!this.state) return false;
    this.state.rng = this.rng.state;
    try {
      this.saves.save(slot, this.state);
      return true;
    } catch {
      return false;
    }
  }

  loadSlot(slot: SlotId): string | null {
    try {
      const s = this.saves.load(slot);
      if (!s) return 'That slot is empty.';
      this.audio.start();
      this.loadState(s);
      return null;
    } catch (e) {
      return e instanceof SaveError ? e.message : 'Could not read the save.';
    }
  }

  exportSave(): string | null {
    if (!this.state) return null;
    this.state.rng = this.rng.state;
    return serialize(this.state);
  }

  importSave(text: string): string | null {
    try {
      const s = deserialize(text);
      this.audio.start();
      this.loadState(s);
      return null;
    } catch (e) {
      return e instanceof SaveError ? e.message : 'Could not read the save.';
    }
  }

  // ------------------------------------------------------------------ settings

  applySettings(s: Settings): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    saveSettings(s);
    this.input.setSettings(s);
    this.audio.setVolumes(s.master, s.music, s.sfx);
    if (qualityChanged) {
      const q = qualitySettings(s.quality);
      this.renderer.applyQuality(q);
      this.clouds.setQuality({ layers: q.cloudLayers, clusters: q.cloudClusters, far: q.far });
      this.islands.setQuality({ chunkRadius: q.chunkRadius, nearDistance: q.nearDistance, detail: q.detail });
    }
    this.ui.applyTouchVisibility();
  }

  // ------------------------------------------------------------------ trade & port actions

  tradeContext() {
    const s = this.state!;
    return { coins: s.coins, cargo: s.cargo, capacity: this.stats.cargoCapacity, reserved: reservedSlots(s.contracts) };
  }

  freeSlots(): number {
    const s = this.state!;
    return this.stats.cargoCapacity - cargoUsed(s.cargo, reservedSlots(s.contracts));
  }

  trade(good: GoodId, qty: number, buying: boolean): TradeResult {
    const s = this.state!;
    if (!s.docked) return { ok: false, reason: 'You must be docked to trade.' };
    const market = s.markets[s.docked];
    const ctx = this.tradeContext();
    const r = buying ? buy(market, s.docked, good, qty, ctx) : sell(market, s.docked, good, qty, ctx);
    if (r.ok) {
      s.coins = r.coins;
      if (buying) {
        const held = s.cargo[good];
        const prevQty = held - qty;
        s.cargoCost[good] = (s.cargoCost[good] * prevQty + r.total) / Math.max(held, 1);
      } else {
        const profit = r.total - s.cargoCost[good] * qty;
        s.stats.tradeProfit += profit;
        if (s.cargo[good] === 0) s.cargoCost[good] = 0;
      }
      s.stats.goodsTraded += qty;
      this.audio.coin();
    } else this.audio.error();
    return r;
  }

  acceptContract(id: string): string | null {
    const s = this.state!;
    if (!s.docked) return 'Not docked.';
    const offer = (s.contracts.offers[s.docked] ?? []).find((c) => c.id === id);
    const r = acceptContract(s.contracts, s.docked, id, this.freeSlots());
    if (!r.ok) {
      this.audio.error();
      return r.reason;
    }
    this.audio.click();
    if (offer) {
      addJournal(s, `Accepted contract: ${offer.title}.`, 'contract');
      if (offer.kind === 'escort') this.spawnEscort(offer, true);
    }
    this.syncMarkers();
    return null;
  }

  abandon(id: string): void {
    const s = this.state!;
    const c = abandonContract(s.contracts, id);
    if (c) {
      addJournal(s, `Abandoned contract: ${c.title}.`, 'contract');
      s.reputation = Math.max(0, s.reputation - 2);
      this.removeEscort(id);
      this.syncMarkers();
    }
  }

  buyUpgrade(id: UpgradeId): string | null {
    const s = this.state!;
    const r = purchaseUpgrade(s.upgrades, id, s.coins);
    if (!r.ok) {
      this.audio.error();
      return r.reason;
    }
    const oldStats = this.stats;
    s.coins = r.coins;
    s.upgrades[id] = r.level;
    this.stats = computeStats(s.upgrades);
    // New capacity is granted topped up by the difference.
    s.ship.hull = Math.min(this.stats.maxHull, s.ship.hull + (this.stats.maxHull - oldStats.maxHull));
    s.ship.fuel = Math.min(this.stats.fuelCapacity, s.ship.fuel + (this.stats.fuelCapacity - oldStats.fuelCapacity));
    this.ship.rebuild({ paint: s.paint, upgrades: s.upgrades });
    this.audio.upgrade();
    addJournal(s, `Upgraded the ${id} at the shipwright.`, 'trade');
    return null;
  }

  setPaint(p: Paint): void {
    const s = this.state!;
    s.paint = { ...p };
    this.ship.rebuild({ paint: s.paint, upgrades: s.upgrades });
  }

  refuelCost(): number {
    const s = this.state!;
    return Math.ceil((this.stats.fuelCapacity - s.ship.fuel) * FUEL_PRICE);
  }

  repairCost(): number {
    const s = this.state!;
    return Math.ceil((this.stats.maxHull - s.ship.hull) * REPAIR_PRICE);
  }

  refuel(): string | null {
    const s = this.state!;
    const cost = this.refuelCost();
    if (cost <= 0) return 'Tanks are already full.';
    if (s.coins < cost) {
      // Partial refuel with what you can afford.
      const units = Math.floor(s.coins / FUEL_PRICE);
      if (units <= 0) return 'Not enough coin.';
      s.coins -= units * FUEL_PRICE;
      s.ship.fuel += units;
    } else {
      s.coins -= cost;
      s.ship.fuel = this.stats.fuelCapacity;
    }
    this.audio.coin();
    return null;
  }

  repair(): string | null {
    const s = this.state!;
    const cost = this.repairCost();
    if (cost <= 0) return 'The hull is sound.';
    if (s.coins < cost) {
      const units = Math.floor(s.coins / REPAIR_PRICE);
      if (units <= 0) return 'Not enough coin.';
      s.coins -= Math.ceil(units * REPAIR_PRICE);
      s.ship.hull += units;
    } else {
      s.coins -= cost;
      s.ship.hull = this.stats.maxHull;
    }
    this.audio.coin();
    return null;
  }

  // ------------------------------------------------------------------ docking

  canDock(): PortId | null {
    const s = this.state;
    if (!s || this.mode !== 'play' || this.dockAnim) return null;
    const speed = Math.hypot(s.ship.vx, s.ship.vz);
    if (speed >= 34) return null;
    for (const p of PORTS) {
      const b = berthPosition(p);
      if (dist3(s.ship.x, s.ship.y, s.ship.z, b.x, b.y, b.z) < DOCK_RANGE) return p.id;
    }
    return null;
  }

  dock(port: PortId): void {
    const s = this.state!;
    const b = berthPosition(PORT_BY_ID[port]);
    this.dockAnim = { t: 0, from: { x: s.ship.x, y: s.ship.y, z: s.ship.z, h: s.ship.heading }, to: b };
    s.ship.throttle = 0;
    this.audio.dock();
  }

  private completeDock(port: PortId): void {
    const s = this.state!;
    s.docked = port;
    s.lastPort = port;
    s.ship.vx = s.ship.vy = s.ship.vz = 0;
    s.ship.yawRate = 0;
    this.mode = 'docked';
    if (!s.discoveredPorts.includes(port)) s.discoveredPorts.push(port);
    // Contracts.
    const payouts = resolveOnDock(s.contracts, port);
    for (const p of payouts) {
      s.coins += p.reward;
      s.reputation += 3;
      s.stats.contractsDone++;
      this.ui.toast(`Contract complete: ${p.contract.title} (+${p.reward} coin)`, 'good', 6000);
      addJournal(s, `Completed contract: ${p.contract.title} for ${p.reward} coin.`, 'contract');
      this.audio.fanfare();
      this.removeEscort(p.contract.id);
    }
    refreshOffers(s.contracts, this.world, port, dayOf(s.time), s.time);
    // Pirates lose interest at port.
    for (const n of this.npcs) if (n.role === 'flagship' && n.state !== 'sinking') this.removeNpc(n.id);
    this.syncMarkers();
    this.ui.showPort(port);
    this.ui.syncPause();
    this.storyEvent({ type: 'dock', port });
    this.autosave();
  }

  undock(): void {
    const s = this.state;
    if (!s || !s.docked) return;
    const p = PORT_BY_ID[s.docked];
    const a = approachPosition(p);
    const b = berthPosition(p);
    // Push off from the berth, facing away from the island.
    s.ship.x = lerp(b.x, a.x, 0.35);
    s.ship.z = lerp(b.z, a.z, 0.35);
    s.ship.y = b.y + 2;
    s.ship.heading = Math.atan2(-(a.x - p.x), -(a.z - p.z));
    s.ship.throttle = 0.25;
    s.docked = null;
    this.mode = 'play';
    this.chase.snap();
    this.ui.hidePort();
    this.ui.syncPause();
    // Escorts depart with you.
    for (const n of this.npcs) if (n.role === 'merchant' && n.state === 'travel') n.reload = 0;
    this.audio.whoosh();
    this.autosave();
  }

  // ------------------------------------------------------------------ story

  private storyEvent(ev: StoryEvent): void {
    const s = this.state!;
    const done = advanceStory(s.story, ev);
    if (!done) return;
    const idx = STORY.indexOf(done);
    if (done.reward) s.coins += done.reward;
    addJournal(s, `Main quest — ${done.title}: complete.`, 'story');
    this.audio.fanfare();
    if (idx === 3) {
      const o = LANDMARK_BY_ID.observatory;
      s.fog.reveal(o.x, o.z, 650);
      if (!s.discoveredLandmarks.includes('observatory')) s.discoveredLandmarks.push('observatory');
    }
    if (idx === 4) this.flagshipTimer = 4;
    if (idx === 5) s.story.flags.lens = true;
    if (idx === 6) {
      const m = LANDMARK_BY_ID.meridian;
      s.fog.reveal(m.x, m.z, 900);
      if (!s.discoveredLandmarks.includes('meridian')) s.discoveredLandmarks.push('meridian');
    }
    const finale = s.story.complete;
    if (finale) {
      s.unlockedPaints.push('guild');
      this.islands.setHallLit(true);
      this.audio.setMood('finale');
    }
    this.paused = true;
    this.ui.dialog(done.outro.speaker, done.outro.lines, done.reward ?? 0, () => {
      this.paused = false;
      if (finale) this.ui.showEnding();
      else this.ui.toast(`New objective: ${STORY[s.story.step].title}`, 'info', 6000);
    });
  }

  // ------------------------------------------------------------------ escorts & npcs

  private spawnEscort(c: Contract, atPort: boolean): void {
    const s = this.state!;
    if (!c.to) return;
    const from = PORT_BY_ID[c.from];
    const start = atPort ? approachPosition(from) : { x: s.ship.x + 60, y: s.ship.y, z: s.ship.z + 60 };
    const dest = approachPosition(PORT_BY_ID[c.to]);
    const n = makeMerchant(this.nextNpcId++, start.x, start.y + 10, start.z, dest, c.id);
    this.npcs.push(n);
    this.addNpcModel(n);
  }

  private respawnEscorts(): void {
    const s = this.state!;
    for (const c of s.contracts.active) {
      if (c.kind === 'escort' && c.status === 'active' && !this.npcs.some((n) => n.contractId === c.id)) this.spawnEscort(c, !!s.docked && s.docked === c.from);
    }
  }

  private removeEscort(contractId: string): void {
    for (const n of this.npcs) if (n.contractId === contractId) this.removeNpc(n.id);
  }

  private addNpcModel(n: Npc): void {
    const paint = n.role === 'flagship' ? FLAGSHIP_PAINT : n.role === 'pirate' ? PIRATE_PAINT : MERCHANT_PAINT;
    const lvl = n.role === 'flagship' ? 3 : n.role === 'pirate' ? 1 : 0;
    const model = new ShipModel(
      {
        paint,
        upgrades: { hull: lvl, engine: lvl, cargo: n.role === 'merchant' ? 3 : 0, lantern: 1, cannons: n.role === 'merchant' ? 0 : n.cannons - 1, tank: 1 },
        scale: n.role === 'flagship' ? 1.45 : 1,
      },
      false,
    );
    this.renderer.scene.add(model.root);
    this.npcModels.set(n.id, model);
  }

  private removeNpcModel(id: number): void {
    const m = this.npcModels.get(id);
    if (m) {
      this.renderer.scene.remove(m.root);
      m.dispose();
      this.npcModels.delete(id);
    }
  }

  private removeNpc(id: number): void {
    this.npcs = this.npcs.filter((n) => n.id !== id);
    this.removeNpcModel(id);
  }

  private spawnPirates(count: number, flagship = false): void {
    const s = this.state!;
    for (let i = 0; i < count; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = flagship && i === 0 ? 650 : this.rng.range(650, 850);
      const p = makePirate(this.nextNpcId++, s.ship.x + Math.cos(a) * d, Math.max(40, s.ship.y + this.rng.range(-30, 40)), s.ship.z + Math.sin(a) * d, this.rng, flagship && i === 0);
      p.state = 'chase';
      this.npcs.push(p);
      this.addNpcModel(p);
    }
    if (flagship) this.ui.toast('The Black Gannet rises from the clouds! Sink the corsair flagship.', 'bad', 7000);
    else this.ui.toast('Corsair sails spotted! Fight with ' + this.ui.keyFor('firePort') + ' / ' + this.ui.keyFor('fireStarboard') + ', or outrun them.', 'bad', 5000);
  }

  // ------------------------------------------------------------------ markers

  /** Keep world markers in sync with fragments, salvage contracts and loot. */
  syncMarkers(): void {
    const s = this.state;
    if (!s) return;
    const want = new Set<string>();
    for (const f of FRAGMENTS) {
      if (s.fragments.includes(f.id)) continue;
      want.add('frag:' + f.id);
      this.fx.addMarker('frag:' + f.id, 'fragment', f.x, f.y, f.z);
    }
    for (const c of s.contracts.active) {
      if (c.kind === 'salvage' && c.status === 'active' && c.target) {
        want.add('salv:' + c.id);
        this.fx.addMarker('salv:' + c.id, 'salvage', c.target.x, c.target.y, c.target.z);
      }
    }
    for (const l of this.loot) want.add(l.id);
    for (const id of this.fx.markerIds()) if (!want.has(id)) this.fx.removeMarker(id);
  }

  // ------------------------------------------------------------------ frame

  private frame(now: number): void {
    const cpuStart = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      this.fps = this.frameCount / this.fpsTime;
      this.frameCount = 0;
      this.fpsTime = 0;
    }
    const pad = this.input.pollGamepad();
    this.handleGlobalKeys();
    const s = this.state;
    if (this.settle > 0) this.settle -= dt;
    else if (s && !this.paused && (this.mode === 'play' || this.mode === 'docked')) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 6) {
        this.simulate(STEP, pad);
        this.acc -= STEP;
        steps++;
      }
      if (steps === 6) this.acc = 0;
    }
    this.updateVisuals(dt, pad);
    this.updateMs = this.updateMs * 0.9 + (performance.now() - cpuStart) * 0.1;
    this.renderer.render();
    // The DOM HUD refreshes at ~30 Hz; the 3D view runs at full rate.
    if (s && this.frameCount % 2 === 0) this.ui.updateHud(this.hudData());
    this.ui.updateFps(this.settings.showFps ? this.fps : null);
  }

  private handleGlobalKeys(): void {
    const inp = this.input;
    if (this.mode === 'title') {
      inp.clearPressed();
      return;
    }
    if (inp.consume('pause')) this.ui.togglePause();
    if (this.ui.blockingOpen()) {
      // Allow map/journal keys to close their own screens.
      if (inp.consume('map')) this.ui.toggleMap();
      if (inp.consume('journal')) this.ui.toggleJournal();
      inp.clearPressed();
      return;
    }
    if (inp.consume('map')) this.ui.toggleMap();
    if (inp.consume('journal')) this.ui.toggleJournal();
  }

  /**
   * First-voyage hints: one-off nudges keyed off what the player has done so
   * far. Each fires once per save (stored as story flags, so old saves load).
   */
  private hintTimer = 0;
  private tickHints(dt: number): void {
    const s = this.state!;
    this.hintTimer -= dt;
    if (this.hintTimer > 0 || s.playTime > 1800) return;
    this.hintTimer = 1;
    const once = (id: string, when: boolean, text: string, ms = 9000): boolean => {
      const key = `hint_${id}`;
      if (!when || s.story.flags[key]) return false;
      s.story.flags[key] = true;
      this.ui.toast(text, 'info', ms);
      return true;
    };
    const k = (a: Parameters<UI['keyFor']>[0]) => this.ui.keyFor(a);
    const play = this.mode === 'play';
    const cargo = GOOD_IDS.reduce((n, g) => n + s.cargo[g], 0);
    const docked = this.mode === 'docked';
    if (once('compass', play && s.playTime > 8 && s.story.step === 0, `Follow the gold ◆ on your compass to the Skyharbor docks. Slow down near the berth and press ${k('interact')} to dock.`)) return;
    if (once('market', docked && s.stats.goodsTraded === 0, 'Welcome to port! The Market tab shows a gossip tip for a profitable short hop. Buy low here, sell high there.')) return;
    if (once('map', play && cargo > 0 && s.playTime > 20, `Hauling cargo? Press ${k('map')} for the chart — ports you have heard of are marked. Fly to one and sell.`)) return;
    if (once('fuel', play && s.ship.fuel < this.stats.fuelCapacity * 0.35, 'Aether running low. Throttle and climbing burn it; refuel in any port’s Harbor tab.')) return;
    if (once('hull', play && s.ship.hull < this.stats.maxHull * 0.6, 'Hull damaged. Repair in any port’s Harbor tab, or flee to a port: corsairs give up near harbours.')) return;
    if (once('upgrade', docked && s.coins >= 300 && s.stats.goodsTraded > 0, 'You can afford an upgrade. The Shipwright tab fits bigger holds, engines, armour and guns.')) return;
    if (once('contracts', docked && s.stats.goodsTraded >= 6 && s.contracts.active.length === 0, 'The Contracts tab has paid jobs: deliveries, escorts and salvage. They pay well on top of trading.')) return;
  }

  private simulate(dt: number, pad: ReturnType<Input['pollGamepad']>): void {
    const s = this.state!;
    this.tickHints(dt);
    // Clock, weather, markets.
    s.time += dt * HOURS_PER_SECOND;
    s.playTime += dt;
    const weatherChanged = stepWeather(s.weather, this.rng, dt * HOURS_PER_SECOND);
    if (weatherChanged && s.weather.kind === 'storm' && this.mode === 'play') this.ui.toast('A storm is brewing. Lightning may strike nearby ships.', 'bad', 5000);
    while (s.time - s.marketHour >= 1) {
      s.marketHour += 1;
      const events = driftMarkets(s.markets, this.rng, 1);
      for (const e of events) {
        if (s.discoveredPorts.includes(e.port) && this.rng.chance(0.5)) {
          addJournal(s, `Rumour: ${e.kind === 'shortage' ? 'a shortage of' : 'a glut of'} ${GOOD_BY_ID[e.good].name} at ${PORT_BY_ID[e.port].name}.`, 'trade');
        }
      }
    }
    if (this.mode === 'docked') {
      if (s.docked && dayOf(s.time) !== s.contracts.offersDay[s.docked]) {
        refreshOffers(s.contracts, this.world, s.docked, dayOf(s.time), s.time);
        this.ui.refreshPort();
      }
      this.stepNpcs(dt);
      return;
    }

    // Docking animation.
    if (this.dockAnim) {
      const a = this.dockAnim;
      a.t += dt / 1.6;
      const k = a.t * a.t * (3 - 2 * Math.min(a.t, 1));
      s.ship.x = lerp(a.from.x, a.to.x, Math.min(k, 1));
      s.ship.y = lerp(a.from.y, a.to.y, Math.min(k, 1));
      s.ship.z = lerp(a.from.z, a.to.z, Math.min(k, 1));
      s.ship.heading = dampAngle(s.ship.heading, a.to.heading, 4, dt);
      s.ship.roll = damp(s.ship.roll, 0, 3, dt);
      s.ship.pitch = damp(s.ship.pitch, 0, 3, dt);
      if (a.t >= 1) {
        this.dockAnim = null;
        this.completeDock(this.nearPort?.id ?? s.lastPort);
      }
      return;
    }

    // Flight.
    const input = this.input.flight(pad);
    this.lastInput = input;
    const storm = localStorm(s.weather, s.ship.x, s.ship.z);
    let windStrength = lerp(WEATHER_WIND[s.weather.kind], 18, stormWallAt(s.ship.x, s.ship.z));
    windStrength = Math.max(windStrength, WEATHER_WIND[s.weather.kind]);
    const w = this.wind.at(s.ship.x, s.ship.z, s.time, windStrength);
    // The storm wall around the Meridian shoves ships away unless the lens is trued.
    const wall = stormWallAt(s.ship.x, s.ship.z);
    if (wall > 0) {
      const m = LANDMARK_BY_ID.meridian;
      const dx = s.ship.x - m.x;
      const dz = s.ship.z - m.z;
      const d = Math.hypot(dx, dz) || 1;
      const push = (s.story.flags.lens ? 9 : 34) * wall;
      w.x += (dx / d) * push;
      w.z += (dz / d) * push;
    }
    this.windNow = w;
    this.currentNow = this.wind.currentStrength(s.ship.x, s.ship.z);
    const prevX = s.ship.x;
    const prevZ = s.ship.z;
    const ev = stepFlight(s.ship, input, this.stats, { windX: w.x, windZ: w.z, updraft: this.world.updraft(s.ship.x, s.ship.y, s.ship.z), collide: (x, y, z, r) => this.world.collide(x, y, z, r) }, dt);
    s.stats.distance += Math.hypot(s.ship.x - prevX, s.ship.z - prevZ);
    if (ev.impact > 7) {
      this.audio.bump(ev.impact);
      this.chase.addShake(Math.min(2, ev.impact / 12));
      this.damageFlash = Math.min(1, this.damageFlash + ev.damage / 25);
    }
    if (ev.undercloud && this.fxRng.chance(0.02)) this.ui.toast('The Undercloud crushes your hull! Climb!', 'bad', 2500);
    if (ev.outOfFuel && !this.outOfFuelWarned) {
      this.outOfFuelWarned = true;
      this.ui.toast('Out of aether! Running on emergency sails. Find a port to refuel.', 'bad', 7000);
    }
    if (s.ship.fuel > 5) this.outOfFuelWarned = false;
    if (s.ship.hull < this.stats.maxHull * 0.25 && !this.lowHullWarned) {
      this.lowHullWarned = true;
      this.ui.toast('Hull critical! Repair at a port.', 'bad', 5000);
    }
    if (s.ship.hull > this.stats.maxHull * 0.4) this.lowHullWarned = false;

    // Lightning in storms.
    if (storm > 0.45 && this.fxRng.chance(storm * 0.5 * dt)) this.lightningStrike(storm);

    // Cannons.
    this.reload.port -= dt;
    this.reload.starboard -= dt;
    if (this.input.enabled) {
      if (this.input.consume('firePort')) this.playerFire(-1);
      if (this.input.consume('fireStarboard')) this.playerFire(1);
    }
    if (this.input.consume('interact')) {
      const port = this.canDock();
      if (port) {
        this.nearPort = { id: port, dist: 0 };
        this.dock(port);
      }
    }

    // Discovery and charting.
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.4;
      s.fog.reveal(s.ship.x, s.ship.z, 240 + this.stats.lanternRange);
    }
    let nearest: { id: PortId; dist: number } | null = null;
    for (const p of PORTS) {
      const d = dist2(p.x, p.z, s.ship.x, s.ship.z);
      if (!nearest || d < nearest.dist) nearest = { id: p.id, dist: d };
      if (d < 700 && !s.discoveredPorts.includes(p.id)) {
        s.discoveredPorts.push(p.id);
        this.ui.toast(`Discovered ${p.name}!`, 'good', 5000);
        addJournal(s, `Charted the port of ${p.name}. ${p.blurb}`, 'discovery');
        this.audio.pickup();
      }
    }
    this.nearPort = nearest;
    for (const [id, l] of Object.entries(LANDMARK_BY_ID)) {
      const d = dist2(l.x, l.z, s.ship.x, s.ship.z);
      if (d < l.radius + 220 && !s.discoveredLandmarks.includes(id)) {
        s.discoveredLandmarks.push(id);
        this.ui.toast(`Discovered ${l.name}`, 'good', 5000);
        addJournal(s, `Found ${l.name}.`, 'discovery');
      }
    }
    // Story reach objectives.
    const step = STORY[s.story.step];
    if (!s.story.complete && step.objective.type === 'reach') {
      const l = LANDMARK_BY_ID[step.objective.landmark];
      if (dist3(l.x, l.y + 20, l.z, s.ship.x, s.ship.y, s.ship.z) < step.objective.radius + 40) this.storyEvent({ type: 'reach', landmark: l.id });
    }
    // Map fragments.
    for (const f of FRAGMENTS) {
      if (s.fragments.includes(f.id)) continue;
      if (dist3(f.x, f.y, f.z, s.ship.x, s.ship.y, s.ship.z) < 26) {
        s.fragments.push(f.id);
        s.fog.reveal(f.x, f.z, 650);
        this.fx.sparkle(f.x, f.y, f.z, 0xffd77a);
        this.fx.removeMarker('frag:' + f.id);
        this.audio.pickup();
        this.ui.toast(`Compass-rose shard recovered (${s.fragments.length}/${FRAGMENTS.length}). The chart around it fills in.`, 'good', 6000);
        addJournal(s, `Recovered a compass-rose shard (${s.fragments.length}/${FRAGMENTS.length}).`, 'discovery');
        s.coins += 50;
        this.storyEvent({ type: 'fragment', total: s.fragments.length });
      }
    }
    // Contracts.
    const changed = updateContracts(s.contracts, s.time, s.ship.x, s.ship.y, s.ship.z);
    for (const c of changed) {
      if (c.status === 'failed') {
        this.ui.toast(`Contract failed: ${c.title}`, 'bad', 5000);
        addJournal(s, `Failed contract: ${c.title}.`, 'contract');
        s.reputation = Math.max(0, s.reputation - 3);
      } else if (c.status === 'ready') {
        if (c.kind === 'salvage' && c.target) this.fx.sparkle(c.target.x, c.target.y, c.target.z, 0x8affc0);
        this.audio.pickup();
        this.ui.toast(c.kind === 'salvage' ? 'Salvage recovered! Report to any port for payment.' : 'You found the lost ruin! Report to any port for payment.', 'good', 6000);
      }
    }
    if (changed.length) this.syncMarkers();

    // Pirates.
    this.spawnTimer -= dt;
    const safe = (nearest?.dist ?? 1e9) < 650;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 18;
      const hostile = this.npcs.filter((n) => n.role !== 'merchant' && n.state !== 'sinking').length;
      const biome = this.world.biomeAt(s.ship.x, s.ship.z);
      const fromHome = Math.hypot(s.ship.x, s.ship.z);
      const danger = BIOMES[biome].danger * clamp(fromHome / 3000, 0.2, 1.4);
      if (!safe && hostile < 3 && (nearest?.dist ?? 0) > 900 && this.rng.chance(danger * 0.35)) this.spawnPirates(this.rng.int(1, danger > 0.6 ? 2 : 1));
    }
    if (!s.story.complete && STORY[s.story.step].objective.type === 'flagship' && !this.npcs.some((n) => n.role === 'flagship')) {
      this.flagshipTimer -= dt;
      if (this.flagshipTimer <= 0 && (nearest?.dist ?? 0) > 500) {
        this.flagshipTimer = 25;
        this.spawnPirates(3, true);
      }
    }
    this.stepNpcs(dt);

    // Cannonballs and hits.
    const targets: Target[] = [{ x: s.ship.x, y: s.ship.y, z: s.ship.z, id: PLAYER_ID, team: 'player' }];
    for (const n of this.npcs) if (n.state !== 'sinking') targets.push({ x: n.x, y: n.y, z: n.z, id: n.id, team: n.role === 'merchant' ? 'player' : 'enemy', r: n.role === 'flagship' ? 19 : undefined });
    const hits = stepBalls(this.balls, targets, dt);
    for (const h of hits) this.onHit(h.targetId, h.ball.damage, h.ball);
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.y < 0 || this.world.collide(b.x, b.y, b.z, 1)) {
        if (b.y < 0) this.fx.splash(b.x, 2, b.z);
        else this.fx.explosion(b.x, b.y, b.z);
        this.balls.splice(i, 1);
      }
    }
    // Loot pickup.
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      if (dist3(l.x, l.y, l.z, s.ship.x, s.ship.y, s.ship.z) < 24) {
        s.coins += l.coins;
        let text = `Salvaged ${l.coins} coin`;
        if (l.good) {
          const space = Math.floor(this.freeSlots() / GOOD_BY_ID[l.good].weight);
          const q = Math.min(space, l.qty);
          if (q > 0) {
            s.cargo[l.good] += q;
            text += ` and ${q} ${GOOD_BY_ID[l.good].name}`;
          }
        }
        this.ui.toast(text + '.', 'good', 4000);
        this.audio.coin();
        this.fx.removeMarker(l.id);
        this.loot.splice(i, 1);
      }
    }

    // Ship lost.
    if (s.ship.hull <= 0) this.shipwreck();

    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = 60;
      this.autosave();
    }
  }

  /** Terrain probe for NPC look-ahead avoidance (16-unit hull margin). */
  private readonly npcBlocked = (x: number, y: number, z: number): boolean => !!this.world.collide(x, y, z, 16);

  private stepNpcs(dt: number): void {
    const s = this.state!;
    const safe = (this.nearPort?.dist ?? 1e9) < 650 || this.mode === 'docked';
    for (const n of [...this.npcs]) {
      if (n.role === 'merchant') {
        const contract = s.contracts.active.find((c) => c.id === n.contractId);
        if (!contract) {
          this.removeNpc(n.id);
          continue;
        }
        const d = dist2(n.x, n.z, s.ship.x, s.ship.z);
        // Merchants wait for you if you fall behind, and stay put while you are docked.
        const savedSpeed = n.speed;
        if (this.mode === 'docked' || d > 420) n.speed = 0.01;
        const arrived = stepMerchant(n, dt, this.npcBlocked);
        n.speed = savedSpeed;
        if (n.state === 'sinking') {
          if (n.sinkTime > 8) this.removeNpc(n.id);
          continue;
        }
        if (arrived && contract.status === 'active') {
          contract.status = 'ready';
          this.ui.toast(`The escort reached ${PORT_BY_ID[contract.to!].name}. Dock there to collect your fee.`, 'good', 6000);
        }
        if (this.mode === 'play') {
          if (d > 900) {
            this.escortAway += dt;
            if (this.escortAway > 25) {
              failContract(s.contracts, contract.id);
              this.ui.toast('You abandoned your escort. Contract failed.', 'bad', 5000);
              this.removeNpc(n.id);
              this.escortAway = 0;
            }
          } else this.escortAway = 0;
          // Ambush halfway.
          const from = PORT_BY_ID[contract.from];
          const to = PORT_BY_ID[contract.to!];
          const total = dist2(from.x, from.z, to.x, to.z);
          const done = dist2(from.x, from.z, n.x, n.z);
          if (done > total * 0.4 && !this.escortAmbushed.has(contract.id)) {
            this.escortAmbushed.add(contract.id);
            this.spawnPirates(2);
          }
        }
        continue;
      }
      // Pirates target the nearest friendly: the player or an escort.
      let tx = s.ship.x;
      let ty = s.ship.y;
      let tz = s.ship.z;
      const merchant = this.npcs.find((m) => m.role === 'merchant' && m.state !== 'sinking');
      if (merchant && dist2(n.x, n.z, merchant.x, merchant.z) < dist2(n.x, n.z, s.ship.x, s.ship.z) * 0.7) {
        tx = merchant.x;
        ty = merchant.y;
        tz = merchant.z;
      }
      const fire = stepPirate(n, tx, ty, tz, safe, dt, this.rng, this.npcBlocked);
      // Last-resort push-out; look-ahead steering should keep NPCs clear.
      const c = this.world.collide(n.x, n.y, n.z, 9);
      if (c) {
        n.x += c.nx * c.depth;
        n.y += c.ny * c.depth + (c.ny === 0 ? 0.5 : 0);
        n.z += c.nz * c.depth;
      }
      if (fire && this.mode === 'play') {
        const balls = fireBroadside(n.x, n.y, n.z, n.vx, n.vz, n.heading, fire.side, n.cannons, n.damage, 'enemy', this.rng);
        this.balls.push(...balls);
        const r = rightOf(n.heading);
        this.fx.muzzle(n.x + r.x * fire.side * 6, n.y - 1, n.z + r.z * fire.side * 6, r.x * fire.side, r.z * fire.side);
        this.audio.cannon(dist2(n.x, n.z, s.ship.x, s.ship.z));
      }
      const far = dist2(n.x, n.z, s.ship.x, s.ship.z);
      if ((n.state === 'sinking' && (n.sinkTime > 9 || n.y < -60)) || (far > 1800 && n.role !== 'flagship') || (n.state === 'flee' && far > 1000)) this.removeNpc(n.id);
    }
  }

  private playerFire(side: number): void {
    const s = this.state!;
    const key = side < 0 ? 'port' : 'starboard';
    if (this.reload[key] > 0) return;
    this.reload[key] = this.stats.reload;
    const balls = fireBroadside(s.ship.x, s.ship.y, s.ship.z, s.ship.vx, s.ship.vz, s.ship.heading, side, this.stats.cannonsPerSide, this.stats.cannonDamage, 'player', this.rng);
    this.balls.push(...balls);
    const r = rightOf(s.ship.heading);
    const f = forwardOf(s.ship.heading);
    for (const m of this.ship.muzzles) {
      if (m.side !== side) continue;
      const wx = s.ship.x + r.x * m.pos.x + f.x * -m.pos.z;
      const wz = s.ship.z + r.z * m.pos.x + f.z * -m.pos.z;
      this.fx.muzzle(wx, s.ship.y + m.pos.y, wz, r.x * side, r.z * side);
    }
    this.audio.cannon(0);
    this.chase.addShake(0.4);
    s.ship.vx -= r.x * side * 2;
    s.ship.vz -= r.z * side * 2;
  }

  private onHit(targetId: number, damage: number, ball: Cannonball): void {
    const s = this.state!;
    this.fx.explosion(ball.x, ball.y, ball.z);
    if (targetId === PLAYER_ID) {
      const dmg = damage * (1 - this.stats.armor);
      s.ship.hull = Math.max(0, s.ship.hull - dmg);
      this.audio.hit();
      this.chase.addShake(0.9);
      this.damageFlash = Math.min(1, this.damageFlash + 0.35);
      return;
    }
    const n = this.npcs.find((x) => x.id === targetId);
    if (!n) return;
    if (n.role === 'merchant' && ball.owner === 'player') return;
    this.audio.hit();
    const sunk = applyDamage(n, damage);
    if (sunk) {
      this.fx.explosion(n.x, n.y, n.z, true);
      this.audio.explosion();
      if (n.role === 'merchant') {
        const c = n.contractId ? failContract(s.contracts, n.contractId) : null;
        if (c) this.ui.toast('Your escort was sunk. Contract failed.', 'bad', 5000);
        return;
      }
      s.stats.piratesSunk++;
      s.reputation += 1;
      const good = this.rng.pick(GOOD_IDS);
      const l: Loot = { id: 'loot:' + n.id, x: n.x, y: Math.max(20, n.y), z: n.z, coins: Math.round(this.rng.range(40, 140) * (n.role === 'flagship' ? 5 : 1)), good, qty: this.rng.int(1, 4) };
      this.loot.push(l);
      this.fx.addMarker(l.id, 'loot', l.x, l.y, l.z);
      addJournal(s, n.role === 'flagship' ? 'Sank the corsair flagship Black Gannet.' : 'Sank a Gullwake corsair.', 'combat');
      this.ui.toast(n.role === 'flagship' ? 'The Black Gannet is going down!' : 'Corsair sunk! Collect the floating loot.', 'good', 4000);
      if (n.role === 'flagship') this.storyEvent({ type: 'flagship' });
    }
  }

  private lightningStrike(storm: number): void {
    const s = this.state!;
    const a = this.fxRng.range(0, Math.PI * 2);
    const near = this.fxRng.chance(0.18 * storm);
    const d = near ? this.fxRng.range(0, 40) : this.fxRng.range(150, 700);
    const x = s.ship.x + Math.cos(a) * d;
    const z = s.ship.z + Math.sin(a) * d;
    this.fx.lightning(x, z, s.ship.y + 500, Math.max(0, s.ship.y - 200));
    this.flash = 1;
    this.audio.thunder(d);
    if (near) {
      const dmg = 9 * (1 - this.stats.armor);
      s.ship.hull = Math.max(0, s.ship.hull - dmg);
      s.ship.vx += Math.cos(a + Math.PI) * 22;
      s.ship.vz += Math.sin(a + Math.PI) * 22;
      s.ship.vy += this.fxRng.range(-10, 10);
      this.chase.addShake(2);
      this.damageFlash = Math.min(1, this.damageFlash + 0.5);
      this.ui.toast('Lightning strike!', 'bad', 2000);
    }
  }

  private shipwreck(): void {
    const s = this.state!;
    this.fx.explosion(s.ship.x, s.ship.y, s.ship.z, true);
    this.audio.explosion();
    const lostCoins = Math.round(s.coins * 0.15);
    s.coins -= lostCoins;
    for (const g of GOOD_IDS) {
      s.cargo[g] = 0;
      s.cargoCost[g] = 0;
    }
    for (const c of [...s.contracts.active]) if (c.kind === 'delivery' || c.kind === 'escort') failContract(s.contracts, c.id);
    for (const n of [...this.npcs]) this.removeNpc(n.id);
    this.balls = [];
    s.ship.hull = this.stats.maxHull * 0.5;
    s.ship.fuel = Math.max(s.ship.fuel, this.stats.fuelCapacity * 0.5);
    const port = s.lastPort;
    addJournal(s, `The ${s.shipName} was wrecked and towed back to ${PORT_BY_ID[port].name}.`, 'combat');
    this.ui.toast(`Your ship was wrecked! A tug hauled you back to ${PORT_BY_ID[port].name}. Lost all cargo and ${lostCoins} coin.`, 'bad', 8000);
    const b = berthPosition(PORT_BY_ID[port]);
    Object.assign(s.ship, { x: b.x, y: b.y, z: b.z, heading: b.heading, vx: 0, vy: 0, vz: 0, throttle: 0 });
    this.nearPort = { id: port, dist: 0 };
    this.chase.snap();
    this.syncMarkers();
    this.completeDock(port);
    this.arrive();
  }

  // ------------------------------------------------------------------ visuals

  private updateVisuals(dt: number, pad: ReturnType<Input['pollGamepad']>): void {
    const s = this.state;
    const hour = s ? hourOf(s.time) : 16.5 + Math.sin(this.time * 0.02) * 0.5;
    const overcast = s ? s.weather.overcast : 0.1;
    const shipPos = this.tmpV;
    if (s) shipPos.set(s.ship.x, s.ship.y, s.ship.z);
    else {
      const h = PORT_BY_ID.skyharbor;
      shipPos.set(h.x, h.y + 70, h.z);
    }
    const storm = s ? localStorm(s.weather, s.ship.x, s.ship.z) : 0;
    this.flash = damp(this.flash, 0, 7, dt);
    this.damageFlash = damp(this.damageFlash, 0, 1.5, dt);

    // Camera.
    if (s && this.mode !== 'title') {
      const look = this.input.takeLook(pad, dt);
      if (!this.ui.blockingOpen() || this.mode === 'docked') {
        this.chase.orbit(look.dx, look.dy);
        if (look.zoom) this.chase.zoom(look.zoom);
      }
      const showcase = this.mode === 'docked' && (this.ui.portTab === 'shipwright' || this.ui.portTab === 'paint');
      this.chase.mode = this.mode === 'docked' && !this.dockAnim ? 'orbit' : 'chase';
      this.chase.orbitDistance = showcase ? 48 : 90;
      this.chase.orbitPitch = showcase ? 0.12 : 0.3;
      const speed = Math.hypot(s.ship.vx, s.ship.vz);
      this.chase.update(shipPos, s.ship.heading, speed, this.lastInput.boost && s.ship.fuel > 0, dt, this.world, this.time);
    } else {
      this.chase.mode = 'orbit';
      this.chase.orbitDistance = 380;
      this.chase.orbitPitch = 0.16;
      this.chase.update(shipPos, 0, 0, false, dt, null, this.time);
    }
    // While docked on wide screens, frame the ship in the space left of the port panel.
    const cam3 = this.chase.camera;
    const W = window.innerWidth;
    if (this.mode === 'docked' && W > 900) cam3.setViewOffset(W, window.innerHeight, Math.min(380, W * 0.28), 0, W, window.innerHeight);
    else if (cam3.view?.enabled) cam3.clearViewOffset();
    const cam = this.chase.camera.position;

    // Sky, light, fog.
    const info = this.sky.update(hour, Math.max(overcast, storm * 0.9), storm, cam, this.time, this.flash);
    const fog = this.renderer.scene.fog as THREE.Fog;
    fog.color.copy(info.horizon);
    const q = this.renderer.quality;
    const nightFar = lerp(q.far, q.far * 0.55 + this.stats.lanternRange * 1.5, info.night);
    fog.far = lerp(nightFar, nightFar * 0.45, storm);
    fog.near = lerp(380, 120, storm);
    const lit = new THREE.Color(0.97, 0.97, 0.97).multiplyScalar(lerp(1, 0.3, info.night) * (1 - storm * 0.5)).lerp(info.sunColor, 0.3 * (1 - info.night));
    const shadow = lit.clone().multiply(new THREE.Color(0.58, 0.64, 0.8)).lerp(info.horizon, 0.12);
    this.clouds.update(cam, this.time, this.windNow.x, this.windNow.z, lit, shadow, info.horizon, storm, dt);
    this.islands.update(cam, this.settle > 0 ? 24 : 4, this.time, info.horizon);
    updateStructures(this.time, info.night);
    this.birds.update(cam, this.time, info.night);
    this.whales.update(cam, this.time, info.night);

    // Smoke from forges.
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.25;
      for (const list of smokeEmitters.values()) for (const p of list) if (p.distanceTo(cam) < 1500) this.fx.smokePuff(p.x, p.y, p.z, 1.5, true);
    }

    // Player ship.
    if (s) {
      const bob = this.mode === 'docked' ? Math.sin(this.time * 1.2) * 0.4 : Math.sin(this.time * 1.6) * 0.25;
      this.ship.root.position.set(s.ship.x, s.ship.y + bob, s.ship.z);
      this.ship.root.rotation.set(s.ship.pitch, s.ship.heading, s.ship.roll, 'YXZ');
      this.ship.animate(dt, this.mode === 'docked' ? 0 : s.ship.throttle, info.night, s.ship.fuel / this.stats.fuelCapacity, this.time);
      if (this.mode === 'play') {
        const f = forwardOf(s.ship.heading);
        this.fx.exhaust(s.ship.x - f.x * 13, s.ship.y - 1.5, s.ship.z - f.z * 13, Math.abs(s.ship.throttle), this.lastInput.boost && s.ship.fuel > 0);
        if (s.ship.hull < this.stats.maxHull * 0.35 && this.fxRng.chance(0.3)) this.fx.smokePuff(s.ship.x, s.ship.y + 2, s.ship.z, 0.8, true);
      }
    }
    // NPC ships.
    for (const n of this.npcs) {
      const m = this.npcModels.get(n.id);
      if (!m) continue;
      m.root.position.set(n.x, n.y + Math.sin(this.time * 1.4 + n.id) * 0.3, n.z);
      const roll = n.state === 'sinking' ? Math.min(0.9, n.sinkTime * 0.15) : 0;
      m.root.rotation.set(n.state === 'sinking' ? -Math.min(0.5, n.sinkTime * 0.08) : 0, n.heading, roll, 'YXZ');
      m.animate(dt, n.state === 'sinking' ? 0 : 0.7, info.night, 1, this.time);
      if (n.state === 'sinking' && this.fxRng.chance(0.5)) this.fx.smokePuff(n.x, n.y + 6, n.z, 1.6, true);
    }

    // Effects.
    const fx = s ? s.ship : { x: cam.x, y: cam.y, z: cam.z };
    this.fx.update(dt, this.time, cam, this.balls, storm, this.windNow.x, this.windNow.z, this.currentNow, new THREE.Vector3(fx.x, fx.y, fx.z), info.night);
    this.renderer.setEffects(this.flash, this.damageFlash);

    // Audio.
    let mood: Mood = 'title';
    if (s) {
      const combat = this.npcs.some((n) => n.role !== 'merchant' && n.state === 'chase' && dist2(n.x, n.z, s.ship.x, s.ship.z) < 700);
      if (s.story.complete && this.ui.endingOpen()) mood = 'finale';
      else if (combat) mood = 'combat';
      else if (this.mode === 'docked') mood = 'port';
      else if (storm > 0.55) mood = 'storm';
      else if (info.night > 0.6) mood = 'night';
      else mood = 'day';
      this.audio.update({
        throttle: this.mode === 'docked' ? 0 : s.ship.throttle,
        speed: Math.hypot(s.ship.vx, s.ship.vz),
        altitude: s.ship.y,
        storm,
        nearPort: clamp(1 - ((this.nearPort?.dist ?? 9999) - 150) / 500, 0, 1) * (this.mode === 'docked' ? 1 : 0.7),
        docked: this.mode === 'docked',
        boost: this.lastInput.boost && s.ship.fuel > 0,
        whaleDist: this.whales.nearest,
        current: this.currentNow,
      });
    }
    this.audio.setMood(mood);
  }

  // ------------------------------------------------------------------ HUD data

  hudData() {
    const s = this.state!;
    const env = { windX: this.windNow.x, windZ: this.windNow.z, updraft: 0 };
    const target = this.trackedTarget();
    let marker: { x: number; y: number; visible: boolean; dist: number; label: string } | null = null;
    if (target) {
      const v = new THREE.Vector3(target.x, target.y + 20, target.z).project(this.chase.camera);
      const behind = v.z > 1;
      marker = { x: behind ? -v.x : v.x, y: behind ? -v.y : v.y, visible: !behind && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.9, dist: dist2(target.x, target.z, s.ship.x, s.ship.z), label: target.name };
    }
    const enemies = this.npcs
      .filter((n) => n.state !== 'sinking')
      .map((n) => ({ dx: n.x - s.ship.x, dz: n.z - s.ship.z, role: n.role, hp: n.hp / n.maxHp }));
    return {
      speed: airSpeed(s.ship, env),
      ground: Math.hypot(s.ship.vx, s.ship.vz),
      altitude: s.ship.y,
      heading: s.ship.heading,
      throttle: s.ship.throttle,
      fuel: s.ship.fuel / this.stats.fuelCapacity,
      fuelAbs: s.ship.fuel,
      hull: s.ship.hull / this.stats.maxHull,
      hullAbs: s.ship.hull,
      cargo: cargoUsed(s.cargo, reservedSlots(s.contracts)),
      capacity: this.stats.cargoCapacity,
      coins: s.coins,
      hour: hourOf(s.time),
      day: dayOf(s.time) + 1,
      weather: s.weather.kind,
      night: hourOf(s.time) < 5.5 || hourOf(s.time) > 19.5,
      windX: this.windNow.x,
      windZ: this.windNow.z,
      current: this.currentNow,
      reloadPort: Math.max(0, this.reload.port) / this.stats.reload,
      reloadStarboard: Math.max(0, this.reload.starboard) / this.stats.reload,
      dockPrompt: this.canDock(),
      marker,
      objective: s.story.complete ? 'Free sky: trade, explore, chart the world.' : STORY[s.story.step].title,
      enemies,
      boost: this.lastInput.boost && s.ship.fuel > 0,
      mode: this.mode,
      nearPortName: this.nearPort && this.nearPort.dist < 900 ? PORT_BY_ID[this.nearPort.id].name : null,
    };
  }

  /** The world target shown by the HUD marker: story first, else a contract. */
  trackedTarget(): { x: number; y: number; z: number; name: string } | null {
    const s = this.state!;
    const story = objectiveTarget(s.story);
    if (story) return story;
    const step = STORY[s.story.step];
    if (!s.story.complete && step.objective.type === 'fragments') {
      // Point at the nearest uncollected shard.
      let best: { x: number; y: number; z: number; name: string } | null = null;
      let bd = Infinity;
      for (const f of FRAGMENTS) {
        if (s.fragments.includes(f.id)) continue;
        const d = dist2(f.x, f.z, s.ship.x, s.ship.z);
        if (d < bd) {
          bd = d;
          best = { x: f.x, y: f.y - 20, z: f.z, name: 'Compass shard' };
        }
      }
      return best;
    }
    if (!s.story.complete && step.objective.type === 'flagship') {
      const f = this.npcs.find((n) => n.role === 'flagship' && n.state !== 'sinking');
      if (f) return { x: f.x, y: f.y - 20, z: f.z, name: 'Black Gannet' };
    }
    for (const c of s.contracts.active) {
      if (c.kind === 'salvage' && c.status === 'active' && c.target) return { ...c.target, name: 'Salvage' };
      if ((c.kind === 'delivery' || (c.kind === 'escort' && c.status === 'ready')) && c.to) {
        const p = PORT_BY_ID[c.to];
        const b = berthPosition(p);
        return { x: b.x, y: b.y, z: b.z, name: p.name };
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ test hooks

  private debugApi() {
    return {
      game: this,
      state: () => this.state,
      mode: () => this.mode,
      teleport: (x: number, y: number, z: number, heading?: number) => {
        const s = this.state;
        if (!s) return;
        Object.assign(s.ship, { x, y, z, vx: 0, vy: 0, vz: 0, throttle: 0 });
        if (heading !== undefined) s.ship.heading = heading;
        this.chase.snap();
        this.arrive();
      },
      /** Place the ship just off a port's berth, ready to dock. */
      approach: (port: PortId) => {
        const s = this.state;
        if (!s) return;
        const b = berthPosition(PORT_BY_ID[port]);
        const a = approachPosition(PORT_BY_ID[port]);
        Object.assign(s.ship, { x: lerp(b.x, a.x, 0.3), y: b.y + 4, z: lerp(b.z, a.z, 0.3), vx: 0, vy: 0, vz: 0, throttle: 0 });
        this.chase.snap();
      },
      fps: () => this.fps,
      info: () => ({ calls: this.renderer.renderer.info.render.calls, triangles: this.renderer.renderer.info.render.triangles, updateMs: this.updateMs, npcs: this.npcs.length }),
      spawnPirates: (n: number, flagship = false) => this.spawnPirates(n, flagship),
      fire: (side: number) => this.playerFire(side),
      setStep: (step: number) => {
        if (this.state) this.state.story.step = step;
      },
      collectShards: (n: number) => {
        const s = this.state;
        if (!s) return;
        for (const f of FRAGMENTS.slice(0, n)) {
          s.ship.x = f.x;
          s.ship.y = f.y;
          s.ship.z = f.z;
          this.simulate(STEP, null);
        }
      },
      islands: () => this.islands.loadedIslands,
      storyObjective: () => (this.state ? STORY[this.state.story.step].objective : null),
      landmark: (id: string) => LANDMARK_BY_ID[id],
      tradeTip: () => (this.state?.docked ? nearbyTrade(this.state.markets, this.state.docked) : null),
      seedHash: (s: string) => hashString(s),
    };
  }
}
