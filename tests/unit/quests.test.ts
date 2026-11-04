import { describe, expect, it } from 'vitest';
import {
  acceptContract,
  generateOffers,
  newContractBook,
  refreshOffers,
  reservedSlots,
  resolveOnDock,
  updateContracts,
  MAX_ACTIVE_CONTRACTS,
} from '../../src/sim/contracts';
import { STORY, advanceStory, newStory, objectiveTarget, FRAGMENTS, FRAGMENTS_NEEDED } from '../../src/sim/story';
import { World } from '../../src/sim/world';
import { PORTS, LANDMARK_BY_ID } from '../../src/sim/ports';

const world = new World(1907);

describe('contracts', () => {
  it('offers are deterministic per port and day', () => {
    expect(generateOffers(world, 'skyharbor', 3, 80)).toEqual(generateOffers(world, 'skyharbor', 3, 80));
    expect(generateOffers(world, 'skyharbor', 3, 80)).not.toEqual(generateOffers(world, 'skyharbor', 4, 104));
  });

  it('covers all contract kinds across ports and days', () => {
    const kinds = new Set<string>();
    for (const p of PORTS) for (let d = 0; d < 6; d++) for (const c of generateOffers(world, p.id, d, d * 24)) kinds.add(c.kind);
    expect(kinds).toEqual(new Set(['delivery', 'salvage', 'escort', 'ruin']));
  });

  it('every offer has a positive reward and valid destination', () => {
    for (const p of PORTS)
      for (const c of generateOffers(world, p.id, 1, 30)) {
        expect(c.reward).toBeGreaterThan(0);
        if (c.kind === 'delivery' || c.kind === 'escort') expect(c.to).not.toBe(p.id);
        if (c.kind === 'salvage' || c.kind === 'ruin') expect(c.target).toBeDefined();
      }
  });

  it('delivery: accept reserves cargo and pays out at destination', () => {
    const book = newContractBook();
    const day = [0, 1, 2, 3, 4, 5, 6, 7].find((d) => generateOffers(world, 'skyharbor', d, d * 24).some((c) => c.kind === 'delivery'))!;
    refreshOffers(book, world, 'skyharbor', day, day * 24);
    const offer = book.offers.skyharbor!.find((c) => c.kind === 'delivery')!;
    expect(acceptContract(book, 'skyharbor', offer.id, 0).ok).toBe(false); // no space
    expect(acceptContract(book, 'skyharbor', offer.id, 99).ok).toBe(true);
    expect(reservedSlots(book)).toBeGreaterThan(0);
    expect(resolveOnDock(book, 'skyharbor')).toHaveLength(0);
    const paid = resolveOnDock(book, offer.to!);
    expect(paid).toHaveLength(1);
    expect(paid[0].reward).toBe(offer.reward);
    expect(book.active).toHaveLength(0);
    expect(book.completed).toBe(1);
  });

  it('deliveries fail after their deadline', () => {
    const book = newContractBook();
    const day = [0, 1, 2, 3, 4, 5, 6, 7].find((d) => generateOffers(world, 'skyharbor', d, d * 24).some((c) => c.kind === 'delivery'))!;
    refreshOffers(book, world, 'skyharbor', day, day * 24);
    const offer = book.offers.skyharbor!.find((c) => c.kind === 'delivery')!;
    acceptContract(book, 'skyharbor', offer.id, 99);
    const changed = updateContracts(book, offer.deadline! + 1, 0, 0, 0);
    expect(changed[0].status).toBe('failed');
    expect(book.failed).toBe(1);
    expect(book.active).toHaveLength(0);
  });

  it('salvage becomes ready at the site and pays at any port', () => {
    const book = newContractBook();
    let port = PORTS[0].id;
    let day = 0;
    outer: for (const p of PORTS)
      for (let d = 0; d < 10; d++)
        if (generateOffers(world, p.id, d, d * 24).some((c) => c.kind === 'salvage')) {
          port = p.id;
          day = d;
          break outer;
        }
    refreshOffers(book, world, port, day, day * 24);
    const offer = book.offers[port]!.find((c) => c.kind === 'salvage')!;
    acceptContract(book, port, offer.id, 0);
    expect(updateContracts(book, day * 24, 0, 9999, 0)).toHaveLength(0);
    const t = offer.target!;
    const changed = updateContracts(book, day * 24, t.x, t.y, t.z);
    expect(changed[0].status).toBe('ready');
    expect(resolveOnDock(book, 'veilmere')).toHaveLength(1);
  });

  it('limits the number of active contracts', () => {
    const book = newContractBook();
    let accepted = 0;
    for (const p of PORTS) {
      refreshOffers(book, world, p.id, 0, 0);
      for (const c of [...(book.offers[p.id] ?? [])]) if (c.kind !== 'escort' && acceptContract(book, p.id, c.id, 999).ok) accepted++;
    }
    expect(accepted).toBe(MAX_ACTIVE_CONTRACTS);
  });
});

describe('main questline', () => {
  it('has 5 to 8 steps ending at a finale location', () => {
    expect(STORY.length).toBeGreaterThanOrEqual(5);
    expect(STORY.length).toBeLessThanOrEqual(8);
    const last = STORY[STORY.length - 1].objective;
    expect(last.type).toBe('reach');
    if (last.type === 'reach') expect(LANDMARK_BY_ID[last.landmark].kind).toBe('finale');
  });

  it('ignores events that do not match the current objective', () => {
    const s = newStory();
    expect(advanceStory(s, { type: 'dock', port: 'rimeholt' })).toBeNull();
    expect(advanceStory(s, { type: 'flagship' })).toBeNull();
    expect(s.step).toBe(0);
  });

  it('can be played start to finish', () => {
    const s = newStory();
    const events = [
      { type: 'dock', port: 'skyharbor' },
      { type: 'reach', landmark: 'wreck_courier' },
      { type: 'dock', port: 'lanternfall' },
      { type: 'fragment', total: FRAGMENTS_NEEDED - 1 },
      { type: 'fragment', total: FRAGMENTS_NEEDED },
      { type: 'reach', landmark: 'observatory' },
      { type: 'flagship' },
      { type: 'dock', port: 'veilmere' },
      { type: 'reach', landmark: 'meridian' },
    ] as const;
    let completed = 0;
    for (const ev of events) if (advanceStory(s, ev)) completed++;
    expect(completed).toBe(STORY.length);
    expect(s.complete).toBe(true);
    expect(objectiveTarget(s)).toBeNull();
    expect(advanceStory(s, { type: 'dock', port: 'skyharbor' })).toBeNull();
  });

  it('has enough unique compass shards', () => {
    expect(new Set(FRAGMENTS.map((f) => f.id)).size).toBe(FRAGMENTS.length);
    expect(FRAGMENTS.length).toBeGreaterThanOrEqual(FRAGMENTS_NEEDED);
  });
});
