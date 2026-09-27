// A bounded foreground server/browser run. All generated artifacts stay in the task scope.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeChain, installMock } from './mock-chain.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
process.env.TMPDIR = resolve(root, 'test/scratch/tmp');
mkdirSync(process.env.TMPDIR, { recursive: true });
if (
  !process.env.PLAYWRIGHT_BROWSERS_PATH &&
  existsSync(resolve(root, 'test/scratch/browsers'))
)
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(root, 'test/scratch/browsers');
const { chromium, expect } = await import('@playwright/test');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const evidence = resolve(root, 'docs/evidence');
mkdirSync(evidence, { recursive: true });
const server = createServer((request, response) => {
  const path = decodeURIComponent(
    new URL(request.url, 'http://localhost').pathname,
  );
  if (!path.startsWith('/preview/') || path.includes('..')) {
    response.writeHead(404).end();
    return;
  }
  const target = resolve(
    root,
    'dist',
    path.slice('/preview/'.length) || 'index.html',
  );
  try {
    const content = readFileSync(target);
    response
      .writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.json': 'application/json',
          }[extname(target)] ?? 'application/octet-stream',
      })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
const report = {
  generatedAt: new Date().toISOString(),
  browser: await browser.version(),
  basePath: '/preview/',
  checks: [],
  screenshots: [],
  consoleErrors: [],
  pageErrors: [],
  failedLocalRequests: [],
  contrast: [],
};
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const live = (page) =>
  expect(page.getByText(/^Live reads · block/)).toBeVisible({ timeout: 20000 });
const card = (page, id) =>
  page.getByRole('article', { name: `Raise #${id}`, exact: true });
