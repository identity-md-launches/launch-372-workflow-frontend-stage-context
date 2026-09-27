import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256, stringToHex } from 'viem';
import { metadata, root, canonical, sha } from './shared.mjs';
const config = metadata();
mkdirSync(resolve(root, 'web/public/abi'), { recursive: true });
for (const contract of config.contracts) {
  const bytes = execFileSync(
    'git',
    ['show', `${config.sourceCommit}:docs/abi/${contract.name}.json`],
    { cwd: root },
  );
  const abi = JSON.parse(bytes.toString());
  if (!Array.isArray(abi)) throw Error('ABI must be a raw array');
  const hash = keccak256(stringToHex(canonical(abi))).slice(2);
  if (hash !== contract.abiHash)
    throw Error(`ABI hash mismatch: ${contract.name}: ${hash}`);
  writeFileSync(resolve(root, 'web/public', contract.abiPath), bytes);
  console.log(`Verified ${contract.name} ABI: ${hash}`);
}
writeFileSync(
  resolve(root, 'web/src/binding.json'),
  JSON.stringify({ metadataSha256: sha(canonical(config)) }, null, 2) + '\n',
);
writeFileSync(
  resolve(root, 'web/public/imd-deployment.json'),
  JSON.stringify({ ...config, assets: [] }, null, 2) + '\n',
);
