import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 5173;
const SERVER_PORT = 3001;
const BASE_URL = `http://localhost:${WEB_PORT}`;
const TEST_API_KEY = 'aoc_e2e_test_key_for_playwright_1234567890';

export default defineConfig({
  testDir: './',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm -w @aoc/server run dev',
      port: SERVER_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        AOC_SECRET: 'e2e-test-secret-key-for-playwright-32chars',
        AOC_API_KEY: TEST_API_KEY,
        AOC_PORT: String(SERVER_PORT),
        AOC_HOST: '127.0.0.1',
        AOC_DB_PATH: './data-e2e.db',
      },
      cwd: '..',
    },
    {
      command: 'npm -w @aoc/web run dev',
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      cwd: '..',
    },
  ],
});
