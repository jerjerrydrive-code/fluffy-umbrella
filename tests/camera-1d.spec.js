/**
 * A linear barcode, read through the real camera path.
 *
 * Two things this settles that the QR spec alone cannot.
 *
 * It proves those assertions are reading the decode rather than passing vacuously: this file
 * feeds a different payload in a different symbology, so if the checks were not actually looking
 * at what came back, both specs would report the same thing.
 *
 * And it covers the 1D path, which is not the 2D path with a different name. A linear symbology
 * is located and sampled differently, and this app treats the two differently elsewhere too —
 * checkScannability fails an inverted 1D code outright at any contrast ratio, while an inverted
 * 2D one is only a warning.
 *
 * Separate file because launchOptions has to be set at file level; Playwright rejects it inside
 * a describe block.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CODE128 = 'XANCODE-128-TEST';
const QR_PAYLOAD = 'https://example.com/scan-test';   // what the other spec feeds
const VIDEO = path.join(os.tmpdir(), 'xancode-fake-camera-128.y4m');

test.beforeAll(() => {
    if (!fs.existsSync(VIDEO)) {
        execFileSync('node', ['scripts/fake-camera.mjs', VIDEO, CODE128, 'code128'], { stdio: 'inherit' });
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

test('a Code 128 barcode is read, with its own payload and its own format', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.ScannerEngine && window.OS_STATE, null, { timeout: 20000 });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.ScannerEngine.start());

    await expect(page.locator('#scanner-result-sheet'))
        .not.toHaveClass(/translate-y-full/, { timeout: 30000 });

    const read = await page.locator('#scan-result-data').innerText();
    expect(read).toBe(CODE128);
    expect(read, 'the same value as the QR spec — these assertions are not reading the decode')
        .not.toBe(QR_PAYLOAD);
    await expect(page.locator('#scan-result-format')).toContainText(/128/i);
});
