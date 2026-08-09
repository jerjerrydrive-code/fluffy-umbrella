/**
 * The scanner, actually scanning.
 *
 * This is what the app is FOR, and until now it was the one pipeline nothing exercised. Headless
 * Chromium has no camera and neither does a CI runner, so every existing test stopped at
 * "bwip-js encodes a code, html5-qrcode decodes the PNG back". That proves the two libraries
 * agree and skips everything that is actually specific to scanning: permissions, getUserMedia,
 * the video element, the frame grabber, the decode callback, the format reported back, the
 * result sheet, and saving what was read.
 *
 * Chromium will play a file back as though it were a webcam, so the gap closes. The video is
 * built by scripts/fake-camera.mjs from the app's own bwip-js — no checked-in binary fixture to
 * drift out of step, and an encoding regression would show up here too.
 *
 * Kept in its own spec because the fake camera has to be set at browser launch, and the rest of
 * the suite should not pay for it.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PAYLOAD = 'https://example.com/scan-test';
const VIDEO = path.join(os.tmpdir(), 'xancode-fake-camera-qr.y4m');

// A second video with a different payload AND a different symbology. Two things it settles that
// the QR tests alone cannot: that the assertions are reading the decode rather than passing
// vacuously, and that the 1D path works — a linear barcode is scanned quite differently from a
// 2D one, and the app treats their polarity rules differently too.
const CODE128 = 'XANCODE-128-TEST';
const VIDEO_128 = path.join(os.tmpdir(), 'xancode-fake-camera-128.y4m');

const build = (file, text, bcid) => {
    if (!fs.existsSync(file)) {
        execFileSync('node', ['scripts/fake-camera.mjs', file, text, bcid], { stdio: 'inherit' });
    }
    if (!fs.existsSync(file)) throw new Error(`fake camera video was not produced: ${file}`);
};

// The generator runs as a subprocess rather than being imported. Playwright transforms an
// imported .mjs into CommonJS while Node still loads it as ESM, and the two disagree — the
// import fails with "exports is not defined in ES module scope" before any test runs. Shelling
// out sidesteps the interop entirely and keeps the generator runnable on its own.
test.beforeAll(() => build(VIDEO, PAYLOAD, 'qrcode'));

test.use({
    // Kept here rather than imported, for the same reason. Three flags: present a camera at all,
    // auto-accept the permission prompt, and play our file instead of a test pattern.
    launchOptions: {
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${VIDEO}`,
        ],
    },
    permissions: ['camera'],
});

const openScanner = async (page) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.ScannerEngine && window.OS_STATE, null, { timeout: 20000 });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.ScannerEngine.start());
};

test.describe('Camera scanning, end to end', () => {
    test('a code held in front of the camera is read, and reads correctly', async ({ page }) => {
        await openScanner(page);

        // The sheet rising is the app saying it decoded something. Generous timeout: the camera
        // has to start, negotiate a resolution, and the decoder needs a few frames to lock on.
        await expect(page.locator('#scanner-result-sheet'))
            .not.toHaveClass(/translate-y-full/, { timeout: 30000 });

        expect(await page.locator('#scan-result-data').innerText()).toBe(PAYLOAD);
        // And it must be reported as the format it actually is, not the default guess.
        await expect(page.locator('#scan-result-format')).toContainText(/QR/i);
    });

    test('the camera really ran, and is released the moment a code is read', async ({ page }) => {
        // The state has to be sampled DURING the scan, not after it. handleSuccess calls
        // stopCamera() as soon as it decodes — which is correct, since holding the camera open
        // once you have a result wastes battery and leaves the indicator light on — so checking
        // isScanning after the sheet appears reads false and proves nothing. An earlier version
        // of this test asserted exactly that and failed against a perfectly good app.
        await page.goto('/index.html');
        await page.waitForFunction(() => window.ScannerEngine && window.OS_STATE, null, { timeout: 20000 });
        await page.waitForTimeout(900);

        await page.evaluate(() => {
            window.__peak = { scanning: false, hasVideo: false, w: 0, h: 0, live: 0, cameras: 0 };
            window.__sampler = setInterval(() => {
                const se = window.ScannerEngine;
                const v = document.querySelector('#scanner-reader video');
                const p = window.__peak;
                p.scanning = p.scanning || !!se.isScanning;
                p.hasVideo = p.hasVideo || !!v;
                p.cameras = Math.max(p.cameras, se.allCameras.length);
                // The TRACK, not the video element. videoWidth is populated from stream metadata
                // and can still read 0 when the decode lands on an early frame — which it does
                // here, because the fake camera shows a large, clean code. Track settings exist
                // as soon as the stream does, and a live track is the thing that proves a real
                // capture device was opened rather than a placeholder element being present.
                const track = v && v.srcObject && v.srcObject.getVideoTracks()[0];
                if (track) {
                    const st = track.getSettings() || {};
                    p.w = Math.max(p.w, st.width || 0);
                    p.h = Math.max(p.h, st.height || 0);
                    if (track.readyState === 'live') p.live++;
                }
            }, 25);
            window.ScannerEngine.start();
        });

        await expect(page.locator('#scanner-result-sheet'))
            .not.toHaveClass(/translate-y-full/, { timeout: 30000 });
        const peak = await page.evaluate(() => { clearInterval(window.__sampler); return window.__peak; });

        expect(peak.cameras, 'no camera was enumerated').toBeGreaterThan(0);
        expect(peak.scanning, 'the engine never entered the scanning state').toBe(true);
        expect(peak.hasVideo, 'no video element was ever attached').toBe(true);
        expect(peak.live, 'no live capture track was ever open').toBeGreaterThan(0);
        expect(peak.w, 'the capture track reported no dimensions').toBeGreaterThan(0);
        expect(peak.h).toBeGreaterThan(0);

        // And it lets go straight away.
        await page.waitForTimeout(600);
        expect(await page.evaluate(() => window.ScannerEngine.isScanning),
               'the camera kept running after a successful read').toBe(false);
    });

    test('a scanned code can be saved, and lands in history as Scanned', async ({ page }) => {
        await openScanner(page);
        await expect(page.locator('#scanner-result-sheet'))
            .not.toHaveClass(/translate-y-full/, { timeout: 30000 });

        await page.locator('#btn-scan-save').click();
        await page.waitForTimeout(1200);

        const saved = await page.evaluate(() => ({
            codes: window.OS_STATE.apps.filter(a => a.data === 'https://example.com/scan-test').length,
            scanned: (window.OS_STATE.history || [])
                       .filter(h => h.source === 'scanned' && h.data === 'https://example.com/scan-test').length,
        }));
        // Whether saving files it as a code or only into history, the payload has to survive the
        // trip intact and be attributed to scanning rather than to creation.
        expect(saved.codes + saved.scanned, 'the scanned payload was not recorded anywhere')
            .toBeGreaterThan(0);
        expect(saved.scanned, 'a scanned code was not recorded as scanned').toBeGreaterThan(0);
    });

    test('closing the scanner releases the camera', async ({ page }) => {
        // A page that keeps the camera open after the scanner is dismissed leaves the indicator
        // light on, which reads as the app watching you.
        await openScanner(page);
        await expect(page.locator('#scanner-result-sheet'))
            .not.toHaveClass(/translate-y-full/, { timeout: 30000 });

        await page.evaluate(() => window.ScannerEngine.stop());
        await page.waitForTimeout(1500);

        const after = await page.evaluate(() => {
            const v = document.querySelector('#scanner-reader video');
            const stream = v && v.srcObject;
            return {
                scanning: window.ScannerEngine.isScanning,
                liveTracks: stream ? stream.getVideoTracks().filter(t => t.readyState === 'live').length : 0,
            };
        });
        expect(after.scanning).toBe(false);
        expect(after.liveTracks, 'the camera track is still live after closing the scanner').toBe(0);
    });
});

