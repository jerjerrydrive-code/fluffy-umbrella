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

test.describe('Self-contained rendering (regression: CDN outage blanked the layout)', () => {
    // The app used to load Tailwind, lucide, bwip-js and html5-qrcode from CDNs. On a restricted
    // or cold network all four failed, and because Tailwind carries essentially all the layout,
    // the app rendered as unstyled scattered text — while the rest of this suite stayed green,
    // since it asserts behaviour and DOM rather than pixels. That is exactly the blind spot this
    // test closes: it blocks EVERY external host and demands the app still fully render.
    const blockAllExternal = async (page) => {
        await page.route('**/*', (route) => {
            const url = route.request().url();
            if (url.startsWith('http://localhost:4173')) return route.continue();
            return route.abort();
        });
    };

    test('renders completely with every external host blocked', async ({ page }) => {
        await blockAllExternal(page);
        await page.goto('/index.html');
        await page.waitForTimeout(2500);

        // Tailwind actually applied: this class only resolves if the stylesheet loaded.
        const layout = await page.evaluate(() => {
            const el = document.getElementById('workspace-container');
            const cs = getComputedStyle(el);
            return { zIndex: cs.zIndex, display: cs.display };
        });
        expect(layout.display).toBe('flex');
        expect(layout.zIndex).toBe('10');

        // The three vendored libraries are present.
        const libs = await page.evaluate(() => ({
            bwip: typeof window.bwipjs,
            lucide: typeof window.lucide,
            qr: typeof window.Html5Qrcode
        }));
        expect(libs.bwip).toBe('object');
        expect(libs.lucide).toBe('object');
        expect(libs.qr).toBe('function');

        // Icons rendered, and barcodes actually drew pixels onto their canvases.
        await expect(page.locator('.app-icon-wrapper')).not.toHaveCount(0);
        await expect(page.locator('#dock-container svg')).not.toHaveCount(0);

        const drew = await page.evaluate(() => {
            const c = document.querySelector('.app-icon-wrapper canvas');
            if (!c || !c.width) return false;
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1]) return true;
            return false; // uniform canvas => nothing rendered
        });
        expect(drew, 'barcode canvas should contain rendered bars').toBe(true);

        // And a wallpaper is present without any network fetch.
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
        expect(bg).toContain('gradient');
        expect(bg).not.toContain('unsplash');
    });

    test('index.html references no external resources for rendering', async ({ page }) => {
        // Belt and braces: catch a CDN tag reintroduced by hand, even if it happens to be
        // reachable on the machine running the suite.
        await page.goto('/index.html');
        const external = await page.evaluate(() =>
            [...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
                .map(el => el.getAttribute('src') || el.getAttribute('href'))
                .filter(u => /^https?:\/\//i.test(u)));
        expect(external, `external render deps: ${external.join(', ')}`).toEqual([]);
    });
});

test.describe('Accent swatch rendering', () => {
    // Two things pinned here. (1) The swatches show a theme as four stacked horizontal bands,
    // not four conic quadrants — the conic version put all four wedges converging on a centre
    // point, which reads as a hazard symbol and is harsh to scan down a long row of. (2) The
    // gradient must be sized to the border box: these buttons carry a 2px border, and a
    // background is positioned to the padding box but painted across the border box, so with
    // the default repeat the top 2px showed the tail colour of the tile above as a stray band.
    // Note the sub-properties come from a CSS class, so the JS must set background LONGHANDS —
    // assigning the `background` shorthand resets them and silently brings the artefact back.
    test('themes render as stacked bands with no tiling artefact', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);
        await page.click('#btn-open-settings');
        await page.waitForTimeout(300);

        const s = await page.evaluate(() => {
            const el = document.querySelector('#theme-swatch-row button');
            const cs = getComputedStyle(el);
            return {
                image: cs.backgroundImage,
                origin: cs.backgroundOrigin,
                repeat: cs.backgroundRepeat
            };
        });

        expect(s.image).toContain('linear-gradient');
        expect(s.image).not.toContain('conic-gradient');
        expect(s.origin).toBe('border-box');
        expect(s.repeat).toBe('no-repeat');
    });

    test('a pinned favourite renders as one flat colour', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);
        await page.click('#btn-open-settings');
        await page.evaluate(() => {
            window.ThemeManager.favorites = ['#123456'];
            window.ThemeManager.render();
        });
        await page.waitForTimeout(250);

        const s = await page.evaluate(() => {
            const cs = getComputedStyle(document.querySelector('#theme-swatch-row button'));
            return { image: cs.backgroundImage, color: cs.backgroundColor };
        });
        // The gradient must be cleared, not left underneath the flat colour.
        expect(s.image).toBe('none');
        expect(s.color).toBe('rgb(18, 52, 86)');
    });
});

test.describe('Soft skin (Phase 1)', () => {
    const toSoft = async (page) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1000);
        await page.evaluate(() => window.SkinManager.setSkin('soft'));
        await page.waitForTimeout(600);
    };

    // Contrast ratio per WCAG 2.1, from two "rgb(r, g, b)" strings.
    const contrast = (a, b) => {
        const lum = (s) => {
            const [r, g, bl] = s.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
                const c = v / 255;
                return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        };
        const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (l1 + 0.05) / (l2 + 0.05);
    };

    test('inverts text polarity so labels stay legible on the light ground', async ({ page }) => {
        // The rest of the app paints white text over a dark wallpaper. This skin's ground is
        // near-white, so every one of those labels would vanish if the flip were missed. This is
        // the single most likely thing to break when the skin's container list drifts.
        await toSoft(page);

        const { label, ground } = await page.evaluate(() => ({
            label: getComputedStyle(document.querySelector('.app-label')).color,
            ground: getComputedStyle(document.body, '::before').backgroundColor
        }));

        expect(label).not.toBe('rgb(255, 255, 255)');
        expect(contrast(label, ground)).toBeGreaterThanOrEqual(4.5); // WCAG AA
    });

    test('every Settings section is re-grounded, not left dark under dark text', async ({ page }) => {
        // Regression: the section slabs use bg-[#2c2c2e] and the segmented control bg-black/40.
        // An early version of this skin flipped the TEXT to dark ink but missed those
        // backgrounds, leaving dark-on-dark and an unreadable Settings panel.
        await toSoft(page);
        await page.click('#btn-open-settings');
        await page.waitForTimeout(400);

        const darkSurfaces = await page.evaluate(() => {
            const lum = (s) => {
                const m = s.match(/\d+/g);
                if (!m) return 1;
                return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
            };
            return [...document.querySelectorAll('#settings-panel *')]
                .filter(el => {
                    const bg = getComputedStyle(el).backgroundColor;
                    return bg && !bg.includes('rgba(0, 0, 0, 0)') && lum(bg) < 0.35;
                })
                .map(el => el.className.toString().slice(0, 60));
        });

        // The only legitimately dark things are accent-filled controls (the active segment sits
        // on var(--accent)) and the off-state toggle track — neither carries dark ink.
        const offenders = darkSurfaces.filter(c => !/accent-bg|grid-select-btn|rounded-full/.test(c));
        expect(offenders, `dark surfaces left in Settings: ${offenders.join(' | ')}`).toEqual([]);
    });

    test('the selected segment stays legible on its accent fill', async ({ page }) => {
        // The polarity-flip rule matches .text-gray-300 inside #settings-panel, which outranks a
        // plain .grid-select-btn.active — so the selected segment silently rendered dark ink on
        // the accent fill. Any rule that must beat the flip needs an ID in it too.
        await toSoft(page);
        await page.click('#btn-open-settings');
        await page.waitForTimeout(400);

        const { color, bg } = await page.evaluate(() => {
            const el = document.querySelector('.grid-select-btn.active');
            const cs = getComputedStyle(el);
            return { color: cs.color, bg: cs.backgroundColor };
        });
        expect(contrast(color, bg)).toBeGreaterThanOrEqual(4.5);
    });

    test('switching soft -> dock restores the dark-wallpaper polarity', async ({ page }) => {
        await toSoft(page);
        await page.evaluate(() => window.SkinManager.setSkin('dock'));
        await page.waitForTimeout(600);
        const label = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.app-label')).color);
        expect(label).toBe('rgb(255, 255, 255)');
    });
});

test.describe('Accessibility baselines', () => {
    // Apple HIG puts the minimum tap target at 44x44pt, and WCAG 2.1 AA wants 4.5:1 on normal
    // text. Both were audited by measuring the rendered app rather than by reading the markup:
    // the offenders were the modal close buttons (36 and 40 square), the segmented grid buttons
    // and Library sort pills (34-38 tall) and the search input (23 tall). Compact chips keep
    // their look and carry an invisible centred hit area instead of being made physically
    // bigger, so this test measures the ::after extension too — checking the box alone would
    // pass elements that are still visually tiny, and checking only the box would fail elements
    // that are genuinely fine to tap.
    const measure = (page) => page.evaluate(() => {
        const MIN = 44, bad = [];
        document.querySelectorAll('button, [role="button"], a, input, .app-icon-wrapper').forEach(el => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') return;
            if (el.closest('.pointer-events-none')) return;
            let { width: w, height: h } = r;
            const after = getComputedStyle(el, '::after');
            if (after && after.content === '""') {
                const ah = parseFloat(after.height), aw = parseFloat(after.width);
                if (!isNaN(ah)) h = Math.max(h, ah);
                if (!isNaN(aw)) w = Math.max(w, aw);
            }
            if (w < MIN || h < MIN) {
                bad.push(`${Math.round(w)}x${Math.round(h)} ${(el.id || el.className.toString().slice(0, 40))}`);
            }
        });
        return [...new Set(bad)];
    });

    test('every interactive target meets 44x44 on the home screen', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const bad = await measure(page);
        expect(bad, `under 44x44: ${bad.join(' | ')}`).toEqual([]);
    });

    test('every interactive target meets 44x44 in Settings and Library', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        await page.click('#btn-open-settings');
        await page.waitForTimeout(400);
        let bad = await measure(page);
        expect(bad, `Settings under 44x44: ${bad.join(' | ')}`).toEqual([]);

        await page.click('#btn-close-settings');
        await page.waitForTimeout(400);
        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(500);
        bad = await measure(page);
        expect(bad, `Library under 44x44: ${bad.join(' | ')}`).toEqual([]);
    });

    test('prefers-reduced-motion collapses animation, and the app still works', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const dur = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.app-icon')).transitionDuration);
        expect(parseFloat(dur)).toBeLessThan(0.05);

        // Nothing is disabled — interactions must still complete, just without the motion.
        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(300);
        await expect(page.locator('#library-overlay')).not.toHaveClass(/pointer-events-none/);
        await expect(page.locator('#library-list > div')).not.toHaveCount(0);
    });
});

test.describe('Feedback & Motion settings', () => {
    test('vibration toggle gates every haptic in the app', async ({ page }) => {
        // There are a dozen navigator.vibrate call sites, all routed through one haptic()
        // helper. This asserts the gate actually holds — a new call site that skips the helper
        // would keep buzzing with the setting off, which is how a preference ends up only
        // half-respected.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
            window.__buzzes = [];
            navigator.vibrate = (p) => { window.__buzzes.push(p); return true; };
        });

        await page.click('#btn-open-settings');
        await page.waitForTimeout(300);

        await page.evaluate(() => { window.__buzzes = []; });
        await page.click('[data-grid="4x6"]');
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => window.__buzzes.length)).toBeGreaterThan(0);

        // Turn vibration off, then repeat the same interaction.
        await page.getByText('Vibration', { exact: true }).click();
        await page.waitForTimeout(250);
        expect(await page.evaluate(() => window.OS_STATE.haptics)).toBe(false);

        await page.evaluate(() => { window.__buzzes = []; });
        await page.click('[data-grid="4x7"]');
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => window.__buzzes)).toEqual([]);
    });

    test('animations toggle collapses motion and survives a reload', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.click('#btn-open-settings');
        await page.waitForTimeout(300);

        await page.getByText('Animations', { exact: true }).click();
        await page.waitForTimeout(250);
        expect(await page.evaluate(() => window.OS_STATE.animations)).toBe(false);
        await expect(page.locator('body')).toHaveClass(/no-motion/);

        const dur = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.app-icon')).transitionDuration);
        expect(parseFloat(dur)).toBeLessThan(0.05);

        // HARD RULE 3: persisted the instant it changed, not behind an Apply button.
        await page.reload();
        await page.waitForTimeout(1500);
        await expect(page.locator('body')).toHaveClass(/no-motion/);
        expect(await page.evaluate(() => document.getElementById('animations-toggle').checked)).toBe(false);

        // Still fully usable with motion off.
        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(300);
        await expect(page.locator('#library-list > div')).not.toHaveCount(0);
    });
});

