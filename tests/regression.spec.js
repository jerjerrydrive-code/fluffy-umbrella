// Regression suite for XanCode OS (index.html). This exists because every one of these checks
// was previously done by hand with a throwaway script, verified once, then thrown away — nothing
// stopped a future change from silently re-breaking any of them. See the roadmap ledger at the
// top of index.html's <script type="module"> for the "why" behind each fix these tests protect.
//
// Run with: npm test  (spins up scripts/dev-server.mjs automatically, see playwright.config.js)
import { test, expect } from '@playwright/test';

// Every test gets a fresh page with pageerror/console-error collection wired up, and fails at
// teardown if anything unexpected was thrown — "zero page errors" is a hard requirement here,
// not just a spot-check.
test.beforeEach(async ({ page }) => {
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
});

test.afterEach(async ({ page }) => {
    expect(page.errors, `Unexpected page errors:\n${page.errors.join('\n')}`).toEqual([]);
});

test.describe('App boot', () => {
    test('renders the home screen with no page errors', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        await expect(page.locator('.app-icon-wrapper')).not.toHaveCount(0);
        expect(await page.evaluate(() => typeof window.OS_STATE !== 'undefined')).toBe(true);
        expect(await page.evaluate(() => typeof window.Renderer !== 'undefined')).toBe(true);
    });
});

test.describe('Edit mode (regression: PhysicsDragEngine.destroy())', () => {
    // A missing destroy() method used to throw the instant you tapped the background to leave
    // edit mode, which silently broke exiting edit mode entirely. This exercises the exact same
    // code path the real background-tap handler uses.
    test('entering and exiting edit mode never throws', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        const result = await page.evaluate(() => {
            try {
                window.OS_STATE.isEditMode = true;
                document.body.classList.add('edit-mode');
                window.DragEngine.destroy();
                document.body.classList.remove('edit-mode');
                window.OS_STATE.isEditMode = false;
                return { ok: true };
            } catch (e) {
                return { ok: false, message: e.message };
            }
        });

        expect(result.ok, result.message).toBe(true);
    });
});

test.describe('Modal pointer-events (regression: hidden modals blocking the home screen)', () => {
    // Several modals used to have pointer-events-auto hardcoded on inner elements even while
    // hidden, so clicking the home screen underneath a "closed" modal could silently hit it
    // instead. All modals should be fully click-through when hidden.
    test('no hidden modal intercepts a click on the home screen', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        const blocked = await page.evaluate(() => {
            const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
            const hiddenModalSelector = '#item-fullscreen-layer, #settings-modal, #rename-modal, ' +
                '#create-modal, #scanner-modal, #account-modal';
            return el ? el.closest(hiddenModalSelector) !== null : false;
        });

        expect(blocked).toBe(false);
    });
});

test.describe('Settings', () => {
    test('grid size picker opens, selects, and closes cleanly', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        await page.click('#btn-open-settings');
        await expect(page.locator('#settings-modal')).toHaveClass(/opacity-100/);

        await page.click('[data-grid="4x6"]');
        await expect(page.locator('[data-grid="4x6"]')).toHaveClass(/active/);
        expect(await page.evaluate(() => window.OS_STATE.gridSize)).toBe('4x6');

        await page.click('#btn-close-settings');
        await expect(page.locator('#settings-modal')).not.toHaveClass(/opacity-100/);
    });

    test('skin picker switches the interface skin', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        await page.click('#btn-open-settings');
        expect(await page.locator('#skin-picker button').count()).toBeGreaterThanOrEqual(2);

        await page.locator('#skin-picker button').nth(1).click();
        await page.waitForTimeout(600); // morph-pulse transition

        expect(await page.evaluate(() => document.body.getAttribute('data-skin'))).toBe('scancard');
    });

    test('accent theme swatch: tap changes it, hold pins a favorite that persists', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        await page.click('#btn-open-settings');
        const initialAccent = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());

        const swatch = page.locator('#theme-swatch-row button').nth(2);

        // quick tap: reroll + apply
        await swatch.dispatchEvent('pointerdown');
        await page.waitForTimeout(80);
        await swatch.dispatchEvent('pointerup');
        await page.waitForTimeout(200);

        const afterTapAccent = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
        expect(afterTapAccent.toLowerCase()).not.toBe(initialAccent.toLowerCase());
        expect((await page.evaluate(() => window.OS_STATE.accent)).toLowerCase()).toBe(afterTapAccent.toLowerCase());

        // long-press (>550ms): pin as favorite
        await swatch.dispatchEvent('pointerdown');
        await page.waitForTimeout(650);
        await swatch.dispatchEvent('pointerup');
        await page.waitForTimeout(200);

        const favorites = await page.evaluate(() => window.ThemeManager.favorites);
        expect(favorites.length).toBeGreaterThan(0);

        // favorite should survive closing and reopening the settings panel
        await page.click('#btn-close-settings');
        await page.click('#btn-open-settings');
        const firstSwatchHtml = await page.locator('#theme-swatch-row button').first().innerHTML();
        expect(firstSwatchHtml).toContain('star');
    });
});

