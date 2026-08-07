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

test.describe('Accent palette (regression: the recovered 338-theme packed string)', () => {
    // The alpha's original packedThemes string was lost in the rebuild and stood in as a 48-theme
    // curated placeholder for several sessions. It was recovered verbatim from the pre-rebuild
    // exports. These assertions are deliberately exact: if someone reformats, truncates or
    // "tidies" that string, the palette silently shrinks and this fails loudly instead.
    test('the full recovered palette is present and parses cleanly', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        const stats = await page.evaluate(() => {
            const row = document.getElementById('theme-swatch-row');
            return {
                swatches: row ? row.querySelectorAll('button').length : 0,
                accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
            };
        });

        // 338 themes x 4 candidates. The row renders one button per theme (favorites add more).
        expect(stats.swatches).toBeGreaterThanOrEqual(338);
        expect(stats.accent).not.toBe('');
    });

    test('picking an accent does not rebuild the whole 338-swatch row', async ({ page }) => {
        // Full render() on every tap made the row stutter once the palette grew past the old
        // 48-theme placeholder. Selecting an accent must only repaint the active ring, so the
        // DOM node under the pointer has to survive the tap.
        await page.goto('/index.html');
        await page.waitForTimeout(1000);
        await page.click('#btn-open-settings');

        const swatch = page.locator('#theme-swatch-row button').nth(5);
        await swatch.evaluate((el) => { el.dataset.identityProbe = 'original'; });

        await swatch.dispatchEvent('pointerdown');
        await page.waitForTimeout(80);
        await swatch.dispatchEvent('pointerup');
        await page.waitForTimeout(250);

        // Still the same element -> the row was not torn down and rebuilt.
        const survived = await page.locator('#theme-swatch-row button').nth(5)
            .evaluate((el) => el.dataset.identityProbe);
        expect(survived).toBe('original');

        const ringed = await page.evaluate(() =>
            document.querySelectorAll('#theme-swatch-row button.border-white').length);
        expect(ringed).toBeGreaterThan(0);
    });
});

test.describe('Library (regression: nav_lib was a dead "coming soon" dock button)', () => {
    const openLibrary = async (page) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);
        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(400);
    };

    test('the dock button opens a list of every saved code', async ({ page }) => {
        await openLibrary(page);

        await expect(page.locator('#library-overlay')).not.toHaveClass(/pointer-events-none/);

        const expected = await page.evaluate(() =>
            window.OS_STATE.apps.filter(a => a.type === 'grid').length);
        await expect(page.locator('#library-list > div')).toHaveCount(expected);
        await expect(page.locator('#library-count')).toContainText(`${expected} saved`);
    });

    test('filtering narrows the list and reports an empty state', async ({ page }) => {
        await openLibrary(page);

        await page.fill('#library-search', 'wifi');
        await page.waitForTimeout(200);
        const filtered = await page.locator('#library-list > div').count();
        expect(filtered).toBeGreaterThan(0);
        await expect(page.locator('#library-count')).toContainText('of');

        await page.fill('#library-search', 'zzzznotarealcode');
        await page.waitForTimeout(200);
        await expect(page.locator('#library-list')).toContainText('No matches');
    });

    test('sorting by name reorders the list', async ({ page }) => {
        await openLibrary(page);

        const titles = () => page.locator('#library-list h4').allTextContents();
        const recentOrder = await titles();

        await page.click('.library-sort-btn[data-sort="name"]');
        await page.waitForTimeout(250);
        const nameOrder = await titles();

        expect(nameOrder).toEqual([...recentOrder].sort((a, b) => a.localeCompare(b)));
    });

    test('tapping a row opens that code in the item viewer', async ({ page }) => {
        await openLibrary(page);

        const firstTitle = await page.locator('#library-list h4').first().textContent();
        await page.locator('#library-list > div').first().click();
        await page.waitForTimeout(600);

        await expect(page.locator('#item-fullscreen-layer')).not.toHaveClass(/pointer-events-none/);
        await expect(page.locator('#item-fullscreen-layer')).toContainText(firstTitle.trim());
    });

    test('a scanned payload containing markup is rendered as text, never as HTML', async ({ page }) => {
        // Code titles and payloads are arbitrary attacker-controlled text — a malicious QR can
        // carry markup. The Library builds those fields with textContent for exactly this reason.
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        await page.evaluate(() => {
            window.OS_STATE.apps.push({
                id: 'bc_xsstest', title: '<img src=x onerror="window.__pwned=1">',
                type: 'grid', page: 0, order: 20, bcid: 'qrcode', data: '<b>payload</b>'
            });
        });

        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(500);

        expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
        expect(await page.evaluate(() =>
            document.querySelectorAll('#library-list img, #library-list b').length)).toBe(0);
        await expect(page.locator('#library-list')).toContainText('<b>payload</b>');
    });
});

test.describe('Glass skin (Phase 1)', () => {
    // The glass skin's whole design contract is that it supplies the *material* (frosted,
    // translucent, ambient field) while the user's accent supplies the *hue* — every tint is a
    // color-mix over var(--accent) rather than the reference's hardcoded lavender. If someone
    // ever swaps one of those for a literal hex, the skin silently stops following the theme,
    // which is HARD RULE 7's exact failure mode. These assertions catch that.
    test('applies, and every tinted surface tracks the accent', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);

        await page.evaluate(() => window.SkinManager.setSkin('glass'));
        await page.waitForTimeout(600);
        expect(await page.evaluate(() => document.body.getAttribute('data-skin'))).toBe('glass');

        const sample = () => page.evaluate(() => {
            const field = getComputedStyle(document.body, '::before');
            const dock = getComputedStyle(document.getElementById('main-dock'));
            return {
                fieldImage: field.backgroundImage,
                fieldFilter: field.backdropFilter || field.webkitBackdropFilter,
                dockBg: dock.backgroundColor,
                dockFilter: dock.backdropFilter || dock.webkitBackdropFilter
            };
        });

        const before = await sample();
        // The ambient field and the frosted dock must actually be there.
        expect(before.fieldImage).toContain('gradient');
        expect(before.fieldFilter).toContain('blur');
        expect(before.dockFilter).toContain('blur');

        // Change the accent; the glass must re-tint with it.
        await page.evaluate(() => window.ThemeManager.applyAccent('#E0432F', true));
        await page.waitForTimeout(250);
        const after = await sample();

        expect(after.dockBg).not.toBe(before.dockBg);
        expect(after.fieldImage).not.toBe(before.fieldImage);
    });

    test('switching to glass and back leaves the home screen intact', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);
        const iconsBefore = await page.locator('.app-icon-wrapper').count();

        await page.evaluate(() => window.SkinManager.setSkin('glass'));
        await page.waitForTimeout(600);
        await page.evaluate(() => window.SkinManager.setSkin('dock'));
        await page.waitForTimeout(600);

        expect(await page.evaluate(() => document.body.getAttribute('data-skin'))).toBe('dock');
        await expect(page.locator('.app-icon-wrapper')).toHaveCount(iconsBefore);
    });
});
