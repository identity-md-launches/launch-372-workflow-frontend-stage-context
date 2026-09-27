# Milestone Fund frontend

A single-page React, TypeScript, Vite and wagmi application for the deployed MilestoneFund. The committed `../dist/` directory is the complete static site. It works at `/`, a gateway subpath, or a named static entrypoint without server rewrites. All runtime assets are local; there is no backend or indexer.

Worker handoff note: this sandbox's `.git` is read-only. Source, export and evidence have been prepared in the working tree; the contributor service must capture them in its submission commit. The validation document records this limitation and the scratch snapshot packaging check.

## Install, build and preview

Use Node 22 or newer and the committed npm lockfile:

```sh
cd web
npm ci
npm run typecheck
npm run build
npm run verify
npm run preview
```

The build requires Git and the pinned source commit in this repository's history. It performs no network requests: `prepare.mjs` extracts `docs/abi/<Contract>.json` using `git show <sourceCommit>:<path>`, verifies each canonical Keccak-256 hash, then Vite exports the site and `manifest.mjs` inventories its final bytes. `npm ci --offline` also works when the locked packages are already in the local npm cache. A fresh installation requires registry access; a vendored registry is neither necessary nor included. `npm run dev` serves the source after an initial build has prepared the configuration and ABIs.

Never edit `dist/` by hand. Run `npm run build` after source, configuration, or asset changes. The final manifest excludes itself and includes the SHA-256 of every other exported file. `npm run verify` rejects missing, additional, changed, or oversized assets and checks configuration against the handoff.

## Deployment configuration

`config/deployment-handoff.json` and `config/network-handoff.json` are preserved build inputs from the assignment. The running application reads **only `imd-deployment.json` and its referenced ABI JSON files** for contract addresses, network, and interfaces. No contract address, RPC, or chain map is compiled into the application. The build compiles only a SHA-256 binding of the manifest metadata; an altered manifest fails closed. Array order is preserved and object keys are recursively sorted for canonical JSON. ABI hashes use Keccak-256 of that canonical JSON, without a `0x` prefix.

The export's manifest copies the handoff's launch ID, deployed source commit, attestation hash, complete contract set, and network block. The unchanged `walletAddChain` object and the deployment block are included as application metadata. Contract addresses are linked to the configured explorer in the page's deployment disclosure. The application verifies the ABI hashes, RPC chain ID, nonempty code for both deployed contracts, and that `MilestoneFund.token()` equals the attested token before enabling transactions. This checks the handoff binding; it is not independent cryptographic verification of the attestation issuer or a byte-for-byte comparison of runtime code to source.

Public RPC fallback follows the handoff's ordered URLs. Each transport has an 8-second timeout and one retry. No private credentials, WalletConnect project ID, keys or signing service are included. Browser wallets are discovered through wagmi's injected/EIP-6963 support. An unknown chain triggers `wallet_addEthereumChain` with the exact supplied parameters, followed by another switch. WalletConnect is not configured; supporting it would require an explicitly supplied public project ID and connector setup.

## Contract flows

- **Open:** three positive milestone percentages, precision up to 0.01%, summing to exactly 100%; a whole-number funding window from 1–90 days. The connected wallet becomes the creator. No TRNC payment is required.
- **Back:** enter a precise token amount, approve MilestoneFund for that exact amount, wait for confirmation, then deposit. Existing sufficient allowance is shown explicitly and may be reused. Creators cannot deposit from the creator wallet. Deposits close strictly at the funding deadline.
- **Approve next tranche:** a backer votes with all their current shares, once per tranche. This is distinct from ERC-20 approval.
- **Release:** anyone may release after a strict majority (`weight * 2 > totalShares`) and three days from the current vote opening. The UI reads `nextTrancheAmount()` rather than deriving a payout from the original deposit total. The next vote and grace period reset after each release.
- **Rage-quit:** the review shows the estimated payout and removal of all shares/current approval. Before the deadline this is the full deposit; afterwards it is a pro-rata share of unreleased funds. The last backer gets the remainder. Already released funds cannot be recovered. A zero-payout exit is explicitly described.
- **Withdraw:** a creator pulls their entire credited balance across all raises.

