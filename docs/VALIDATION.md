# Worker validation — Milestone Fund frontend

**Complete for the authorized frontend scope.** These are worker-run checks, not independent certification. No live transaction was signed or broadcast. Publication, IPFS pinning, naming and subsequent control-plane checks were not performed.

**Checkout commit limitation:** `git add -- web dist docs` failed because the sandbox mounts `.git` read-only (`Unable to create .git/index.lock: Read-only file system`). The requested source/export/evidence are present in the working tree for the contributor service to collect. A separate writable Git snapshot under the explicitly authorized, ignored `test/scratch/` is used only to verify the full submission bundle size; it does not change this checkout's HEAD. This worker cannot truthfully claim a commit in the protected checkout.

## Scope and requirements

Implemented a single-page React/TypeScript/Vite/wagmi interface against source commit `5ac8f1fd4d5562312160e8f180f9546a25b7b0d5`. The source, lockfile and frontend configuration are in `web/`; the complete static export is in `dist/`. Deployed Solidity, ABIs in the original `docs/abi/`, root build configuration and dependencies under `lib/` are preserved.

The approved workflow was read together with both protected deployment/token test definitions, the deployment handoff, network handoff, and the pinned Better Interface workflow and six domain core principles. The workflow explicitly says **no in-page swap**. The interface instead explains how to obtain TRNC externally; the provided Uniswap addresses are preserved unchanged in the runtime network block. ERC-20 deposit approvals use MilestoneFund as the spender.

The generic root `DESIGN.md` criterion conflicts with the overriding write budget. The implemented design document is delivered at [`docs/DESIGN.md`](DESIGN.md). No root `DESIGN.md` was created. This is the only intentional path-related criterion deviation. The previous attempt's `.playwright-mcp/` output failure was avoided by running a bounded programmatic Playwright harness; profiles/caches stay in ignored `test/scratch/`, and committed evidence stays in `docs/evidence/`.

## Commands and evidence

Commands ran from the repository root unless a `cd web` is shown. The final production build and all tests are rerun after applicable source fixes.

| Check | Command | Result |
| --- | --- | --- |
| Locked offline reinstall | `npm --cache test/scratch/npm-cache --prefix web ci --offline` | PASS; 55 packages installed from the local cache, audit reported zero vulnerabilities |
| TypeScript | `npm --prefix web run typecheck` | PASS |
| Production export and ABI binding | `npm --prefix web run build` | PASS; relative `./` base, complete static assets |
| Pure boundary/amount checks | First phase of `npm --prefix web test` | 4 tests PASS |
| Production browser/interaction suite | Second phase of `npm --prefix web test` | PASS; [structured report](evidence/browser-report.json) |
| Manifest inventory | `npm --prefix web run verify` | PASS; handoff metadata and every non-manifest export file checked |
| Public RPC reads | `node web/scripts/check-chain.mjs` | PASS for all three supplied RPCs; [observations](evidence/live-rpc.json) |
| Unmocked production browser | `node web/tests/live-browser.mjs` | PASS; live empty raise list, no browser console/resource failures; [report](evidence/live-browser.json) |

The four domain tests exercise exact 50% vs strict majority, grace period −1 second and inclusive boundary, last-backer rounding, funding-window refund behavior, token input precision, uint256 overflow, invalid percentages, and the 1/90-day limits. These supplement the interface tests; they do not re-certify the deployed Solidity.

The browser harness serves the final export from `/preview/`. It injects a test-only EIP-1193 wallet and intercepts the configured RPC URLs with ABI-encoded replies. It checks:

- Disconnected and missing-wallet states; wrong-chain disabling; unknown-chain code 4902; exact `wallet_addEthereumChain` parameters; switch retry; account/chain-change events.
- All seven primary actions: `open`, token `approve`, `deposit`, `approveTranche`, `release`, `rageQuit`, `withdraw`. It checks token/fund destinations, spender, amounts, arguments, and that every submitted action had a successful simulation first.
- Creator deposit prohibition; precise amount/balance validation; explicit allowance confirmation before deposit; stale milestone approvals not carrying forward; strict majority and grace gating; reset after release.
- Review consequences and exact amounts, rejection recovery, simulation revert preventing signature, receipt-triggered refresh, historical deposit totals, zero creator-credit state and zero-share exit disabling.
- Raise pagination, inclusive log chunks from the deployment block through the observed tip, tampered ABI/config rejection, RPC chain mismatch, missing code and token-binding mismatch.
- Responsive rendering at **1440×1000, 880×1000, 390×1000 and 320×1000**, no document horizontal overflow, axe WCAG 2 A/AA and 2.1 AA tags in those connected states, 200% root text size, reduced motion, review dialog keyboard cycle, Escape dismissal and focus return.

The final report lists 18 interaction/inspection groups. Browser validation uses Chromium; no standalone browser extension wallet is installed for testing. The mocked fixtures contain synthetic wallet balances and raises and are never imported into production. Screenshots showing populated raises are **mocked test states**, not claims about live projects.

The live RPC script observed Sepolia chain 11155111, 1,739-byte LaunchToken code, 4,938-byte MilestoneFund code, the attested token binding and zero raises at its recorded block. Each observation includes its endpoint, block and timestamp. The live browser independently fetched the real production configuration, ABIs and public RPC without interception; it rendered the empty funding board. These checks are read-only and say nothing about real wallet confirmation, gas estimation by a wallet, or transaction mining.

## Better Interface review

All six domains were reviewed using the pinned guide, the final source, rendered screenshots and relevant browser checks. No unresolved observed blocker remains in the implemented scope.

