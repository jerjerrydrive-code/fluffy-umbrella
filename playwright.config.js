// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // No retries, deliberately, including in CI. A retry turns an intermittent failure into a
    // green tick, and an intermittent failure here has already turned out to be a real bug: the
    // folder-dwell test failed about one run in five because the reorder swap moved the target
    // out from under the pointer and cancelled the merge. A retry would have hidden that
    // indefinitely. If something is flaky, that is the finding.
    retries: 0,
    reporter: 'list',
    // Boot used to be network-bound — Tailwind, bwip-js, lucide and html5-qrcode came from CDNs
    // and cold starts ran to ~25s, which left tests finishing within seconds of Playwright's 30s
    // default and made the suite flaky by latency rather than by behaviour. Those are vendored
    // now and boot is local, but the headroom is kept: a CI runner under load is slow for
    // reasons that have nothing to do with the code, and a timeout should fail a test only when
    // something is actually wrong.
    timeout: 90_000,
    use: {
        baseURL: 'http://localhost:4173',
        trace: 'retain-on-failure',
        // This ships to phones. Without it the page reports no touch support, TouchEvent is
        // unavailable, and any test that drives a finger silently becomes a mouse test — which
        // is how a long-press bug that only exists under touch got a passing test.
        hasTouch: true,
        // The app now starts EMPTY on a first run — three sample codes belonging to nobody are
        // clutter to delete, not a demonstration. Almost every test here was written against
        // those codes though, so they are supplied as a saved state instead of as a default.
        // Doing it here rather than in each test keeps the suite testing the app rather than
        // testing its seed data, and a test that needs a genuinely fresh install still gets one
        // by clearing localStorage itself, exactly as it did before.
        storageState: 'tests/demo-state.json',
    },
    webServer: {
        command: 'node scripts/dev-server.mjs',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 10_000,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
});
