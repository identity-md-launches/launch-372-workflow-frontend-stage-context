import { BaseError, type AbiEvent, type Address, type Log } from 'viem';
import type { Runtime } from './config';

export type Raise = {
  creator: Address;
  deadline: bigint;
  voteOpenedAt: bigint;
  released: number;
  bps1: number;
  bps2: number;
  bps3: number;
  totalShares: bigint;
  unreleased: bigint;
  approvalWeight: bigint;
};
export type RaiseView = Raise & {
  id: bigint;
  shares: bigint;
  approved: boolean;
  nextAmount: bigint;
};
export type Snapshot = {
  block: bigint;
  timestamp: bigint;
  fetchedAt: number;
  count: bigint;
  raises: RaiseView[];
  balance: bigint;
  allowance: bigint;
  withdrawable: bigint;
  decimals: number;
  symbol: string;
  account?: Address;
};
export type History = Map<string, { deposited: bigint; released: bigint }>;
export const PAGE_SIZE = 6n;

export async function verifyChain(runtime: Runtime) {
  const { client, contracts, fund, token, deployment } = runtime;
  if ((await client.getChainId()) !== deployment.chainId)
    throw Error(
      'The public RPC is on the wrong network. Transactions are disabled. Retry with a working RPC.',
    );
  const code = await Promise.all(
    contracts.map((contract) => client.getCode({ address: contract.address })),
  );
  if (code.some((value) => !value || value === '0x'))
    throw Error(
      'Deployed contract code is missing. Transactions are disabled.',
    );
  const boundToken = (await client.readContract({
    address: fund.address,
    abi: fund.abi,
    functionName: 'token',
  })) as Address;
  if (boundToken.toLowerCase() !== token.address.toLowerCase())
    throw Error(
      'MilestoneFund.token() does not match the attested token. Transactions are disabled.',
    );
  return boundToken;
}

export async function readSnapshot(
  runtime: Runtime,
  page: number,
  account?: Address,
): Promise<Snapshot> {
  const { client, fund, token } = runtime;
  // Resolve the working currency from the application contract, not from a token guess.
  const tokenAddress = await verifyChain(runtime);
  const block = await client.getBlock();
  const readFund = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address: fund.address,
      abi: fund.abi,
      functionName,
      args,
      blockNumber: block.number,
    }) as Promise<T>;
  const readToken = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address: tokenAddress,
      abi: token.abi,
      functionName,
      args,
      blockNumber: block.number,
    }) as Promise<T>;
  const [count, decimals, symbol, balance, allowance, withdrawable] =
    await Promise.all([
      readFund<bigint>('raiseCount'),
      readToken<number>('decimals'),
      readToken<string>('symbol'),
      account ? readToken<bigint>('balanceOf', [account]) : 0n,
      account ? readToken<bigint>('allowance', [account, fund.address]) : 0n,
      account ? readFund<bigint>('creatorBalance', [account]) : 0n,
    ]);
  if (decimals < 4 || decimals > 36)
    throw Error('Unexpected token precision. Transactions are disabled.');
  const end = count - BigInt(page) * PAGE_SIZE;
  const ids: bigint[] = [];
  for (let id = end - 1n; id >= 0n && ids.length < Number(PAGE_SIZE); id--)
    ids.push(id);
  const raises = await Promise.all(
    ids.map(async (id) => {
      const [raise, shares, approved, nextAmount] = await Promise.all([
        readFund<Raise>('raise', [id]),
        account ? readFund<bigint>('sharesOf', [id, account]) : 0n,
        account ? readFund<boolean>('hasApproved', [id, account]) : false,
        readFund<bigint>('nextTrancheAmount', [id]),
      ]);
      return { ...raise, id, shares, approved, nextAmount };
    }),
  );
  return {
    block: block.number,
    timestamp: block.timestamp,
    fetchedAt: Date.now(),
    count,
    raises,
    decimals,
    symbol,
    balance,
    allowance,
    withdrawable,
    account,
  };
}

