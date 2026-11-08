import { test, expect } from '@playwright/test';

// Test-mode happy path on a phone-sized viewport: landing → Test Mode
// (guest auto-signin) → lobby defaults → start → move a tank → scrub → rewind.
test('test mode happy path', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('btn-test').click();

  // lobby: guest auto-signin + game create happen automatically
  await expect(page.getByRole('button', { name: /start game/i })).toBeVisible({ timeout: 15_000 });
  // give ourselves AP so a move is immediately legal (default is 0)
  await page.getByLabel('Starting AP').fill('2');
  await page.getByRole('button', { name: /start game/i }).click();

  await expect(page.getByTestId('board')).toBeVisible({ timeout: 15_000 });

  // move: select move mode, then a legal cell
  await page.getByTestId('btn-move').click();
  const legal = page.locator('rect.legal').first();
  await legal.click();
  await expect(page.getByTestId('ap-counter')).not.toHaveText(/^-1|NaN/);

  // history scrubber visible in test mode
  await expect(page.getByTestId('history-scrubber')).toBeVisible();
  const slider = page.getByRole('slider');
  if (await slider.count()) {
    const max = Number(await slider.getAttribute('max'));
    if (max >= 1) {
      // scrub to one event back, then rewind (creator = us)
      await slider.fill('1');
      await page.getByRole('button', { name: /rewind/i }).click();
      // after the fork the game reloads; board still visible
      await expect(page.getByTestId('board')).toBeVisible({ timeout: 15_000 });
    }
  }
});
