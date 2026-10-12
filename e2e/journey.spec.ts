import { expect, test, type Page } from '@playwright/test';

async function skipIntro(page: Page) {
  await page.goto('/');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('new-game')).toBeVisible();
}

async function navValue(page: Page) {
  return (await page.getByTestId('nav').textContent())?.trim();
}

test('full guest journey: create fund, trade, news, close, report, save, reload, fail, restart', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1-4: open site, play as guest, create fund, choose difficulty
  await skipIntro(page);
  await page.getByTestId('new-game').click();
  await page.getByTestId('fund-name').fill('Playwright Capital');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-game').click();

  // 5: terminal
  await expect(page.getByTestId('clock')).toHaveText('09:30', { timeout: 30_000 });
  await page.getByText('Skip tutorial').click();
  await expect(page.locator('.topbar')).toContainText('Playwright Capital');

  // 6: select a fictional stock via the Markets screen
  await page.keyboard.press('m');
  await page.getByTestId('market-search').fill('');
  await page.getByRole('button', { name: 'Stocks' }).click();
  const firstRow = page.locator('table.tbl tbody tr').first();
  const symbol = (await firstRow.locator('td').nth(1).textContent())!.trim();
  await firstRow.click();
  await expect(page.locator('h1')).toContainText(symbol);

  // 7: place an order (pre-market → queues for the open)
  await page.getByLabel('Quantity').fill('100');
  await page.getByTestId('submit-order').click();
  await expect(page.getByText('Order working')).toBeVisible();

  // 8: advance market time
  await page.getByTestId('adv15').click();
  await expect(page.getByTestId('clock')).toHaveText('09:45');
  const price1 = await page.getByTestId('chart-price').first().textContent();

  // 9: verify the position and its value
  await page.keyboard.press('p');
  const row = page.locator('table.tbl tbody tr', { hasText: symbol }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('100');
  await expect(row).toContainText('$');

  // 10: read a news article
  await page.keyboard.press('n');
  await page.locator('.news-item').first().click();
  await expect(page.getByTestId('article')).toBeVisible();
  await expect(page.getByTestId('article').locator('h2')).not.toBeEmpty();

  // 11: the market reacts as time passes (prices move with simulated time only)
  await page.goto(`/#/instrument/${symbol}`);
  await page.getByTestId('adv15').click();
  await expect(page.getByTestId('clock')).toHaveText('10:00');
  const price2 = await page.getByTestId('chart-price').first().textContent();
  expect(price2).not.toBe(price1);

  // 12-13: reach the close and review the end-of-day report
  await page.getByTestId('skip-close').click();
  await expect(page.getByTestId('clock')).toHaveText('16:00');
  await page.keyboard.press('d');
  await expect(page.getByTestId('eod-report')).toBeVisible();
  await expect(page.getByTestId('eod-report')).toContainText('Investment P&L');

  // 14: next trading day
  await page.getByTestId('next-day').click();
  await expect(page.getByTestId('clock')).toHaveText('09:30');
  await expect(page.locator('.topbar')).toContainText('Pre-market');

  // 15: save to a manual slot
  await page.keyboard.press('l');
  await page.getByTestId('save-slot1').click();
  await expect(page.getByText('Slot 1').first()).toBeVisible();
  const navBefore = await navValue(page);
  const dateBefore = await page.locator('.topbar .small.dim.hide-sm').textContent();

  // 16: reload the browser and resume
  await page.reload();
  await page.keyboard.press('Escape').catch(() => {});
  await expect(page.getByTestId('continue')).toBeVisible();
  await page.getByTestId('continue').click();
  await expect(page.locator('.topbar')).toContainText('Playwright Capital');
  expect(await navValue(page)).toBe(navBefore);
  expect(await page.locator('.topbar .small.dim.hide-sm').textContent()).toBe(dateBefore);
  await page.keyboard.press('p');
  await expect(page.locator('table.tbl tbody tr', { hasText: symbol }).first()).toBeVisible();

  // 17: end the run through the failure/closure system
  await page.keyboard.press('b');
  await page.getByRole('button', { name: 'Close fund…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close fund' }).click();
  await expect(page.getByTestId('game-over')).toBeVisible();
  await expect(page.getByTestId('game-over')).toContainText('Days survived');

  // 18: start a new game
  await page.getByRole('button', { name: 'Start a new fund' }).click();
  await page.getByTestId('fund-name').fill('Second Act Partners');
  await page.getByTestId('start-game').click();
  await expect(page.locator('.topbar')).toContainText('Second Act Partners', { timeout: 30_000 });

  expect(errors).toEqual([]);
});

test('corrupted saves fail gracefully and never crash the app', async ({ page }) => {
  await skipIntro(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('trading-floor', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('saves'); req.result.createObjectStore('profile'); };
      req.onsuccess = () => {
        const tx = req.result.transaction('saves', 'readwrite');
        const s = tx.objectStore('saves');
        s.put({ garbage: true }, 'data:slot2');
        s.put({ slot: 'slot2', gameId: 'x', fundName: 'Broken Fund', difficulty: 'normal', preset: 'founder', date: '2031-01-01', day: 3, daysPlayed: 1, nav: 100, status: 'active', savedAt: Date.now() + 99999, schema: 1, label: '' }, 'meta:slot2');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: /Load game/ }).click();
  await page.locator('.list-row', { hasText: 'Broken Fund' }).getByRole('button', { name: 'Load' }).click();
  await expect(page.getByRole('alert')).toContainText(/corrupt|validation/i);
  // the menu still works
  await page.getByRole('button', { name: '← Main menu' }).click();
  await expect(page.getByTestId('new-game')).toBeVisible();
});

test('responsive: the game remains usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 860 });
  await skipIntro(page);
  await page.getByTestId('new-game').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('clock')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Skip tutorial').click();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.locator('.sidenav').getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.locator('h1')).toContainText('Portfolio');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