| Domain | Coverage and evidence | Unperformed / not applicable |
| --- | --- | --- |
| Accessibility | **Checked:** native controls/landmarks, named cards and fields, semantic heading order, alerts/status region, associated errors, disabled-state explanations, visible keyboard focus screenshot, native dialog plus explicit Tab wrapping, Escape/focus return, automated axe scans. | No screen-reader session, physical-device check or full accessibility certification. Forced-colors fallback reviewed in source; not visually inspected. |
| Layout | **Checked:** desktop board/sidebar alignment; 880px adaptation; 390px and 320px card/form reflow; no horizontal document overflow; addresses/amount wrapping; 200% text enlargement. | Browser-native 200% zoom, RTL and translated variants unperformed. English-only page; other locales/themes not implemented. |
| Writing | **Checked:** contract-specific action labels, spending-approval/vote distinction, recovery instructions, creator prohibition, empty-state next step, rage-quit consequences, majority-wallet limitation. | No fabricated project names, targets, success claims or in-page swap. |
| Typography | **Checked:** serif/sans hierarchy, system fallback font stacks, tabular amounts, 16px inputs, labels/units and date wrapping at the tested widths. | Cross-platform font rendering not measured; no local/remote font asset is promised. |
| Colors | **Checked:** semantic token roles, text status cues, actual rendered text/background contrast via axe and computed pairs. Final measured pairs range from 5.34:1 to 12.29:1 in the recorded sample. | Not every hover/disabled/overlay combination was manually measured; no dark mode. |
| UI | **Checked:** normal, unavailable, loading, empty, connected, wrong-network, success/rejection/revert and review states; responsive card disclosures, opaque illustration colors, restrained button-only motion and reduced-motion behavior. | No animations panel slow-motion review; no entrance animations, carousel, themes or complex media controls exist. |

### Findings, corrections and rechecks

| Severity / domain | Location and concrete finding | Correction and verification |
| --- | --- | --- |
| Medium / colors | `web/src/styles.css:285`: axe identified insufficient contrast on the first stair number when the whole step used 0.65 opacity. | Replaced transparent group fades with opaque light/mid green fills and dark labels. Final first/second step label ratios are **8.24:1 / 5.34:1**; axe passes at all four widths. |
| Medium / accessibility | `web/src/App.tsx:836`: browser keyboard test found that Tab after the final review action did not wrap directly to Cancel with native dialog behavior alone. | Added an explicit first/last enabled-button Tab loop while retaining native dialog inertness. The final keyboard test executes Tab, Shift+Tab and Escape, and checks focus return. |
| Medium / forms | `web/src/App.tsx:892`: source review showed a funding-day validation failure marked every field invalid and returned focus to the first milestone field. | Track whether the split or duration failed, associate the error only with that group, and focus the duration for a day error. Browser test enters 91 days and verifies focus. |
| Medium / observability | `web/src/App.tsx:120`: source review found interval refresh could supersede an RPC request still running after 30 seconds, delaying visible failure reporting. | Poll only when reads and transactions are idle. Guard cache updates against superseded event scans (`web/src/chain.ts:132`). Source recheck and final normal/error suites pass; a 30+ second all-RPC timeout was not artificially held open. |
| Medium / error writing | `web/src/chain.ts:205`: nested RPC revert details could be hidden behind viem's generic short message. | Inspect nested error text for known contract reverts and return an actionable message. Mock `GracePeriodActive` simulation is rendered correctly and sends no transaction. |

Initial harness-only failures were repaired as fixtures: ERC-20 `approve` returns a boolean; decoded addresses use checksum casing; field label matching includes percent units; axe requires an explicitly created browser context. None of these failures was relabeled as a pass. Final evidence is generated by a successful run.

### Rendered artifacts

- [Live empty board](evidence/live-desktop.png): actual public RPC, no wallet, no fabricated raises.
- [Desktop disconnected](evidence/desktop-disconnected.png) and [desktop connected](evidence/desktop-connected.png): mocked raises/wallet, inspected for hierarchy, spacing, status and forms.
- [390px connected](evidence/mobile-390-connected.png), [320px connected](evidence/mobile-320-connected.png), and [320px controls](evidence/mobile-320-controls.png): mocked narrow layouts, inspected for wrapping and available controls.
- [Keyboard focus](evidence/keyboard-focus.png) and [review dialog](evidence/review-dialog.png): visible focus in the rendered page and modal.

## Integrity and limitations

Both implementation ABI hashes match the handoff: LaunchToken `66c0725e9072e2c383f59b9a3baa620d857711ec96837623ad2372c434b83f07`; MilestoneFund `b79418d5d731169b80268436b8a0fa324a514af251f4e8fe4c0d7c0b2af233f8`. ABIs are extracted from the pinned Git commit, not hand-written. The build's metadata digest prevents a different deployment configuration from silently binding to this JS build. Runtime ABI hashes are verified before wagmi initializes.

`dist/imd-deployment.json` is the runtime configuration and records the SHA-256 of all other export files, excluding itself. The network block is unchanged from the supplied handoff. Final size/path evidence is in `evidence/delivery.json`. The Vite main chunk exceeds its advisory 500 kB warning threshold; the entire export is approximately 0.64 MB uncompressed, well within the artifact, HTTP-budget and submission limits. No source maps, dependency archives or node_modules are committed.

Unperformed: live signing/broadcast/mining, real hardware/mobile/extension wallets, real-chain populated raise interactions, deep reorganizations, transaction replacement/cancellation and timeout execution, forced-colors rendering, screen readers, non-Chromium browsers, browser-native zoom and publication checks. Simulations, preflight checks and estimates do not guarantee an on-chain outcome. Partial event history remains unavailable rather than being displayed as zero. The 12-block event replay is not a guarantee against deeper reorganizations; reloading clears its cache.