test.describe('Aurora skin (Phase 1)', () => {
    const toAurora = async (page) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.SkinManager.setSkin('aurora'));
        await page.waitForTimeout(700);
    };

    test('keeps the dark polarity — no text inversion, unlike soft', async ({ page }) => {
        // The distinguishing property of this skin: its ground is dark, so the app's native
        // white-on-dark text is already correct and must be left alone. If someone ever copies
        // soft's polarity-flip block into aurora, labels go dark-on-dark and vanish.
        await toAurora(page);
        expect(await page.evaluate(() => document.body.getAttribute('data-skin'))).toBe('aurora');
        const label = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.app-label')).color);
        expect(label).toBe('rgb(255, 255, 255)');
    });

    test('the three blooms stay distinguishable and all retune with the accent', async ({ page }) => {
        // Weighting the mixes toward the accent collapsed all three blooms to one hue and the
        // field read as a flat wash instead of an aurora. Both halves matter: they must differ
        // from each other, AND they must all move when the accent changes.
        await toAurora(page);
        const blooms = () => page.evaluate(() => {
            const cs = getComputedStyle(document.body);
            return ['--aur-bloom-a', '--aur-bloom-b', '--aur-bloom-c']
                .map(v => cs.getPropertyValue(v).trim());
        });

        const before = await blooms();
        expect(new Set(before).size, `blooms collapsed to one hue: ${before.join(' ')}`).toBe(3);

        await page.evaluate(() => window.ThemeManager.applyAccent('#E0432F', true));
        await page.waitForTimeout(300);
        const after = await blooms();
        expect(new Set(after).size).toBe(3);
        after.forEach((c, i) => expect(c).not.toBe(before[i]));
    });

    test('the drifting field freezes under reduced motion', async ({ page }) => {
        // The drift is decorative. It is covered by the global reduced-motion collapse rather
        // than by its own rule, so this checks that coverage actually reaches a pseudo-element
        // animation and not just element transitions.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await toAurora(page);
        const dur = await page.evaluate(() =>
            getComputedStyle(document.body, '::before').animationDuration);
        expect(parseFloat(dur)).toBeLessThan(0.05);
    });
});

test.describe('Classic skin (Phase 1) and the dock/pagination stack', () => {
    test('page dots never overlap the dock, at any height or grid density', async ({ page }) => {
        // Regression: the dots were absolutely positioned at bottom-[90px] while the dock sits at
        // bottom-4, which put them 12px INSIDE the dock's top edge in every skin. A larger fixed
        // offset would not hold either — dock height tracks --app-size, so changing grid density
        // moves the dock top. They now share one flex stack, which is what this asserts survives.
        const gap = () => page.evaluate(() => {
            const dock = document.getElementById('main-dock').getBoundingClientRect();
            const pag = document.getElementById('pagination-container').getBoundingClientRect();
            return dock.top - pag.bottom;
        });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        expect(await gap()).toBeGreaterThan(0);

        await page.setViewportSize({ width: 390, height: 700 });
        await page.waitForTimeout(400);
        expect(await gap()).toBeGreaterThan(0);

        // Grid density changes --app-size, which changes dock height.
        await page.evaluate(() => window.SettingsManager.setGridSize('4x7'));
        await page.waitForTimeout(600);
        expect(await gap()).toBeGreaterThan(0);
    });

    test('classic refines the treatment without moving any layout geometry', async ({ page }) => {
        // The whole contract of this skin: it is the original, polished. If it ever starts
        // changing sizes or spacing it has become a different look and the name is a lie.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const geometry = () => page.evaluate(() => {
            const icon = getComputedStyle(document.querySelector('.app-icon'));
            const grid = getComputedStyle(document.querySelector('.os-grid'));
            const dock = getComputedStyle(document.getElementById('main-dock'));
            return {
                iconW: icon.width, iconH: icon.height, iconRadius: icon.borderRadius,
                gridGap: grid.rowGap, gridPad: grid.padding,
                dockRadius: dock.borderRadius, dockPad: dock.padding
            };
        });
        const treatment = () => page.evaluate(() => ({
            labelShadow: getComputedStyle(document.querySelector('.app-label')).textShadow,
            iconShadow: getComputedStyle(document.querySelector('.app-icon')).boxShadow
        }));

        const geoBefore = await geometry();
        const treatBefore = await treatment();

        await page.evaluate(() => window.SkinManager.setSkin('classic'));
        await page.waitForTimeout(700);
        expect(await page.evaluate(() => document.body.getAttribute('data-skin'))).toBe('classic');

        // Geometry identical...
        expect(await geometry()).toEqual(geoBefore);
        // ...treatment genuinely different.
        const treatAfter = await treatment();
        expect(treatAfter.labelShadow).not.toBe(treatBefore.labelShadow);
        expect(treatAfter.iconShadow).not.toBe(treatBefore.iconShadow);
    });

    test('every skin in the picker applies and leaves the home screen rendering', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        // dock, scancard, glass, soft, aurora, classic — kept in step with the loop below so
        // adding a SKINS entry without a matching case here fails loudly.
        const skins = ['dock', 'scancard', 'glass', 'soft', 'aurora', 'classic'];
        const rendered = await page.evaluate(() =>
            document.querySelectorAll('#skin-picker button').length);
        expect(rendered).toBe(skins.length);

        for (const skin of skins) {
            await page.evaluate((s) => window.SkinManager.setSkin(s), skin);
            await page.waitForTimeout(550);
            expect(await page.evaluate(() => document.body.getAttribute('data-skin'))).toBe(skin);
            await expect(page.locator('.app-icon-wrapper')).not.toHaveCount(0);
            await expect(page.locator('#dock-container svg')).not.toHaveCount(0);
        }
    });
});

test.describe('Quick Add template registry (Phase 2)', () => {
    test('every template is well formed and its icon actually resolves', async ({ page }) => {
        // Icons fail SILENTLY: an unknown lucide name renders an empty tile with no glyph and no
        // console error. Five brand names (instagram, twitter, facebook, youtube, linkedin) were
        // shipping exactly that, because lucide does not carry brand logos. Structure is checked
        // in the same pass so a malformed addition cannot reach the grid either.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const report = await page.evaluate(() => {
            const keys = Object.keys(window.lucide.icons || window.lucide);
            const pascal = (s) => s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');
            const cats = new Set(['popular', 'social', 'personal', 'utility']);
            const malformed = [], missingIcon = [];

            window.QUICK_TEMPLATES.forEach(t => {
                if (!t.id || !t.label || !t.icon || !cats.has(t.cat) ||
                    !Array.isArray(t.fields) || !t.fields.length || typeof t.build !== 'function') {
                    malformed.push(t.id || '(no id)');
                }
                if (!keys.includes(t.icon) && !keys.includes(pascal(t.icon))) missingIcon.push(`${t.id}:${t.icon}`);
            });

            const ids = window.QUICK_TEMPLATES.map(t => t.id);
            return { malformed, missingIcon, total: ids.length, dupes: ids.length - new Set(ids).size };
        });

        expect(report.malformed, `malformed: ${report.malformed.join(', ')}`).toEqual([]);
        expect(report.missingIcon, `unresolved icons: ${report.missingIcon.join(', ')}`).toEqual([]);
        expect(report.dupes, 'duplicate template ids').toBe(0);
        expect(report.total).toBeGreaterThanOrEqual(22);
    });

    test('each type builds the payload its spec requires', async ({ page }) => {
        // Payload format is the whole contract of a code — a scanner does nothing useful with
        // "nearly right". Builders are called directly so all of these are covered without
        // driving 22 forms through the UI.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const built = await page.evaluate(() => {
            const samples = {
                wifi: { ssid: 'Net', sec: 'WPA', pass: 'pw' },
                url: { url: 'example.com' },
                email: { to: 'a@b.com', subject: 'Hi there' },
                phone: { number: '+15551234567' },
                sms: { number: '+15551234567', body: 'yo' },
                contact: { name: 'Jane Doe', phone: '123', email: 'j@d.com' },
                instagram: { handle: '@me' },
                whatsapp: { number: '+1 555-123-4567' },
                youtube: { handle: 'chan' },
                geo: { lat: '51.5007', lng: '-0.1246', label: 'Big Ben' },
                crypto: { coin: 'bitcoin', address: 'bc1qxyz', amount: '0.5' }
            };
            const out = {};
            for (const [id, v] of Object.entries(samples)) {
                const t = window.QUICK_TEMPLATES.find(x => x.id === id);
                out[id] = t ? { data: t.build(v).data, bcid: t.bcid || 'azteccode' } : null;
            }
            return out;
        });

        expect(built.wifi.data).toBe('WIFI:S:Net;T:WPA;P:pw;;');
        expect(built.url.data).toBe('https://example.com');           // scheme added
        expect(built.email.data).toBe('mailto:a@b.com?subject=Hi%20there'); // subject encoded
        expect(built.phone.data).toBe('tel:+15551234567');
        expect(built.sms.data).toBe('sms:+15551234567?body=yo');
        expect(built.contact.data).toContain('BEGIN:VCARD');
        expect(built.contact.data).toContain('FN:Jane Doe');
        expect(built.instagram.data).toBe('https://instagram.com/me'); // leading @ stripped
        expect(built.whatsapp.data).toBe('https://wa.me/15551234567'); // wa.me takes digits only
        expect(built.youtube.data).toBe('https://youtube.com/@chan');
        expect(built.geo.data).toBe('geo:51.5007,-0.1246');
        expect(built.crypto.data).toBe('bitcoin:bc1qxyz?amount=0.5');

        // HARD RULE 6: Aztec everywhere except formats that genuinely need QR.
        expect(built.wifi.bcid).toBe('qrcode');
        expect(built.contact.bcid).toBe('qrcode');
        expect(built.url.bcid).toBe('azteccode');
        expect(built.instagram.bcid).toBe('azteccode');
    });

    test('categories filter the grid, and Popular is the default', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.CodeGenerator.open());
        await page.waitForTimeout(400);

        await expect(page.locator('.tpl-cat-btn[data-cat="popular"]')).toHaveClass(/active/);
        await expect(page.locator('#template-grid button')).toHaveCount(7);

        await page.click('.tpl-cat-btn[data-cat="social"]');
        await page.waitForTimeout(300);
        await expect(page.locator('#template-grid button')).toHaveCount(10);

        await page.click('.tpl-cat-btn[data-cat="utility"]');
        await page.waitForTimeout(300);
        await expect(page.locator('#template-grid button')).toHaveCount(3);

        // Every template must be reachable from some category, or it may as well not exist.
        const totals = await page.evaluate(() => {
            const counts = {};
            window.QUICK_TEMPLATES.forEach(t => { counts[t.cat] = (counts[t.cat] || 0) + 1; });
            return { counts, total: window.QUICK_TEMPLATES.length };
        });
        expect(Object.values(totals.counts).reduce((a, b) => a + b, 0)).toBe(totals.total);
    });

    test('a required field blocks the save centrally', async ({ page }) => {
        // Validation moved out of each per-type branch into one loop over declared fields. If it
        // regresses, a type silently saves a half-empty payload.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const before = await page.evaluate(() => window.OS_STATE.apps.length);

        await page.evaluate(() => window.CodeGenerator.open());
        await page.waitForTimeout(300);
        await page.click('.tpl-cat-btn[data-cat="social"]');
        await page.waitForTimeout(300);
        await page.locator('#template-grid button').first().click(); // Instagram
        await page.click('#tpl-save-btn');                            // handle left empty
        await page.waitForTimeout(400);

        expect(await page.evaluate(() => window.OS_STATE.apps.length)).toBe(before);
        await expect(page.locator('#create-modal')).toHaveClass(/opacity-100/); // stays open
    });

    test('a social template saves end to end through the real UI', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.CodeGenerator.open());
        await page.waitForTimeout(300);
        await page.click('.tpl-cat-btn[data-cat="social"]');
        await page.waitForTimeout(300);
        await page.locator('#template-grid button').first().click();
        await page.fill('#tpl-instagram-handle', '@claude');
        await page.click('#tpl-save-btn');
        await page.waitForTimeout(600);

        const created = await page.evaluate(() => {
            const items = window.OS_STATE.apps.filter(a => a.type === 'grid');
            return items[items.length - 1];
        });
        expect(created.data).toBe('https://instagram.com/claude');
        expect(created.title).toBe('Instagram @claude');
        expect(created.bcid).toBe('azteccode');
    });
});

