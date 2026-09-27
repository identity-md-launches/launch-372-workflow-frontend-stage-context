import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  toHex,
} from 'viem';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export const USER = '0x1111111111111111111111111111111111111111';
export const CREATOR = '0x2222222222222222222222222222222222222222';
const UNIT = 10n ** 18n;
const HASH = `0x${'ab'.repeat(32)}`;
const ZEROHASH = `0x${'00'.repeat(32)}`;
export function makeChain(root) {
  const deployment = JSON.parse(
    readFileSync(resolve(root, 'dist/imd-deployment.json')),
  );
  const fund = deployment.contracts.find((c) => c.name === 'MilestoneFund');
  const token = deployment.contracts.find((c) => c.name === 'LaunchToken');
  const abis = Object.fromEntries(
    deployment.contracts.map((c) => [
      c.address,
      JSON.parse(readFileSync(resolve(root, 'dist', c.abiPath))),
    ]),
  );
  const now = 1790496000n;
  const block = BigInt(deployment.deploymentBlock) + 4500n;
  const state = {
    now,
    block,
    balance: 1000n * UNIT,
    allowance: 0n,
    withdrawable: 12n * UNIT,
    calls: [],
    writes: [],
    simulations: [],
    ranges: [],
    logs: [],
    receipts: new Map(),
    failSimulation: false,
    failReads: false,
    failHistory: false,
    missingCode: false,
    wrongRpc: false,
    wrongToken: false,
  };
  state.raises = Array.from({ length: 4 }, (_, id) => ({
    creator: id === 3 ? USER : CREATOR,
    deadline:
      id >= 2 ? now + 7n * 86400n : now - 3n * 86400n + (id === 1 ? 1n : 0n),
    voteOpenedAt:
      id >= 2 ? now + 7n * 86400n : now - 3n * 86400n + (id === 1 ? 1n : 0n),
    released: 0,
    bps1: 3000,
    bps2: 3000,
    bps3: 4000,
    totalShares: 1000n * UNIT,
    unreleased: 1000n * UNIT,
    approvalWeight: id === 1 ? 500n * UNIT : id === 0 ? 600n * UNIT : 0n,
    shares: id === 3 ? 0n : 100n * UNIT,
    approved: false,
  }));
  function log(eventName, args, at = state.block) {
    const event = abis[fund.address].find(
      (item) => item.type === 'event' && item.name === eventName,
    );
    state.logs.push({
      address: fund.address,
      topics: encodeEventTopics({ abi: [event], eventName, args }),
      data: encodeAbiParameters(
        event.inputs.filter((item) => !item.indexed),
        event.inputs
          .filter((item) => !item.indexed)
          .map((item) => args[item.name]),
      ),
      blockNumber: toHex(at),
      blockHash: HASH,
      transactionHash: HASH,
      transactionIndex: '0x0',
      logIndex: toHex(state.logs.length),
      removed: false,
    });
  }
  state.raises.forEach((_, id) =>
    log(
      'Deposited',
      { raiseId: BigInt(id), backer: USER, amount: 1000n * UNIT },
      BigInt(deployment.deploymentBlock) + BigInt(id) * 1100n,
    ),
  );
  function result(call, write = false) {
    const abi = abis[call.to?.toLowerCase()];
    if (!abi) throw Error(`Unknown contract ${call.to}`);
    const { functionName: name, args = [] } = decodeFunctionData({
      abi,
      data: call.data ?? call.input,
    });
    const r = state.raises[Number(args[0])];
    const arg =
      name === 'raise' && r
        ? Object.fromEntries(
            Object.entries(r).filter(
              ([key]) => !['shares', 'approved'].includes(key),
            ),
          )
        : undefined;
    let value;
    if (name === 'token') value = state.wrongToken ? CREATOR : token.address;
    else if (name === 'decimals') value = 18;
    else if (name === 'symbol') value = 'TRNC';
    else if (name === 'raiseCount') value = BigInt(state.raises.length);
    else if (name === 'balanceOf') value = state.balance;
    else if (name === 'allowance') value = state.allowance;
    else if (name === 'creatorBalance') value = state.withdrawable;
    else if (name === 'raise') value = arg;
    else if (name === 'sharesOf') value = r.shares;
    else if (name === 'hasApproved') value = r.approved;
    else if (name === 'nextTrancheAmount')
      value =
        r.released === 0
          ? (r.unreleased * 3n) / 10n
          : r.released === 1
            ? (r.unreleased * 3n) / 7n
            : r.released === 2
              ? r.unreleased
              : 0n;
    else {
      if (!write) {
        state.simulations.push({ name, args, to: call.to, data: call.data });
        if (state.failSimulation)
          throw Error('Execution reverted: GracePeriodActive');
      }
      if (name === 'open') value = BigInt(state.raises.length);
      if (name === 'approve') value = true;
      if (write) {
        state.writes.push({ name, args, to: call.to, data: call.data });
        if (name === 'approve') state.allowance = args[1];
        if (name === 'deposit') {
          r.shares += args[1];
          r.totalShares += args[1];
          r.unreleased += args[1];
          state.balance -= args[1];
          state.allowance -= args[1];
          log('Deposited', { raiseId: args[0], backer: USER, amount: args[1] });
        }
        if (name === 'approveTranche') {
          r.approved = true;
          r.approvalWeight += r.shares;
        }
        if (name === 'release') {
          const amount =
            r.released === 0
              ? (r.unreleased * 3n) / 10n
              : r.released === 1
                ? (r.unreleased * 3n) / 7n
                : r.unreleased;
          r.unreleased -= amount;
          r.released++;
          r.approvalWeight = 0n;
          r.approved = false;
          r.voteOpenedAt = state.now;
          log('Released', {
            raiseId: args[0],
            tranche: r.released,
            amount,
            nextVoteOpenedAt: state.now,
          });
        }
        if (name === 'rageQuit') {
          const payout =
            state.now < r.deadline
              ? r.shares
              : (r.shares * r.unreleased) / r.totalShares;
          state.balance += payout;
          r.unreleased -= payout;
          r.totalShares -= r.shares;
          if (r.approved) r.approvalWeight -= r.shares;
          r.shares = 0n;
          r.approved = false;
        }
        if (name === 'withdraw') {
          state.balance += state.withdrawable;
          state.withdrawable = 0n;
        }
        if (name === 'open')
          state.raises.push({
            creator: USER,
            deadline: state.now + args[3],
            voteOpenedAt: state.now + args[3],
            released: 0,
            bps1: args[0],
            bps2: args[1],
            bps3: args[2],
            totalShares: 0n,
            unreleased: 0n,
            approvalWeight: 0n,
            shares: 0n,
            approved: false,
          });
      }
    }
    return encodeFunctionResult({ abi, functionName: name, result: value });
  }
  async function rpc({ method, params = [] }) {
    state.calls.push(method);
    if (state.failReads) throw Error('Mock RPC unavailable');
    if (method === 'eth_chainId')
      return toHex(state.wrongRpc ? 1 : deployment.chainId);
    if (method === 'eth_getCode')
      return state.missingCode ? '0x' : '0x60006000';
    if (method === 'eth_blockNumber') return toHex(state.block);
    if (method === 'eth_getBlockByNumber')
      return {
        number: toHex(state.block),
        hash: HASH,
        parentHash: ZEROHASH,
        timestamp: toHex(state.now),
        gasLimit: '0x1c9c380',
        gasUsed: '0x0',
        baseFeePerGas: '0x1',
        difficulty: '0x0',
        extraData: '0x',
        logsBloom: `0x${'00'.repeat(256)}`,
        miner: CREATOR,
        mixHash: ZEROHASH,
        nonce: '0x0000000000000000',
        receiptsRoot: ZEROHASH,
        sha3Uncles: ZEROHASH,
        stateRoot: ZEROHASH,
        transactionsRoot: ZEROHASH,
        size: '0x1',
        totalDifficulty: '0x0',
        transactions: [],
        uncles: [],
      };
    if (method === 'eth_call') return result(params[0]);
    if (method === 'eth_getLogs') {
      if (state.failHistory) throw Error('Mock history unavailable');
      const { fromBlock, toBlock } = params[0];
      state.ranges.push({ from: BigInt(fromBlock), to: BigInt(toBlock) });
      return state.logs.filter(
        (log) =>
          BigInt(log.blockNumber) >= BigInt(fromBlock) &&
          BigInt(log.blockNumber) <= BigInt(toBlock),
      );
    }
    if (method === 'eth_sendTransaction') {
      result(params[0], true);
      const hash = `0x${state.writes.length.toString(16).padStart(64, '0')}`;
      state.receipts.set(hash, {
        transactionHash: hash,
        blockHash: HASH,
        blockNumber: toHex(state.block),
        contractAddress: null,
        cumulativeGasUsed: '0x5208',
        effectiveGasPrice: '0x1',
        from: USER,
        gasUsed: '0x5208',
        logs: [],
        logsBloom: `0x${'00'.repeat(256)}`,
        status: '0x1',
        to: params[0].to,
        transactionIndex: '0x0',
        type: '0x2',
      });
      return hash;
    }
    if (method === 'eth_getTransactionReceipt')
      return state.receipts.get(params[0]) ?? null;
    if (method === 'eth_getBalance') return toHex(UNIT);
    if (method === 'eth_estimateGas') return '0x5208';
    throw Error(`Unhandled mock RPC ${method}`);
  }
  return { state, rpc, deployment, fund, token };
}

