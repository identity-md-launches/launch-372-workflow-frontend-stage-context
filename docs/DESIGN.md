# Milestone Fund design

This is the implemented design document. It lives under `docs/` because the assignment prohibits creating repository-root files, including the otherwise requested root `DESIGN.md`.

## Overview

Milestone Fund serves backers and creators using a three-tranche TRNC funding contract on Sepolia. It is a single, light-themed page with a warm paper background, dark green actions, a serif introduction, and compact contract data. The milestone stair illustration is built with CSS and an inline SVG mark; it introduces the three-stage structure without adding downloaded imagery.

The desktop composition has a funding board on the left and wallet/creator controls on the right. A small introduction gives way to live contract data. Cards group each raise's totals, progress and eligibility. Details disclose the relevant controls in place. Native transaction dialogs repeat the consequences before a wallet request.

## Colors

The source of truth is `web/src/styles.css`, using sRGB hex primitives and semantic custom properties.

| Semantic token | Value | Purpose |
| --- | --- | --- |
| `--page` | `#f5f4ed` | Paper page background |
| `--surface` | `#ffffff` | Cards, inputs, review dialog |
| `--surface-soft` | `#ecece3` | Muted surfaces, rule note, disabled controls |
| `--text` | `#253d31` | Main text and numbers |
| `--text-muted` | `#566253` | Secondary copy, units and labels |
| `--border` | `#d6d9cc` | Structural edges |
| `--input-border` | `#6b756a` | Input boundaries and expanded cards |
| `--accent` | `#183b31` | Primary action and brand mark |
| `--accent-hover` | `#264e3c` | Action hover |
| `--accent-soft` | `#e6eddf` | Creator panel and funding status |
| `--highlight` | `#e3f0a4` | Current milestone and brand illustration |
| `--illustration-low` / `--illustration-mid` | `#cad8bf` / `#9ab28e` | First and second decorative step fills, with dark text |
| `--focus` | `#164ed0` | Three-pixel keyboard focus outline |
| `--warning-bg` / `--warning-text` | `#fbf0dc` / `#70500d` | Voting/grace and network warnings |
| `--error-bg` / `--error-text` | `#faeae6` / `#963b2e` | Errors and exit action |

Status always includes text; progress adds a checkmark for released tranches. Primary fill is reserved for the currently available connect/open action and the active review confirmation. Other controls use neutral borders. There is no dark theme. Measured rendered contrast pairs and their scope are recorded in `docs/evidence/browser-report.json`; they are not a claim that every browser state has been measured.

## Typography

`web/src/typography.css` defines the role scale. Body text uses `Inter`, `Segoe UI`, Arial, sans-serif; these are system fallbacks, not downloaded fonts. The title and short explanatory heading use Georgia, Times New Roman, serif. The intended character is the serif/sans contrast, not dependence on a particular installed Inter font. The browser resolves an available system face; no remote font request is made.

The root is 16px with a 1.55 line height. Main titles use `clamp(3rem, 5.3vw, 4.7rem)`, line height 1.06 and −0.045em tracking; the narrow layout uses `clamp(2.8rem, 10vw, 4.2rem)`. Section, card, body-small and caption roles are 1.9rem, 1.2rem, 0.875rem and 0.75rem. Inputs remain 1rem. Labels use weights 400–600; a small number of compact badge and eyebrow labels are below the caption size. Heading levels descend by role, with a 1.3rem sidebar section variant. Font synthesis is disabled.

Headings balance their lines; descriptions use pretty wrapping. Numbers use tabular numerals. Amounts, addresses and hashes wrap within their containers. Full creator addresses are available in expanded details, wallet addresses in the wallet panel, and contract addresses in the footer. Summary amounts use four decimals, with exact transaction values in reviews.

## Layout

The `.shell` is at most 1240px wide, with 48px side margins on larger screens. The spacing vocabulary is 8, 16, 24, 32 and 48px, with denser 6–12px gaps inside controls. Raise cards have 24px padding, which becomes 18px on narrow screens. The desktop `.workspace` is a flexible board plus a 350px sidebar with a 36px gap.

Actual CSS breakpoints:

- At 68rem: 32px page margins, 320px sidebar, 24px column gap and wrapping action summaries.
- At 55rem: one main column; wallet/open panels use a two-column row and withdrawals span it. The header omits only the redundant testnet word.
- At 40rem: 16px page margins, a stacked header and hero, single-column sidebar, two-column raise metrics, wrapping card headings, full-width manage/action controls and a stacked footer/dialog action row.

All important controls stay in normal document flow. There is no sticky header, off-canvas panel or carousel. Dates and quantities can wrap. The text measure is limited where paragraphs need it. Responsive validation covers 1440, 880, 390 and 320 CSS pixels; the complete observations are in the validation report. Reflow at 200% text size is distinct from browser-native zoom.

## Elevation & Depth

The main interface is flat. Tonal surfaces establish groups; one-pixel borders identify structure and control boundaries. The transaction dialog alone uses elevation (`0 20px 80px #183b3130`) and a `#13251e99` backdrop. The native dialog top layer keeps the page inert while a review is open. There are no decorative gradient or blurred layers.

## Shapes

Cards and panels use `--radius: 12px`; inputs and buttons use `--radius-small: 6px`. The brand mark and notices use 8px. Status badges are capsules, sequence numbers are circles, and the three-stage bars have 2px corners. The review dialog uses a 16px outer radius with 28px internal padding. No image clipping assets are required.

## Components

`web/src/App.tsx` contains the page and its implemented patterns:

- **`Mark`**: one inline SVG using `currentColor`, decorative to assistive technology. Used for the brand and raise identity.
- **`Amount`**: decimal-aware, tabular numeric summary and unit, with the exact value in its title. Transaction reviews use full precision.
- **`RaiseCard`**: named article with creator, historical deposits/releases, held balance, and three milestone segments. `expanded` reveals backer controls or milestone voting, plus rage-quit. Text explains unavailable actions; contract prerequisites use native disabled buttons. The approve-spending and approve-tranche labels remain distinct.
- **`OpenForm`**: three milestone percentage fields and a funding-day field. Validation errors associate with the relevant fields; focus moves to the failing group or duration. Submission creates a review intent, not a direct transaction.
- **Wallet and withdrawal panels**: browser-wallet connection, address, balance, allowance and creator-credit display. The wrong-network notice offers one switch action; connection errors remain visible with a retry path.
- **Review dialog**: a native `<dialog>` with title, consequences and exact amounts. Initial focus is Cancel, Tab is contained, Escape dismisses, and focus returns to the triggering control. Confirm is gated by fresh state and wallet eligibility.
- **Notices and transaction status**: visible text plus a stable polite status region. Input failures use alerts. A submitted transaction keeps its explorer link through confirmation errors.

Buttons have at least 44px height except the compact refresh text action, which is 32px at the smallest breakpoint. The skip link is the first focusable element. Focus uses a three-pixel outline with a three-pixel offset; forced-colors mode uses `Highlight`. Native inputs, buttons, links, summaries and dialogs supply the keyboard behaviors. Motion is limited to 120ms button background/scale transitions and a 0.96 press scale under `prefers-reduced-motion: no-preference`. No content animates on page load.

## Do's and Don'ts

Use `.shell`, the semantic color tokens, native controls and the existing typography roles when adding an adjacent page. Keep wallet state and deployment configuration in the existing runtime, and use the same review/simulate/receipt path for actions. Group closely related values within a panel and leave larger gaps between tasks. Preserve explanatory disabled-state text.

Do not add a second address map, fake project names, a server-indexed raise list or a swap flow to this page. Do not turn the milestone graphic into a funding target: the contract has no target amount. Never display partial event scans as historical totals. Preserve the explicit distinction between an ERC-20 allowance and a tranche vote.

## Guidance provenance

Applied the assignment's pinned Better Interface workflow and all six domains: accessibility, layout, writing, typography, colors and UI. Design guidance is adapted from Jakub Krehel's [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`, MIT. The documentation method is adapted from Paul Bakaus's [Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`, Apache-2.0. These remain distinct works under their original licenses. No upstream guide text or implementation was vendored into the app.