test.describe('Format browser and encodability (Phase 2)', () => {
    test('every advertised format actually encodes in bwip-js', async ({ page }) => {
        // Offering a format the renderer cannot produce would save codes that render as a blank
        // tile. This proves the registry and the encoder agree, rather than assuming they do.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const failures = await page.evaluate(() => {
            const samples = {
                azteccode: 'hello', qrcode: 'hello', datamatrix: 'hello', pdf417: 'hello',
                code128: 'hello', code39: 'HELLO', code93: 'HELLO', ean13: '123456789012',
                ean8: '1234567', upca: '12345678901', interleaved2of5: '12345678'
            };
            const bad = [];
            for (const f of window.CODE_FORMATS) {
                if (!samples[f.bcid]) { bad.push(`${f.bcid}: no sample in test`); continue; }
                const cv = document.createElement('canvas');
                document.body.appendChild(cv);
                try { bwipjs.toCanvas(cv, { bcid: f.bcid, text: samples[f.bcid], scale: 2 }); }
                catch (e) { bad.push(`${f.bcid}: ${e.message}`); }
                cv.remove();
            }
            return bad;
        });
        expect(failures, failures.join(' | ')).toEqual([]);
    });

    test('format constraints are enforced before save, not silently at render', async ({ page }) => {
        // bwip-js throws on data that does not fit a symbology; that throw is swallowed by the
        // canvas guard, so the old behaviour was a saved code with a blank tile and no
        // explanation. These are the symbologies' real rules.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const v = await page.evaluate(() => ({
            eanLetters: window.validateForFormat('ean13', 'hello'),
            eanShort: window.validateForFormat('ean13', '123'),
            eanOk: window.validateForFormat('ean13', '123456789012'),
            itfOdd: window.validateForFormat('interleaved2of5', '12345'),
            itfOk: window.validateForFormat('interleaved2of5', '123456'),
            code39Lower: window.validateForFormat('code39', 'hello'),
            code39Ok: window.validateForFormat('code39', 'HELLO-1'),
            aztecAnything: window.validateForFormat('azteccode', 'anything at all'),
            empty: window.validateForFormat('qrcode', '')
        }));

        expect(v.eanLetters).toContain('digits');
        expect(v.eanShort).toContain('digits');
        expect(v.eanOk).toBeNull();
        expect(v.itfOdd).toContain('even');
        expect(v.itfOk).toBeNull();
        expect(v.code39Lower).toContain('uppercase');
        expect(v.code39Ok).toBeNull();
        expect(v.aztecAnything).toBeNull(); // 2D formats take arbitrary text
        expect(v.empty).toBeTruthy();
    });

    test('an invalid combination is blocked at save and explained', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const before = await page.evaluate(() => window.OS_STATE.apps.length);

        await page.evaluate(() => window.CodeGenerator.open());
        await page.waitForTimeout(300);
        await page.click('.create-tab-btn[data-mode="custom"]');
        await page.waitForTimeout(300);

        await page.click('#format-picker-btn');
        await page.waitForTimeout(300);
        await page.fill('#format-search', 'EAN-13');
        await page.waitForTimeout(300);
        await page.locator('#format-options button').first().click();
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => document.getElementById('create-input-type').value)).toBe('ean13');

        await page.fill('#create-input-title', 'Test Product');
        await page.fill('#create-input-data', 'not-a-barcode');
        await page.waitForTimeout(300);
        await expect(page.locator('#format-warning')).not.toHaveClass(/hidden/);

        await page.click('#btn-save-create');
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.OS_STATE.apps.length)).toBe(before);

        // Correct the data and it saves.
        await page.fill('#create-input-data', '123456789012');
        await page.waitForTimeout(300);
        await expect(page.locator('#format-warning')).toHaveClass(/hidden/);
        await page.click('#btn-save-create');
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.OS_STATE.apps.length)).toBe(before + 1);
    });

    test('search matches the blurb, not just the format name', async ({ page }) => {
        // The browser exists for people who do not know the format's name — "boarding pass"
        // has to find PDF417, and "retail" the EAN/UPC family.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.CodeGenerator.open());
        await page.waitForTimeout(300);
        await page.click('.create-tab-btn[data-mode="custom"]');
        await page.click('#format-picker-btn');
        await page.waitForTimeout(300);

        await page.fill('#format-search', 'boarding pass');
        await page.waitForTimeout(300);
        await expect(page.locator('#format-options button')).toHaveCount(1);
        await expect(page.locator('#format-options')).toContainText('PDF417');

        await page.fill('#format-search', 'retail');
        await page.waitForTimeout(300);
        await expect(page.locator('#format-options button')).toHaveCount(3); // EAN-13, EAN-8, UPC-A

        await page.fill('#format-search', 'zzzz');
        await page.waitForTimeout(300);
        await expect(page.locator('#format-options')).toContainText('No formats match');
    });
});

test.describe('Code styling and scannability (Phase 2)', () => {
    test('polarity is judged separately from contrast', async ({ page }) => {
        // The rule a contrast-only validator gets wrong. White-on-black scores 21:1 — perfect by
        // any contrast measure — but nearly all scanners expect dark data on a light background.
        // Inverting breaks most 1D laser/CCD readers outright while modern 2D camera decoders
        // usually cope, so the same 21:1 pair must FAIL on EAN-13 and merely WARN on QR.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const v = await page.evaluate(() => ({
            invQR: window.checkScannability('FFFFFF', '000000', 'qrcode'),
            invEAN: window.checkScannability('FFFFFF', '000000', 'ean13'),
            blackOnWhite: window.checkScannability('000000', 'FFFFFF', 'qrcode'),
            greyOnGrey: window.checkScannability('888888', '999999', 'qrcode'),
            midContrast: window.checkScannability('6B7280', 'FFFFFF', 'qrcode')
        }));

        expect(v.invQR.ratio).toBeCloseTo(21, 0);
        expect(v.invEAN.ratio).toBeCloseTo(21, 0);
        expect(v.invQR.level).toBe('warn');   // same ratio...
        expect(v.invEAN.level).toBe('fail');  // ...opposite verdict
        expect(v.invEAN.message).toMatch(/1D|swap/i);

        expect(v.blackOnWhite.level).toBe('ok');
        expect(v.greyOnGrey.level).toBe('fail');
        expect(v.midContrast.level).toBe('warn'); // passes text AA, not good enough to scan
    });

    test('an unscannable pair is blocked at save; a merely imperfect one is not', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const before = await page.evaluate(() => window.OS_STATE.apps.length);

        await page.evaluate(() => window.CodeGenerator.open());
        await page.waitForTimeout(300);
        await page.click('.create-tab-btn[data-mode="custom"]');
        await page.fill('#create-input-title', 'Styled');
        await page.fill('#create-input-data', 'hello world');
        await page.waitForTimeout(300);

        // fail: no usable contrast
        await page.evaluate(() => {
            window.CodeGenerator.fg = '888888';
            window.CodeGenerator.bg = '999999';
            window.CodeGenerator.renderStyleRows();
        });
        await page.click('#btn-save-create');
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.OS_STATE.apps.length)).toBe(before);

        // warn: readable but not ideal — must still save
        await page.evaluate(() => {
            window.CodeGenerator.fg = '6B7280';
            window.CodeGenerator.bg = 'FFFFFF';
            window.CodeGenerator.renderStyleRows();
        });
        await page.click('#btn-save-create');
        await page.waitForTimeout(600);
        expect(await page.evaluate(() => window.OS_STATE.apps.length)).toBe(before + 1);

        const created = await page.evaluate(() => {
            const items = window.OS_STATE.apps.filter(a => a.type === 'grid');
            return items[items.length - 1];
        });
        expect(created.fg).toBe('6B7280');
        expect(created.bg).toBeUndefined(); // default bg is not stored
    });

    test('custom colours reach every place a code is drawn', async ({ page }) => {
        // Home grid, search, library and the fullscreen viewer each had their own hardcoded
        // black-on-white option object. They now share one renderCode path, so a styled code
        // cannot render correctly in one surface and plain in another.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const painted = await page.evaluate(async () => {
            window.OS_STATE.apps.push({
                id: 'bc_styled', title: 'Styled', type: 'grid', page: 0, order: 21,
                bcid: 'qrcode', data: 'styled-code', fg: 'B0195F', bg: 'FFF7E6'
            });
            window.Renderer.render();
            await new Promise(r => setTimeout(r, 400));

            const cv = document.getElementById('can-bc_styled');
            if (!cv || !cv.width) return { drawn: false };
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            const seen = new Set();
            for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i+1]},${d[i+2]}`);
            return { drawn: true, hasFg: seen.has('176,25,95'), hasBg: seen.has('255,247,230') };
        });

        expect(painted.drawn).toBe(true);
        expect(painted.hasFg, 'foreground colour missing from the rendered tile').toBe(true);
        expect(painted.hasBg, 'background colour missing from the rendered tile').toBe(true);
    });

    test('a code with no stored colours still renders black on white', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const painted = await page.evaluate(() => {
            const cv = document.querySelector('.app-icon-wrapper canvas');
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            const seen = new Set();
            for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i+1]},${d[i+2]}`);
            return { black: seen.has('0,0,0'), white: seen.has('255,255,255') };
        });
        expect(painted.black && painted.white).toBe(true);
    });
});

test.describe('Payload parser (Phase 3)', () => {
    test('classifies every payload type, and orders the rules correctly', async ({ page }) => {
        // Extracted from an if-chain inside the scanner's success handler that mixed detection
        // with DOM writes, so none of it was testable. Rule ORDER is the fragile part: specific
        // prefixes must beat the loose bare-text heuristics, or MECARD: parses as plain text and
        // a 13-digit product barcode parses as a phone number.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const r = await page.evaluate(() => {
            const cases = {
                url: 'https://example.com/x', bareDomain: 'example.com',
                wifi: 'WIFI:S:MyNet;T:WPA;P:pw;;',
                vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nEND:VCARD',
                mecard: 'MECARD:N:Smith,John;;',
                event: 'BEGIN:VEVENT\nSUMMARY:Standup\nEND:VEVENT',
                geo: 'geo:51.5007,-0.1246', crypto: 'bitcoin:bc1qxyz?amount=0.5',
                mailto: 'mailto:a@b.com', bareEmail: 'a@b.com',
                tel: 'tel:+15551234567', barePhone: '+1 555 123 4567',
                sms: 'sms:+15551234567',
                ean13: '5012345678900', ean8: '12345678',
                prose: 'just some words here', empty: ''
            };
            const out = {};
            for (const [k, v] of Object.entries(cases)) out[k] = window.parsePayload(v);
            return out;
        });

        expect(r.url.type).toBe('url');
        expect(r.url.title).toBe('example.com');          // hostname, not the whole URL
        expect(r.bareDomain.primary.href).toBe('https://example.com'); // scheme added
        expect(r.wifi.type).toBe('wifi');
        expect(r.wifi.fields.ssid).toBe('MyNet');         // regressed once: SSID came back empty
        expect(r.vcard.type).toBe('vcard');
        expect(r.vcard.fields.name).toBe('Jane Doe');
        expect(r.mecard.type).toBe('mecard');             // must beat the plain-text fallback
        expect(r.event.fields.summary).toBe('Standup');
        expect(r.geo.type).toBe('geo');
        expect(r.geo.primary.href).toContain('maps.google.com');
        expect(r.crypto.type).toBe('crypto');
        expect(r.mailto.type).toBe('email');
        expect(r.bareEmail.primary.href).toBe('mailto:a@b.com');
        expect(r.tel.type).toBe('phone');
        expect(r.barePhone.type).toBe('phone');
        expect(r.sms.type).toBe('sms');
        expect(r.prose.type).toBe('text');
        expect(r.empty.type).toBe('empty');

        // Retail lengths must beat the phone heuristic, which would otherwise claim them.
        expect(r.ean13.type).toBe('product');
        expect(r.ean8.type).toBe('product');
        expect(r.ean13.lookups.length).toBe(4);
        expect(r.ean13.lookups[0].url).toContain('5012345678900');
    });

    test('the parser never navigates — it only describes', async ({ page }) => {
        // Purity is what makes the rules above testable without a camera. If a branch ever
        // reintroduces a side effect, this catches it.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const before = page.url();
        await page.evaluate(() => {
            ['https://example.com', 'tel:+15551234567', 'mailto:a@b.com', 'geo:1,2']
                .forEach(t => window.parsePayload(t));
        });
        await page.waitForTimeout(300);
        expect(page.url()).toBe(before);
    });
});

test.describe('Generate → decode round trip (Phase 3)', () => {
    test('a generated code decodes back to exactly what went in', async ({ page }) => {
        // The strongest check in this suite: bwip-js encodes, html5-qrcode decodes the resulting
        // image, and the text must survive unchanged. It covers the whole pipeline — payload
        // building, rendering and reading — without needing a camera, and it is what makes the
        // scan-from-image feature verifiable at all.
        await page.goto('/index.html');
        await page.waitForTimeout(1500);

        const results = await page.evaluate(async () => {
            const payloads = [
                'https://example.com/roundtrip',
                'WIFI:S:MyNet;T:WPA;P:pw;;',
                '5012345678900',
                'BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nEND:VCARD'
            ];
            const out = [];
            for (const text of payloads) {
                const cv = document.createElement('canvas');
                document.body.appendChild(cv);
                bwipjs.toCanvas(cv, { bcid: 'qrcode', text, scale: 6, padding: 10,
                                      backgroundcolor: 'ffffff', barcolor: '000000' });
                const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
                cv.remove();

                const host = document.createElement('div');
                host.id = 'rt-host';
                host.style.display = 'none';
                document.body.appendChild(host);
                try {
                    const decoded = await new Html5Qrcode(host.id)
                        .scanFile(new File([blob], 'c.png', { type: 'image/png' }), false);
                    out.push({ text, decoded });
                } catch (e) {
                    out.push({ text, decoded: 'DECODE FAILED: ' + e });
                } finally { host.remove(); }
            }
            return out;
        });

        for (const { text, decoded } of results) expect(decoded).toBe(text);
    });

    test('scan-from-image feeds a decoded photo through the same result path', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1500);

        const shown = await page.evaluate(async () => {
            const text = 'https://example.com/from-photo';
            const cv = document.createElement('canvas');
            document.body.appendChild(cv);
            bwipjs.toCanvas(cv, { bcid: 'qrcode', text, scale: 6, padding: 10,
                                  backgroundcolor: 'ffffff', barcolor: '000000' });
            const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
            cv.remove();

            await window.ScannerEngine.scanFromImage(new File([blob], 'photo.png', { type: 'image/png' }));
            await new Promise(r => setTimeout(r, 600));
            return {
                data: document.getElementById('scan-result-data').innerText,
                label: document.getElementById('scan-result-format').innerText,
                parsedType: window.ScannerEngine.parsedResult && window.ScannerEngine.parsedResult.type
            };
        });

        expect(shown.data).toBe('https://example.com/from-photo');
        expect(shown.parsedType).toBe('url');
        expect(shown.label).toContain('WEBSITE');
    });
});

