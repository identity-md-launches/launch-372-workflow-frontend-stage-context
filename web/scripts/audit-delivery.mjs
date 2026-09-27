import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, read, inventory } from './shared.mjs';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const config = read('dist/imd-deployment.json');
const lines = text => text ? text.split('\n') : [];
const changed = [...new Set([...lines(git(['diff', '--name-only', config.sourceCommit, '--'])), ...lines(git(['ls-files', '--others', '--exclude-standard']))])].sort();
if (changed.some(path => !/^(web|dist|docs)\//.test(path))) throw Error('Out-of-scope submission path');
if (changed.some(path => /(^|\/)(node_modules|npm-cache|\.cache|\.playwright-mcp)(\/|$)/.test(path))) throw Error('Generated dependency/cache in submission');
if (lines(git(['ls-files', '--stage'])).some(line => line.startsWith('160000'))) throw Error('Git submodule present');
const files = [...new Set([...lines(git(['ls-files'])), ...lines(git(['ls-files', '--others', '--exclude-standard']))])];
const workingTreeBytes = files.reduce((size, path) => size + statSync(resolve(root, path)).size, 0);
if (workingTreeBytes >= 8388608) throw Error('Uncompressed tracked deliverable exceeds 8 MiB');
const assets = inventory(resolve(root, 'dist'));
const exportBytes = assets.reduce((size, item) => size + statSync(resolve(root, 'dist', item.path)).size, statSync(resolve(root, 'dist/imd-deployment.json')).size);
const suppliedNetwork = read('web/config/network-handoff.json').network;
if (JSON.stringify(suppliedNetwork) !== JSON.stringify(config.network)) throw Error('Network object changed');
for (const contract of config.contracts) {
  const pinned = execFileSync('git', ['show', `${config.sourceCommit}:docs/abi/${contract.name}.json`], { cwd: root });
  if (!pinned.equals(readFileSync(resolve(root, 'dist', contract.abiPath)))) throw Error('ABI differs from pinned raw export');
}
const report = { checkedAt: new Date().toISOString(), result: 'PASS', sourceCommit: config.sourceCommit, changedPaths: changed, networkUnchanged: true, pinnedAbiBytesMatch: true, submodules: 0, assetCountExcludingManifest: assets.length, exportBytesIncludingManifest: exportBytes, workingTreeBytes, budgetBytes: 8388608, notes: 'Working tree total includes original committed source and all new nonignored files. Scratch, dependencies and caches excluded. Bundle size is also checked after committing.' };
writeFileSync(resolve(root, 'docs/evidence/delivery.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, assets: assets.length, exportBytes, workingTreeBytes, changedFiles: changed.length }));
