// Browser tests for the todo app (npm run test:e2e). Locally they drive the installed Chrome
// (no browser download); in CI (CI=true) they use Playwright's bundled Chromium.
// Date-dependent tests (tagged @dates) also run in two far-apart time zones, because the app
// mixes local "today" with UTC date arithmetic.
import { defineConfig } from '@playwright/test';

const chrome = process.env.CI ? {} : { channel: 'chrome' };

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  // Each worker is a full Chrome; the default (half the CPU cores) overloads big machines and
  // makes simple tests time out. 4 locally / 2 on CI runners is stable.
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { ...chrome, viewport: { width: 1280, height: 800 } },
  projects: [
    { name: 'desktop-utc', use: { timezoneId: 'UTC' } },
    { name: 'tz-auckland', grep: /@dates/, use: { timezoneId: 'Pacific/Auckland' } },
    { name: 'tz-sao-paulo', grep: /@dates/, use: { timezoneId: 'America/Sao_Paulo' } },
    { name: 'mobile', grep: /@mobile/, use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