export async function installMock(page, mock, options = {}) {
  await page.route('https://**', async (route) => {
    if (
      !mock.deployment.network.rpcUrls.some((url) =>
        route.request().url().startsWith(url),
      )
    )
      return route.abort();
    try {
      const request = route.request().postDataJSON();
      const one = async (item) => {
        try {
          return { jsonrpc: '2.0', id: item.id, result: await mock.rpc(item) };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id: item.id,
            error: { code: -32000, message: error.message },
          };
        }
      };
      const response = Array.isArray(request)
        ? await Promise.all(request.map(one))
        : await one(request);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    } catch {
      return route.abort();
    }
  });
  if (options.noWallet) return;
  await page.exposeFunction('mockWalletRpc', (request) => mock.rpc(request));
  await page.addInitScript(
    ({ account, chainId, wrongChain }) => {
      const listeners = {};
      const wallet = {
        isMetaMask: true,
        chain: wrongChain ? '0x1' : chainId,
        known: !wrongChain,
        accounts: [],
        reject: false,
        calls: [],
        on(event, callback) {
          (listeners[event] ??= []).push(callback);
        },
        removeListener(event, callback) {
          listeners[event] = (listeners[event] ?? []).filter(
            (fn) => fn !== callback,
          );
        },
        emit(event, value) {
          (listeners[event] ?? []).forEach((fn) => fn(value));
        },
        async request({ method, params }) {
          this.calls.push({ method, params });
          if (method === 'eth_requestAccounts') {
            this.accounts = [account];
            return this.accounts;
          }
          if (method === 'eth_accounts') return this.accounts;
          if (method === 'eth_chainId') return this.chain;
          if (method === 'wallet_switchEthereumChain') {
            if (!this.known)
              throw Object.assign(new Error('Unknown chain'), { code: 4902 });
            this.chain = params[0].chainId;
            this.emit('chainChanged', this.chain);
            return null;
          }
          if (method === 'wallet_addEthereumChain') {
            this.known = true;
            return null;
          }
          if (method === 'wallet_requestPermissions') return [];
          if (method === 'wallet_revokePermissions') {
            this.accounts = [];
            return null;
          }
          if (method === 'eth_sendTransaction' && this.reject) {
            this.reject = false;
            throw Object.assign(new Error('User rejected the request'), {
              code: 4001,
            });
          }
          return window.mockWalletRpc({ method, params });
        },
      };
      window.ethereum = wallet;
    },
    {
      account: USER,
      chainId: toHex(mock.deployment.chainId),
      wrongChain: options.wrongChain ?? false,
    },
  );
}
