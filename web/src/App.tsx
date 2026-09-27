import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi';
import {
  createWalletClient,
  custom,
  formatUnits,
  type EIP1193Provider,
  type Hash,
} from 'viem';
import type { Runtime } from './config';
import {
  EventHistory,
  explain,
  PAGE_SIZE,
  readSnapshot,
  verifyChain,
  type History,
  type RaiseView,
  type Snapshot,
} from './chain';
import {
  amountInput,
  displayAmount,
  GRACE,
  openingInput,
  phase,
  refund,
  releaseReady,
  shortAddress,
} from './domain.mjs';

type Intent = {
  title: string;
  description: string;
  method: string;
  args: readonly unknown[];
  token?: boolean;
};
type Tx = { message: string; hash?: Hash; error?: boolean };
const same = (a?: string, b?: string) => a?.toLowerCase() === b?.toLowerCase();
const date = (seconds: bigint) =>
  new Date(Number(seconds) * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

function Mark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M7 31V19h7v12M17 31V13h7v18M27 31V7h7v24"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path d="M5 35h31" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function Amount({ value, snapshot }: { value: bigint; snapshot: Snapshot }) {
  return (
    <span
      className="amount"
      title={`${formatUnits(value, snapshot.decimals)} ${snapshot.symbol}`}
    >
      {displayAmount(value, snapshot.decimals)}{' '}
      <span className="unit">{snapshot.symbol}</span>
    </span>
  );
}

