// Read-only network evidence. curl uses the worker's network transport; no signing methods.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, decodeFunctionResult } from 'viem';
import { root, read } from './shared.mjs';
const execute = promisify(execFile);
const config = read('dist/imd-deployment.json');
const fund = config.contracts.find((c) => c.name === 'MilestoneFund');
const token = config.contracts.find((c) => c.name === 'LaunchToken');
const abi = read(`dist/${fund.abiPath}`);
const report = {
  observedAt: new Date().toISOString(),
  readOnly: true,
  endpoints: [],
};
for (const endpoint of config.network.rpcUrls) {
  async function rpc(method, params = []) {
    const { stdout } = await execute(
      'curl',
      [
        '--silent',
        '--show-error',
        '--fail-with-body',
        '--max-time',
        '20',
        '-H',
        'Content-Type: application/json',
        '--data',
        JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        endpoint,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const response = JSON.parse(stdout);
    if (response.error) throw Error(response.error.message);
    return response.result;
  }
  try {
    const chain = await rpc('eth_chainId');
    if (Number(chain) !== config.chainId) throw Error('RPC chain ID mismatch');
    const block = await rpc('eth_blockNumber');
    const contracts = await Promise.all(
      config.contracts.map(async (c) => ({
        name: c.name,
        address: c.address,
        codeBytes:
          ((await rpc('eth_getCode', [c.address, block])).length - 2) / 2,
      })),
    );
    if (contracts.some((c) => c.codeBytes === 0))
      throw Error('Missing deployed code');
    const tokenResult = await rpc('eth_call', [
      {
        to: fund.address,
        data: encodeFunctionData({ abi, functionName: 'token' }),
      },
      block,
    ]);
    const actualToken = decodeFunctionResult({
      abi,
      functionName: 'token',
      data: tokenResult,
    });
    if (actualToken.toLowerCase() !== token.address)
      throw Error('Token binding mismatch');
    const count = decodeFunctionResult({
      abi,
      functionName: 'raiseCount',
      data: await rpc('eth_call', [
        {
          to: fund.address,
          data: encodeFunctionData({ abi, functionName: 'raiseCount' }),
        },
        block,
      ]),
    });
    report.endpoints.push({
      endpoint,
      result: 'PASS',
      chainId: Number(chain),
      blockNumber: Number(block),
      contracts,
      tokenBinding: actualToken,
      raiseCount: count.toString(),
    });
  } catch (error) {
    report.endpoints.push({
      endpoint,
      result: 'UNAVAILABLE',
      error: error.message,
    });
  }
}
report.result = report.endpoints.some((e) => e.result === 'PASS')
  ? 'PASS'
  : 'UNAVAILABLE';
mkdirSync(resolve(root, 'docs/evidence'), { recursive: true });
writeFileSync(
  resolve(root, 'docs/evidence/live-rpc.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
