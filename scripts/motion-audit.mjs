#!/usr/bin/env node
/**
 * MOTION AUDIT — look at every animation frame by frame, and measure it.
 *
 * The regression suite asserts end states: the overlay is open, the icon moved, the accent
 * changed. That leaves everything that happens BETWEEN the states invisible — an element that
 * flies in from off-screen, a transition that stalls halfway, a panel that settles a few pixels
 * from where it should, a spring that overshoots past the viewport edge. Those are exactly the
 * defects a person notices immediately and a green test suite never mentions.
 *
 * Two passes, because they catch different things.
 *
 * FRAMES. Real-time screenshotting is the obvious approach and the wrong one: a screenshot costs
 * 20-50ms, so it samples the motion coarsely AND perturbs the timing it is trying to measure.
 * Instead this drives the Web Animations API — every CSS transition and animation on the page is
 * a live Animation object, so they can all be paused and their currentTime set to an exact
 * millisecond before each capture. The frames are therefore precise rather than approximate, and
 * the screenshot cost stops mattering because time is not running while it happens.
 *
 * NUMBERS. Separately, the same interaction is played at full speed with a rAF sampler reading
 * computed geometry every frame. That gives a trace to check for stalls, discontinuities,
 * overshoot past the viewport, and whether the thing actually finishes where it claims to.
 *
 * Contact sheets are assembled as HTML and screenshotted, so the whole tool needs no image
 * library and no ffmpeg — same self-contained constraint as the app itself.
 *
 *   node scripts/motion-audit.mjs [--out DIR] [--only NAME]
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : dflt; };
const OUT = argOf('--out', 'motion-audit');
const ONLY = argOf('--only', null);
const BASE = 'http://localhost:4173/index.html';
const VIEWPORT = { width: 412, height: 892 };   // a common Android portrait size

// Frames per interaction. 12 across the transition plus one settled frame afterwards reads
// like a filmstrip without producing more images than can be looked at in one go.
const STEPS = 12;

/* ------------------------------------------------------------------ scenes */
/* `open` runs the interaction. `watch` is what to trace. `settleAfter` is how long the motion
   is supposed to take, used both to scale the filmstrip and to judge whether it finished. */
const SCENES = [
    { name: 'settings-open',   watch: ['#settings-modal', '#settings-panel'], ms: 700,
      open: () => window.SettingsManager.open() },
    { name: 'settings-close',  watch: ['#settings-modal', '#settings-panel'], ms: 700,
      setup: () => window.SettingsManager.open(), open: () => window.SettingsManager.close() },
    { name: 'library-open',    watch: ['#library-overlay'], ms: 700,
      open: () => window.LibraryManager.open() },
    { name: 'account-open',    watch: ['#account-modal', '#account-panel'], ms: 700,
      open: () => window.CloudSync.open() },
    { name: 'editor-open',     watch: ['#create-modal', '#create-panel'], ms: 800,
      open: () => window.CodeGenerator.open() },
    { name: 'viewer-open',     watch: ['#item-fullscreen-layer'], ms: 800,
      open: () => window.InteractionManager.openEnlarge(
                    window.OS_STATE.apps.find(a => a.type === 'grid')) },
    { name: 'viewer-close',    watch: ['#item-fullscreen-layer'], ms: 800,
      setup: () => window.InteractionManager.openEnlarge(
                    window.OS_STATE.apps.find(a => a.type === 'grid')),
      open: () => window.InteractionManager.closeEnlarge() },
    { name: 'folder-open',     watch: ['#folder-overlay'], ms: 700,
      setup: () => { const [a, b] = window.OS_STATE.apps.filter(x => x.type === 'grid');
                     window.createFolderFrom(a.id, b.id); window.Renderer.render(); },
      open: () => window.FolderManager.open(
                    window.OS_STATE.apps.find(a => a.type === 'folder').id) },
    { name: 'rename-open',     watch: ['#rename-modal', '#rename-panel'], ms: 700,
      open: () => window.InteractionManager.openRename(
                    window.OS_STATE.apps.find(a => a.type === 'grid')) },
    { name: 'search-open',     watch: ['#search-overlay', '#search-bar-container'], ms: 700,
      open: () => window.GestureManager.openSearch() },
    // The jiggle is a keyframe animation on .jiggle-target inside the wrapper, not on the
    // wrapper itself — watching the wrapper reported "nothing animated" while 16 animations
    // were plainly running.
    { name: 'edit-mode-enter', watch: ['#workspace-pager .jiggle-target'], ms: 900,
      open: () => { window.OS_STATE.isEditMode = true;
                    document.body.classList.add('edit-mode'); window.Renderer.render(); } },
    // 480ms of pulse, but the skin swap is staged behind a 220ms timer and the workspace
    // transition runs on after it, so the whole thing is not done until past 1.1s.
    { name: 'skin-morph',      watch: ['#workspace-container'], ms: 1300,
      open: () => window.SkinManager.setSkin('glass') },
    { name: 'toast',           watch: ['.fixed.top-16'], ms: 900,
      open: () => window.showToast('Motion audit') },
];

