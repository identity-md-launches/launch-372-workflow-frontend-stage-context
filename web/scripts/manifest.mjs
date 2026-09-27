import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { metadata, inventory, root, canonical, read } from './shared.mjs';
const dist = resolve(root, 'dist');
const expected = { ...metadata(), assets: inventory(dist) };
if (process.argv.includes('--check')) {
  if (canonical(read('dist/imd-deployment.json')) !== canonical(expected))
    throw Error('Manifest differs from handoff or exported bytes');
} else {
  writeFileSync(
    resolve(dist, 'imd-deployment.json'),
    JSON.stringify(expected, null, 2) + '\n',
  );
}
const bytes = expected.assets.reduce(
  (sum, asset) => sum + readFileSync(resolve(dist, asset.path)).length,
  0,
);
if (bytes > 8 * 1024 * 1024) throw Error('Export exceeds submission budget');
console.log(
  `Manifest verified: ${expected.assets.length} assets, ${bytes} bytes; configuration bound to ${expected.sourceCommit}`,
);
