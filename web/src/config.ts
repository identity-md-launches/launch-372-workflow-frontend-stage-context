import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  isAddress,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
} from 'viem';
import { canonical } from './canonical.mjs';
import binding from './binding.json';

export type Deployment = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  deploymentBlock: number;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<string, Address>;
  };
  walletAddChain: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};

export async function loadDeployment() {
  async function json(path: string) {
    const response = await fetch(new URL(path, document.baseURI), {
      cache: 'no-cache',
    });
    if (!response.ok)
      throw Error(`Cannot load ${path}. Reload or check the static export.`);
    return response.json();
  }
  const deployment = (await json('imd-deployment.json')) as Deployment;
  const { assets: _assets, ...metadata } = deployment;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical(metadata)),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== binding.metadataSha256)
    throw Error(
      'Deployment configuration does not match this build. Reload the complete export.',
    );
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId
  )
    throw Error('Invalid deployment network.');
  const contracts = await Promise.all(
    deployment.contracts.map(async (contract) => {
      if (
        !isAddress(contract.address) ||
        !/^[\w/-]+\.json$/.test(contract.abiPath) ||
        contract.abiPath.includes('..') ||
        contract.abiPath.startsWith('/')
      )
        throw Error('Invalid deployment contract.');
      const abi = (await json(contract.abiPath)) as Abi;
      if (
        !Array.isArray(abi) ||
        keccak256(stringToHex(canonical(abi))).slice(2) !== contract.abiHash
      )
        throw Error(
          `${contract.name} ABI verification failed. Reload the complete export.`,
        );
      return { ...contract, abi };
    }),
  );
  const fund = contracts.find((c) => c.name === 'MilestoneFund');
  const token = contracts.find((c) => c.name === 'LaunchToken');
  if (!fund || !token) throw Error('Missing required application contracts.');
  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.network.name,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
    blockExplorers: {
      default: { name: 'Explorer', url: deployment.network.explorer },
    },
    testnet: deployment.network.testnet,
  });
  const transport = fallback(
    deployment.network.rpcUrls.map((url) =>
      http(url, { timeout: 8000, retryCount: 1 }),
    ),
    { rank: false },
  );
  const client = createPublicClient({ chain, transport });
  return { deployment, chain, transport, client, contracts, fund, token };
}
export type Runtime = Awaited<ReturnType<typeof loadDeployment>>;