/* --------------------------------------------------------------- utilities */
const sh = (cmd, a, opts) => spawn(cmd, a, opts);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const ensure = (d) => fs.mkdirSync(d, { recursive: true });

async function boot(browser) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    // Firebase is an optional dynamic import and this machine has no route to gstatic, so its
    // failure is the sandbox, not the app — the app is designed to carry on local-only. Filtered
    // so it cannot bury a finding that matters. Nothing else is filtered.
    const ENVIRONMENTAL = /gstatic\.com|firebasejs|ERR_CONNECTION_RESET|Cloud sync unavailable/;
    const errors = [];
    const note = (s) => { if (!ENVIRONMENTAL.test(s)) errors.push(s); };
    page.on('pageerror', e => note(String(e.message)));
    page.on('console', m => { if (m.type() === 'error') note('console: ' + m.text()); });
    await page.goto(BASE);
    await page.waitForFunction(() => window.Renderer && window.OS_STATE, null, { timeout: 15000 });
    await page.waitForTimeout(900);
    page._auditErrors = errors;
    return page;
}

/* ------------------------------------------------------- pass 1: the numbers */
/* Plays the interaction at full speed, sampling every animation frame. No screenshots, so the
   timing is the app's own rather than the harness's. */
async function traceScene(page, scene) {
    if (scene.setup) { await page.evaluate(scene.setup); await page.waitForTimeout(500); }

    const trace = await page.evaluate(async ({ selectors, ms }) => {
        const pick = () => selectors.map(sel => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            // A heavy blur is the one effect that makes the interface unreadable rather than
            // merely moving, so how long it lasts is worth knowing on its own.
            const blur = /blur\(([\d.]+)px\)/.exec(cs.filter);
            return { sel, t: 0, opacity: +cs.opacity, transform: cs.transform,
                     blur: blur ? +blur[1] : 0,
                     loops: cs.animationIterationCount.split(',').some(v => v.trim() === 'infinite'),
                     x: +r.x.toFixed(2), y: +r.y.toFixed(2),
                     w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
        });

        const frames = [];
        const t0 = performance.now();
        let stop = false;
        const tick = () => {
            const t = performance.now() - t0;
            frames.push(pick().map(s => s && Object.assign(s, { t: +t.toFixed(1) })));
            if (!stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        window.__auditTrigger();
        await new Promise(r => setTimeout(r, ms + 250));
        stop = true;
        return frames;
    }, { selectors: scene.watch, ms: scene.ms });

    return trace;
}

/* Turns a raw trace into findings. Only checks that mean the same thing on any machine —
   frame-rate on a headless VM says nothing useful about a phone, so it is reported, not judged. */
function analyse(scene, trace, viewport) {
    const findings = [];
    const info = [];

    scene.watch.forEach((sel, i) => {
        const series = trace.map(f => f[i]).filter(Boolean);
        if (series.length < 3) { findings.push(`${sel}: never found in the DOM during the scene`); return; }

        // A looping animation is supposed to still be running at the end — the edit-mode jiggle
        // never stops until edit mode does. Judging it by "has it settled" invents a defect.
        if (series[0].loops) { info.push(`${sel}: loops by design, settle check skipped`); return; }

        const opacities = series.map(s => s.opacity);
        const moved = new Set(series.map(s => s.transform)).size > 1;
        const faded = Math.max(...opacities) - Math.min(...opacities) > 0.01;

        if (!moved && !faded) {
            findings.push(`${sel}: nothing animated — no transform or opacity change in ${scene.ms}ms`);
            return;
        }

        // Settled? The last 4 frames should agree, or the motion is still running when it
        // should be done (or is being restarted by something).
        const tail = series.slice(-4);
        const settledOpacity = tail.every(s => Math.abs(s.opacity - tail[0].opacity) < 0.01);
        const settledTransform = new Set(tail.map(s => s.transform)).size === 1;
        if (!settledOpacity || !settledTransform) {
            findings.push(`${sel}: still moving at ${scene.ms}ms — has not settled`);
        }

        // When did it actually finish? Useful for spotting a transition far longer or shorter
        // than the sheet declares.
        let lastChange = 0;
        for (let k = 1; k < series.length; k++) {
            if (series[k].transform !== series[k - 1].transform ||
                Math.abs(series[k].opacity - series[k - 1].opacity) > 0.005) lastChange = series[k].t;
        }
        info.push(`${sel}: motion ends at ${Math.round(lastChange)}ms`);

        // Off-screen mid-flight. An element that leaves the viewport during its own entrance is
        // the classic "it flashes in from nowhere" defect, and it is invisible to an end-state test.
        const escapes = series.filter(s =>
            s.opacity > 0.15 && s.w > 0 && (s.x + s.w < -1 || s.x > viewport.width + 1 ||
                                            s.y + s.h < -1 || s.y > viewport.height + 1));
        if (escapes.length) {
            const worst = escapes[0];
            findings.push(`${sel}: visible but outside the viewport at ${Math.round(worst.t)}ms ` +
                          `(x=${worst.x} y=${worst.y} w=${worst.w} h=${worst.h})`);
        }

        // A stall in the middle: several consecutive identical frames while still visible and
        // before the motion has finished.
        let run = 1, worstRun = 0, worstAt = 0;
        for (let k = 1; k < series.length; k++) {
            const same = series[k].transform === series[k - 1].transform &&
                         Math.abs(series[k].opacity - series[k - 1].opacity) < 0.003;
            if (same && series[k].t < lastChange) {
                run++;
                if (run > worstRun) { worstRun = run; worstAt = series[k].t; }
            } else run = 1;
        }
        if (worstRun >= 8) {
            findings.push(`${sel}: stalls for ${worstRun} frames around ${Math.round(worstAt)}ms`);
        }

        // How long is the interface actually unreadable? Above about 4px of blur, text and the
        // codes themselves stop being legible; a whole-screen effect that sits there is felt as
        // the app going away rather than as a transition.
        const blurred = series.filter(s => s.blur >= 4);
        if (blurred.length > 1) {
            const span = blurred[blurred.length - 1].t - blurred[0].t;
            const line = `${sel}: unreadable (blur ≥4px) for ${Math.round(span)}ms`;
            if (span > 500) findings.push(line + ' — over half a second of illegible screen');
            else info.push(line);
        }

        // A discontinuity in opacity — a jump rather than a fade.
        for (let k = 1; k < series.length; k++) {
            const d = Math.abs(series[k].opacity - series[k - 1].opacity);
            if (d > 0.45 && series[k].t > 20 && series[k].t < lastChange - 20) {
                findings.push(`${sel}: opacity jumps ${d.toFixed(2)} in one frame at ${Math.round(series[k].t)}ms`);
                break;
            }
        }
    });

    const gaps = [];
    for (let k = 1; k < trace.length; k++) {
        const a = trace[k].find(Boolean), b = trace[k - 1].find(Boolean);
        if (a && b) gaps.push(a.t - b.t);
    }
    const p95 = gaps.length ? gaps.slice().sort((x, y) => x - y)[Math.floor(gaps.length * 0.95)] : 0;
    info.push(`frames: ${trace.length}, p95 gap ${p95.toFixed(1)}ms (headless — advisory only)`);

    return { findings, info };
}

/* -------------------------------------------------- pass 2: the actual frames */
/* Two clocks have to be advanced together, and getting this wrong produces a filmstrip that
   looks authoritative and lies.
 *
 * CSS transitions and animations run on the browser's own timeline, reachable through the Web
 * Animations API — pause them and set currentTime and the frame is exact.
 *
 * But several sequences here are staged with setTimeout instead: the skin morph swaps
 * data-skin at 220ms and clears the pulse at 480ms, and the drag settle lands at 400ms. Those
 * timers keep running in wall-clock time while screenshots are being written, and a screenshot
 * costs tens of milliseconds. Stepping only the animation clock therefore captured animation
 * time T against timer state "whenever the disk got round to it" — which is how the first run
 * of this tool produced a skin-morph strip showing the icons blanking out, an artefact of the
 * harness rather than anything the app does.
 *
 * So the JS clock is faked and advanced by the same increment, and animations that begin part
 * way through (a transition started by a timer) are given a currentTime relative to when they
 * actually appeared rather than to the start of the scene. */
async function filmstrip(page, scene, dir) {
    if (scene.setup) { await page.evaluate(scene.setup); await page.waitForTimeout(500); }

    // install() alone is not enough: the fake clock still advances with real time, so the tens
    // of milliseconds each screenshot takes were firing the very timers this is trying to hold
    // still. That is what produced the first misleading skin-morph strip — the frame labelled
    // 0ms had already run the 220ms skin swap by the time it was written to disk. pauseAt()
    // stops the clock dead, and only runFor() moves it.
    const T0 = new Date('2030-01-01T09:00:00Z');
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T0);

    await page.evaluate(() => {
        window.__auditSeen = new Map();
        // Adopts any animation running at global time `t`, then places every known one at its
        // own elapsed time. Called after each clock advance so late starters are handled.
        window.__auditStep = (t) => {
            for (const a of document.getAnimations()) {
                if (!window.__auditSeen.has(a)) {
                    window.__auditSeen.set(a, t);
                    try { a.pause(); } catch (e) {}
                }
                try { a.currentTime = Math.max(0, t - window.__auditSeen.get(a)); } catch (e) {}
            }
            return window.__auditSeen.size;
        };
        window.__auditTrigger();
        return window.__auditStep(0);
    });

    const shots = [];
    let animationCount = 0;
    let elapsed = 0;
    for (let i = 0; i <= STEPS; i++) {
        const t = Math.round((scene.ms * i) / STEPS);
        if (t > elapsed) { await page.clock.runFor(t - elapsed); elapsed = t; }
        animationCount = await page.evaluate((ms) => window.__auditStep(ms), t);

        const file = path.join(dir, `${scene.name}-${String(i).padStart(2, '0')}-${t}ms.png`);
        await page.screenshot({ path: file });
        shots.push({ file: path.basename(file), t });
    }

    // Hand time back and let everything finish on its own, to see where it truly lands.
    await page.evaluate(() => document.getAnimations().forEach(a => { try { a.play(); } catch (e) {} }));
    await page.clock.runFor(scene.ms + 800);
    await page.clock.resume();
    await page.waitForTimeout(500);
    const settled = path.join(dir, `${scene.name}-99-settled.png`);
    await page.screenshot({ path: settled });
    shots.push({ file: path.basename(settled), t: 'settled' });

    return { shots, animationCount };
}

/* Contact sheet as HTML, screenshotted — no image library needed. */
async function contactSheet(browser, scene, shots, dir) {
    const cells = shots.map(s => `
        <figure>
          <img src="${s.file}">
          <figcaption>${typeof s.t === 'number' ? s.t + 'ms' : s.t}</figcaption>
        </figure>`).join('');
    const html = `<!doctype html><meta charset="utf-8"><style>
        body { margin:0; background:#111; color:#ddd; font:12px system-ui, sans-serif; padding:14px; }
        h1 { font-size:15px; margin:0 0 12px; font-weight:700; letter-spacing:.02em; }
        .grid { display:grid; grid-template-columns:repeat(7, 1fr); gap:8px; }
        figure { margin:0; }
        img { width:100%; display:block; border:1px solid #333; border-radius:4px; background:#000; }
        figcaption { text-align:center; padding-top:4px; color:#8a8a8a; font-variant-numeric:tabular-nums; }
      </style><h1>${scene.name} — ${scene.ms}ms, stepped deterministically</h1>
      <div class="grid">${cells}</div>`;
    const file = path.join(dir, `_sheet-${scene.name}.html`);
    fs.writeFileSync(file, html);

    const p = await browser.newPage({ viewport: { width: 1680, height: 900 } });
    await p.goto('file://' + path.resolve(file));
    await p.waitForTimeout(400);
    const png = path.join(dir, `_sheet-${scene.name}.png`);
    await p.screenshot({ path: png, fullPage: true });
    await p.close();
    return png;
}

/* --------------------------------------------------- pass 3: geometry at rest */
/* What the filmstrip cannot tell you: whether anything is a few pixels off, unreachable, or
   spilling out of the layer it belongs to. Run on each layer once it has settled. */
const LAYERS = [
    { name: 'home',     open: () => {} },
    { name: 'settings', open: () => window.SettingsManager.open() },
    { name: 'library',  open: () => window.LibraryManager.open() },
    { name: 'account',  open: () => window.CloudSync.open() },
    { name: 'editor',   open: () => window.CodeGenerator.open() },
    { name: 'viewer',   open: () => window.InteractionManager.openEnlarge(
                                     window.OS_STATE.apps.find(a => a.type === 'grid')) },
    { name: 'search',   open: () => window.GestureManager.openSearch() },
    { name: 'edit-mode',open: () => { window.OS_STATE.isEditMode = true;
                                      document.body.classList.add('edit-mode');
                                      window.Renderer.render(); } },
];

async function geometry(page, layer, viewport) {
    await page.evaluate(layer.open);
    await page.waitForTimeout(800);

    return page.evaluate((vp) => {
        const out = [];
        const visible = (el) => {
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.05) return false;
            // Walk up: a control inside a closed overlay is not on screen even though it exists.
            for (let n = el; n && n !== document.body; n = n.parentElement) {
                const s = getComputedStyle(n);
                if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false;
                if (n.classList.contains('pointer-events-none')) return false;
            }
            return true;
        };

        // The page itself must never scroll sideways.
        const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth + 1) {
            out.push(`page scrolls horizontally: ${de.scrollWidth}px of content in ${de.clientWidth}px`);
        }

        for (const el of document.querySelectorAll('button, [role="button"], input, a[href]')) {
            if (!visible(el)) continue;
            const r = el.getBoundingClientRect();
            const id = el.id || el.className.toString().split(' ').slice(0, 2).join('.') || el.tagName;

            // Reachable? A control drawn outside the viewport cannot be tapped — unless it sits
            // in something that scrolls, in which case it is merely scrolled away, which is the
            // normal state of most of a long list.
            const inScroller = (() => {
                for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
                    const s = getComputedStyle(n);
                    if (/auto|scroll/.test(s.overflowY) || /auto|scroll/.test(s.overflowX)) return true;
                }
                return false;
            })();
            if (!inScroller && r.width > 0 &&
                (r.right < 0 || r.left > vp.width || r.bottom < 0 || r.top > vp.height)) {
                out.push(`offscreen control: ${id} at (${Math.round(r.x)},${Math.round(r.y)})`);
            }
            // Big enough? tap-extend supplies a 44px pseudo-element, so honour it.
            const extended = el.classList.contains('tap-extend') || el.classList.contains('tap44');
            const h = extended ? Math.max(r.height, 44) : r.height;
            const w = extended ? Math.max(r.width, 44) : r.width;
            if (r.width > 0 && (h < 44 || w < 44)) {
                out.push(`tap target ${Math.round(w)}x${Math.round(h)}: ${id}`);
            }
        }

        // Text wider than its box and not asked to truncate is text with its end cut off. An
        // earlier version of this check compared scrollHeight to clientHeight on containers,
        // which flagged edit mode: the dock is translated 150% down there, so it counts toward
        // scrollHeight while being opacity 0 and pointer-events none — hidden on purpose, not
        // unreachable content. Asking about the text directly avoids inventing that problem.
        for (const el of document.querySelectorAll('h1,h2,h3,h4,p,span,button,label,div')) {
            if (!visible(el)) continue;
            if (el.children.length) continue;                       // leaf text only
            const cs = getComputedStyle(el);
            if (cs.textOverflow === 'ellipsis' || cs.overflow !== 'visible') continue;
            if (cs.whiteSpace !== 'nowrap') continue;               // wrapping text is fine
            if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
                const id = el.id || el.className.toString().split(' ').slice(0, 2).join('.') || el.tagName;
                out.push(`clipped text: ${id} needs ${el.scrollWidth}px, has ${el.clientWidth}px — "${(el.textContent || '').trim().slice(0, 30)}"`);
            }
        }
        return out;
    }, viewport);
}

