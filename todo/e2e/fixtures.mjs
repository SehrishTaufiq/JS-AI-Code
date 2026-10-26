// Shared fixtures for the e2e tests: every test records the browser's console and network traffic
// (attached to the Playwright report as browser-log.txt) and fails on console errors, uncaught
// exceptions, files that fail to load, or any request that leaves the app folder. The app is
// offline by design, so nothing should ever go to the internet.
//
// A test that causes an error on purpose allows it: test.use({ allowConsole: [/Content Security Policy/] }).
// A test can read what was recorded through the `browserLog` fixture.
import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APP_DIR = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..') + path.sep).href;

export const test = base.extend({
  allowConsole: [[], { option: true }],
  browserLog: async ({}, use) => {
    await use({ lines: [], requests: [], problems: [] });
  },
  context: async ({ context, allowConsole, browserLog }, use, testInfo) => {
    const { lines, requests, problems } = browserLog;
    const allowed = (text) => allowConsole.some((re) => re.test(text));
    context.on('console', (msg) => {
      lines.push(`console.${msg.type()}: ${msg.text()}`);
      if (msg.type() === 'error' && !allowed(msg.text())) problems.push(`console.error: ${msg.text()}`);
    });
    context.on('weberror', (err) => {
      const message = err.error().message;
      lines.push(`uncaught: ${message}`);
      if (!allowed(message)) problems.push(`uncaught: ${message}`);
    });
    context.on('request', (req) => {
      lines.push(`${req.method()} ${req.url()}`);
      if (/^(about|data|blob):/.test(req.url())) return;
      requests.push(req.url());
      if (!req.url().startsWith(APP_DIR)) problems.push(`request outside the app: ${req.url()}`);
    });
    context.on('requestfailed', (req) => {
      lines.push(`FAILED ${req.url()} (${req.failure()?.errorText})`);
      problems.push(`failed to load: ${req.url()} (${req.failure()?.errorText})`);
    });
    await use(context);
    await testInfo.attach('browser-log.txt', { body: lines.join('\n') || '(nothing logged)', contentType: 'text/plain' });
    expect(problems, 'browser console and network should be clean').toEqual([]);
  },
});

export { expect };
