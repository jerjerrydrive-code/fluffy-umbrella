// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
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