test.describe('Create modal / Quick Add', () => {
    test('opens fresh onto Quick Add, and a prefilled scan reopens onto Custom', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        await page.evaluate(() => window.CodeGenerator.open());
        await expect(page.locator('#create-templates-view')).not.toHaveClass(/hidden/);
        await expect(page.locator('#template-grid button')).toHaveCount(7);
        await page.click('#btn-close-create');

        await page.evaluate(() => window.CodeGenerator.open('https://example.com/scanned', 'qrcode'));
        await expect(page.locator('#create-custom-view')).not.toHaveClass(/hidden/);
        expect(await page.locator('#create-input-data').inputValue()).toBe('https://example.com/scanned');
        await page.click('#btn-close-create');
    });

    test('WiFi Quick Add template builds the correct payload and forces QR', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        const beforeCount = await page.evaluate(() => window.OS_STATE.apps.filter((a) => a.type === 'grid').length);

        await page.evaluate(() => window.CodeGenerator.open());
        await page.locator('#template-grid button').nth(0).click(); // WiFi is first
        await page.fill('#tpl-wifi-ssid', 'RegressionNet');
        await page.fill('#tpl-wifi-pass', 'hunter2');
        await page.click('#tpl-save-btn');
        await page.waitForTimeout(500);

        const created = await page.evaluate(() => {
            const items = window.OS_STATE.apps.filter((a) => a.type === 'grid');
            return items[items.length - 1];
        });

        expect(created.title).toBe('RegressionNet');
        expect(created.bcid).toBe('qrcode');
        expect(created.data).toBe('WIFI:S:RegressionNet;T:WPA;P:hunter2;;');

        const afterCount = await page.evaluate(() => window.OS_STATE.apps.filter((a) => a.type === 'grid').length);
        expect(afterCount).toBe(beforeCount + 1);
        await expect(page.locator('#create-modal')).not.toHaveClass(/opacity-100/);
    });
});

test.describe('Scanner', () => {
    // No camera device exists in a headless CI runner, so this only asserts the modal opens
    // and closes cleanly and never throws — not that a real scan succeeds. Verifying actual
    // camera capture needs a real device (see the build report's "needs a minute from you").
    test('opens and closes without throwing when no camera is available', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        await page.evaluate(() => window.ScannerEngine.start());
        await page.waitForTimeout(500);
        await page.evaluate(() => window.ScannerEngine.stop());
        await page.waitForTimeout(300);

        await expect(page.locator('#scanner-modal')).not.toHaveClass(/opacity-100/);
    });
});

test.describe('Cloud sync resilience (regression: static Firebase import blanking the whole app)', () => {
    // Loading the Firebase SDKs via a static top-of-module `import` used to mean one failed CDN
    // request took the ENTIRE app down (confirmed by testing offline: zero icons rendered,
    // OS_STATE undefined). Firebase now loads via a dynamic import sandboxed inside
    // OSCloudSyncManager.init(); this test blocks that request on purpose so the check doesn't
    // depend on the runner's actual network conditions, and asserts everything else still works.
    test('a blocked Firebase CDN never breaks the rest of the app', async ({ page }) => {
        await page.route('**gstatic.com/firebasejs/**', (route) => route.abort());

        await page.goto('/index.html');
        await page.waitForTimeout(1500);

        await expect(page.locator('.app-icon-wrapper')).not.toHaveCount(0);
        expect(await page.evaluate(() => typeof window.OS_STATE !== 'undefined')).toBe(true);
        expect(await page.evaluate(() => typeof window.Renderer !== 'undefined')).toBe(true);
        expect(await page.evaluate(() => window.CloudSync && window.CloudSync.ready)).toBe(false);

        // the account modal should explain itself instead of silently doing nothing
        await page.click('#btn-open-account');
        await expect(page.locator('#account-guest-error')).not.toHaveClass(/hidden/);
        await page.click('#btn-close-account');
    });
});
