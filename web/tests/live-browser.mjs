import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
process.env.TMPDIR = resolve(root, 'test/scratch/tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, 'test/scratch/browsers');
mkdirSync(process.env.TMPDIR, { recursive: true });
const { chromium } = await import('@playwright/test');
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (!path.startsWith('/preview/') || path.includes('..'))
    return response.writeHead(404).end();
  const file = resolve(root, 'dist', path.slice(9) || 'index.html');
  try {
    const data = readFileSync(file);
    response
      .writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
          }[extname(file)] ?? 'application/octet-stream',
      })
      .end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
const report = {
  observedAt: new Date().toISOString(),
  readOnly: true,
  mocked: false,
  consoleErrors: [],
  failures: [],
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    report.failures.push({
      url: request.url(),
      error: request.failure()?.errorText,
    }),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  try {
    await page.getByText(/^Live reads · block/).waitFor({ timeout: 45000 });
    report.result = 'PASS';
    report.status = await page.locator('.connection-status').innerText();
    report.emptyState = await page
      .getByText('The first milestone starts here.')
      .isVisible();
  } catch (error) {
    report.result = 'UNAVAILABLE';
    report.error = error.message;
  }
  await page.screenshot({
    path: resolve(root, 'docs/evidence/live-desktop.png'),
    fullPage: true,
  });
} finally {
  writeFileSync(
    resolve(root, 'docs/evidence/live-browser.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((done) => server.close(done));
}