test.describe('History and batch scanning (Phase 3)', () => {
    test('history logs scans and creations separately, and dedupes', async ({ page }) => {
        // History is deliberately separate from OS_STATE.apps: the home screen is curated, the
        // log is not, and merging them would litter the grid with every incidental scan.
        // Re-scanning the same label is the normal case, so a repeat refreshes position rather
        // than stacking duplicates.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const r = await page.evaluate(() => {
            window.OS_STATE.history = [];
            window.recordHistory({ data: 'https://a.example', source: 'scanned' });
            window.recordHistory({ data: '5012345678900', source: 'scanned' });
            window.recordHistory({ data: 'https://a.example', source: 'scanned' });
            window.recordHistory({ data: 'made-this', source: 'created', title: 'Mine' });
            const h = window.OS_STATE.history;
            return {
                total: h.length,
                scanned: h.filter(x => x.source === 'scanned').length,
                created: h.filter(x => x.source === 'created').length,
                newestFirst: h[0].data,
                derivedTitle: h.find(x => x.data === 'https://a.example').title
            };
        });

        expect(r.total).toBe(3);          // four calls, one was a repeat
        expect(r.scanned).toBe(2);
        expect(r.created).toBe(1);
        expect(r.newestFirst).toBe('made-this');
        expect(r.derivedTitle).toBe('a.example'); // titled by the payload parser
    });

    test('history is capped and never breaks the caller', async ({ page }) => {
        // localStorage is finite and a scanning session fills fast. Without a cap this grows
        // until a save throws QuotaExceededError and takes the rest of OS_STATE with it.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
            window.OS_STATE.history = [];
            for (let i = 0; i < 260; i++) window.recordHistory({ data: 'code-' + i, source: 'scanned' });
            const bad = window.recordHistory({ data: '', source: 'scanned' }); // junk must not throw
            return { len: window.OS_STATE.history.length, bad, newest: window.OS_STATE.history[0].data };
        });
        expect(r.len).toBeLessThanOrEqual(200);
        expect(r.newest).toBe('code-259');   // newest kept, oldest dropped
        expect(r.bad).toBeNull();
    });

    test('history stays out of the cloud payload', async ({ page }) => {
        // Device-local by construction, like the wallpaper (HARD RULE 4). The sync payload is an
        // explicit allowlist, and this asserts history was never added to it.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        // Read the real source rather than a re-serialised DOM, and take the whole object
        // literal so the check cannot pass by accident on a truncated slice.
        const src = await (await fetch('http://localhost:4173/index.html')).text();
        const start = src.indexOf('await setDoc(ref, {');
        expect(start, 'sync payload not found').toBeGreaterThan(-1);
        const payload = src.slice(start, src.indexOf('});', start));
        expect(payload).toContain('apps:');          // sanity: we sliced the right block
        // Match the KEY, not the bare word — the comment above the payload explains why history
        // is excluded, and searching for the word alone matched that prose instead of any code.
        const keys = [...payload.matchAll(/^\s*([a-zA-Z_$][\w$]*)\s*:/gm)].map(m => m[1]);
        expect(keys, `sync keys: ${keys.join(', ')}`).not.toContain('history');
        expect(keys).toContain('apps');
    });

    test('the Library switches between saved, scanned and created', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
            window.OS_STATE.history = [];
            window.recordHistory({ data: 'https://scanned.example', source: 'scanned' });
            window.recordHistory({ data: 'https://made.example', source: 'created' });
        });

        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(600);
        const saved = await page.locator('#library-list > div').count();
        expect(saved).toBeGreaterThan(0);

        await page.click('.library-src-btn[data-source="scanned"]');
        await page.waitForTimeout(400);
        await expect(page.locator('#library-list > div')).toHaveCount(1);
        await expect(page.locator('#library-count')).toContainText('scanned');
        // "Page 1" is meaningless for a log entry; history rows show when instead.
        await expect(page.locator('#library-list')).not.toContainText('Page 1');

        await page.click('.library-src-btn[data-source="created"]');
        await page.waitForTimeout(400);
        await expect(page.locator('#library-list > div')).toHaveCount(1);
        await expect(page.locator('#library-list')).toContainText('made.example');
    });

    test('batch mode collects without stopping, dedupes, and saves all at once', async ({ page }) => {
        // The whole point of batch is that the camera keeps running. A duplicate must not be
        // added — a camera re-reads the same label many times a second, so without dedupe one
        // code fills the tray before the phone can be moved.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const collected = await page.evaluate(() => {
            const S = window.ScannerEngine;
            window.OS_STATE.history = [];
            S.toggleBatch();
            S.handleSuccess('https://one.example', 'QR_CODE');
            S.handleSuccess('https://two.example', 'QR_CODE');
            S.handleSuccess('https://one.example', 'QR_CODE'); // repeat frame
            return {
                mode: S.batchMode,
                count: S.batch.length,
                // No single-result sheet, and nothing logged yet — a code removed from the tray
                // must never reach history.
                sheetStillHidden: document.getElementById('scanner-result-sheet').classList.contains('translate-y-full'),
                historyEmpty: window.OS_STATE.history.length === 0
            };
        });
        expect(collected.mode).toBe(true);
        expect(collected.count).toBe(2);
        expect(collected.sheetStillHidden).toBe(true);
        expect(collected.historyEmpty).toBe(true);

        const saved = await page.evaluate(() => {
            const before = window.OS_STATE.apps.filter(a => a.type === 'grid').length;
            window.ScannerEngine.saveBatch();
            return {
                added: window.OS_STATE.apps.filter(a => a.type === 'grid').length - before,
                logged: window.OS_STATE.history.length,
                trayCleared: window.ScannerEngine.batch.length
            };
        });
        expect(saved.added).toBe(2);
        expect(saved.logged).toBe(2);
        expect(saved.trayCleared).toBe(0);
    });
});

test.describe('Starred history and sharing (Phase 3)', () => {
    test('starring pins an entry above every sort order', async ({ page }) => {
        // A star means "I want to find this again", which no ordering rule should bury.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
            window.OS_STATE.history = [];
            window.recordHistory({ data: 'https://zebra.example', source: 'scanned', title: 'Zebra' });
            window.recordHistory({ data: 'https://apple.example', source: 'scanned', title: 'Apple' });
            window.recordHistory({ data: 'https://mango.example', source: 'scanned', title: 'Mango' });
        });

        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(500);
        await page.click('.library-src-btn[data-source="scanned"]');
        await page.waitForTimeout(400);

        // Star the oldest (last by Recent, last by Name too).
        const zebraRow = page.locator('#library-list > div').filter({ hasText: 'Zebra' });
        await zebraRow.locator('.lib-star').click();
        await page.waitForTimeout(400);

        expect(await page.evaluate(() =>
            window.OS_STATE.history.find(h => h.title === 'Zebra').starred)).toBe(true);

        const firstTitle = () => page.locator('#library-list h4').first().textContent();
        expect((await firstTitle()).trim()).toBe('Zebra');   // pinned under Recent

        await page.click('.library-sort-btn[data-sort="name"]');
        await page.waitForTimeout(400);
        expect((await firstTitle()).trim()).toBe('Zebra');   // still pinned under Name
    });

    test('the star does not open the item viewer underneath it', async ({ page }) => {
        // The row has its own click handler; without stopPropagation, starring also launches
        // the viewer every single time.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
            window.OS_STATE.history = [];
            window.recordHistory({ data: 'https://one.example', source: 'scanned', title: 'One' });
        });
        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(500);
        await page.click('.library-src-btn[data-source="scanned"]');
        await page.waitForTimeout(400);

        await page.locator('.lib-star').first().click();
        await page.waitForTimeout(500);
        await expect(page.locator('#item-fullscreen-layer')).toHaveClass(/pointer-events-none/);
        await expect(page.locator('#library-overlay')).not.toHaveClass(/pointer-events-none/);
    });

    test('share falls back to the clipboard when there is no share sheet', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const copied = await page.evaluate(async () => {
            delete navigator.share;                       // simulate a desktop browser
            window.ScannerEngine.currentResult = 'https://shared.example';
            await window.ScannerEngine.shareResult();
            return await navigator.clipboard.readText();
        });
        expect(copied).toBe('https://shared.example');
    });

    test('cancelling a share is not reported as a failure', async ({ page }) => {
        // navigator.share rejects identically on cancel and on error. Treating a cancel as an
        // error tells someone their deliberate action went wrong.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const toasts = await page.evaluate(async () => {
            const seen = [];
            const realToast = window.showToast;
            window.showToast = (m, t) => { seen.push(`${t || 'success'}: ${m}`); realToast(m, t); };
            navigator.share = () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
            window.ScannerEngine.currentResult = 'https://cancelled.example';
            await window.ScannerEngine.shareResult();
            return seen;
        });
        expect(toasts).toEqual([]);
    });
});

test.describe('Backup and restore (Phase 4)', () => {
    test('a backup round-trips onto a fresh device with nothing lost', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const backup = await page.evaluate(() => {
            window.OS_STATE.apps = window.OS_STATE.apps.filter(a => a.type !== 'grid');
            window.OS_STATE.apps.push(
                { id: 'bc_a', title: 'Alpha', type: 'grid', page: 0, order: 0, bcid: 'qrcode', data: 'alpha-payload' },
                { id: 'bc_b', title: 'Beta', type: 'grid', page: 1, order: 0, bcid: 'azteccode', data: 'beta-payload' });
            window.OS_STATE.history = [];
            window.recordHistory({ data: 'https://logged.example', source: 'scanned' });
            window.OS_STATE.skin = 'aurora';
            window.OS_STATE.accent = '#E0432F';
            return JSON.stringify(window.buildBackup());
        });

        // Simulate a fresh install, then restore.
        const restored = await page.evaluate((json) => {
            window.OS_STATE.apps = window.OS_STATE.apps.filter(a => a.type !== 'grid');
            window.OS_STATE.history = [];
            window.OS_STATE.skin = 'dock';
            window.OS_STATE.accent = '#3b82f6';

            const res = window.applyBackup(json);
            return {
                res,
                codes: window.OS_STATE.apps.filter(a => a.type === 'grid').map(a => a.data).sort(),
                history: window.OS_STATE.history.length,
                skin: window.OS_STATE.skin,
                accent: window.OS_STATE.accent
            };
        }, backup);

        expect(restored.res.ok).toBe(true);
        expect(restored.res.added).toBe(2);
        expect(restored.codes).toEqual(['alpha-payload', 'beta-payload']);
        expect(restored.history).toBe(1);
        expect(restored.skin).toBe('aurora');      // preferences restored too
        expect(restored.accent).toBe('#E0432F');
    });

    test('restoring never deletes what is already on the device', async ({ page }) => {
        // The single most important property here. A destructive restore is a one-tap way to
        // lose everything, and a confirmation dialog is not a substitute for not doing it.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const out = await page.evaluate(() => {
            window.OS_STATE.apps = window.OS_STATE.apps.filter(a => a.type !== 'grid');
            window.OS_STATE.apps.push({ id: 'bc_keep', title: 'Keep Me', type: 'grid', page: 0, order: 0,
                                        bcid: 'qrcode', data: 'existing-payload' });
            const backup = {
                format: 'xancode-os-backup', version: 1,
                state: { apps: [
                    { id: 'x', title: 'From Backup', type: 'grid', page: 0, order: 1, bcid: 'qrcode', data: 'backup-payload' },
                    { id: 'y', title: 'Duplicate', type: 'grid', page: 0, order: 2, bcid: 'qrcode', data: 'existing-payload' }
                ] }
            };
            const res = window.applyBackup(backup);
            return { res, payloads: window.OS_STATE.apps.filter(a => a.type === 'grid').map(a => a.data).sort() };
        });

        expect(out.res.ok).toBe(true);
        expect(out.res.added).toBe(1);                              // the duplicate was skipped
        expect(out.payloads).toEqual(['backup-payload', 'existing-payload']);
    });

    test('a bad file fails cleanly with the state untouched', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const out = await page.evaluate(() => {
            const before = window.OS_STATE.apps.length;
            const results = {
                notJson: window.applyBackup('this is not json'),
                wrongFormat: window.applyBackup(JSON.stringify({ format: 'something-else' })),
                noApps: window.applyBackup(JSON.stringify({ format: 'xancode-os-backup', version: 1, state: {} })),
                tooNew: window.applyBackup(JSON.stringify({ format: 'xancode-os-backup', version: 99, state: { apps: [] } }))
            };
            return { results, unchanged: window.OS_STATE.apps.length === before };
        });

        for (const [name, r] of Object.entries(out.results)) {
            expect(r.ok, `${name} should have been rejected`).toBe(false);
            expect(r.error, `${name} needs an explanation`).toBeTruthy();
        }
        expect(out.unchanged).toBe(true);
    });

    test('CSV export escapes payloads that contain commas and quotes', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const csv = await page.evaluate(() => {
            window.OS_STATE.apps = window.OS_STATE.apps.filter(a => a.type !== 'grid');
            window.OS_STATE.apps.push({ id: 'bc_c', title: 'Tricky, "quoted"', type: 'grid', page: 0,
                                        order: 0, bcid: 'qrcode', data: 'a,b,"c"' });
            return window.buildCsv();
        });
        expect(csv.split('\n')[0]).toBe('title,data,format,page');
        expect(csv).toContain('"Tricky, ""quoted"""');
        expect(csv).toContain('"a,b,""c"""');
    });
});