Every transaction gets a native review dialog, a fresh chain/code/token check, simulation, wallet account/network recheck, wallet confirmation, receipt tracking, and state refresh. Rejections and reverts are visible. Submitted hashes link to the explorer, including when receipt confirmation times out. Check the explorer before retrying a submitted transaction. Amounts and states can change before execution; simulations do not guarantee execution. Transaction replacement/cancellation handling is implemented but not exercised with a real wallet.

TRNC is obtained by swapping Sepolia ETH externally in the ETH/TRNC launch pool. The approved workflow explicitly excludes an in-page swap; this application has no quote, swap, Permit2 or router transactions. MilestoneFund itself is the spender for deposit approvals.

## Reads and accounting

Reads work before connection. Connecting also loads the wallet's token balance, fund allowance, creator balance, shares, and current-tranche vote status. `token()`, `decimals()` and `symbol()` determine the currency. Amount arithmetic uses bigint and token decimals, never floating-point token arithmetic. Display summaries truncate to four decimals; hover titles and transaction reviews expose exact amounts. Values below 0.0001 are labeled accordingly.

The list uses `raiseCount()` and `raise()` in pages of six, newest first. Related contract views and wallet reads share a pinned block number. Historical total deposits and released amounts come from `Deposited` and `Released` logs, in inclusive chunks of at most 2,000 blocks starting at the deployment block. RPC range failures split the range down to 32-block spans. Totals remain unavailable until the full scan succeeds; partial history is never presented as a total. Repeat scans replay the last 12 blocks and verify the scan-tip hash. Deeper reorganizations require a page reload to discard the cache. First-load scans may take longer as contract history grows.

State refreshes every 30 seconds when a read/transaction is not active, after receipts, on wallet changes, and on manual refresh. Eligibility uses the timestamp of the last read block. If successful reads stop, actions are disabled once the snapshot is two minutes old. Read failures immediately disable transactions. Display dates use the browser's local timezone. Current views remain usable when historical event totals fail.

A majority held through multiple wallets, including wallets controlled by a creator, can approve releases. The contract enforces a new three-day grace period for every tranche, giving other backers time to leave first. This is displayed in the page; it is not a guarantee of project delivery.

## Validation

```sh
cd web
# Install the browser once; choose a writable location.
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npm test
node scripts/check-chain.mjs
node tests/live-browser.mjs
```

The browser harness runs a temporary foreground HTTP server at `/preview/`, tests the actual `dist/`, closes its server/browser, and saves evidence under `docs/evidence/`. Mock fixtures are test-only and never imported by production code. The primary interaction suite sends no real transactions. `check-chain.mjs` and `live-browser.mjs` perform only live reads. No Playwright MCP snapshots or files are generated in the repository root.

See `../docs/VALIDATION.md`, `../docs/evidence/browser-report.json` and `../docs/DESIGN.md`. The root `DESIGN.md` requested by the generic acceptance text conflicts with this assignment's explicit allowed paths. The complete document is therefore delivered at `docs/DESIGN.md`; no root file was changed.

## Publication and scope

Publish the committed `dist/` as plain files with normal HTML, CSS, JavaScript and JSON MIME types. HTTP(S) hosting is required; `file://` cannot fetch the runtime JSON configuration. No deployment, keys, broadcast, IPFS pinning or site naming was performed by this worker. Publication checks remain the control plane's responsibility.

Only `web/**`, `dist/**`, `docs/**` and the explicitly allowed `web/.gitignore` are submitted. Dependencies, browser binaries, profiles, caches and temporary scaffolding are excluded. The frontend guide and its provenance are credited in the design documentation.
