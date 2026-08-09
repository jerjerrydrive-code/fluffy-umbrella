/**
 * Batch scanning, through the real camera.
 *
 * Batch is a genuinely separate path, not a flag on the normal one: handleSuccess intercepts
 * before any of the single-result work, so there is no camera stop, no result sheet and no
 * history write — the camera keeps running and codes accumulate in a tray until you save the
 * lot. None of that had ever been exercised.
 *
 * It needs a camera that shows DIFFERENT codes over time, because the tray de-duplicates: a
 * single repeated still can only ever produce one item however long it plays. So the fake camera
 * takes a sequence, and holds each code for a couple of seconds before the next appears.
 *
 * Own spec file because launchOptions is file-level in Playwright.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CODES = [
    { text: 'BATCH-ALPHA', bcid: 'qrcode' },
    { text: 'BATCH-BETA', bcid: 'qrcode' },
    { text: 'BATCH-GAMMA', bcid: 'code128' },
];
const VIDEO = path.join(os.tmpdir(), 'xancode-fake-camera-batch.y4m');

test.beforeAll(() => {
    if (!fs.existsSync(VIDEO)) {
        const args = CODES.flatMap(c => [c.text, c.bcid]);
        execFileSync('node', ['scripts/fake-camera.mjs', VIDEO, ...args], { stdio: 'inherit' });
    }
    if (!fs.existsSync(VIDEO)) throw new Error('fake camera video was not produced');
});

test.use({
    launchOptions: {
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${VIDEO}`,
        ],
    },
    permissions: ['camera'],
});

const startBatch = async (page) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.ScannerEngine && window.OS_STATE, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
        window.ScannerEngine.start();
        window.ScannerEngine.toggleBatch();
    });
    expect(await page.evaluate(() => window.ScannerEngine.batchMode)).toBe(true);
};

test.describe('Batch scanning', () => {
    test('several different codes accumulate without the camera stopping', async ({ page }) => {
        await startBatch(page);

        // The video runs through three codes; wait for the tray to hold at least two.
        await page.waitForFunction(() => window.ScannerEngine.batch.length >= 2,
                                   null, { timeout: 40000 });

        const state = await page.evaluate(() => ({
            payloads: window.ScannerEngine.batch.map(b => b.data),
            scanning: window.ScannerEngine.isScanning,
            trayVisible: !document.getElementById('scanner-batch-tray').classList.contains('hidden'),
            // The single-result sheet must stay down: batch intercepts before it.
            sheetDown: document.getElementById('scanner-result-sheet')
                         .classList.contains('translate-y-full'),
        }));

        expect(state.payloads.length).toBeGreaterThanOrEqual(2);
        expect(new Set(state.payloads).size, 'the tray holds duplicates').toBe(state.payloads.length);
        for (const p of state.payloads) expect(CODES.map(c => c.text)).toContain(p);
        expect(state.scanning, 'the camera stopped — batch should keep scanning').toBe(true);
        expect(state.trayVisible, 'the tray did not appear').toBe(true);
        expect(state.sheetDown, 'the single-result sheet opened during batch mode').toBe(true);
    });

    test('nothing reaches history until the batch is saved', async ({ page }) => {
        // The tray is a holding area on purpose: a code you remove before saving should never
        // have been logged. Recording on decode would defeat that.
        await startBatch(page);
        await page.waitForFunction(() => window.ScannerEngine.batch.length >= 2,
                                   null, { timeout: 40000 });

        expect(await page.evaluate(() =>
            (window.OS_STATE.history || []).filter(h => h.data.startsWith('BATCH-')).length),
            'batch items were logged before being saved').toBe(0);
    });

    test('saving the batch records every code once, as scanned', async ({ page }) => {
        await startBatch(page);
        await page.waitForFunction(() => window.ScannerEngine.batch.length >= 2,
                                   null, { timeout: 40000 });
        const expected = await page.evaluate(() => window.ScannerEngine.batch.map(b => b.data));

        await page.evaluate(() => window.ScannerEngine.saveBatch());
        await page.waitForTimeout(1200);

        const after = await page.evaluate(() => ({
            history: (window.OS_STATE.history || []).filter(h => h.data.startsWith('BATCH-')),
            codes: window.OS_STATE.apps.filter(a => (a.data || '').startsWith('BATCH-')).map(a => a.data),
            batch: window.ScannerEngine.batch.length,
            scanning: window.ScannerEngine.isScanning,
        }));

        for (const data of expected) {
            const hits = after.history.filter(h => h.data === data);
            // Across ALL sources, deliberately. recordHistory already de-duplicates per
            // (data, source), so counting same-source entries can never exceed one and would
            // prove nothing — an earlier version of this assertion did exactly that and stayed
            // green when a second identical log was injected on purpose. The bug this actually
            // guards is the cross-source duplicate: saveCode writes history tagged 'scanned',
            // and saveBatch recording it as well logged every item twice, once under each source.
            expect(hits.length, `${data} appears ${hits.length} times in history: `
                              + hits.map(h => h.source).join(', ')).toBe(1);
            expect(hits[0].source, `${data} was not attributed to scanning`).toBe('scanned');
            expect(after.codes, `${data} was not saved as a code`).toContain(data);
        }
        expect(after.batch, 'the tray was not emptied after saving').toBe(0);
        expect(after.scanning, 'the camera kept running after saving the batch').toBe(false);
    });

    test('removing an item from the tray keeps it out of history entirely', async ({ page }) => {
        await startBatch(page);
        await page.waitForFunction(() => window.ScannerEngine.batch.length >= 2,
                                   null, { timeout: 40000 });

        const dropped = await page.evaluate(() => {
            const se = window.ScannerEngine;
            const [gone] = se.batch.splice(0, 1);
            se.renderBatch();
            return gone.data;
        });
        await page.evaluate(() => window.ScannerEngine.saveBatch());
        await page.waitForTimeout(1200);

        const seen = await page.evaluate((d) => ({
            history: (window.OS_STATE.history || []).filter(h => h.data === d).length,
            codes: window.OS_STATE.apps.filter(a => a.data === d).length,
        }), dropped);
        expect(seen.history, 'a code removed before saving still reached history').toBe(0);
        expect(seen.codes).toBe(0);
    });
});