test.describe('Bulk operations (Phase 4)', () => {
    const openLib = async (page) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(500);
    };

    test('select mode picks rows instead of opening them', async ({ page }) => {
        await openLib(page);
        await page.click('#btn-library-select');
        await page.waitForTimeout(300);

        await page.locator('#library-list > div').first().click();
        await page.waitForTimeout(300);

        await expect(page.locator('#select-count')).toContainText('1 selected');
        // The row's normal action must not fire while selecting.
        await expect(page.locator('#item-fullscreen-layer')).toHaveClass(/pointer-events-none/);
        await expect(page.locator('#library-overlay')).not.toHaveClass(/pointer-events-none/);
    });

    test('deleting a selection removes exactly those codes', async ({ page }) => {
        await openLib(page);
        const before = await page.evaluate(() =>
            window.OS_STATE.apps.filter(a => a.type === 'grid').map(a => a.title));

        await page.click('#btn-library-select');
        await page.waitForTimeout(300);
        await page.locator('#library-list > div').first().click();
        await page.waitForTimeout(300);
        const targetTitle = (await page.locator('#library-list h4').first().textContent()).trim();

        await page.click('#btn-select-delete');
        await page.waitForTimeout(500);

        const after = await page.evaluate(() =>
            window.OS_STATE.apps.filter(a => a.type === 'grid').map(a => a.title));
        expect(after.length).toBe(before.length - 1);
        expect(after).not.toContain(targetTitle);
    });

    test('changing the view drops the selection', async ({ page }) => {
        // A selection that survives a filter or source switch lets Delete remove things the
        // person cannot currently see — the worst possible surprise for a destructive action.
        await openLib(page);
        await page.click('#btn-library-select');
        await page.waitForTimeout(300);
        await page.locator('#library-list > div').first().click();
        await page.waitForTimeout(300);
        await expect(page.locator('#select-count')).toContainText('1 selected');

        await page.click('.library-src-btn[data-source="scanned"]');
        await page.waitForTimeout(400);
        await expect(page.locator('#select-count')).toContainText('Nothing selected');

        await page.click('.library-src-btn[data-source="saved"]');
        await page.waitForTimeout(400);
        await page.fill('#library-search', 'wifi');
        await page.waitForTimeout(400);
        await expect(page.locator('#select-count')).toContainText('Nothing selected');
    });

    test('All toggles, and delete only ever touches the active source', async ({ page }) => {
        await openLib(page);
        await page.evaluate(() => {
            window.OS_STATE.history = [];
            window.recordHistory({ data: 'https://kept.example', source: 'scanned' });
        });

        await page.click('#btn-library-select');
        await page.waitForTimeout(300);
        await page.click('#btn-select-all');
        await page.waitForTimeout(300);
        const savedCount = await page.evaluate(() =>
            window.OS_STATE.apps.filter(a => a.type === 'grid').length);
        await expect(page.locator('#select-count')).toContainText(`${savedCount} selected`);

        await page.click('#btn-select-all');          // second tap clears
        await page.waitForTimeout(300);
        await expect(page.locator('#select-count')).toContainText('Nothing selected');

        // Delete everything under Saved; history must be untouched.
        await page.click('#btn-select-all');
        await page.waitForTimeout(200);
        await page.click('#btn-select-delete');
        await page.waitForTimeout(500);

        const state = await page.evaluate(() => ({
            saved: window.OS_STATE.apps.filter(a => a.type === 'grid').length,
            history: window.OS_STATE.history.length
        }));
        expect(state.saved).toBe(0);
        expect(state.history).toBe(1);   // a different source was never in scope
    });

    test('history entries can be deleted in bulk too', async ({ page }) => {
        await openLib(page);
        await page.evaluate(() => {
            window.OS_STATE.history = [];
            window.recordHistory({ data: 'https://a.example', source: 'scanned' });
            window.recordHistory({ data: 'https://b.example', source: 'scanned' });
        });
        await page.click('.library-src-btn[data-source="scanned"]');
        await page.waitForTimeout(400);
        await page.click('#btn-library-select');
        await page.waitForTimeout(300);
        await page.click('#btn-select-all');
        await page.waitForTimeout(300);
        await page.click('#btn-select-delete');
        await page.waitForTimeout(500);

        expect(await page.evaluate(() => window.OS_STATE.history.length)).toBe(0);
    });
});

test.describe('Named pages (Phase 4)', () => {
    test('the chip appears in edit mode so an unnamed page can be named', async ({ page }) => {
        // A rename control only visible once a thing is already named cannot be used to name it.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await expect(page.locator('#page-name-chip')).toHaveClass(/hidden/);

        await page.evaluate(() => {
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(400);
        await expect(page.locator('#page-name-chip')).not.toHaveClass(/hidden/);
        await expect(page.locator('#page-name-chip')).toContainText('Name page 1');
    });

    test('naming a page persists, shows outside edit mode, and clears when emptied', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        await page.evaluate(() => {
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(300);
        await page.click('#page-name-chip');
        await page.waitForTimeout(300);
        await page.fill('#rename-input', 'Travel');
        await page.click('#btn-save-rename');
        await page.waitForTimeout(400);

        expect(await page.evaluate(() => window.OS_STATE.pageNames[0])).toBe('Travel');

        // Visible outside edit mode once it has a name.
        await page.evaluate(() => {
            window.OS_STATE.isEditMode = false;
            document.body.classList.remove('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(400);
        await expect(page.locator('#page-name-chip')).not.toHaveClass(/hidden/);
        await expect(page.locator('#page-name-chip')).toContainText('Travel');

        // Emptying the field must clear the name, not store an empty string — otherwise there is
        // no way back to an unnamed page.
        await page.evaluate(() => {
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(300);
        await page.click('#page-name-chip');
        await page.waitForTimeout(300);
        await page.fill('#rename-input', '');
        await page.click('#btn-save-rename');
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.OS_STATE.pageNames[0])).toBeUndefined();
    });

    test('the chip does nothing outside edit mode', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
            window.OS_STATE.pageNames = ['Work'];
            window.Renderer.updatePageChip(0);
        });
        await page.waitForTimeout(300);
        await page.click('#page-name-chip');
        await page.waitForTimeout(400);
        await expect(page.locator('#rename-modal')).toHaveClass(/pointer-events-none/);
    });

    test('the generic prompt does not leak into the next item rename', async ({ page }) => {
        // promptFor and openRename share one modal. If the generic callback is not disarmed,
        // renaming a code afterwards runs the page-naming handler instead.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        await page.evaluate(() => {
            window.InteractionManager.promptFor({
                heading: 'Test', value: '', onSave: () => { window.__leaked = true; }
            });
            window.InteractionManager.closeRename();          // cancelled
            const item = window.OS_STATE.apps.find(a => a.type === 'grid');
            window.InteractionManager.openRename(item);
        });
        await page.fill('#rename-input', 'Renamed Properly');
        await page.click('#btn-save-rename');
        await page.waitForTimeout(400);

        expect(await page.evaluate(() => window.__leaked)).toBeUndefined();
        expect(await page.evaluate(() =>
            window.OS_STATE.apps.some(a => a.title === 'Renamed Properly'))).toBe(true);
    });
});

test.describe('Folders (Phase 4)', () => {
    test('membership is derived, never a second copy of the truth', async ({ page }) => {
        // Codes stay in OS_STATE.apps and carry a folderId; the folder holds no child list. A
        // folder keeping its own list would drift the first time a code was deleted elsewhere
        // while the folder still named it.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const r = await page.evaluate(() => {
            const ids = window.OS_STATE.apps.filter(a => a.type === 'grid').map(a => a.id);
            const folder = window.createFolderFrom(ids[1], ids[0]);
            const before = window.folderChildren(folder.id).length;
            // Delete a member the way the Library would, with no folder bookkeeping at all.
            window.OS_STATE.apps = window.OS_STATE.apps.filter(a => a.id !== ids[1]);
            return { folderKeys: Object.keys(folder), before, after: window.folderChildren(folder.id).length };
        });

        expect(r.folderKeys).not.toContain('children');   // nothing to keep in step
        expect(r.before).toBe(2);
        expect(r.after).toBe(1);                          // membership just follows
    });

    test('a folder dissolves rather than lingering with one code', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
            const ids = window.OS_STATE.apps.filter(a => a.type === 'grid').map(a => a.id);
            const f = window.createFolderFrom(ids[1], ids[0]);
            const res = window.removeFromFolder(ids[1]);
            return {
                dissolved: res.dissolved,
                foldersLeft: window.OS_STATE.apps.filter(a => a.type === 'folder').length,
                onGrid: window.OS_STATE.apps.filter(a => a.type === 'grid' && !a.folderId).length
            };
        });
        expect(r.dissolved).toBe(true);
        expect(r.foldersLeft).toBe(0);
        expect(r.onGrid).toBe(3);   // both codes back out, nothing lost
    });

    test('deleting a folder frees its codes instead of taking them with it', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const r = await page.evaluate(async () => {
            const ids = window.OS_STATE.apps.filter(a => a.type === 'grid').map(a => a.id);
            const f = window.createFolderFrom(ids[1], ids[0]);
            window.addToFolder(f.id, ids[2]);
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
            await new Promise(res => setTimeout(res, 300));

            document.querySelector(`[data-id="${f.id}"] .edit-only`).click();
            await new Promise(res => setTimeout(res, 500));
            return {
                folders: window.OS_STATE.apps.filter(a => a.type === 'folder').length,
                codes: window.OS_STATE.apps.filter(a => a.type === 'grid').length,
                orphaned: window.OS_STATE.apps.filter(a => a.type === 'grid' && a.folderId).length
            };
        });
        expect(r.folders).toBe(0);
        expect(r.codes).toBe(3);     // every code survived
        expect(r.orphaned).toBe(0);  // and none left pointing at a folder that is gone
    });

    test('dragging one icon onto another and dwelling creates a folder', async ({ page }) => {
        // The real gesture, driven with pointer events. Dwell is what separates "moving past
        // this" from "I mean this one".
        await page.goto('/index.html');
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(500);

        const boxes = await page.evaluate(() => {
            const icons = [...document.querySelectorAll('#workspace-pager .app-icon-wrapper')].slice(0, 2);
            return icons.map(el => { const r = el.getBoundingClientRect();
                return { id: el.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        });

        await page.mouse.move(boxes[1].x, boxes[1].y);
        await page.mouse.down();
        await page.mouse.move(boxes[1].x + 12, boxes[1].y + 12, { steps: 3 });  // engage
        await page.mouse.move(boxes[0].x, boxes[0].y, { steps: 12 });           // onto the target
        await page.waitForTimeout(900);                                          // dwell past 550ms
        await page.mouse.up();
        await page.waitForTimeout(800);

        const r = await page.evaluate(() => ({
            folders: window.OS_STATE.apps.filter(a => a.type === 'folder').length,
            filed: window.OS_STATE.apps.filter(a => a.folderId).length
        }));
        expect(r.folders).toBe(1);
        expect(r.filed).toBe(2);
    });

    test('a quick pass over an icon still reorders instead of making a folder', async ({ page }) => {
        // The other half of the contract. Without the dwell timer every reorder that crossed an
        // icon would try to merge.
        await page.goto('/index.html');
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(500);

        const boxes = await page.evaluate(() => {
            const icons = [...document.querySelectorAll('#workspace-pager .app-icon-wrapper')].slice(0, 2);
            return icons.map(el => { const r = el.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        });

        await page.mouse.move(boxes[1].x, boxes[1].y);
        await page.mouse.down();
        await page.mouse.move(boxes[1].x + 12, boxes[1].y + 12, { steps: 3 });
        await page.mouse.move(boxes[0].x, boxes[0].y, { steps: 10 });
        await page.mouse.up();                       // released immediately — no dwell
        await page.waitForTimeout(800);

        expect(await page.evaluate(() =>
            window.OS_STATE.apps.filter(a => a.type === 'folder').length)).toBe(0);
    });
});

test.describe('Tags (Phase 4)', () => {
    test('tags normalise so one label does not become three', async ({ page }) => {
        // "Work", "work" and " work " are the same intent. Letting them coexist gives three
        // filter chips each showing a third of your codes.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
            const id = window.OS_STATE.apps.find(a => a.type === 'grid').id;
            const results = [
                window.addTag(id, 'Work'),
                window.addTag(id, ' work '),   // same tag
                window.addTag(id, 'WORK'),     // same again
                window.addTag(id, 'travel'),
                window.addTag(id, '   ')       // nothing at all
            ];
            const item = window.OS_STATE.apps.find(a => a.id === id);
            return { results, tags: item.tags };
        });
        expect(r.results).toEqual([true, false, false, true, false]);
        expect(r.tags).toEqual(['work', 'travel']);
    });

    test('removing the last tag drops the key entirely', async ({ page }) => {
        // Keeps untagged items clean in backups and the sync payload.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
            const id = window.OS_STATE.apps.find(a => a.type === 'grid').id;
            window.addTag(id, 'solo');
            window.removeTag(id, 'solo');
            return 'tags' in window.OS_STATE.apps.find(a => a.id === id);
        });
        expect(r).toBe(false);
    });

    test('allTags orders by use, not alphabetically', async ({ page }) => {
        // An alphabetical filter list buries the tags someone actually relies on.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
            const ids = window.OS_STATE.apps.filter(a => a.type === 'grid').map(a => a.id);
            ids.forEach(id => window.addTag(id, 'zebra'));   // on everything
            window.addTag(ids[0], 'alpha');                  // on one
            return window.allTags();
        });
        expect(r[0].tag).toBe('zebra');
        expect(r[0].count).toBeGreaterThan(r[r.length - 1].count);
    });

    test('tags are addable in the viewer and searchable in the Library', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        await page.evaluate(() => {
            const item = window.OS_STATE.apps.find(a => a.type === 'grid');
            window.InteractionManager.openEnlarge(item);
        });
        await page.waitForTimeout(500);
        await page.click('#btn-add-tag');
        await page.waitForTimeout(300);
        await page.fill('#rename-input', 'Holiday');
        await page.click('#btn-save-rename');
        await page.waitForTimeout(400);

        await expect(page.locator('#fullscreen-tags')).toContainText('holiday');
        await page.evaluate(() => window.InteractionManager.closeEnlarge());
        await page.waitForTimeout(400);

        // Findable by tag even though the tag is in neither the title nor the payload.
        await page.click('#dock-container [data-id="nav_lib"]');
        await page.waitForTimeout(500);
        await page.fill('#library-search', 'holiday');
        await page.waitForTimeout(400);
        await expect(page.locator('#library-list > div')).toHaveCount(1);
    });
});