/* ------------------------------------------------------------------- driver */
const server = sh('node', ['scripts/dev-server.mjs'], { stdio: 'ignore' });
await wait(1600);
const browser = await chromium.launch();
ensure(OUT);

const scenes = SCENES.filter(s => !ONLY || s.name.includes(ONLY));
const report = [];

for (const scene of scenes) {
    const dir = path.join(OUT, scene.name);
    ensure(dir);
    process.stdout.write(`\n${scene.name}\n`);

    // Trace and filmstrip each get a clean page: stepping animations by hand leaves the page in
    // a state that is fine to screenshot and not fine to measure timing from.
    let page = await boot(browser);
    await page.evaluate(`window.__auditTrigger = ${scene.open.toString()}`);
    const trace = await traceScene(page, scene);
    const { findings, info } = analyse(scene, trace, VIEWPORT);
    const errors = page._auditErrors.slice();
    await page.close();

    page = await boot(browser);
    await page.evaluate(`window.__auditTrigger = ${scene.open.toString()}`);
    const { shots, animationCount } = await filmstrip(page, scene, dir);
    errors.push(...page._auditErrors);
    await page.close();

    const sheet = await contactSheet(browser, scene, shots, dir);

    info.forEach(l => process.stdout.write(`   · ${l}\n`));
    process.stdout.write(`   · ${animationCount} animations driven, ${shots.length} frames\n`);
    findings.forEach(f => process.stdout.write(`   ✗ ${f}\n`));
    errors.forEach(e => process.stdout.write(`   ✗ page error: ${e}\n`));
    if (!findings.length && !errors.length) process.stdout.write('   ✓ clean\n');

    report.push({ scene: scene.name, findings, info, errors, sheet, animationCount });
}

/* Geometry at rest, once per layer. */
const geo = [];
if (!ONLY) {
    process.stdout.write('\n--- geometry at rest ---\n');
    for (const layer of LAYERS) {
        const page = await boot(browser);
        const found = await geometry(page, layer, VIEWPORT);
        await page.screenshot({ path: path.join(OUT, `_rest-${layer.name}.png`) });
        await page.close();
        process.stdout.write(`\n${layer.name}\n`);
        if (!found.length) process.stdout.write('   ✓ clean\n');
        // Repeats of the same shape are one problem, not twenty.
        const seen = new Map();
        found.forEach(f => seen.set(f, (seen.get(f) || 0) + 1));
        [...seen].forEach(([f, n]) => process.stdout.write(`   ✗ ${f}${n > 1 ? ` (x${n})` : ''}\n`));
        geo.push({ layer: layer.name, findings: found });
    }
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ motion: report, geometry: geo }, null, 2));
const total = report.reduce((n, r) => n + r.findings.length + r.errors.length, 0)
            + geo.reduce((n, g) => n + g.findings.length, 0);
process.stdout.write(`\n${total} finding(s) across ${report.length} scenes and ${geo.length} layers → ${OUT}/\n`);

await browser.close();
server.kill();
process.exit(0);