async function openCard(page, id) {
  const item = card(page, id);
  if (await item.getByRole('button', { name: 'Manage raise' }).count())
    await item.getByRole('button', { name: 'Manage raise' }).click();
  return item;
}
async function confirm(page, title) {
  const modal = page.getByRole('dialog');
  await expect(
    modal.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await modal.getByRole('button', { name: 'Confirm in wallet' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `${title} confirmed.` }),
  ).toBeVisible({ timeout: 15000 });
  await live(page);
}
async function newPage(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const mock = makeChain(root);
  if (options.modify) options.modify(mock);
  await installMock(page, mock, options);
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(url))
      report.failedLocalRequests.push(request.url());
  });
  await page.goto(url);
  return { page, mock };
}
try {
  const { page, mock } = await newPage({ wrongChain: true });
  await live(page);
  await expect(
    page.getByRole('button', { name: 'Review new raise' }),
  ).toBeDisabled();
  await page
    .getByText('Reading event history', { exact: false })
    .waitFor({ state: 'hidden' });
  assert(
    mock.state.ranges.some(
      (r) => r.from === BigInt(mock.deployment.deploymentBlock),
    ),
  );
  assert(mock.state.ranges.every((r) => r.to - r.from < 2000n));
  assert(mock.state.ranges.some((r) => r.to === mock.state.block));
  await page.screenshot({
    path: resolve(evidence, 'desktop-disconnected.png'),
    fullPage: true,
  });
  report.screenshots.push('desktop-disconnected.png');
  pass(
    'Read-only state; raise list, chunked event history from deployment block, and subpath asset loading',
  );
  await page.getByRole('button', { name: 'Connect browser wallet' }).click();
  await expect(
    page.getByText('Your wallet is on another network'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review new raise' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
  await expect(page.getByText('Your wallet is on another network')).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'Review new raise' }),
  ).toBeEnabled();
  const walletCalls = await page.evaluate(() => window.ethereum.calls);
  assert.deepEqual(
    walletCalls.find((c) => c.method === 'wallet_addEthereumChain').params,
    [mock.deployment.walletAddChain],
  );
  assert.equal(
    walletCalls.filter((c) => c.method === 'wallet_switchEthereumChain').length,
    2,
  );
  pass(
    'Wallet connect; wrong-network guard; 4902 add-chain parameters and switch retry',
  );
  const own = await openCard(page, 3);
  await expect(own.getByLabel('Amount to back (TRNC)')).toBeDisabled();
  await expect(
    own.getByRole('button', { name: '1. Approve TRNC' }),
  ).toBeDisabled();
  pass('Creator cannot approve/deposit into their own raise');
  let back = await openCard(page, 2);
  await back.getByLabel('Amount to back (TRNC)').fill('1.0000000000000000001');
  await back.getByRole('button', { name: '1. Approve TRNC' }).click();
  await expect(back.getByRole('alert')).toContainText('at most 18');
  await expect(back.getByLabel('Amount to back (TRNC)')).toBeFocused();
  await back.getByLabel('Amount to back (TRNC)').fill('1001');
  await back.getByRole('button', { name: '1. Approve TRNC' }).click();
  await expect(back.getByRole('alert')).toContainText('within your balance');
  await back.getByLabel('Amount to back (TRNC)').fill('25.5');
  await expect(
    back.getByRole('button', { name: '2. Review deposit' }),
  ).toBeDisabled();
  await back.getByRole('button', { name: '1. Approve TRNC' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Cancel' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    back.getByRole('button', { name: '1. Approve TRNC' }),
  ).toBeFocused();
  await page.evaluate(() => {
    window.ethereum.reject = true;
  });
  await back.getByRole('button', { name: '1. Approve TRNC' }).click();
  await page.getByRole('button', { name: 'Confirm in wallet' }).click();
  await expect(page.getByText(/Request declined in your wallet/)).toBeVisible();
  assert.equal(mock.state.writes.length, 0);
  pass(
    'Precision and balance validation, explicit approval gating, review dismissal/focus return, and wallet rejection',
  );
  await back.getByRole('button', { name: '1. Approve TRNC' }).click();
  await confirm(page, 'Approve TRNC spending');
  assert.equal(mock.state.writes.at(-1).name, 'approve');
  assert.equal(mock.state.writes.at(-1).to.toLowerCase(), mock.token.address);
  assert.deepEqual(
    mock.state.writes.at(-1).args.map((value) => String(value).toLowerCase()),
    [mock.fund.address, '25500000000000000000'],
  );
  await expect(
    back.getByRole('button', { name: '2. Review deposit' }),
  ).toBeEnabled();
  await back.getByRole('button', { name: '2. Review deposit' }).click();
  await confirm(page, 'Back this raise');
  assert.equal(mock.state.writes.at(-1).name, 'deposit');
  assert.equal(mock.state.writes.at(-1).args[0], 2n);
  assert.equal(mock.state.allowance, 0n);
  await expect(back.getByText('1,025.5 TRNC', { exact: true })).toHaveCount(2);
  pass(
    'Exact ERC-20 approval followed by deposit; correct ABI/address/arguments and receipt-driven balance/history refresh',
  );
  const voting = await openCard(page, 1);
  await expect(
    voting.getByRole('button', { name: 'Release tranche 1' }),
  ).toBeDisabled();
  await voting.getByRole('button', { name: 'Approve next tranche' }).click();
  await confirm(page, 'Approve next tranche');
  await expect(
    voting.getByRole('button', { name: 'Tranche approved' }),
  ).toBeDisabled();
  await expect(
    voting.getByRole('button', { name: 'Release tranche 1' }),
  ).toBeDisabled();
  mock.state.now += 1n;
  await page.getByRole('button', { name: 'Refresh state' }).click();
  await expect(
    voting.getByRole('button', { name: 'Release tranche 1' }),
  ).toBeEnabled();
  mock.state.failSimulation = true;
  const before = mock.state.writes.length;
  await voting.getByRole('button', { name: 'Release tranche 1' }).click();
  await page.getByRole('button', { name: 'Confirm in wallet' }).click();
  await expect(
    page.getByText(/three-day grace period is still active/),
  ).toBeVisible();
  assert.equal(mock.state.writes.length, before);
  mock.state.failSimulation = false;
  await voting.getByRole('button', { name: 'Release tranche 1' }).click();
  await confirm(page, 'Release next tranche');
  await expect(
    voting.getByRole('button', { name: 'Release tranche 2' }),
  ).toBeDisabled();
  assert.equal(mock.state.raises[1].released, 1);
  pass(
    '50% and grace-period release guards; once-per-tranche vote; simulation revert blocks signature; release resets vote/grace',
  );
  back = await openCard(page, 2);
  await back.getByRole('button', { name: 'Review rage-quit' }).click();
  await expect(page.getByRole('dialog')).toContainText('125.5 TRNC');
  await confirm(page, 'Rage-quit this raise');
  await expect(
    back.getByRole('button', { name: 'Review rage-quit' }),
  ).toBeDisabled();
  assert.equal(mock.state.raises[2].shares, 0n);
  await page.getByRole('button', { name: 'Withdraw released funds' }).click();
  await confirm(page, 'Withdraw creator funds');
  await expect(
    page.getByRole('button', { name: 'Withdraw released funds' }),
  ).toBeDisabled();
  pass(
    'Rage-quit amount/consequence review and creator pull withdrawal, with state refresh',
  );
  const open = page.locator('#open-raise');
  await open.getByLabel('Milestone 1', { exact: false }).fill('31');
  await open.getByRole('button', { name: 'Review new raise' }).click();
  await expect(open.getByRole('alert')).toContainText('total 100%');
  await open.getByLabel('Milestone 1', { exact: false }).fill('30');
  await open.getByLabel('Funding window', { exact: false }).fill('91');
  await open.getByRole('button', { name: 'Review new raise' }).click();
  await expect(open.getByRole('alert')).toContainText('1 to 90');
  await expect(
    open.getByLabel('Funding window', { exact: false }),
  ).toBeFocused();
  await open.getByLabel('Funding window', { exact: false }).fill('14');
  await open.getByRole('button', { name: 'Review new raise' }).click();
  await confirm(page, 'Open a raise');
  await expect(card(page, 4)).toBeVisible();
  assert.deepEqual(mock.state.writes.at(-1).args, [3000, 3000, 4000, 1209600n]);
  for (const write of mock.state.writes)
    assert(
      mock.state.simulations.some(
        (sim) => sim.to === write.to && sim.data === write.data,
      ),
    );
  pass(
    'Open-raise validation and 30/30/40, 14-day calldata; all seven primary actions simulated before signing',
  );
  await page.evaluate(() => {
    window.ethereum.accounts = ['0x3333333333333333333333333333333333333333'];
    window.ethereum.emit('accountsChanged', window.ethereum.accounts);
  });
  await expect(page.locator('.wallet-panel .address')).toContainText(
    '0x3333333333333333333333333333333333333333',
  );
  await live(page);
  await page.evaluate(() => {
    window.ethereum.chain = '0x1';
    window.ethereum.emit('chainChanged', '0x1');
  });
  await expect(
    page.getByRole('button', { name: 'Review new raise' }),
  ).toBeDisabled();
  pass(
    'Wallet account and chain-change events refresh reads and disable writes',
  );
  await page.close();

  const visual = await newPage();
  await live(visual.page);
  await visual.page
    .getByRole('button', { name: 'Connect browser wallet' })
    .click();
  await expect(
    visual.page.getByRole('button', { name: 'Review new raise' }),
  ).toBeEnabled();
  await openCard(visual.page, 2);
  for (const width of [1440, 880, 390, 320]) {
    await visual.page.setViewportSize({ width, height: 1000 });
    const overflow = await visual.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    const audit = await new AxeBuilder({ page: visual.page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.deepEqual(
      audit.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
      `Accessibility at ${width}px`,
    );
    if (width === 1440 || width === 390 || width === 320) {
      await visual.page.bringToFront();
      await visual.page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      const path = `${width === 1440 ? 'desktop' : `mobile-${width}`}-connected.png`;
      await visual.page.screenshot({
        path: resolve(evidence, path),
        fullPage: true,
      });
      report.screenshots.push(path);
      if (width === 320) {
        await card(visual.page, 2).screenshot({ path: resolve(evidence, 'mobile-320-controls.png') });
        report.screenshots.push('mobile-320-controls.png');
      }
    }
  }
  pass(
    'Chromium renders at 1440, 880, 390 and 320px; no horizontal overflow; axe WCAG A/AA checks pass',
  );
  await visual.page.setViewportSize({ width: 1440, height: 1000 });
  await visual.page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  assert.equal(
    await visual.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await visual.page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await visual.page.emulateMedia({ reducedMotion: 'reduce' });
  await visual.page.bringToFront();
  assert.equal(
    await visual.page
      .getByRole('button', { name: 'Review new raise' })
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s',
  );
  await visual.page.keyboard.press('Control+Home');
  await visual.page.evaluate(() => document.activeElement?.blur());
  await visual.page.keyboard.press('Tab');
  await visual.page.getByRole('link', { name: 'Skip to content' }).focus();
  await visual.page.evaluate(() => window.scrollTo(0, 0));
  await expect(visual.page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  assert.equal(await visual.page.locator('.skip-link').evaluate(el => el.matches(':focus-visible') && el.getBoundingClientRect().top >= 0), true);
  await visual.page.screenshot({
    path: resolve(evidence, 'keyboard-focus.png'),
  });
  report.screenshots.push('keyboard-focus.png');
  await visual.page.keyboard.press('Enter');
  await visual.page.getByRole('button', { name: 'Review new raise' }).focus();
  await visual.page.keyboard.press('Enter');
  await expect(visual.page.getByRole('dialog')).toBeVisible();
  await visual.page.screenshot({ path: resolve(evidence, 'review-dialog.png') });
  report.screenshots.push('review-dialog.png');
  await visual.page.keyboard.press('Tab');
  await expect(
    visual.page.getByRole('button', { name: 'Confirm in wallet' }),
  ).toBeFocused();
  await visual.page.keyboard.press('Tab');
  await expect(
    visual.page.getByRole('dialog').getByRole('button', { name: 'Cancel' }),
  ).toBeFocused();
  await visual.page.keyboard.press('Shift+Tab');
  await expect(visual.page.getByRole('button', { name: 'Confirm in wallet' })).toBeFocused();
  await visual.page.keyboard.press('Escape');
  await expect(
    visual.page.getByRole('button', { name: 'Review new raise' }),
  ).toBeFocused();
  report.contrast = await visual.page.evaluate(() => {
    const lum = (rgb) => {
      const c = rgb
        .match(/\d+(\.\d+)?/g)
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    return [
      '.hero-copy',
      '.hero-copy > p:not(.eyebrow)',
      '.primary',
      '.raise-card dt',
      '.badge.funding',
      '.badge.voting',
      '.steps-art > div:nth-child(1) > span',
      '.steps-art > div:nth-child(2) > span',
    ].map((selector) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      let parent = element;
      let bg;
      while (parent) {
        bg = getComputedStyle(parent).backgroundColor;
        if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
        parent = parent.parentElement;
      }
      const a = lum(style.color);
      const b = lum(bg);
      return {
        selector,
        foreground: style.color,
        background: bg,
        ratio: Number(
          ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
        ),
      };
    });
  });
  assert(report.contrast.every((pair) => pair.ratio >= 4.5));
  pass(
    '200% text-size reflow, reduced motion, keyboard dialog focus trap/return and computed contrast pairs',
  );
  await visual.page.close();

  const absent = await newPage({
    noWallet: true,
    modify: (mock) => {
      mock.state.raises = [];
      mock.state.logs = [];
    },
  });
  await live(absent.page);
  await expect(
    absent.page.getByText('The first milestone starts here.'),
  ).toBeVisible();
  await absent.page
    .getByRole('button', { name: 'Connect browser wallet' })
    .click();
  await expect(absent.page.getByRole('alert')).toContainText(
    'No browser wallet found',
  );
  await absent.page.close();
  pass('Empty funding board and missing-wallet recovery copy');
  for (const [name, modify, expected] of [
    [
      'RPC chain mismatch',
      (m) => {
        m.state.wrongRpc = true;
      },
      /public RPC is on the wrong network/,
    ],
    [
      'Missing deployed code',
      (m) => {
        m.state.missingCode = true;
      },
      /contract code is missing/,
    ],
    [
      'Token binding mismatch',
      (m) => {
        m.state.wrongToken = true;
      },
      /does not match the attested token/,
    ],
  ]) {
    const scenario = await newPage({ modify });
    await expect(scenario.page.getByRole('alert')).toContainText(expected, {
      timeout: 20000,
    });
    await expect(
      scenario.page.getByRole('button', { name: 'Review new raise' }),
    ).toBeDisabled();
    await scenario.page.close();
    pass(`${name} fails closed`);
  }
  const corrupt = await browser.newPage();
  await corrupt.route('**/abi/MilestoneFund.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await corrupt.goto(url);
  await expect(corrupt.getByRole('alert')).toContainText(
    'ABI verification failed',
  );
  await corrupt.close();
  pass('Tampered ABI rejected before application/wallet initialization');
  const modifiedConfig = await browser.newPage();
  await modifiedConfig.route('**/imd-deployment.json', (route) => {
    const config = JSON.parse(
      readFileSync(resolve(root, 'dist/imd-deployment.json')),
    );
    config.chainId = 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(config),
    });
  });
  await modifiedConfig.goto(url);
  await expect(modifiedConfig.getByRole('alert')).toContainText(
    'does not match this build',
  );
  await modifiedConfig.close();
  pass('Tampered deployment manifest rejected by build metadata digest');
  const pages = await newPage({
    modify: (m) => {
      m.state.raises.push(
        ...Array.from({ length: 4 }, () => ({ ...m.state.raises[2] })),
      );
    },
  });
  await live(pages.page);
  await expect(card(pages.page, 7)).toBeVisible();
  await expect(pages.page.getByRole('article')).toHaveCount(6);
  await pages.page.getByRole('button', { name: 'Older raises' }).click();
  await expect(pages.page.getByRole('article')).toHaveCount(2);
  await expect(card(pages.page, 0)).toBeVisible();
  await pages.page.close();
  pass('Raise pagination loads all IDs through contract views');
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.failedLocalRequests, []);
  assert.deepEqual(report.consoleErrors, []);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.failure = error.stack;
  throw error;
} finally {
  writeFileSync(
    resolve(evidence, 'browser-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  await browser.close();
  await new Promise((done) => server.close(done));
}