test.describe('Page reordering (Phase 4)', () => {
    test('moving a page swaps its codes and its name', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
            window.OS_STATE.pageNames = ['First', 'Second'];
            const before = window.OS_STATE.apps.filter(a => a.type === 'grid')
                .map(a => ({ id: a.id, page: a.page }));
            const ok = window.movePage(0, 1);
            const after = window.OS_STATE.apps.filter(a => a.type === 'grid')
                .map(a => ({ id: a.id, page: a.page }));
            return { ok, before, after, names: window.OS_STATE.pageNames };
        });

        expect(r.ok).toBe(true);
        expect(r.names).toEqual(['Second', 'First']);
        // Every code that was on page 0 is now on 1 and vice versa.
        r.before.forEach(b => {
            const a = r.after.find(x => x.id === b.id);
            expect(a.page).toBe(b.page === 0 ? 1 : 0);
        });
    });

    test('out-of-range moves are refused rather than corrupting pages', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
            const snapshot = JSON.stringify(window.OS_STATE.apps.map(a => a.page));
            const results = [window.movePage(0, -1), window.movePage(0, 99), window.movePage(1, 1)];
            return { results, unchanged: JSON.stringify(window.OS_STATE.apps.map(a => a.page)) === snapshot };
        });
        expect(r.results).toEqual([false, false, false]);
        expect(r.unchanged).toBe(true);
    });

    test('items inside folders are not given a page by a reorder', async ({ page }) => {
        // Folder members carry no page. A renumber that assigned them one would quietly pull
        // them back onto the grid.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
            const ids = window.OS_STATE.apps.filter(a => a.type === 'grid').map(a => a.id);
            window.createFolderFrom(ids[1], ids[0]);
            window.movePage(0, 1);
            return window.OS_STATE.apps.filter(a => a.folderId).map(a => a.page);
        });
        expect(r.every(p => p === undefined)).toBe(true);
    });

    test('the move arrows appear only in edit mode and disable at the ends', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await expect(page.locator('#page-move-row')).toHaveClass(/hidden/);

        await page.evaluate(() => {
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(500);
        await expect(page.locator('#page-move-row')).not.toHaveClass(/hidden/);
        // On page 0, left is disabled and dimmed rather than hidden.
        await expect(page.locator('#btn-page-left')).toBeDisabled();
        await expect(page.locator('#btn-page-left')).toHaveClass(/opacity-30/);
        await expect(page.locator('#btn-page-right')).not.toBeDisabled();
    });
});

test.describe('Back navigation (XanNav)', () => {
    // The report was "I get stuck in a lot of pages and cant go back". Nothing in the app was
    // wired to history, so hardware Back on Android left the PWA instead of closing the layer
    // on top. Each of these opens a layer the way the UI opens it, then presses Back.
    const boot = async (page) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
    };
    const isOpen = (page, id) => page.evaluate(
        (i) => document.getElementById(i).classList.contains('pointer-events-auto'), id);

    for (const [name, id, open] of [
        ['the Library',      'library-overlay',       () => window.LibraryManager.open()],
        ['Settings',         'settings-modal',        () => window.SettingsManager.open()],
        ['the code editor',  'create-modal',          () => window.CodeGenerator.open()],
        ['search',           'search-overlay',        () => window.GestureManager.openSearch()],
    ]) {
        test(`Back closes ${name}`, async ({ page }) => {
            await boot(page);
            await page.evaluate(open);
            await page.waitForTimeout(300);
            expect(await isOpen(page, id)).toBe(true);

            await page.goBack();
            await page.waitForTimeout(400);
            expect(await isOpen(page, id)).toBe(false);
        });
    }

    test('Back unwinds nested layers one at a time, innermost first', async ({ page }) => {
        await boot(page);
        await page.evaluate(() => window.LibraryManager.open());
        await page.waitForTimeout(250);
        await page.evaluate(() => window.SettingsManager.open());
        await page.waitForTimeout(250);

        expect(await isOpen(page, 'library-overlay')).toBe(true);
        expect(await isOpen(page, 'settings-modal')).toBe(true);

        await page.goBack();
        await page.waitForTimeout(400);
        // Settings was on top, so only Settings goes.
        expect(await isOpen(page, 'settings-modal')).toBe(false);
        expect(await isOpen(page, 'library-overlay')).toBe(true);

        await page.goBack();
        await page.waitForTimeout(400);
        expect(await isOpen(page, 'library-overlay')).toBe(false);
    });

    test('closing by button unwinds history too, so Back does not reopen anything', async ({ page }) => {
        // The failure this guards: close with the X, then press Back, and the leftover history
        // entry pops you into a layer you already dismissed — or worse, out of the app.
        await boot(page);
        await page.evaluate(() => window.LibraryManager.open());
        await page.waitForTimeout(250);
        await page.locator('#btn-close-library').click();
        await page.waitForTimeout(400);

        expect(await page.evaluate(() => window.XanNav.stack.length)).toBe(0);
        expect(await page.evaluate(() => (history.state && history.state.xanDepth) || 0)).toBe(0);
    });

    test('closing one layer and opening another in the same tick keeps the new one', async ({ page }) => {
        // Finishing a scan closes the scanner and opens the editor in one tick. MutationObserver
        // delivers records in observer-registration order, so the arrival can be seen before the
        // departure — the stack must not treat the newcomer as collateral of the layer below it.
        await boot(page);
        await page.evaluate(() => window.SettingsManager.open());
        await page.waitForTimeout(250);
        await page.evaluate(() => { window.SettingsManager.close(); window.LibraryManager.open(); });
        await page.waitForTimeout(500);

        expect(await isOpen(page, 'library-overlay')).toBe(true);
        expect(await isOpen(page, 'settings-modal')).toBe(false);
        expect(await page.evaluate(() => window.XanNav.stack.map(l => l.id))).toEqual(['library-overlay']);
        expect(await page.evaluate(() => (history.state && history.state.xanDepth) || 0)).toBe(1);

        // And Back still gets you out of the one that is actually open.
        await page.goBack();
        await page.waitForTimeout(400);
        expect(await isOpen(page, 'library-overlay')).toBe(false);
    });

    test('Back leaves edit mode instead of leaving the app', async ({ page }) => {
        await boot(page);
        await page.evaluate(() => {
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(400);

        await page.goBack();
        await page.waitForTimeout(700);
        expect(await page.evaluate(() => window.OS_STATE.isEditMode)).toBe(false);
        expect(await page.evaluate(() => document.body.classList.contains('edit-mode'))).toBe(false);
    });

    test('Escape closes the top layer on desktop', async ({ page }) => {
        await boot(page);
        await page.evaluate(() => window.SettingsManager.open());
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        expect(await isOpen(page, 'settings-modal')).toBe(false);
    });

    test('every dismissable layer is registered, so none can become a dead end', async ({ page }) => {
        await boot(page);
        const registered = await page.evaluate(() => [...window.XanNav.layers.keys()]);
        for (const id of ['search-overlay', 'item-fullscreen-layer', 'library-overlay',
                          'folder-overlay', 'settings-modal', 'account-modal', 'rename-modal',
                          'create-modal', 'scanner-modal', 'edit-mode']) {
            expect(registered, `${id} is not reachable by Back`).toContain(id);
        }
    });
});

test.describe('Edit-mode dragging (report: "I have to re-tap the icons")', () => {
    const enterEditMode = async (page) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(400);
    };
    const centres = (page) => page.evaluate(() =>
        [...document.querySelectorAll('#workspace-pager .app-icon-wrapper')].slice(0, 3).map(el => {
            const r = el.getBoundingClientRect();
            return { id: el.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }));

    test('dropping an icon on an empty slot does not kick you out of edit mode', async ({ page }) => {
        // This was the actual cause of the re-tapping. Releasing over a free slot synthesised a
        // click on that slot, the background-tap handler read it as "done rearranging", and edit
        // mode ended — so every further move needed another long press.
        await enterEditMode(page);
        const icons = await centres(page);
        const empty = await page.evaluate(() => {
            const s = document.querySelector('#workspace-pager .empty-slot');
            if (!s) return null;
            const r = s.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        expect(empty, 'the first page needs a free slot for this test').not.toBeNull();

        await page.mouse.move(icons[0].x, icons[0].y);
        await page.mouse.down();
        await page.mouse.move(icons[0].x + 12, icons[0].y + 12, { steps: 3 });
        await page.mouse.move(empty.x, empty.y, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(900);

        expect(await page.evaluate(() => window.OS_STATE.isEditMode)).toBe(true);
        expect(await page.evaluate(() => document.body.classList.contains('edit-mode'))).toBe(true);
    });

    test('a second icon can be moved straight after the first, with no tap in between', async ({ page }) => {
        await enterEditMode(page);
        const icons = await centres(page);

        // First move.
        await page.mouse.move(icons[0].x, icons[0].y);
        await page.mouse.down();
        await page.mouse.move(icons[0].x + 12, icons[0].y + 12, { steps: 3 });
        await page.mouse.move(icons[2].x, icons[2].y, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(120);   // deliberately inside the 400ms settle window

        // Second move begins before the first has finished animating home. The settle timer
        // used to fire mid-flight here and strip the new drag's transform.
        await page.mouse.move(icons[1].x, icons[1].y);
        await page.mouse.down();
        await page.mouse.move(icons[1].x + 12, icons[1].y + 12, { steps: 3 });
        const engaged = await page.evaluate(() => window.DragEngine.isEngaged);
        await page.mouse.move(icons[0].x, icons[0].y, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(900);

        expect(engaged, 'the second drag never engaged').toBe(true);
        expect(await page.evaluate(() => window.OS_STATE.isEditMode)).toBe(true);
        // No icon may be left detached from the grid by an interrupted settle.
        expect(await page.evaluate(() =>
            [...document.querySelectorAll('.app-icon-wrapper')]
                .filter(el => el.style.position === 'fixed').length)).toBe(0);
        expect(await page.evaluate(() =>
            document.querySelectorAll('.custom-drag-ghost').length)).toBe(0);
    });

    test('an icon that reaches the grid without a render is still draggable', async ({ page }) => {
        // Listeners used to be attached to each icon element inside init(). That stayed correct
        // only because render() calls init() as its last step — an icon arriving in the grid by
        // any other route got none, and would jiggle without being pickable. Delegation removes
        // the dependency on that ordering. Here the icon is cloned straight into the page, with
        // no render, which is the case per-icon binding could not cover.
        await enterEditMode(page);
        await page.evaluate(() => {
            const page0 = document.querySelector('#workspace-pager .sortable-page');
            const slot = page0.querySelector('.empty-slot');
            const clone = page0.querySelector('.app-icon-wrapper').cloneNode(true);
            clone.dataset.id = 'nav-test-clone';
            slot.replaceWith(clone);
        });
        await page.waitForTimeout(200);
        const icons = await page.evaluate(() => {
            const el = document.querySelector('[data-id="nav-test-clone"]');
            const r = el.getBoundingClientRect();
            return [{ x: r.left + r.width / 2, y: r.top + r.height / 2 }];
        });

        await page.mouse.move(icons[0].x, icons[0].y);
        await page.mouse.down();
        await page.mouse.move(icons[0].x + 12, icons[0].y + 12, { steps: 3 });
        expect(await page.evaluate(() => window.DragEngine.isEngaged)).toBe(true);
        await page.mouse.up();
        await page.waitForTimeout(700);
    });
});

test.describe('Theme coverage (report: "so much doesnt even get themes")', () => {
    // The accent used to reach only things that were already accent-coloured. Everything
    // structural was a fixed grey, so picking any of the 1352 reachable accents changed a few
    // controls and left the app looking the same.
    const surfaceOf = (page, sel, prop = 'backgroundColor') =>
        page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);

    test('chrome repaints when the accent changes, on every major surface', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => { window.SettingsManager.open(); window.LibraryManager.open(); });
        await page.waitForTimeout(400);

        const surfaces = ['#settings-panel', '#library-overlay', '#folder-overlay', '#main-dock',
                          '#settings-modal', '#account-modal', '#create-panel', '#item-fullscreen-layer'];
        const read = async () => {
            const out = {};
            for (const s of surfaces) out[s] = await surfaceOf(page, s);
            return out;
        };

        await page.evaluate(() => window.ThemeManager.applyAccent('#1F5C6B', false));
        await page.waitForTimeout(200);
        const teal = await read();

        await page.evaluate(() => window.ThemeManager.applyAccent('#F2B33F', false));
        await page.waitForTimeout(200);
        const amber = await read();

        for (const s of surfaces) {
            expect(teal[s], `${s} has no background at all`).not.toBe('rgba(0, 0, 0, 0)');
            expect(amber[s], `${s} does not respond to the accent`).not.toBe(teal[s]);
        }
    });

    test('the white plate behind a code is never tinted, on any accent', async ({ page }) => {
        // Scannability is functional, not decorative: a tinted plate cuts the contrast a 1D
        // reader needs. Every accent-driven surface rule must stop at the code.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
            const item = window.OS_STATE.apps.find(a => a.type === 'grid');
            window.InteractionManager.openEnlarge(item);
        });
        await page.waitForTimeout(600);

        for (const accent of ['#1F5C6B', '#F2B33F', '#E97A7A', '#000000', '#FFFFFF']) {
            await page.evaluate((a) => window.ThemeManager.applyAccent(a, false), accent);
            await page.waitForTimeout(120);
            expect(await surfaceOf(page, '.fullscreen-canvas-panel'),
                   `plate tinted by accent ${accent}`).toBe('rgb(255, 255, 255)');
        }
    });

    test('accent text stays readable on tinted chrome across the whole palette', async ({ page }) => {
        // Tinting the chrome toward the accent made accent-coloured TEXT on that chrome much
        // harder to read — a dark teal accent on teal-tinted panels fell under 2:1. Every one of
        // the 1352 reachable accents has to clear 4.5:1 on both the dark and the light surface.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const worst = await page.evaluate(() => {
            const { ratio, mixHex } = window.accentMath;
            const tm = window.ThemeManager;
            const row = document.getElementById('theme-swatch-row');
            const accents = [...new Set([...row.children]
                .filter(el => el._quad).flatMap(el => el._quad))];
            let dark = { r: Infinity }, light = { r: Infinity };
            for (const hex of accents) {
                const onDark = ratio(tm.readableOn(hex, mixHex('#1c1c1e', hex, 0.08)),
                                     mixHex('#1c1c1e', hex, 0.08));
                const onLight = ratio(tm.readableOn(hex, mixHex('#ffffff', hex, 0.05)),
                                      mixHex('#ffffff', hex, 0.05));
                if (onDark < dark.r) dark = { r: onDark, hex };
                if (onLight < light.r) light = { r: onLight, hex };
            }
            return { dark, light, count: accents.length };
        });

        expect(worst.count).toBeGreaterThan(1000);
        expect(worst.dark.r, `worst accent on dark chrome: ${worst.dark.hex}`).toBeGreaterThanOrEqual(4.5);
        expect(worst.light.r, `worst accent on light chrome: ${worst.light.hex}`).toBeGreaterThanOrEqual(4.5);
    });

    test('an accent that already passes is left exactly as the user picked it', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const unchanged = await page.evaluate(() => {
            const { mixHex } = window.accentMath;
            const hex = '#F2B33F';   // bright amber, comfortably readable on dark chrome
            return window.ThemeManager.readableOn(hex, mixHex('#1c1c1e', hex, 0.08));
        });
        expect(unchanged.toUpperCase()).toBe('#F2B33F');
    });
});

