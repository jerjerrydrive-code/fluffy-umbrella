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
