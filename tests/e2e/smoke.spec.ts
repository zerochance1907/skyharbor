import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __skyharbor: {
      state: () => { coins: number; ship: { x: number; y: number; z: number; throttle: number; heading: number }; docked: string | null; cargo: Record<string, number> } | null;
      mode: () => string;
      approach: (port: string) => void;
    };
  }
}

const ship = (page: Page) => page.evaluate(() => window.__skyharbor.state()!.ship);

test('boot, new voyage, fly, dock, trade with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'SKYHARBOR' })).toBeVisible();

  // Start a new game.
  await page.getByTestId('new-game').click();
  await page.getByTestId('ship-name').fill('Smoketest');
  await page.getByTestId('start-voyage').click();
  await expect(page.getByTestId('hud-coins')).toHaveText(/400/);
  await page.waitForFunction(() => window.__skyharbor.mode() === 'play');

  // Fly for a few seconds with real keys: throttle up and turn.
  const start = await ship(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyA');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__skyharbor.state()!.ship.throttle > 0.5, null, { timeout: 60_000 });
  // Software WebGL in CI can run slowly, so wait for real movement instead of a fixed time.
  await page.waitForFunction(
    ([x, z]) => {
      const s = window.__skyharbor.state()!.ship;
      return Math.hypot(s.x - x, s.z - z) > 8;
    },
    [start.x, start.z],
    { timeout: 90_000 },
  );
  await page.keyboard.up('KeyA');
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
  const moved = await ship(page);
  const dist = Math.hypot(moved.x - start.x, moved.z - start.z);
  expect(dist).toBeGreaterThan(8);
  expect(moved.y).toBeGreaterThan(start.y);
  expect(moved.heading).not.toBeCloseTo(start.heading, 3);

  // Line up at the Skyharbor berth and dock with the real interact key.
  await page.evaluate(() => window.__skyharbor.approach('skyharbor'));
  await expect(page.getByTestId('dock-prompt')).toBeVisible();
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__skyharbor.mode() === 'docked', null, { timeout: 60_000 });

  // The harbormaster's story dialogue opens on first docking.
  const next = page.getByTestId('dialog-next');
  await expect(next).toBeVisible();
  while (await next.isVisible()) await next.click();

  // Buy and sell at the market.
  const coins0 = await page.evaluate(() => window.__skyharbor.state()!.coins);
  await page.getByTestId('buy-grain').click();
  await expect.poll(() => page.evaluate(() => window.__skyharbor.state()!.cargo.grain)).toBe(1);
  const coins1 = await page.evaluate(() => window.__skyharbor.state()!.coins);
  expect(coins1).toBeLessThan(coins0);
  await page.getByTestId('sell-grain').click();
  await expect.poll(() => page.evaluate(() => window.__skyharbor.state()!.cargo.grain)).toBe(0);
  const coins2 = await page.evaluate(() => window.__skyharbor.state()!.coins);
  expect(coins2).toBeGreaterThan(coins1);
  expect(coins2).toBeLessThanOrEqual(coins0);
  await expect(page.getByTestId('port-coins')).toHaveText(new RegExp(String(Math.round(coins2))));

  // Cast off again.
  await page.getByTestId('depart').click();
  await page.waitForFunction(() => window.__skyharbor.mode() === 'play');

  expect(errors).toEqual([]);
});
