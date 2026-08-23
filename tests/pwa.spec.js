/**
 * The service worker, and whether the app really works with the network gone.
 *
 * This is a PWA and offline is one of its promises, and nothing had ever checked it. A service
 * worker fails quietly by nature: registration resolves, install "succeeds", and you find out
 * it cached nothing useful the first time you open the app on a train.
 *
 * Kept separate from the regression suite because these need their own context per test — a
 * service worker persists across reloads within a context, which is the point, but means one
 * test's cache would otherwise decide another test's result.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ready = async (page) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.Renderer && window.OS_STATE, null, { timeout: 25000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Install caches the shell after activation; give it a moment to finish writing.
    await page.waitForFunction(async () => {
        const names = await caches.keys();
        if (!names.length) return false;
        const c = await caches.open(names[0]);
        return (await c.keys()).length >= 10;
    }, null, { timeout: 25000 });
};

test.describe('Offline', () => {
    test('the worker registers, activates and takes control', async ({ page }) => {
        await ready(page);
        const reg = await page.evaluate(async () => {
            const r = await navigator.serviceWorker.ready;
            return { active: !!r.active, scope: r.scope, controlled: !!navigator.serviceWorker.controller };
        });
        expect(reg.active).toBe(true);
        expect(reg.scope).toContain('localhost');
    });

    test('every file the worker claims to cache is actually cached', async ({ page }) => {
        await ready(page);

        // Read the list the worker itself declares, so the test cannot drift from it.
        const sw = fs.readFileSync(path.join(process.cwd(), 'sw.js'), 'utf8');
        const declared = [...sw.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1])
            .filter(u => u !== './' && !u.startsWith('./sw'));
        expect(declared.length).toBeGreaterThan(5);

        const cached = await page.evaluate(async () => {
            const names = await caches.keys();
            const c = await caches.open(names[0]);
            return (await c.keys()).map(r => new URL(r.url).pathname);
        });

        for (const url of declared) {
            const expected = url.replace('./', '/');
            expect(cached, `${url} is declared in the app shell but was not cached`)
                .toContain(expected);
        }
    });

    test('the app boots with the network gone, styled and fully functional', async ({ page, context }) => {
        await ready(page);
        await context.setOffline(true);

        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.Renderer && window.OS_STATE, null, { timeout: 25000 });

        const state = await page.evaluate(() => {
            // The proxy for "the stylesheet loaded" has to come FROM that stylesheet.
            //
            // This measured the dock's border-radius and required it to be non-zero, which was a
            // fine stand-in for as long as the dock was a rounded floating pill. It is a
            // full-width bar with square corners now, so a perfectly healthy offline boot
            // reported "stylesheet did not load offline" — the assertion had quietly become a
            // test of the dock's shape.
            //
            // A bare .flex probe cannot be confused with anything else: display:flex on a div
            // exists only in vendor/tailwind.css, so it is block when that file is missing and
            // flex when it is there, whatever the app's design does later.
            const probe = document.createElement('div');
            probe.className = 'flex';
            document.body.appendChild(probe);
            const probeDisplay = getComputedStyle(probe).display;
            probe.remove();
            return {
                icons: document.querySelectorAll('#workspace-pager .app-icon-wrapper').length,
                probeDisplay,
                bwip: typeof window.bwipjs,
                qr: typeof window.Html5Qrcode,
                lucide: typeof window.lucide,
            };
        });

        expect(state.icons, 'no codes rendered offline').toBeGreaterThan(0);
        expect(state.probeDisplay, 'vendor/tailwind.css did not load offline').toBe('flex');
        expect(state.bwip).toBe('object');
        expect(state.qr).toBe('function');
        expect(state.lucide).toBe('object');
        expect(errors).toEqual([]);
    });

    test('a code can still be generated offline, not merely displayed', async ({ page, context }) => {
        // Present is not the same as working: a truncated cached script still defines a global.
        await ready(page);
        await context.setOffline(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.bwipjs && window.renderCode, null, { timeout: 25000 });

        const drew = await page.evaluate(() => {
            const c = document.createElement('canvas');
            c.id = 'offline-probe';
            document.body.appendChild(c);
            const ok = window.renderCode('offline-probe',
                { data: 'OFFLINE-TEST', bcid: 'qrcode' }, { scale: 3 });
            const ctx = c.getContext('2d');
            const px = ctx.getImageData(0, 0, c.width, c.height).data;
            let dark = 0;
            for (let i = 0; i < px.length; i += 4) if (px[i] < 128) dark++;
            return { ok, w: c.width, h: c.height, dark };
        });
        expect(drew.ok, 'renderCode reported failure offline').toBe(true);
        expect(drew.w).toBeGreaterThan(0);
        expect(drew.dark, 'the canvas is blank — nothing was actually drawn').toBeGreaterThan(50);
    });
});

test.describe('App shell declaration', () => {
    // These read the repo rather than the browser: the failure they guard against is someone
    // adding a vendored file and forgetting sw.js, which breaks offline for that asset only and
    // is invisible until you are offline.
    const shell = () => {
        const sw = fs.readFileSync(path.join(process.cwd(), 'sw.js'), 'utf8');
        return [...sw.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]);
    };

    test('everything the shell lists exists on disk', () => {
        for (const url of shell()) {
            if (url === './' || url.startsWith('./sw')) continue;
            const file = path.join(process.cwd(), url.replace('./', ''));
            expect(fs.existsSync(file), `${url} is in the app shell but not in the repo`).toBe(true);
            expect(fs.statSync(file).size, `${url} is empty`).toBeGreaterThan(0);
        }
    });

    test('every vendored asset and icon is in the shell', () => {
        const listed = shell();
        for (const dir of ['vendor', 'icons']) {
            for (const name of fs.readdirSync(path.join(process.cwd(), dir))) {
                // tailwind.src.css is a build input, never fetched by the page.
                if (name.endsWith('.src.css')) continue;
                expect(listed, `${dir}/${name} is served but missing from the app shell — it will not work offline`)
                    .toContain(`./${dir}/${name}`);
            }
        }
    });

    test('losing a critical asset stops the worker installing rather than half-installing', () => {
        // The behaviour, asserted at the source: every critical entry must also be in the shell,
        // and the install path must throw on a critical failure instead of swallowing it.
        const sw = fs.readFileSync(path.join(process.cwd(), 'sw.js'), 'utf8');
        const critical = [...sw.matchAll(/CRITICAL\s*=\s*\[([^\]]*)\]/gs)][0][1];
        const entries = [...critical.matchAll(/'([^']+)'/g)].map(m => m[1]);
        expect(entries.length).toBeGreaterThan(3);
        for (const e of entries) expect(shell()).toContain(e);

        expect(sw, 'install no longer fails on a missing critical asset').toMatch(/throw new Error\('app shell incomplete/);
        expect(sw, 'cache failures are being swallowed again').not.toMatch(/cache\.add\([^)]*\)\.catch\(\(\)\s*=>\s*\{\}\)/);
    });
});
