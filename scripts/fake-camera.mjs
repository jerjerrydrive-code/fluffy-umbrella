/**
 * Builds a Y4M video file containing a real, scannable code, so the camera path can actually be
 * tested instead of assumed.
 *
 * The scanner is what this app is FOR, and it was the one pipeline nothing exercised: no camera
 * exists in headless Chromium or on a CI runner, so every test stopped at "bwip-js encodes, then
 * html5-qrcode decodes the PNG back". That covers the codecs and skips everything specific to
 * scanning — permissions, getUserMedia, the video element, the frame grabber, the decode
 * callback, the result sheet, and saving what was read.
 *
 * Chromium can be handed a file to play back as if it were a webcam
 * (--use-file-for-fake-video-capture), which closes the gap. It wants raw Y4M, so the frames are
 * built here: the app's OWN bwip-js renders the code, exactly as it does for a code on screen,
 * and the pixels are converted to I420. Using the app's encoder rather than a checked-in fixture
 * means the test would notice if encoding itself regressed, and there is no binary to keep in
 * step with the code that reads it.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Rec.601 full-range RGB → I420, the layout Chromium's fake capture device expects. */
function rgbaToI420(rgba, w, h) {
    const y = Buffer.alloc(w * h);
    const cw = w >> 1, ch = h >> 1;
    const u = Buffer.alloc(cw * ch);
    const v = Buffer.alloc(cw * ch);

    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            const p = (j * w + i) * 4;
            const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
            y[j * w + i] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
        }
    }
    // Chroma is subsampled 2x2: average the four luma-sized samples in each block.
    for (let j = 0; j < ch; j++) {
        for (let i = 0; i < cw; i++) {
            let r = 0, g = 0, b = 0;
            for (const [dy, dx] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
                const p = ((j * 2 + dy) * w + (i * 2 + dx)) * 4;
                r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2];
            }
            r /= 4; g /= 4; b /= 4;
            u[j * cw + i] = Math.max(0, Math.min(255, Math.round(-0.169 * r - 0.331 * g + 0.5 * b + 128)));
            v[j * cw + i] = Math.max(0, Math.min(255, Math.round(0.5 * r - 0.419 * g - 0.081 * b + 128)));
        }
    }
    return { y, u, v };
}

// Each entry is held for `frames` frames before the next appears. One code is a still; several
// make a sequence, which is what batch mode needs — it accumulates DISTINCT codes, so a single
// repeated still can only ever produce one item no matter how long it plays.
function writeY4M(file, segments, w, h, frames) {
    const parts = [Buffer.from(`YUV4MPEG2 W${w} H${h} F25:1 Ip A1:1 C420mpeg2\n`, 'ascii')];
    for (const planes of segments) {
        // Repeated rather than interpolated: the decoder needs several frames to lock on, and a
        // moving image would be testing the fake-capture device rather than the scanner.
        for (let i = 0; i < frames; i++) {
            parts.push(Buffer.from('FRAME\n', 'ascii'), planes.y, planes.u, planes.v);
        }
    }
    // Written to a unique temp file and renamed into place. Playwright runs specs in parallel
    // and two workers reach for the same video at once — a plain write means one can read a
    // half-finished file and get a decode failure that looks like a scanner bug. rename is
    // atomic within a filesystem, so a reader sees either no file or a complete one.
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, Buffer.concat(parts));
    fs.renameSync(tmp, file);
}

/**
 * Renders `text` as `bcid` using the app's own bwip-js, centred on white at w×h, and writes a
 * Y4M to `outFile`. Returns the path.
 */
export async function buildFakeCameraVideo({ text, bcid = 'qrcode', codes, outFile,
                                             w = 640, h = 480, frames = 60 } = {}) {
    // `codes` is the general form: [{ text, bcid }, ...] shown one after another. A bare
    // text/bcid pair is the single-code shorthand.
    const sequence = codes && codes.length ? codes : [{ text, bcid }];
    if (fs.existsSync(outFile)) return outFile;
    fs.mkdirSync(path.dirname(outFile), { recursive: true });

    const server = spawn('node', ['scripts/dev-server.mjs'], { stdio: 'ignore' });
    const browser = await chromium.launch();
    try {
        await new Promise(r => setTimeout(r, 1400));
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        await page.goto('http://localhost:4173/index.html');
        await page.waitForFunction(() => typeof window.bwipjs !== 'undefined', null, { timeout: 20000 });

        const rgbaFor = ({ text, bcid }) => page.evaluate(async ({ text, bcid, w, h }) => {
            const off = document.createElement('canvas');
            // Generous quiet zone and a big module size: a code that fills the frame edge to
            // edge is harder to decode than one with white around it, and the point here is to
            // test the scanner rather than its tolerance for a bad photograph.
            window.bwipjs.toCanvas(off, {
                bcid, text, scale: 8, includetext: false,
                paddingwidth: 10, paddingheight: 10,
                barcolor: '000000', backgroundcolor: 'FFFFFF',
            });

            const frame = document.createElement('canvas');
            frame.width = w; frame.height = h;
            const ctx = frame.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);

            const scale = Math.min((h * 0.8) / off.height, (w * 0.8) / off.width);
            const dw = Math.round(off.width * scale), dh = Math.round(off.height * scale);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(off, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);

            return Array.from(ctx.getImageData(0, 0, w, h).data);
        }, { text, bcid, w, h });

        const segments = [];
        for (const code of sequence) {
            const rgba = await rgbaFor(code);
            segments.push(rgbaToI420(Uint8ClampedArray.from(rgba), w, h));
        }
        writeY4M(outFile, segments, w, h, frames);
        await page.close();
    } finally {
        await browser.close();
        server.kill();
    }
    return outFile;
}

/** Chromium flags that replace the webcam with the file above. */
export const fakeCameraArgs = (y4m) => [
    '--use-fake-ui-for-media-stream',      // auto-accept the permission prompt
    '--use-fake-device-for-media-stream',  // present a camera at all
    `--use-file-for-fake-video-capture=${y4m}`,
];

// Runnable directly, to eyeball the generated file. Wrapped rather than using top-level await:
// a module with TLA cannot be required, and the spec that imports this is loaded by Playwright's
// CommonJS-compatible transform.
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        // node scripts/fake-camera.mjs OUT TEXT BCID [TEXT2 BCID2 ...]
        const [out = 'fake-camera.y4m', ...rest] = process.argv.slice(2);
        const pairs = rest.length ? rest : ['https://example.com/scan-test', 'qrcode'];
        const codes = [];
        for (let i = 0; i < pairs.length; i += 2) codes.push({ text: pairs[i], bcid: pairs[i + 1] || 'qrcode' });
        await buildFakeCameraVideo({ codes, outFile: out });
        console.log(`${out}: ${fs.statSync(out).size} bytes (${codes.map(c => c.bcid).join(', ')})`);
    })();
}
