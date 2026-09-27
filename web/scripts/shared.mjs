import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonical } from '../src/canonical.mjs';
export const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const read = (path) =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8'));
export const sha = (data) => createHash('sha256').update(data).digest('hex');
export function metadata() {
  const d = read('web/config/deployment-handoff.json');
  const n = read('web/config/network-handoff.json');
  if (
    d.version !== 1 ||
    d.chainId !== n.network.chainId ||
    Number(n.walletAddChain.chainId) !== d.chainId
  )
    throw Error('Handoff chain mismatch');
  return {
    version: 1,
    launchId: d.launchId,
    chainId: d.chainId,
    sourceCommit: d.sourceCommit,
    attestationHash: d.attestationHash,
    contracts: d.contracts.map(({ name, address, abiHash }) => {
      if (!/^[A-Za-z0-9_]+$/.test(name) || !/^[0-9a-f]{64}$/.test(abiHash))
        throw Error('Invalid ABI binding');
      return { name, address, abiHash, abiPath: `abi/${name}.json` };
    }),
    network: n.network,
    walletAddChain: n.walletAddChain,
    deploymentBlock: Math.min(...d.contracts.map((c) => c.blockNumber)),
  };
}
export function inventory(dir) {
  const list = [];
  function walk(path) {
    for (const file of readdirSync(path).sort()) {
      const full = resolve(path, file);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw Error('Export contains a symlink');
      if (stat.isDirectory()) walk(full);
      else if (relative(dir, full) !== 'imd-deployment.json') {
        if (stat.size > 8 * 1024 * 1024) throw Error('Asset too large');
        list.push({
          path: relative(dir, full).split('\\').join('/'),
          sha256: sha(readFileSync(full)),
        });
      }
    }
  }
  walk(dir);
  if (list.length > 128 || !list.some((a) => a.path === 'index.html'))
    throw Error('Invalid asset count');
  return list;
}
export { canonical };