export function App({ runtime }: { runtime: Runtime }) {
  const connection = useConnection();
  const { address, chainId, connector, isConnected } = connection;
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [history, setHistory] = useState<History>();
  const [historyMessage, setHistoryMessage] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [readError, setReadError] = useState('');
  const [walletError, setWalletError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [intent, setIntent] = useState<Intent>();
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [tx, setTx] = useState<Tx>({ message: '' });
  const [tick, setTick] = useState(Date.now());
  const eventHistory = useRef(new EventHistory());
  const readPending = useRef(false);
  const txLock = useRef(false);
  const session = useRef('');
  session.current = `${address ?? ''}:${chainId ?? ''}`;
  const dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const correctChain = chainId === runtime.chain.id;
  const fresh = !!snapshot && tick - snapshot.fetchedAt < 120_000;
  const ready =
    isConnected &&
    correctChain &&
    !!snapshot &&
    same(snapshot.account, address) &&
    !readError &&
    !loading &&
    fresh &&
    !busy;

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    const polling = setInterval(() => {
      if (!readPending.current && !txLock.current) refresh();
    }, 30_000);
    return () => {
      clearInterval(timer);
      clearInterval(polling);
    };
  }, [refresh]);
  useEffect(() => {
    let current = true;
    readPending.current = true;
    setLoading(true);
    setReadError('');
    setHistoryError('');
    setHistory(undefined);
    readSnapshot(runtime, page, address)
      .then(async (next) => {
        if (!current) return;
        setSnapshot(next);
        setLoading(false);
        try {
          const totals = await eventHistory.current.read(
            runtime,
            next.block,
            (message) => {
              if (current) setHistoryMessage(message);
            },
          );
          if (current) {
            setHistory(totals);
            setHistoryMessage('');
          }
        } catch (error) {
          if (current) {
            setHistoryError(`Historical totals unavailable. ${explain(error)}`);
            setHistoryMessage('');
          }
        }
      })
      .catch((error) => {
        if (current) {
          setReadError(explain(error));
          setLoading(false);
        }
      })
      .finally(() => {
        if (current) readPending.current = false;
      });
    return () => {
      current = false;
    };
  }, [runtime, page, revision, address, chainId]);
  useEffect(() => {
    setIntent(undefined);
    setWalletError('');
  }, [address, chainId]);
  useEffect(() => {
    if (intent && dialog.current && !dialog.current.open)
      dialog.current.showModal();
    if (!intent && dialog.current?.open) dialog.current.close();
  }, [intent]);

  async function connectWallet(index: number) {
    setWalletError('');
    try {
      const chosen = connectors[index];
      if (!chosen || !(await chosen.getProvider()))
        throw Error(
          'No browser wallet found. Install an Ethereum browser wallet, then reload this page.',
        );
      await connect.mutateAsync({ connector: chosen });
    } catch (error) {
      setWalletError(explain(error));
    }
  }
  async function switchNetwork() {
    if (!connector) return;
    setSwitching(true);
    setWalletError('');
    try {
      const provider = (await connector.getProvider()) as EIP1193Provider;
      const params: [{ chainId: string }] = [
        { chainId: runtime.deployment.walletAddChain.chainId },
      ];
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params,
        });
      } catch (error) {
        const e = error as {
          code?: number;
          message?: string;
          data?: { originalError?: { code?: number } };
        };
        if (
          e.code !== 4902 &&
          e.data?.originalError?.code !== 4902 &&
          !/unknown chain|unrecognized chain|chain.*not.*added/i.test(
            e.message ?? '',
          )
        )
          throw error;
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [runtime.deployment.walletAddChain],
        });
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params,
        });
      }
      refresh();
    } catch (error) {
      setWalletError(explain(error));
    } finally {
      setSwitching(false);
    }
  }

  async function submit() {
    if (!intent || !ready || !connector || !address || txLock.current) return;
    txLock.current = true;
    setBusy(true);
    const action = intent;
    const startedSession = session.current;
    setIntent(undefined);
    let submittedHash: Hash | undefined;
    try {
      setTx({ message: `Checking ${action.title.toLowerCase()}…` });
      await verifyChain(runtime);
      const provider = (await connector.getProvider()) as EIP1193Provider;
      const wallet = createWalletClient({
        account: address,
        chain: runtime.chain,
        transport: custom(provider),
      });
      const checkWallet = async () => {
        const [actualChain, accounts] = await Promise.all([
          wallet.getChainId(),
          wallet.getAddresses(),
        ]);
        if (
          actualChain !== runtime.chain.id ||
          !same(accounts[0], address) ||
          session.current !== startedSession
        )
          throw Error(
            'The wallet account or network changed. Review the action again.',
          );
      };
      await checkWallet();
      const contract = action.token ? runtime.token : runtime.fund;
      const { request } = await runtime.client.simulateContract({
        address: contract.address,
        abi: contract.abi,
        functionName: action.method,
        args: action.args,
        account: address,
      });
      await checkWallet();
      setTx({
        message: `Confirm ${action.title.toLowerCase()} in your wallet.`,
      });
      submittedHash = await wallet.writeContract(request);
      setTx({
        message: `${action.title} submitted. Waiting for confirmation…`,
        hash: submittedHash,
      });
      const receipt = await runtime.client.waitForTransactionReceipt({
        hash: submittedHash,
        timeout: 120_000,
        onReplaced: (replacement) => {
          submittedHash = replacement.transaction.hash;
          setTx({
            message: `Transaction ${replacement.reason}. Waiting for confirmation…`,
            hash: submittedHash,
          });
          if (
            replacement.reason === 'cancelled' ||
            replacement.reason === 'replaced'
          )
            throw Error(
              'The transaction was cancelled or replaced in your wallet. Check the explorer before trying again.',
            );
        },
      });
      if (receipt.status !== 'success')
        throw Error(
          'The transaction reverted on-chain. No action was applied; network fees may still be charged.',
        );
      setTx({
        message: `${action.title} confirmed. Contract state is refreshing.`,
        hash: receipt.transactionHash,
      });
      refresh();
    } catch (error) {
      setTx({
        message: submittedHash
          ? `Confirmation requires attention. ${explain(error)} Check the transaction link before retrying; it may still be pending.`
          : explain(error),
        hash: submittedHash,
        error: true,
      });
    } finally {
      txLock.current = false;
      setBusy(false);
    }
  }

  const disabledReason = !isConnected
    ? 'Connect a wallet to use the contract.'
    : !correctChain
      ? `Switch to ${runtime.chain.name} to continue.`
      : readError
        ? 'Resolve the connection error before continuing.'
        : !snapshot || loading
          ? 'Waiting for a verified state update.'
          : !fresh
            ? 'The state is stale. Refresh before continuing.'
            : busy
              ? 'Wait for the current transaction to finish.'
              : '';

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header shell">
        <a className="brand" href="#main" aria-label="Milestone Fund home">
          <span className="brand-mark">
            <Mark />
          </span>
          <span>
            Milestone<span className="brand-secondary">Fund</span>
          </span>
        </a>
        <div className="header-actions">
          <span className="network-label">
            <span className="status-dot" />
            {runtime.chain.name} <span className="testnet">testnet</span>
          </span>
          {isConnected ? (
            <button
              className="wallet-button"
              onClick={() => disconnect.mutate()}
              disabled={busy}
              title={address}
            >
              Disconnect {shortAddress(address!)}
            </button>
          ) : (
            <button
              onClick={() => connectWallet(0)}
              disabled={connect.isPending}
            >
              {connect.isPending ? 'Connecting…' : 'Connect wallet'}{' '}
              <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>

      <main id="main" className="shell">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Built on trust. Released in stages.</p>
            <h1 id="hero-title">
              Good ideas.
              <br />
              <em>Steady progress.</em>
            </h1>
            <p>
              Back a creator. Vote on each milestone.
              <br className="desktop-break" /> Keep a say in what happens next.
            </p>
            <a className="text-link" href="#raises">
              Explore the raises <span aria-hidden="true">↘</span>
            </a>
          </div>
          <div
            className="journey"
            aria-label="Three milestones, one shared direction"
          >
            <div className="journey-top">
              <span>One raise. Three milestones.</span>
              <span aria-hidden="true">↗</span>
            </div>
            <div className="steps-art" aria-hidden="true">
              <div>
                <span>01</span>
                <i />
              </div>
              <div>
                <span>02</span>
                <i />
              </div>
              <div>
                <span>03</span>
                <i />
              </div>
            </div>
            <div className="journey-bottom">
              <span>Fund with conviction.</span>
              <span>Move forward together.</span>
            </div>
          </div>
        </section>
        <section className="facts" aria-label="How the fund works">
          <div>
            <strong>
              {snapshot ? snapshot.count.toString().padStart(2, '0') : '—'}
            </strong>
            <span>Raises opened</span>
          </div>
          <div>
            <strong>03</strong>
            <span>Milestones per raise</span>
          </div>
          <div>
            <strong>3 days</strong>
            <span>Grace before each release</span>
          </div>
          <p>
            Powered by <strong>TRNC</strong>
            <br />
            You approve. The contract holds.
          </p>
        </section>

        <div className="connection-status">
          <span className="small" role="status">
            {loading
              ? 'Reading verified contract state…'
              : snapshot && !readError
                ? `Live reads · block ${snapshot.block.toLocaleString()}${fresh ? '' : ' · refresh needed'}`
                : 'Contract connection unavailable'}
          </span>
          <button
            className="text-button"
            disabled={loading || busy}
            onClick={refresh}
          >
            Refresh state <span aria-hidden="true">↻</span>
          </button>
        </div>
        {readError && (
          <div className="notice error" role="alert">
            <strong>Unable to verify live state</strong>
            <p>{readError}</p>
            <button onClick={refresh}>Retry connection</button>
          </div>
        )}
        {isConnected && !correctChain && (
          <div className="notice warning">
            <div>
              <strong>Your wallet is on another network</strong>
              <p>
                This fund is on {runtime.chain.name}. Contract actions are
                disabled until you switch.
              </p>
            </div>
            <button onClick={switchNetwork} disabled={switching}>
              {switching ? 'Switching…' : `Switch to ${runtime.chain.name}`}
            </button>
          </div>
        )}
        <div className="transaction" role="status" aria-live="polite">
          {tx.message && (
            <div className={`notice ${tx.error ? 'error' : 'success'}`}>
              <span>{tx.message}</span>
              {tx.hash && (
                <a
                  href={`${runtime.deployment.network.explorer}/tx/${tx.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              )}
            </div>
          )}
        </div>

        <div className="workspace">
          <section
            className="raises-column"
            id="raises"
            aria-labelledby="raises-title"
          >
            <div className="section-header">
              <div>
                <p className="eyebrow">The funding board</p>
                <h2 id="raises-title">
                  Explore raises{' '}
                  <span className="count">
                    {snapshot?.count.toString() ?? '—'}
                  </span>
                </h2>
              </div>
              <span className="small">Newest first</span>
            </div>
            {historyMessage && (
              <p className="small history-status" role="status">
                {historyMessage}
              </p>
            )}
            {historyError && (
              <p className="notice warning" role="status">
                {historyError}
              </p>
            )}
            {!snapshot && !readError && (
              <div className="empty">
                <span className="empty-mark" aria-hidden="true">
                  ◷
                </span>
                <h3>Reading the funding board</h3>
                <p>
                  Checking the network and contract state. Your wallet can stay
                  disconnected.
                </p>
              </div>
            )}
            {snapshot && snapshot.count === 0n && (
              <div className="empty">
                <span className="empty-mark" aria-hidden="true">
                  ↗
                </span>
                <h3>The first milestone starts here.</h3>
                <p>
                  No raises have opened yet. Set three milestone shares and give
                  backers a place to begin.
                </p>
                <a href="#open-raise">Open the first raise →</a>
              </div>
            )}
            {snapshot?.raises.map((raise) => (
              <RaiseCard
                key={raise.id.toString()}
                runtime={runtime}
                raise={raise}
                snapshot={snapshot}
                totals={
                  history?.get(raise.id.toString()) ??
                  (history ? { deposited: 0n, released: 0n } : undefined)
                }
                expanded={selected === raise.id.toString()}
                onExpand={() =>
                  setSelected(
                    selected === raise.id.toString()
                      ? undefined
                      : raise.id.toString(),
                  )
                }
                ready={ready}
                reason={disabledReason}
                onReview={setIntent}
              />
            ))}
            {snapshot && snapshot.count > PAGE_SIZE && (
              <nav className="pagination" aria-label="Raise pages">
                <button
                  disabled={page === 0 || loading}
                  onClick={() => {
                    setPage((value) => value - 1);
                    setSelected(undefined);
                  }}
                >
                  Newer raises
                </button>
                <span>
                  Page {page + 1} of{' '}
                  {((snapshot.count + PAGE_SIZE - 1n) / PAGE_SIZE).toString()}
                </span>
                <button
                  disabled={
                    BigInt(page + 1) * PAGE_SIZE >= snapshot.count || loading
                  }
                  onClick={() => {
                    setPage((value) => value + 1);
                    setSelected(undefined);
                  }}
                >
                  Older raises
                </button>
              </nav>
            )}
            <div className="principles">
              <h3>A little structure. A shared say.</h3>
              <ol>
                <li>
                  <span>01</span>
                  <div>
                    <strong>Back the idea</strong>
                    <p>
                      Deposit TRNC during the funding window. Each token gives
                      you an equal share of the vote.
                    </p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Approve the progress</strong>
                    <p>
                      More than half of the current shares must approve each
                      milestone. Every vote starts fresh.
                    </p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Release, or leave</strong>
                    <p>
                      After the three-day grace period, anyone can release an
                      approved tranche. Backers can rage-quit for their share of
                      funds still held.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          </section>

          <aside className="sidebar" aria-label="Wallet and creator controls">
            <section className="wallet-panel" aria-labelledby="wallet-title">
              <div className="panel-heading">
                <h2 id="wallet-title">Your wallet</h2>
                <span className="badge">
                  {isConnected ? 'Connected' : 'Read only'}
                </span>
              </div>
              {isConnected ? (
                <>
                  <a
                    className="address"
                    href={`${runtime.deployment.network.explorer}/address/${address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {address} ↗
                  </a>
                  <dl className="wallet-values">
                    <div>
                      <dt>Available balance</dt>
                      <dd>
                        {snapshot && same(snapshot.account, address) ? (
                          <Amount
                            value={snapshot.balance}
                            snapshot={snapshot}
                          />
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Fund allowance</dt>
                      <dd>
                        {snapshot && same(snapshot.account, address) ? (
                          <Amount
                            value={snapshot.allowance}
                            snapshot={snapshot}
                          />
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                  </dl>
                  <p className="small">
                    Allowance is the maximum this fund can pull when you
                    deposit. Each deposit needs your signature.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Connect to see your TRNC balance, back a raise, or open your
                    own.
                  </p>
                  {connectors.length > 1 ? (
                    <div className="wallet-choices">
                      {connectors.map((item, index) => (
                        <button
                          key={item.uid}
                          onClick={() => connectWallet(index)}
                          disabled={connect.isPending}
                        >
                          Connect {item.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="primary full"
                      onClick={() => connectWallet(0)}
                      disabled={connect.isPending}
                    >
                      {connect.isPending
                        ? 'Connecting…'
                        : 'Connect browser wallet'}{' '}
                      <span aria-hidden="true">↗</span>
                    </button>
                  )}
                </>
              )}
              {walletError && (
                <p className="field-error" role="alert">
                  {walletError}
                </p>
              )}
              <div className="token-note">
                <strong>Need TRNC?</strong>
                <p>
                  TRNC comes from swapping Sepolia ETH in the ETH/TRNC launch
                  pool. Obtain it externally, then return to back a raise.
                </p>
                <span className="small">
                  Sepolia is a test network. Keep a little ETH for gas.
                </span>
              </div>
            </section>
            <OpenForm
              ready={ready}
              reason={disabledReason}
              onReview={setIntent}
            />
            <section
              className="withdraw-panel"
              aria-labelledby="withdraw-title"
            >
              <h2 id="withdraw-title">Creator withdrawals</h2>
              <p>
                Released funds across all your raises are ready to collect here.
              </p>
              <div className="withdraw-amount">
                {snapshot && same(snapshot.account, address) && address ? (
                  <Amount value={snapshot.withdrawable} snapshot={snapshot} />
                ) : (
                  '— TRNC'
                )}
              </div>
              <button
                className="full"
                disabled={!ready || !snapshot || snapshot.withdrawable === 0n}
                onClick={() =>
                  snapshot &&
                  setIntent({
                    title: 'Withdraw creator funds',
                    description: `Transfer all ${formatUnits(snapshot.withdrawable, snapshot.decimals)} ${snapshot.symbol} released to your connected creator wallet. This covers every raise you created.`,
                    method: 'withdraw',
                    args: [],
                  })
                }
              >
                Withdraw released funds <span aria-hidden="true">↗</span>
              </button>
              <p className="small">
                {disabledReason ||
                  (snapshot?.withdrawable === 0n
                    ? 'No released funds to withdraw yet.'
                    : 'All available creator funds will be withdrawn.')}
              </p>
            </section>
          </aside>
        </div>

        <section className="risk-note">
          <span aria-hidden="true">ⓘ</span>
          <div>
            <h2>Know what your vote means.</h2>
            <p>
              A holder controlling more than 50% of shares across multiple
              wallets—including a creator—can approve releases. Each tranche
              still waits at least three days from its vote opening. You can
              rage-quit at any time, but funds already released cannot be
              reclaimed. Amounts can round down to the smallest token unit.
            </p>
          </div>
        </section>
      </main>
      <footer className="shell site-footer">
        <div>
          <span className="footer-brand">Milestone Fund</span>
          <p>Three milestones. One step at a time.</p>
        </div>
        <details>
          <summary>Deployment & contracts</summary>
          <p className="small">
            Configuration and ABI hashes verified against this build. Live
            checks verify the chain, nonempty code, and token binding.
          </p>
          {runtime.contracts.map((contract) => (
            <a
              key={contract.name}
              className="contract-link"
              href={`${runtime.deployment.network.explorer}/address/${contract.address}`}
              target="_blank"
              rel="noreferrer"
            >
              {contract.name}
              <span>{contract.address} ↗</span>
            </a>
          ))}
          <a href="./imd-deployment.json">View deployment manifest</a>
          <p className="small address">
            Source {runtime.deployment.sourceCommit}
          </p>
        </details>
        <span className="small">Built on {runtime.chain.name} ↗</span>
      </footer>
      <dialog
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = dialog.current?.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          );
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        onCancel={() => setIntent(undefined)}
        onClose={() => setIntent(undefined)}
        aria-labelledby="review-title"
        aria-describedby="review-description"
      >
        <div className="dialog-content">
          <p className="eyebrow">Review transaction</p>
          <h2 id="review-title">{intent?.title}</h2>
          <p id="review-description">{intent?.description}</p>
          <p className="small">
            Network: {runtime.chain.name}. Your wallet will show the network
            fee. State may change before confirmation.
          </p>
          {!ready && <p className="field-error">{disabledReason}</p>}
          <div className="dialog-actions">
            <button onClick={() => setIntent(undefined)} autoFocus>
              Cancel
            </button>
            <button className="primary" disabled={!ready} onClick={submit}>
              Confirm in wallet
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function OpenForm({
  ready,
  reason,
  onReview,
}: {
  ready: boolean;
  reason: string;
  onReview: (intent: Intent) => void;
}) {
  const [shares, setShares] = useState(['30', '30', '40']);
  const [days, setDays] = useState('14');
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<'split' | 'days'>('split');
  const form = useRef<HTMLFormElement>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    try {
      const args = openingInput(shares, days);
      setError('');
      onReview({
        title: 'Open a raise',
        description: `Create a raise with ${shares.join('% / ')}% milestone shares and a ${days}-day funding window. You become the creator and cannot deposit from this wallet. These terms cannot be edited. No TRNC payment is needed.`,
        method: 'open',
        args,
      });
    } catch (error) {
      const message = (error as Error).message;
      const field = message.includes('funding days') ? 'days' : 'split';
      setError(message);
      setErrorField(field);
      form.current
        ?.querySelector<HTMLInputElement>(
          field === 'days' ? '#duration' : 'input',
        )
        ?.focus();
    }
  }
  return (
    <section
      className="open-panel"
      id="open-raise"
      aria-labelledby="open-title"
    >
      <p className="eyebrow">For the next good idea</p>
      <h2 id="open-title">Open a raise</h2>
      <p>
        Give your project three milestones. You set the split; your backers
        approve each release.
      </p>
      <form ref={form} onSubmit={submit} noValidate>
        <fieldset>
          <legend>
            Milestone shares <span>Must total 100%</span>
          </legend>
          <div className="split-inputs">
            {shares.map((value, i) => (
              <label key={i}>
                Milestone {i + 1}
                <span className="input-suffix">
                  <input
                    name={`milestone-${i + 1}`}
                    inputMode="decimal"
                    value={value}
                    aria-invalid={!!error && errorField === 'split'}
                    aria-describedby={
                      error && errorField === 'split' ? 'open-error' : undefined
                    }
                    onChange={(event) => {
                      setShares((values) =>
                        values.map((item, j) =>
                          i === j ? event.target.value : item,
                        ),
                      );
                      setError('');
                    }}
                  />
                  <span aria-hidden="true">%</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="duration-label" htmlFor="duration">
          Funding window <span>1–90 days</span>
        </label>
        <span className="input-suffix">
          <input
            id="duration"
            name="funding-days"
            inputMode="numeric"
            value={days}
            aria-invalid={!!error && errorField === 'days'}
            aria-describedby={
              error && errorField === 'days' ? 'open-error' : undefined
            }
            onChange={(event) => {
              setDays(event.target.value);
              setError('');
            }}
          />
          <span>days</span>
        </span>
        {error && (
          <p className="field-error" role="alert" id="open-error">
            {error}
          </p>
        )}
        <button className={`full ${ready ? 'primary' : ''}`} disabled={!ready}>
          Review new raise <span aria-hidden="true">↗</span>
        </button>
        <p className="small">
          {reason || 'Opening a raise costs gas. No token deposit required.'}
        </p>
      </form>
    </section>
  );
}

function RaiseCard({
  runtime,
  raise,
  snapshot,
  totals,
  expanded,
  onExpand,
  ready,
  reason,
  onReview,
}: {
  runtime: Runtime;
  raise: RaiseView;
  snapshot: Snapshot;
  totals?: { deposited: bigint; released: bigint };
  expanded: boolean;
  onExpand: () => void;
  ready: boolean;
  reason: string;
  onReview: (intent: Intent) => void;
}) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const amountField = useRef<HTMLInputElement>(null);
  const status = phase(raise, snapshot.timestamp);
  const creator = same(raise.creator, snapshot.account);
  const funding = snapshot.timestamp < raise.deadline;
  const canBack = funding && !creator;
  const canVote =
    !funding && raise.released < 3 && raise.shares > 0n && !raise.approved;
  const canRelease = releaseReady(raise, snapshot.timestamp);
  const payout = refund(raise, raise.shares, snapshot.timestamp);
  let parsed = 0n;
  try {
    parsed = amountInput(amount, snapshot.decimals);
  } catch {
    /* Validate with a visible message on review. */
  }
  const approvedAmount = parsed > 0n && snapshot.allowance >= parsed;
  const id = raise.id.toString();
  function back(step: 'approve' | 'deposit') {
    if (!ready || !canBack) return;
    try {
      const value = amountInput(amount, snapshot.decimals);
      if (value > snapshot.balance)
        throw Error(
          `Your balance is ${formatUnits(snapshot.balance, snapshot.decimals)} ${snapshot.symbol}. Enter an amount within your balance.`,
        );
      if (step === 'deposit' && value > snapshot.allowance)
        throw Error('Approve this amount first, then wait for confirmation.');
      setError('');
      onReview(
        step === 'approve'
          ? {
              title: 'Approve TRNC spending',
              description: `Set the MilestoneFund allowance to exactly ${formatUnits(value, snapshot.decimals)} ${snapshot.symbol}. This replaces the current allowance of ${formatUnits(snapshot.allowance, snapshot.decimals)} ${snapshot.symbol}. Approval does not deposit tokens; return for step 2 after confirmation.`,
              method: 'approve',
              args: [runtime.fund.address, value],
              token: true,
            }
          : {
              title: 'Back this raise',
              description: `Deposit ${formatUnits(value, snapshot.decimals)} ${snapshot.symbol} into raise #${id}. You receive the same number of shares. The creator can withdraw funds only after a release.`,
              method: 'deposit',
              args: [raise.id, value],
            },
      );
    } catch (error) {
      setError((error as Error).message);
      amountField.current?.focus();
    }
  }
  const approvalPercent =
    raise.totalShares > 0n
      ? Number((raise.approvalWeight * 10000n) / raise.totalShares) / 100
      : 0;
  return (
    <article
      className={`raise-card ${expanded ? 'expanded' : ''}`}
      aria-labelledby={`raise-title-${id}`}
    >
      <div className="raise-heading">
        <div className="raise-identity">
          <span className="raise-icon" aria-hidden="true">
            <Mark />
          </span>
          <div>
            <h3 id={`raise-title-${id}`}>Raise #{id}</h3>
            <a
              className="small creator-link"
              title={raise.creator}
              href={`${runtime.deployment.network.explorer}/address/${raise.creator}`}
              target="_blank"
              rel="noreferrer"
            >
              By {shortAddress(raise.creator)}
              {creator ? ' · You' : ''} ↗
            </a>
          </div>
        </div>
        <span
          className={`badge ${status === 'Funding' ? 'funding' : status === 'Closed' ? '' : 'voting'}`}
        >
          {status}
        </span>
      </div>
      <dl className="raise-metrics">
        <div>
          <dt>Total deposits</dt>
          <dd>
            {totals ? (
              <Amount value={totals.deposited} snapshot={snapshot} />
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>Released</dt>
          <dd>
            {totals ? (
              <Amount value={totals.released} snapshot={snapshot} />
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>Still held</dt>
          <dd>
            <Amount value={raise.unreleased} snapshot={snapshot} />
          </dd>
        </div>
      </dl>
      <ol
        className="tranches"
        aria-label={`${raise.released} of 3 milestones released`}
      >
        {[raise.bps1, raise.bps2, raise.bps3].map((bps, i) => (
          <li
            key={i}
            className={
              i < raise.released ? 'done' : i === raise.released ? 'next' : ''
            }
          >
            <span className="tranche-line" />
            <div>
              <span>
                {i < raise.released ? '✓ ' : ''}Milestone {i + 1}
              </span>
              <strong>{bps / 100}%</strong>
            </div>
          </li>
        ))}
      </ol>
      <div className="raise-summary">
        <span className="small">
          {funding ? (
            <>
              <span className="summary-line">
                Funding until{' '}
                <time
                  dateTime={new Date(
                    Number(raise.deadline) * 1000,
                  ).toISOString()}
                >
                  {date(raise.deadline)}
                </time>
              </span>
              <span className="summary-line">
                Next: milestone 1 ·{' '}
                <Amount value={raise.nextAmount} snapshot={snapshot} />
              </span>
            </>
          ) : raise.released === 3 || raise.totalShares === 0n ? (
            `${raise.released} of 3 milestones released`
          ) : (
            <>
              Next: milestone {raise.released + 1} ·{' '}
              <Amount value={raise.nextAmount} snapshot={snapshot} />
            </>
          )}
        </span>
        <button
          aria-expanded={expanded}
          aria-controls={`raise-actions-${id}`}
          onClick={onExpand}
        >
          {expanded ? 'Close details' : 'Manage raise'}{' '}
          <span aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>
      </div>
      {expanded && (
        <div className="raise-details" id={`raise-actions-${id}`}>
          <dl className="detail-values">
            <div>
              <dt>Your shares</dt>
              <dd>
                <Amount value={raise.shares} snapshot={snapshot} />
              </dd>
            </div>
            <div>
              <dt>Current approval</dt>
              <dd>
                {approvalPercent}% <span className="small">of shares</span>
              </dd>
            </div>
          </dl>
          <p className="small address">Creator: {raise.creator}</p>
          {funding ? (
            <div className="back-form">
              <h4>Back this raise</h4>
              <p className="small">
                Approve spending first, then deposit. Your tokens stay in the
                contract until released or reclaimed.
              </p>
              <label htmlFor={`amount-${id}`}>
                Amount to back ({snapshot.symbol})
              </label>
              <input
                ref={amountField}
                id={`amount-${id}`}
                name="deposit-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                disabled={creator}
                aria-invalid={!!error}
                aria-describedby={
                  error ? `amount-error-${id}` : `back-help-${id}`
                }
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError('');
                }}
              />
              {error && (
                <p
                  id={`amount-error-${id}`}
                  className="field-error"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <div className="action-row">
                <button
                  disabled={!ready || !canBack || approvedAmount}
                  onClick={() => back('approve')}
                >
                  {approvedAmount ? '1. Allowance ready ✓' : '1. Approve TRNC'}
                </button>
                <button
                  disabled={!ready || !canBack || !approvedAmount}
                  onClick={() => back('deposit')}
                >
                  2. Review deposit <span aria-hidden="true">↗</span>
                </button>
              </div>
              <p className="small" id={`back-help-${id}`}>
                {creator
                  ? 'Creators cannot back their own raise from this wallet.'
                  : reason ||
                    (approvedAmount
                      ? 'Allowance covers this amount. You can deposit after review.'
                      : 'An exact-amount approval is a separate wallet transaction.')}
              </p>
            </div>
          ) : (
            <div className="voting-controls">
              <h4>
                {raise.released < 3
                  ? `Milestone ${raise.released + 1} approval`
                  : 'All milestones released'}
              </h4>
              <p className="small">
                {raise.released < 3
                  ? `Earliest release: ${date(raise.voteOpenedAt + GRACE)}. More than 50% of current shares must approve.`
                  : 'All remaining funds were credited to the creator.'}
              </p>
              <div
                className="vote-meter"
                role="meter"
                aria-label="Current tranche approval percentage"
                aria-valuenow={approvalPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${approvalPercent}%` }} />
              </div>
              <div className="action-row">
                <button
                  disabled={!ready || !canVote}
                  onClick={() =>
                    onReview({
                      title: 'Approve next tranche',
                      description: `Vote with all ${formatUnits(raise.shares, snapshot.decimals)} of your shares for milestone ${raise.released + 1} of raise #${id}. This is a milestone vote, not an ERC-20 spending approval. Votes cannot be revoked separately; rage-quitting removes your shares and current approval.`,
                      method: 'approveTranche',
                      args: [raise.id],
                    })
                  }
                >
                  {raise.approved
                    ? 'Tranche approved ✓'
                    : 'Approve next tranche'}
                </button>
                <button
                  disabled={!ready || !canRelease}
                  onClick={() =>
                    onReview({
                      title: 'Release next tranche',
                      description: `Credit the creator of raise #${id} with the current next-tranche amount: ${formatUnits(raise.nextAmount, snapshot.decimals)} ${snapshot.symbol}. This reduces backers’ refundable funds. The creator then withdraws separately.`,
                      method: 'release',
                      args: [raise.id],
                    })
                  }
                >
                  Release tranche {raise.released < 3 ? raise.released + 1 : ''}
                </button>
              </div>
              <p className="small">
                {reason ||
                  (raise.shares === 0n
                    ? 'You have no shares to vote with. Anyone can release once the conditions are met.'
                    : raise.approved
                      ? 'Your vote is recorded for this tranche.'
                      : 'Approval applies only to the next unreleased tranche.')}
                {!canRelease && raise.released < 3
                  ? ' Release needs a strict majority and the completed grace period.'
                  : ''}
              </p>
            </div>
          )}
          <div className="quit-row">
            <div>
              <h4>Leave this raise</h4>
              <p className="small">
                Estimated return: <Amount value={payout} snapshot={snapshot} />.
                All your shares are removed.
              </p>
            </div>
            <button
              className="danger-button"
              disabled={!ready || raise.shares === 0n}
              onClick={() =>
                onReview({
                  title: 'Rage-quit this raise',
                  description: `Remove all ${formatUnits(raise.shares, snapshot.decimals)} of your shares and any current vote from raise #${id}. Estimated return: ${formatUnits(payout, snapshot.decimals)} ${snapshot.symbol}. Released funds cannot be reclaimed. Your final payout depends on the state when this transaction executes.${payout === 0n ? ' Your current payout is zero.' : ''}`,
                  method: 'rageQuit',
                  args: [raise.id],
                })
              }
            >
              Review rage-quit
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
