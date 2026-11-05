// End-to-end play-test: new game → trade loop → upgrade → contract → pirate
// fight → main questline → finale. Uses real input where practical and debug
// hooks for long travel. Run against `npm run preview` (port 4173):
//   node scripts/playtest.mjs [outDir]
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'playtest-out';
const BASE = process.env.BASE ?? 'http://localhost:4173/skyharbor/';
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const t0 = Date.now();
const problems = [];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
const H = (fn, arg) => page.evaluate(fn, arg);
const st = () => H(() => window.__skyharbor.state());
const mode = () => H(() => window.__skyharbor.mode());
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  log('screenshot', name);
};
const toasts = () => H(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent));
const closeDialogs = async () => {
  for (let i = 0; i < 20; i++) {
    const b = page.getByTestId('dialog-next');
    if (!(await b.isVisible().catch(() => false))) return;
    await b.click();
    await page.waitForTimeout(150);
  }
};
const dock = async (port) => {
  if ((await mode()) === 'docked') await page.getByTestId('depart').click();
  await H((p) => window.__skyharbor.approach(p), port);
  await page.getByTestId('dock-prompt').waitFor({ state: 'visible', timeout: 30000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__skyharbor.mode() === 'docked', null, { timeout: 60000 });
  await page.waitForTimeout(300);
  await closeDialogs();
};

await page.goto(BASE);
await page.getByRole('heading', { name: 'SKYHARBOR' }).waitFor();
await shot('01-title');
await page.getByTestId('new-game').click();
await page.getByTestId('ship-name').fill('Playtest');
await page.getByTestId('start-voyage').click();
await page.waitForFunction(() => window.__skyharbor.mode() === 'play');
await page.waitForTimeout(1500);
await shot('02-first-flight');
log('first toasts', await toasts());

// Real flight input for a few seconds.
await page.keyboard.down('KeyW');
await page.waitForTimeout(3000);
await page.keyboard.up('KeyW');

// Story step 0: dock at Skyharbor.
await dock('skyharbor');
let s = await st();
log('docked at skyharbor, step', s.story.step, 'coins', s.coins);
await shot('03-port-market');

// First trade loop: buy the cheapest-looking good, sell at Thistlewick.
const goods = await H(() => [...document.querySelectorAll('[data-testid^="buy-"]')].filter((b) => !b.disabled).map((b) => b.dataset.testid.slice(4)));
log('buyable goods', goods);
const tipText = await page.getByTestId('trade-tip').textContent().catch(() => null);
log('trade tip', tipText);
const tip = await H(() => {
  const g = window.__skyharbor.game;
  return g.state ? window.__skyharbor.tradeTip?.() : null;
});
const g = tip?.good ?? goods[0];
const dest = tip?.to ?? 'thistlewick';
for (let i = 0; i < 6; i++) await page.getByTestId(`buy-${g}`).click();
s = await st();
log('bought', s.cargo[g], g, 'coins', s.coins);
const coinsBefore = s.coins;
await dock(dest);
await shot('04-sell-port');
for (let i = 0; i < 6; i++) {
  const b = page.getByTestId(`sell-${g}`);
  if (await b.isDisabled()) break;
  await b.click();
}
s = await st();
log('after sale coins', s.coins, 'delta', s.coins - coinsBefore, 'step', s.story.step);

// Upgrade.
for (const tab of ['shipwright', 'upgrades', 'yard']) {
  if (await page.getByTestId(`tab-${tab}`).isVisible().catch(() => false)) {
    await page.getByTestId(`tab-${tab}`).click();
    break;
  }
}
const ups = await H(() => [...document.querySelectorAll('[data-testid^="upgrade-"]')].map((b) => ({ id: b.dataset.testid, disabled: b.disabled, text: b.textContent })));
log('upgrades', JSON.stringify(ups));
const afford = ups.find((u) => !u.disabled);
if (afford) {
  await page.getByTestId(afford.id).click();
  log('fitted', afford.id);
} else problems.push('balance: no upgrade affordable after first trade loop');
await shot('05-upgrades');

// Contract.
for (const tab of ['contracts', 'board', 'jobs']) {
  if (await page.getByTestId(`tab-${tab}`).isVisible().catch(() => false)) {
    await page.getByTestId(`tab-${tab}`).click();
    break;
  }
}
const acc = page.getByTestId('accept-contract').first();
if (await acc.isVisible().catch(() => false)) {
  await acc.click();
  s = await st();
  log('contracts active', JSON.stringify(s.contracts.active.map((c) => [c.kind, c.from, c.to, c.good, c.qty])));
  await shot('06-contracts');
} else problems.push('no contract offered at thistlewick');

// Pirate fight using the real fire keys.
await page.getByTestId('depart').click();
await page.waitForTimeout(500);
await H(() => {
  const g = window.__skyharbor.game;
  const s = window.__skyharbor.state();
  window.__skyharbor.teleport(s.ship.x + 1500, 260, s.ship.z + 1500, 0);
});
await page.waitForTimeout(1500);
await H(() => window.__skyharbor.spawnPirates(1));
let sunk = false;
for (let i = 0; i < 160 && !sunk; i++) {
  // Park the pirate abeam to starboard and fire with E.
  await H(() => {
    const g = window.__skyharbor.game;
    const s = window.__skyharbor.state();
    const p = g.npcs.find((n) => n.role === 'pirate' && n.state !== 'sinking');
    if (!p) return;
    const r = { x: Math.cos(s.ship.heading), z: -Math.sin(s.ship.heading) };
    p.x = s.ship.x + r.x * 90;
    p.z = s.ship.z + r.z * 90;
    p.y = s.ship.y;
    // Sail parallel, as a corsair holding a broadside would.
    p.heading = s.ship.heading;
    p.vx = s.ship.vx;
    p.vz = s.ship.vz;
  });
  if (i === 3) await shot('07-pirate-fight');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(700);
  sunk = (await H(() => window.__skyharbor.state().stats.piratesSunk)) > 0;
}
s = await st();
log('pirate sunk', sunk, 'hull', Math.round(s.ship.hull));
if (!sunk) problems.push('could not sink pirate with starboard broadside');
await page.waitForTimeout(1000);
await shot('08-after-fight');

// Main questline.
for (let guard = 0; guard < 20; guard++) {
  s = await st();
  if (s.story.complete) break;
  const step = s.story.step;
  const o = await H(() => {
    const g = window.__skyharbor.game;
    return g.state.story;
  });
  const obj = await H(() => window.__skyharbor.storyObjective());
  log('story step', step, JSON.stringify(obj ?? o));
  const kind = obj?.type;
  if ((await mode()) === 'docked') await page.getByTestId('depart').click();
  if (kind === 'dock') await dock(obj.port);
  else if (kind === 'reach') {
    await H((l) => {
      const t = window.__skyharbor.landmark(l);
      window.__skyharbor.teleport(t.x + 30, t.y + 40, t.z + 30);
    }, obj.landmark);
    await page.waitForTimeout(2500);
    await closeDialogs();
  } else if (kind === 'fragments') {
    await H(() => window.__skyharbor.collectShards(4));
    await page.waitForTimeout(800);
    await closeDialogs();
  } else if (kind === 'flagship') {
    // Debug assist: a 260-hull flagship takes minutes under software WebGL.
    await H(() => { window.__skyharbor.game.stats.cannonDamage = 120; });
    await page.waitForTimeout(6000);
    for (let i = 0; i < 60; i++) {
      const done = await H(() => {
        const g = window.__skyharbor.game;
        const f = g.npcs.find((n) => n.role === 'flagship' && n.state !== 'sinking');
        if (!f) return !g.npcs.some((n) => n.role === 'flagship');
        const s = window.__skyharbor.state();
        const r = { x: Math.cos(s.ship.heading), z: -Math.sin(s.ship.heading) };
        f.x = s.ship.x + r.x * 100;
        f.z = s.ship.z + r.z * 100;
        f.y = s.ship.y;
        f.heading = s.ship.heading;
        f.vx = s.ship.vx;
        f.vz = s.ship.vz;
        return false;
      });
      if (i === 4) await shot('09-flagship');
      if (done && (await st()).story.step !== step) break;
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(1500);
    await closeDialogs();
  }
  await page.waitForFunction((n) => { const t = window.__skyharbor.state().story; return t.step !== n || t.complete; }, step, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await closeDialogs();
  s = await st();
  if (s.story.step === step && !s.story.complete) {
    problems.push(`story stuck at step ${step}`);
    break;
  }
}
s = await st();
log('story complete', s.story.complete);
await page.waitForTimeout(1500);
await shot('10-finale');
const ending = await page.locator('#ending').isVisible().catch(() => false);
log('ending visible', ending);
await shot('11-ending');
log('PROBLEMS', JSON.stringify(problems, null, 1));
await browser.close();
