import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 5173;
const SERVER_PORT = 3001;
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
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
      command: 'npm run dev:server',
      port: SERVER_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        AOC_SECRET: 'e2e-test-secret-key-for-playwright-32chars',
        AOC_PORT: String(SERVER_PORT),
        AOC_HOST: '127.0.0.1',
        AOC_DB_PATH: './data-e2e.db',
      },
    },
    {
      command: 'npm run dev:web',
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
