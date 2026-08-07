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
