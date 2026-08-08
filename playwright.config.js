// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
    // index.html pulls Tailwind, bwip-js, lucide and html5-qrcode from CDNs at boot, so first
    // paint is network-bound and can take ~25s on a cold/proxied connection. Playwright's 30s
    // default left every test finishing within a couple of seconds of the cap, which made the
    // suite flaky-by-latency rather than by behaviour. Raised so a slow network fails a test
    // only when something is actually wrong.
    timeout: 90_000,
    use: {
        baseURL: 'http://localhost:4173',
        trace: 'retain-on-failure',
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