export class EventHistory {
  private to: bigint | undefined;
  private logs: Log[] = [];
  private generation = 0;
  async read(
    runtime: Runtime,
    to: bigint,
    progress: (message: string) => void,
  ): Promise<History> {
    const generation = ++this.generation;
    const start = BigInt(runtime.deployment.deploymentBlock);
    const rewind =
      this.to === undefined || this.to > to
        ? start
        : this.to > start + 12n
          ? this.to - 12n
          : start;
    const events = runtime.fund.abi.filter(
      (item) =>
        item.type === 'event' && ['Deposited', 'Released'].includes(item.name),
    ) as AbiEvent[];
    const collected: Log[] = this.logs.filter(
      (log) => log.blockNumber !== null && log.blockNumber < rewind,
    );
    async function chunk(fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
      try {
        return await runtime.client.getLogs({
          address: runtime.fund.address,
          events,
          fromBlock,
          toBlock,
          strict: true,
        });
      } catch (error) {
        if (toBlock - fromBlock < 32n) throw error;
        const middle = (fromBlock + toBlock) / 2n;
        return [
          ...(await chunk(fromBlock, middle)),
          ...(await chunk(middle + 1n, toBlock)),
        ];
      }
    }
    const pinned = await runtime.client.getBlock({ blockNumber: to });
    for (let from = rewind; from <= to; from += 2000n) {
      const end = from + 1999n < to ? from + 1999n : to;
      progress(
        `Reading event history · blocks ${from.toString()}–${end.toString()}`,
      );
      collected.push(...(await chunk(from, end)));
    }
    if (
      (await runtime.client.getBlock({ blockNumber: to })).hash !== pinned.hash
    )
      throw Error(
        'Chain history changed during the read. Refresh to try again.',
      );
    if (generation === this.generation) {
      this.logs = collected;
      this.to = to;
    }
    const totals: History = new Map();
    for (const raw of collected) {
      const log = raw as unknown as {
        eventName: string;
        args: { raiseId: bigint; amount: bigint };
      };
      const id = log.args.raiseId.toString();
      const total = totals.get(id) ?? { deposited: 0n, released: 0n };
      if (log.eventName === 'Deposited') total.deposited += log.args.amount;
      else if (log.eventName === 'Released') total.released += log.args.amount;
      totals.set(id, total);
    }
    return totals;
  }
}

export function explain(error: unknown): string {
  const message =
    error instanceof BaseError
      ? error.shortMessage
      : error instanceof Error
        ? error.message
        : 'The request could not be completed.';
  const details = error instanceof Error ? error.message : message;
  if (/reject|denied|4001/i.test(details))
    return 'Request declined in your wallet. No new transaction was submitted. You can try again.';
  if (/AlreadyApproved/.test(details))
    return 'You already approved this tranche. Refresh to see the latest vote.';
  if (/GracePeriodActive/.test(details))
    return 'The three-day grace period is still active. Refresh and wait until the release time.';
  if (/InsufficientApproval/.test(details))
    return 'More than 50% of current shares must approve before release. Refresh to see the latest vote.';
  if (/FundingClosed/.test(details))
    return 'The funding window has closed. Refresh to see voting and rage-quit options.';
  if (/CreatorCannotBack/.test(details))
    return 'A creator cannot back their own raise from the same wallet.';
  if (/ERC20InsufficientAllowance/.test(details))
    return 'Your token allowance is too low. Refresh and approve the deposit amount first.';
  if (/ERC20InsufficientBalance/.test(details))
    return 'Your token balance is too low. Reduce the amount or obtain more TRNC.';
  if (/NoShares/.test(details))
    return 'You have no remaining shares in this raise. Refresh the state.';
  if (/AllReleased/.test(details))
    return 'All three milestones have already been released. Refresh the state.';
  if (/NothingToWithdraw/.test(details))
    return 'There are no creator funds to withdraw. Refresh after a tranche is released.';
  return `${message} Refresh the state and try again if needed.`;
}