test.describe('Palette browsing (report: "im missing so many themes")', () => {
    test('tapping a band selects that colour instead of one of the four at random', async ({ page }) => {
        // The swatch shows four colours; tapping one should give you that one. Picking at
        // random from the four meant getting the shade you were looking at was a matter of
        // tapping until it came up.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.SettingsManager.open());
        await page.waitForTimeout(400);

        const swatch = page.locator('#theme-swatch-row button.accent-swatch').nth(3);
        const quad = await swatch.evaluate(el => el._quad);
        const box = await swatch.boundingBox();

        for (let band = 0; band < 4; band++) {
            // Aim at the middle of each band in turn.
            await page.mouse.move(box.x + box.width / 2, box.y + box.height * (band + 0.5) / 4);
            await page.mouse.down();
            await page.mouse.up();
            await page.waitForTimeout(120);
            expect(await page.evaluate(() => window.OS_STATE.accent.toUpperCase()))
                .toBe(quad[band].toUpperCase());
        }
    });

    test('a tap with no coordinates still picks something rather than throwing', async ({ page }) => {
        // Synthetic events and keyboard activation carry no clientY, so there is no band to
        // read. That path has to keep working.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const swatch = page.locator('#theme-swatch-row button.accent-swatch').nth(2);
        await swatch.dispatchEvent('pointerdown');
        await swatch.dispatchEvent('pointerup');
        await page.waitForTimeout(200);

        const quad = await swatch.evaluate(el => el._quad);
        expect(quad.map(c => c.toUpperCase()))
            .toContain(await page.evaluate(() => window.OS_STATE.accent.toUpperCase()));
    });

    test('the whole palette can be browsed, not just the first screenful', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.SettingsManager.open());
        await page.waitForTimeout(400);

        // The count is on the control, so the size of the palette is discoverable.
        await expect(page.locator('#btn-theme-expand')).toHaveText(/Browse all 338/);

        const strip = await page.locator('#theme-swatch-row').evaluate(el => ({
            cols: getComputedStyle(el).gridTemplateColumns, wide: el.scrollWidth,
        }));
        expect(strip.cols).toBe('none');           // collapsed: one horizontal strip

        await page.locator('#btn-theme-expand').click();
        await page.waitForTimeout(300);

        const grid = await page.locator('#theme-swatch-row').evaluate(el => ({
            cols: getComputedStyle(el).gridTemplateColumns.split(' ').length,
            tall: el.scrollHeight, wide: el.scrollWidth, box: el.clientWidth,
        }));
        expect(grid.cols).toBe(6);                  // expanded: wraps into a grid
        expect(grid.wide).toBeLessThanOrEqual(grid.box + 1);   // no sideways scrolling left
        expect(grid.tall).toBeGreaterThan(1000);    // and all 338 are in there to scroll through
        await expect(page.locator('#btn-theme-expand')).toHaveText('Show less');
    });

    test('expanded swatches are big enough for their bands to be tappable', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.SettingsManager.open());
        await page.waitForTimeout(400);
        await page.locator('#btn-theme-expand').click();
        await page.waitForTimeout(300);

        const box = await page.locator('#theme-swatch-row button.accent-swatch').first().boundingBox();
        expect(box.height / 4).toBeGreaterThanOrEqual(9);
    });
});

test.describe('Sign-in failures explain themselves', () => {
    // The live site showed "Sign-in error: Error (auth/unauthorized-domain)" — a code, not a
    // message. It is also the one failure here that is neither transient nor fixable in the
    // app: the domain has to be listed in the Firebase project first.
    const describe = (page, code) => page.evaluate(
        (c) => window.CloudSync.describeAuthError({ code: c, message: 'Firebase: something (' + c + ').' }), code);

    test('an unauthorised domain says what to do, and names the domain', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const text = await describe(page, 'auth/unauthorized-domain');
        expect(text).toContain('localhost');            // the host actually being served
        expect(text).toContain('Authorized domains');   // where to fix it
        expect(text).not.toContain('auth/unauthorized-domain');
        // And it says the app still works, because it does.
        expect(text).toMatch(/without signing in/i);
    });

    test('a cancelled popup is silent rather than an error', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        expect(await describe(page, 'auth/popup-closed-by-user')).toBe('');

        // An empty message hides the banner instead of showing a blank red line.
        await page.evaluate(() => { window.CloudSync.showGuestError('something'); });
        await page.evaluate(() => { window.CloudSync.showGuestError(''); });
        expect(await page.evaluate(() =>
            document.getElementById('account-guest-error').classList.contains('hidden'))).toBe(true);
    });

    test('an unknown code still produces a sentence, not a bare code', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const text = await describe(page, 'auth/some-new-thing');
        expect(text.startsWith('Sign-in failed:')).toBe(true);
        expect(text).not.toContain('Firebase: ');
    });
});

test.describe('Motion budgets (found by scripts/motion-audit.mjs)', () => {
    // The suite asserts end states, so nothing here was visible to it until the motion audit
    // stepped the animation and JS clocks together and produced a filmstrip to look at. These
    // pin what that found, so it cannot quietly come back.

    test('changing skin does not take the interface away for half a second', async ({ page }) => {
        // The morph is deliberately a blur-and-settle rather than a crossfade. It was holding
        // the whole screen illegible for 608ms of an 880ms sequence — long enough to read as
        // the app going away rather than as a transition.
        //
        // Measured by stepping the clock, not by sampling in real time. A rAF sampler gives a
        // number that moves with whatever else the machine is doing: the first version of this
        // test passed alone and failed alongside two other tests on a second worker. Freezing
        // the clock and advancing it by hand makes the result depend only on the app. Both
        // clocks have to move together — the skin swap and the pulse removal are setTimeout,
        // while the blur itself is a CSS transition on the browser's own timeline — so the
        // fake clock drives the timers and getAnimations() drives the transition.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        const T0 = new Date('2030-01-01T09:00:00Z');
        await page.clock.install({ time: T0 });
        await page.clock.pauseAt(T0);

        await page.evaluate(() => {
            window.__seen = new Map();
            window.__step = (t) => {
                for (const a of document.getAnimations()) {
                    if (!window.__seen.has(a)) { window.__seen.set(a, t); try { a.pause(); } catch (e) {} }
                    try { a.currentTime = Math.max(0, t - window.__seen.get(a)); } catch (e) {}
                }
                const m = /blur\(([\d.]+)px\)/.exec(
                    getComputedStyle(document.getElementById('workspace-container')).filter);
                return m ? +m[1] : 0;
            };
            window.SkinManager.setSkin('glass');
        });

        let first = null, last = null, elapsed = 0;
        for (let t = 0; t <= 1200; t += 20) {
            if (t > elapsed) { await page.clock.runFor(t - elapsed); elapsed = t; }
            const blur = await page.evaluate((ms) => window.__step(ms), t);
            if (blur >= 4) { if (first === null) first = t; last = t; }
        }
        const span = first === null ? 0 : last - first;

        expect(span, 'screen unreadable for too long during the skin morph').toBeLessThan(500);
        expect(span, 'the morph effect has been removed entirely').toBeGreaterThan(80);
    });

    test('every overlay settles rather than animating indefinitely', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        for (const [name, open] of [
            ['settings', () => window.SettingsManager.open()],
            ['library',  () => window.LibraryManager.open()],
            ['editor',   () => window.CodeGenerator.open()],
        ]) {
            const settled = await page.evaluate(async (fn) => {
                const el = document.querySelector('#settings-panel, #library-overlay, #create-panel');
                eval(`(${fn})()`);
                await new Promise(r => setTimeout(r, 900));
                const a = getComputedStyle(el).transform, o = getComputedStyle(el).opacity;
                await new Promise(r => setTimeout(r, 200));
                return a === getComputedStyle(el).transform && o === getComputedStyle(el).opacity;
            }, open.toString());
            expect(settled, `${name} was still moving 900ms after opening`).toBe(true);
        }
    });

    test('the tap targets the audit found stay at 44px', async ({ page }) => {
        // These live in layers the older accessibility test never opened, which is why they sat
        // undersized: the editor's close button and mode tabs, the viewer's tag button, and the
        // search field and its Cancel.
        await page.goto('/index.html');
        await page.waitForTimeout(1200);

        // Wait for the box to stop changing rather than for a fixed delay. These panels animate
        // scale-90 to scale-100, so a measurement taken mid-transition reports 90% of the real
        // size — 40px reads as 36 and the test fails only when the machine is busy enough to be
        // slow, which is the worst kind of failure to debug.
        const stableBox = async (loc) => {
            let last = null;
            for (let i = 0; i < 40; i++) {
                const box = await loc.boundingBox();
                if (box && last && Math.abs(box.height - last.height) < 0.5
                         && Math.abs(box.width - last.width) < 0.5) return box;
                last = box;
                await page.waitForTimeout(50);
            }
            return last;
        };

        const check = async (openFn, ids) => {
            await page.evaluate(openFn);
            for (const id of ids) {
                const loc = page.locator(id).first();
                await loc.waitFor({ state: 'visible' });
                const box = await stableBox(loc);
                const extended = await loc.evaluate(el =>
                    el.classList.contains('tap-extend') || el.classList.contains('tap44'));
                const h = extended ? Math.max(box.height, 44) : box.height;
                expect(h, `${id} is ${Math.round(box.height)}px tall`).toBeGreaterThanOrEqual(44);
            }
        };

        await check(() => window.CodeGenerator.open(), ['#btn-close-create', '.create-tab-btn']);
        await page.evaluate(() => window.CodeGenerator.close());
        await check(() => window.GestureManager.openSearch(), ['#search-input', '#btn-cancel-search']);
        await page.evaluate(() => window.GestureManager.closeSearch());
        await check(() => window.InteractionManager.openEnlarge(
                            window.OS_STATE.apps.find(a => a.type === 'grid')), ['#btn-add-tag']);
    });
});

