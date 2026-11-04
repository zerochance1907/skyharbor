import { describe, expect, it } from 'vitest';
import { SaveError, SaveManager, deserialize, serialize, type KeyValueStore } from '../../src/sim/save';
import { newGame } from '../../src/sim/state';
import { FogGrid } from '../../src/sim/fog';

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('save / load', () => {
  it('round-trips a game state exactly', () => {
    const s = newGame(1234, 'Testbed');
    s.coins = 777;
    s.cargo.silk = 4;
    s.upgrades.engine = 2;
    s.fragments.push('rose-3');
    s.fog.reveal(1000, -2000, 400);
    s.story.step = 3;
    s.time = 55.5;
    const back = deserialize(serialize(s));
    expect(back.coins).toBe(777);
    expect(back.cargo.silk).toBe(4);
    expect(back.upgrades.engine).toBe(2);
    expect(back.fragments).toEqual(['rose-3']);
    expect(back.fog.isRevealed(1000, -2000)).toBe(true);
    expect(back.fog.revealedCount).toBe(s.fog.revealedCount);
    expect(back.story.step).toBe(3);
    expect(back.markets).toEqual(s.markets);
    expect(back.ship).toEqual(s.ship);
    expect(serialize(back, 1)).toBe(serialize(s, 1));
  });

  it('rejects garbage, foreign files and future versions', () => {
    expect(() => deserialize('not json')).toThrow(SaveError);
    expect(() => deserialize('{"hello":1}')).toThrow(SaveError);
    const s = JSON.parse(serialize(newGame(1)));
    s.version = 999;
    expect(() => deserialize(JSON.stringify(s))).toThrow(/newer/);
    const bad = JSON.parse(serialize(newGame(1)));
    bad.state.ship.x = 'nope';
    expect(() => deserialize(JSON.stringify(bad))).toThrow(SaveError);
    const badUp = JSON.parse(serialize(newGame(1)));
    badUp.state.upgrades.hull = 12;
    expect(() => deserialize(JSON.stringify(badUp))).toThrow(SaveError);
  });

  it('sanitises cargo counts', () => {
    const s = JSON.parse(serialize(newGame(1)));
    s.state.cargo.grain = -5;
    s.state.cargo.tea = 2.7;
    const back = deserialize(JSON.stringify(s));
    expect(back.cargo.grain).toBe(0);
    expect(back.cargo.tea).toBe(2);
  });

  it('manages slots, metadata and latest save', async () => {
    const store = memStore();
    const mgr = new SaveManager(store);
    expect(mgr.load('slot1')).toBeNull();
    const a = newGame(5, 'Alpha');
    mgr.save('slot1', a);
    await new Promise((r) => setTimeout(r, 5));
    const b = newGame(6, 'Beta');
    b.docked = 'rimeholt';
    mgr.save('auto', b);
    expect(mgr.meta('slot1')!.shipName).toBe('Alpha');
    expect(mgr.latest()!.slot).toBe('auto');
    expect(mgr.latest()!.location).toBe('Rimeholt');
    expect(mgr.load('slot1')!.shipName).toBe('Alpha');
    mgr.remove('slot1');
    expect(mgr.load('slot1')).toBeNull();
  });
});

describe('fog of war', () => {
  it('reveals discs and counts cells once', () => {
    const f = new FogGrid();
    const n = f.reveal(0, 0, 300);
    expect(n).toBeGreaterThan(20);
    expect(f.reveal(0, 0, 300)).toBe(0);
    expect(f.isRevealed(0, 0)).toBe(true);
    expect(f.isRevealed(5000, 5000)).toBe(false);
    expect(f.coverage).toBeGreaterThan(0);
    const g = FogGrid.decode(f.encode());
    expect(g.revealedCount).toBe(f.revealedCount);
    expect(g.isRevealed(250, 0)).toBe(f.isRevealed(250, 0));
  });
  it('ignores reveals outside the charted region', () => {
    const f = new FogGrid();
    expect(f.reveal(1e6, 1e6, 500)).toBe(0);
  });
});
