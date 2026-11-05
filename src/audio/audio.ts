/**
 * Fully procedural audio with WebAudio: an adaptive generative soundtrack,
 * engine hum tied to throttle, wind, rain, harbour ambience, whale song and
 * synthesised sound effects. No audio files are used anywhere.
 */
import { Rng } from '../core/rng';
import { clamp } from '../core/math';

export type Mood = 'title' | 'day' | 'night' | 'port' | 'combat' | 'storm' | 'finale';

interface MoodDef {
  root: number;
  scale: number[];
  progression: number[];
  bpm: number;
  barsPerChord: number;
  pluckDensity: number;
  drums: number;
  padBright: number;
}

const MOODS: Record<Mood, MoodDef> = {
  title: { root: 50, scale: [0, 2, 4, 6, 7, 9, 11], progression: [0, 4, 5, 3], bpm: 72, barsPerChord: 2, pluckDensity: 0.45, drums: 0, padBright: 0.6 },
  day: { root: 52, scale: [0, 2, 4, 6, 7, 9, 11], progression: [0, 3, 5, 4], bpm: 84, barsPerChord: 2, pluckDensity: 0.6, drums: 0.2, padBright: 0.7 },
  night: { root: 45, scale: [0, 2, 3, 5, 7, 9, 10], progression: [0, 5, 3, 6], bpm: 66, barsPerChord: 2, pluckDensity: 0.35, drums: 0, padBright: 0.35 },
  port: { root: 55, scale: [0, 2, 4, 5, 7, 9, 10], progression: [0, 3, 4, 0], bpm: 96, barsPerChord: 1, pluckDensity: 0.75, drums: 0.6, padBright: 0.6 },
  combat: { root: 45, scale: [0, 1, 3, 5, 7, 8, 10], progression: [0, 5, 6, 4], bpm: 132, barsPerChord: 1, pluckDensity: 0.85, drums: 1, padBright: 0.5 },
  storm: { root: 43, scale: [0, 2, 3, 5, 7, 8, 10], progression: [0, 5, 3, 4], bpm: 76, barsPerChord: 2, pluckDensity: 0.3, drums: 0.4, padBright: 0.25 },
  finale: { root: 50, scale: [0, 2, 4, 5, 7, 9, 11], progression: [0, 4, 5, 3, 0, 5, 3, 4], bpm: 70, barsPerChord: 1, pluckDensity: 0.55, drums: 0.15, padBright: 0.9 },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export interface AudioParams {
  throttle: number;
  speed: number;
  altitude: number;
  storm: number;
  nearPort: number;
  docked: boolean;
  boost: boolean;
  whaleDist: number;
  current: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private delay!: DelayNode;
  private noise!: AudioBuffer;
  private engineOsc: OscillatorNode[] = [];
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private chopGain!: GainNode;
  private chopLfo!: OscillatorNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private harborGain!: GainNode;
  private mood: Mood = 'title';
  private pendingMood: Mood = 'title';
  private nextBeat = 0;
  private beat = 0;
  private rng = new Rng(2024);
  private timer: number | null = null;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8 };
  private lastBell = 0;
  private lastGull = 0;
  private lastSong = 0;
  private padVoices: { osc: OscillatorNode[]; gain: GainNode }[] = [];

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(this.master);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus.connect(comp);
    this.sfxBus.connect(comp);
    this.ambBus.connect(comp);
    this.noise = this.makeNoise(2);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.8);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.55;
    this.reverb.connect(revGain).connect(comp);
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2400;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(this.reverb);
    dlp.connect(this.musicBus);
    this.buildEngine();
    this.buildAmbience();
    this.applyVolumes();
    this.nextBeat = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx * 0.9, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.volumes.sfx * 0.8, t, 0.05);
  }

  setMood(m: Mood): void {
    this.pendingMood = m;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  private noiseSource(loop = true): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.chopGain = ctx.createGain();
    this.chopGain.gain.value = 0.7;
    this.chopLfo = ctx.createOscillator();
    this.chopLfo.frequency.value = 6;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;
    this.chopLfo.connect(lfoDepth).connect(this.chopGain.gain);
    this.chopLfo.start();
    for (const [type, mul, g] of [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['triangle', 2.01, 0.25]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 45 * mul;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.engineFilter);
      o.start();
      this.engineOsc.push(o);
    }
    this.engineFilter.connect(this.chopGain).connect(this.engineGain).connect(this.ambBus);
  }

  private buildAmbience(): void {
    const ctx = this.ctx!;
    const wind = this.noiseSource();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.ambBus);
    wind.start();
    const rain = this.noiseSource();
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 2500;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rf).connect(this.rainGain).connect(this.ambBus);
    rain.start(0, 0.7);
    const water = this.noiseSource();
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 420;
    this.harborGain = ctx.createGain();
    this.harborGain.gain.value = 0;
    const lap = ctx.createOscillator();
    lap.frequency.value = 0.35;
    const lapG = ctx.createGain();
    lapG.gain.value = 0.04;
    lap.connect(lapG).connect(this.harborGain.gain);
    lap.start();
    water.connect(wf).connect(this.harborGain).connect(this.ambBus);
    water.start(0, 1.3);
  }

  /** Continuous sound parameters, called every frame. */
  update(p: AudioParams): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const th = Math.abs(p.throttle);
    const f = 38 + th * 46 + (p.boost ? 24 : 0);
    this.engineOsc.forEach((o, i) => o.frequency.setTargetAtTime(f * [1, 0.5, 2.01][i], t, 0.3));
    this.engineFilter.frequency.setTargetAtTime(220 + th * 900 + (p.boost ? 600 : 0), t, 0.3);
    this.engineGain.gain.setTargetAtTime(p.docked ? 0.01 : 0.05 + th * 0.09, t, 0.3);
    this.chopLfo.frequency.setTargetAtTime(3 + th * 16, t, 0.3);
    const windLevel = clamp(0.03 + (p.speed / 70) * 0.1 + p.storm * 0.18 + (p.altitude / 700) * 0.06 + p.current * 0.08, 0, 0.4);
    this.windGain.gain.setTargetAtTime(p.docked ? windLevel * 0.3 : windLevel, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(350 + p.speed * 9 + p.storm * 300, t, 0.5);
    this.rainGain.gain.setTargetAtTime(p.storm * 0.12, t, 1);
    this.harborGain.gain.setTargetAtTime(p.nearPort * 0.07, t, 1);
    if (p.nearPort > 0.3 && t - this.lastBell > 9 && this.rng.chance(0.01)) {
      this.lastBell = t;
      this.bell(midi(this.rng.pick([67, 72, 74, 79])), 0.08 * p.nearPort);
    }
    if (p.nearPort > 0.2 && t - this.lastGull > 4 && this.rng.chance(0.006)) {
      this.lastGull = t;
      this.gull(0.05 * p.nearPort);
    }
    if (p.whaleDist < 900 && t - this.lastSong > 14 && this.rng.chance(0.01)) {
      this.lastSong = t;
      this.whaleSong(clamp(1 - p.whaleDist / 900, 0.1, 1) * 0.12);
    }
  }

  // ---------- Music ----------
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextBeat < ctx.currentTime + 0.25) {
      this.playBeat(this.nextBeat);
      const def = MOODS[this.mood];
      this.nextBeat += 60 / def.bpm / 2; // eighth notes
    }
  }

  private playBeat(t: number): void {
    const eighth = this.beat % 8;
    if (eighth === 0 && this.pendingMood !== this.mood && (this.beat % 16 === 0 || this.pendingMood === 'combat')) {
      this.mood = this.pendingMood;
      this.beat = 0;
    }
    const def = MOODS[this.mood];
    const bar = Math.floor(this.beat / 8);
    const chordIdx = Math.floor(bar / def.barsPerChord) % def.progression.length;
    const degree = def.progression[chordIdx];
    const note = (deg: number, oct = 0) => {
      const s = def.scale;
      const idx = ((deg % s.length) + s.length) % s.length;
      const octave = Math.floor(deg / s.length);
      return def.root + s[idx] + 12 * (octave + oct);
    };
    const chord = [note(degree), note(degree + 2), note(degree + 4)];
    const spb = 60 / def.bpm;
    // Pad on chord change.
    if (eighth === 0 && bar % def.barsPerChord === 0) this.pad(chord, t, spb * 4 * def.barsPerChord, def.padBright);
    // Bass.
    if (eighth === 0 || (def.drums > 0.5 && eighth === 4)) this.bass(midi(chord[0] - 12), t, spb * 1.6);
    // Plucked arpeggio.
    if (this.rng.chance(def.pluckDensity * (eighth % 2 === 0 ? 1 : 0.6))) {
      const pick = this.rng.chance(0.75) ? this.rng.pick(chord) + 12 : note(degree + this.rng.int(0, 6), 1);
      this.pluck(midi(pick), t, 0.06);
    }
    // Occasional bell melody.
    if (eighth === 0 && this.rng.chance(0.3)) this.bell(midi(note(degree + this.rng.pick([0, 2, 4, 7]), 2)), 0.03, t);
    // Drums.
    if (def.drums > 0) {
      if (eighth === 0 || (def.drums > 0.8 && eighth === 3) || (def.drums > 0.5 && eighth === 6)) this.kick(t, 0.25 * def.drums);
      if (def.drums > 0.4 && eighth % 2 === 1) this.hat(t, 0.03 * def.drums);
      if (def.drums > 0.8 && eighth === 4) this.snare(t, 0.12);
    }
    this.beat++;
  }

  private pad(notes: number[], t: number, dur: number, bright: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 + bright * 1400;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0, t + dur + 0.6);
    const oscs: OscillatorNode[] = [];
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.7);
        oscs.push(o);
      }
    }
    lp.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverb);
    this.padVoices.push({ osc: oscs, gain: g });
    if (this.padVoices.length > 6) this.padVoices.shift();
  }

  private pluck(freq: number, t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.6);
    o.connect(g);
    g.connect(this.musicBus);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + 0.65);
  }

  private bass(freq: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private bell(freq: number, vol: number, t = this.ctx!.currentTime): void {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * 3.5;
    mg.gain.setValueAtTime(freq * 1.2, t);
    mg.gain.exponentialRampToValueAtTime(1, t + 1.5);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 2.5);
    car.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverb);
    car.start(t);
    mod.start(t);
    car.stop(t + 2.6);
    mod.stop(t + 2.6);
  }

  private kick(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  private hat(t: number, vol: number): void {
    const ctx = this.ctx!;
    const s = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    s.connect(f).connect(g).connect(this.musicBus);
    s.start(t, this.rng.range(0, 1.5));
    s.stop(t + 0.06);
  }

  private snare(t: number, vol: number): void {
    const ctx = this.ctx!;
    const s = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    s.connect(f).connect(g).connect(this.musicBus);
    s.start(t, this.rng.range(0, 1.5));
    s.stop(t + 0.2);
  }

  // ---------- Ambient one-shots ----------
  private gull(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const s = t + i * 0.22;
      o.frequency.setValueAtTime(1800, s);
      o.frequency.exponentialRampToValueAtTime(900, s + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0005, s + 0.2);
      o.connect(g).connect(this.ambBus);
      g.connect(this.reverb);
      o.start(s);
      o.stop(s + 0.22);
    }
  }

  private whaleSong(vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const base = this.rng.range(140, 220);
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.6, t + 1.6);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + 3.4);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vg = ctx.createGain();
    vg.gain.value = 6;
    vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.8);
    g.gain.linearRampToValueAtTime(0, t + 3.6);
    o.connect(g).connect(this.reverb);
    g.connect(this.ambBus);
    o.start(t);
    vib.start(t);
    o.stop(t + 3.7);
    vib.stop(t + 3.7);
  }

  // ---------- Sound effects ----------
  private boom(vol: number, cutoff: number, dur: number, pitch = 70): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    g.connect(this.reverb);
    s.start(t, this.rng.range(0, 1));
    s.stop(t + dur + 0.05);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(pitch, t);
    o.frequency.exponentialRampToValueAtTime(30, t + dur * 0.6);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 1.2, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.6);
    o.connect(og).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur);
  }

  cannon(distance = 0): void {
    this.boom(0.5 * clamp(1 - distance / 900, 0.1, 1), 1600, 0.7);
  }

  hit(): void {
    this.boom(0.45, 2500, 0.35, 110);
  }

  explosion(): void {
    this.boom(0.8, 900, 1.8, 50);
  }

  thunder(distance: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const delay = clamp(distance / 340, 0, 3);
    window.setTimeout(() => this.boom(0.55 * clamp(1 - distance / 1500, 0.15, 1), 500, 3, 40), delay * 1000);
  }

  bump(strength: number): void {
    this.boom(clamp(strength / 30, 0.05, 0.5), 700, 0.4, 60);
  }

  private tone(freqs: number[], step: number, type: OscillatorType, vol: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const t = t0 + i * step;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(g).connect(this.sfxBus);
      g.connect(this.reverb);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  }

  coin(): void {
    this.tone([1318, 1760], 0.07, 'square', 0.05, 0.18);
  }

  click(): void {
    this.tone([880], 0, 'triangle', 0.04, 0.06);
  }

  error(): void {
    this.tone([220, 180], 0.09, 'square', 0.05, 0.15);
  }

  pickup(): void {
    this.tone([784, 988, 1175, 1568], 0.07, 'triangle', 0.08, 0.5);
  }

  fanfare(): void {
    this.tone([523, 659, 784, 1047, 784, 1047], 0.13, 'triangle', 0.09, 0.7);
  }

  dock(): void {
    this.bell(midi(72), 0.12);
    window.setTimeout(() => this.bell(midi(79), 0.1), 260);
  }

  upgrade(): void {
    this.tone([392, 523, 659, 784], 0.08, 'sawtooth', 0.04, 0.35);
  }

  whoosh(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t);
    s.stop(t + 0.75);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