test('Folders: a merge survives the reorder swapping the target out from under the pointer', async ({ page }) => {
    // The pointermove that starts the dwell also swaps the hovered icon into the ghost's old
    // place, so by the next move the finger is over the ghost rather than the icon. The dwell
    // used to be cleared by that, and whether a folder happened came down to where the final
    // move event landed — unreliable by hand, and about one failure in five for the test above.
    // This drives the losing case deliberately: hover the target, then keep moving on the spot
    // so more pointermoves arrive after the swap has taken the icon away.
    await page.goto('/index.html');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        window.OS_STATE.isEditMode = true;
        document.body.classList.add('edit-mode');
        window.Renderer.render();
    });
    await page.waitForTimeout(500);

    const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('#workspace-pager .app-icon-wrapper')].slice(0, 2).map(el => {
            const r = el.getBoundingClientRect();
            return { id: el.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }));

    await page.mouse.move(boxes[1].x, boxes[1].y);
    await page.mouse.down();
    await page.mouse.move(boxes[1].x + 12, boxes[1].y + 12, { steps: 3 });
    await page.mouse.move(boxes[0].x, boxes[0].y, { steps: 12 });

    // Jitter on the spot across the whole dwell window. Every one of these lands on the ghost
    // once the swap has happened, which is precisely what used to cancel the merge.
    for (let i = 0; i < 10; i++) {
        await page.mouse.move(boxes[0].x + (i % 2 ? 1 : -1), boxes[0].y);
        await page.waitForTimeout(80);
    }
    await page.mouse.up();
    await page.waitForTimeout(800);

    const r = await page.evaluate(() => ({
        folders: window.OS_STATE.apps.filter(a => a.type === 'folder').length,
        filed: window.OS_STATE.apps.filter(a => a.folderId).length,
    }));
    expect(r.folders, 'the merge was cancelled by the reorder swap').toBe(1);
    expect(r.filed).toBe(2);
});

test.describe('Text stays readable on every skin', () => {
    // Each skin restyled the surfaces it knew about and listed the text to recolour by hand, so
    // any control added afterwards kept whatever colour the default dark chrome had given it.
    // That is how the Library's Saved/Scanned/Created row ended up at 1.22:1 on Soft and the
    // code viewer's title at 1.11:1 on Aurora — present in the DOM, invisible on screen. Found
    // by sweeping scripts/motion-audit.mjs across all six skins; this keeps it swept.
    const SKINS = ['dock', 'scancard', 'glass', 'soft', 'aurora', 'classic'];

    // Mirrors the audit's measurement, including its one hard-won rule: stop at a background
    // IMAGE rather than walking past it to a colour underneath. The wallpaper is a gradient on
    // a body whose background-COLOR is black, and walking past it reports every icon label on
    // Soft as unreadable when it is dark ink on a light gradient.
    const worstContrast = (page) => page.evaluate(() => {
        const lum = (c) => {
            const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
            if (!m) return null;
            const [r, g, b] = m.slice(1, 4).map(v => {
                const x = +v / 255;
                return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const behind = (el) => {
            for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
                const cs = getComputedStyle(n);
                if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
                const bg = cs.backgroundColor;
                const a = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(bg);
                if (bg && bg !== 'transparent' && (!a || +a[1] > 0.85)) return bg;
            }
            return null;
        };
        const shown = (el) => {
            for (let n = el; n && n !== document.body; n = n.parentElement) {
                const s = getComputedStyle(n);
                if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false;
                if (n.classList.contains('pointer-events-none')) return false;
            }
            return true;
        };

        let worst = { ratio: Infinity, what: 'nothing measurable' };
        for (const el of document.querySelectorAll('h1,h2,h3,h4,p,span,button,label,a')) {
            if (el.children.length || !shown(el)) continue;
            const text = (el.textContent || '').trim();
            if (text.length < 2) continue;
            const bg = behind(el);
            if (!bg) continue;
            const lf = lum(getComputedStyle(el).color), lb = lum(bg);
            if (lf === null || lb === null) continue;
            const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
            if (ratio < worst.ratio) {
                worst = { ratio, what: (el.id || el.className.toString().split(' ')[0] || el.tagName)
                                       + ' "' + text.slice(0, 24) + '"' };
            }
        }
        return worst;
    });

    for (const skin of SKINS) {
        test(`${skin}: nothing is invisible in the Library or the code viewer`, async ({ page }) => {
            await page.goto('/index.html');
            await page.waitForTimeout(1300);
            if (skin !== 'dock') {
                await page.evaluate((s) => window.SkinManager.setSkin(s), skin);
                await page.waitForTimeout(900);
            }

            for (const [name, open] of [
                ['library', () => window.LibraryManager.open()],
                ['settings', () => window.SettingsManager.open()],
                ['viewer', () => window.InteractionManager.openEnlarge(
                                   window.OS_STATE.apps.find(a => a.type === 'grid'))],
            ]) {
                await page.evaluate(open);
                await page.waitForTimeout(700);
                const worst = await worstContrast(page);
                // 3:1 is the floor below which text is not dim but gone. Deliberately not 4.5:1:
                // this is a "nothing is invisible" guard, not an AA audit, and holding every
                // decorative label to AA on six skins would be a different piece of work.
                expect(worst.ratio, `${skin}/${name}: ${worst.what}`).toBeGreaterThanOrEqual(3);
            }
        });
    }
});

test.describe('Arming a folder merge is visible, not only felt', () => {
    // Found by the gesture filmstrip in scripts/motion-audit.mjs: the frame at the moment a
    // merge armed was pixel-identical to the frame before it. The target does grow and take an
    // accent ring, but the icon you are holding sits directly on top of it at scale 1.15 and
    // covered the lot — so the only signal that releasing would make a folder rather than
    // reorder was the haptic. Vibration is a setting the user can switch off, which left that
    // case with no feedback at all.
    const arm = async (page) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
            window.OS_STATE.isEditMode = true;
            document.body.classList.add('edit-mode');
            window.Renderer.render();
        });
        await page.waitForTimeout(500);
        const p = await page.evaluate(() =>
            [...document.querySelectorAll('#workspace-pager .app-icon-wrapper')].slice(0, 2).map(el => {
                const r = el.getBoundingClientRect();
                return { id: el.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }));
        await page.mouse.move(p[1].x, p[1].y);
        await page.mouse.down();
        await page.mouse.move(p[1].x + 14, p[1].y + 8);
        await page.mouse.move(p[0].x, p[0].y, { steps: 8 });
        return p;
    };

    test('the target takes a ring and the held icon fades once armed', async ({ page }) => {
        await arm(page);

        // Before the dwell completes, neither marker is present.
        const early = await page.evaluate(() => ({
            target: !!document.querySelector('.folder-target'),
            merging: !!document.querySelector('.drag-merging'),
        }));
        expect(early.target, 'armed before the dwell elapsed').toBe(false);
        expect(early.merging).toBe(false);

        await page.waitForTimeout(750);

        const armed = await page.evaluate(() => {
            const t = document.querySelector('.folder-target');
            const m = document.querySelector('.drag-merging');
            if (!t || !m) return null;
            const icon = t.querySelector('.app-icon');
            return {
                ring: getComputedStyle(icon).boxShadow,
                scale: getComputedStyle(icon).transform,
                heldOpacity: +getComputedStyle(m).opacity,
            };
        });
        expect(armed, 'nothing was armed').not.toBeNull();
        // The ring has to reach past the held icon, so it is two shadows, not one.
        expect(armed.ring.split('rgb').length - 1, 'the ring lost its outer halo').toBeGreaterThanOrEqual(3);
        expect(armed.scale).not.toBe('none');
        expect(armed.heldOpacity, 'the held icon still hides the target').toBeLessThan(0.7);

        await page.mouse.up();
        await page.waitForTimeout(800);
        expect(await page.evaluate(() =>
            window.OS_STATE.apps.filter(a => a.type === 'folder').length)).toBe(1);
    });

    test('moving off the target undims the held icon again', async ({ page }) => {
        // clearFolderDwell has to strip the fade whether or not a merge had armed, or a near
        // miss leaves the icon translucent for the rest of the drag.
        const p = await arm(page);
        await page.waitForTimeout(750);
        expect(await page.evaluate(() => !!document.querySelector('.drag-merging'))).toBe(true);

        await page.mouse.move(p[1].x, p[1].y + 180, { steps: 8 });
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => !!document.querySelector('.drag-merging')),
               'the held icon stayed faded after moving away').toBe(false);
        expect(await page.evaluate(() => !!document.querySelector('.folder-target'))).toBe(false);

        await page.mouse.up();
        await page.waitForTimeout(700);
        // And nothing is left translucent once it lands.
        expect(await page.evaluate(() =>
            [...document.querySelectorAll('.app-icon-wrapper')]
                .filter(el => +getComputedStyle(el).opacity < 0.9).length)).toBe(0);
    });
});

test.describe('Guest sign-in failing does not take cloud sync down with it', () => {
    // CI runs the motion audit with real outbound network — this development machine has none,
    // so it can never see this — and every page load there reports HTTP 400 from
    // identitytoolkit accounts:signUp, which is the anonymous sign-in call. That used to sit
    // bare in the init try block, so its failure marked ALL of cloud sync unavailable and the
    // Account sheet then refused Google sign-in with "offline or blocked": wrong, and
    // impossible to act on.
    //
    // The init path itself cannot be exercised here (Firebase never loads without network), so
    // what is pinned is the structure that made the failure fatal, plus the messages.

    test('the anonymous call is caught on its own, not by the outer handler', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(800);
        const src = await page.evaluate(() => document.documentElement.outerHTML);

        const init = src.slice(src.indexOf('async init() {'));
        const anon = init.indexOf('signInAnonymously');
        const readyTrue = init.indexOf('this.ready = true;');
        expect(anon, 'signInAnonymously not found in init').toBeGreaterThan(-1);

        // It must be wrapped, and the wrapper must sit before ready is set — otherwise a throw
        // skips straight past it to the outer catch.
        const around = init.slice(Math.max(0, anon - 260), anon + 260);
        expect(around, 'signInAnonymously is not individually caught').toMatch(/try\s*\{[^}]*signInAnonymously/);
        expect(around).toContain('catch');
        expect(anon).toBeLessThan(readyTrue);
    });

    test('each owner-fixable failure explains itself and names what still works', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForTimeout(1200);
        const say = (code, message) => page.evaluate(
            ([c, m]) => window.CloudSync.describeAuthError({ code: c, message: m }), [code, message]);

        const anon = await say('auth/admin-restricted-operation', 'Firebase: blah.');
        expect(anon).toMatch(/Anonymous/);
        expect(anon, 'does not say the app still works').toMatch(/still works|safe on this device/i);
        expect(anon).not.toContain('auth/admin-restricted-operation');

        const key = await say('auth/api-key-not-valid', 'Firebase: bad key.');
        expect(key).toContain('localhost');
        expect(key).toMatch(/API key restrictions/);

        // A referrer rejection can arrive under a different code, so the message is matched too.
        const referer = await say('auth/internal-error', 'Requests from referer http://x are blocked.');
        expect(referer).toMatch(/not cleared for/);
    });
});
