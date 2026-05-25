# CLAUDE.md

This file provides guidance to Claude when working with code in this repository.

## Project overview

Personal finance web app called **Finaura**, live at **https://finaura.app**. The app is a single file — `index.html`, ~2,066 lines. No framework, no build step, no dependencies except PostHog (CDN) and optional CDN scripts. Deployed to GitHub Pages with a custom domain. All financial data persists in `localStorage`. Open `index.html` directly in a browser to test locally — no server needed.

## Repository files

| File | Purpose |
|---|---|
| `index.html` | The entire app — CSS, HTML, and JS in one file |
| `legal.html` | Terms of Service and Privacy Policy (standalone page) |
| `og-image.svg` | 1200×630 Open Graph image for social sharing previews |
| `CNAME` | Custom domain config (`finaura.app`) for GitHub Pages |
| `CLAUDE.md` | This file |

## Git workflow

Feature branches → PR into `main` → GitHub Pages auto-deploys from `main`. Branch protection is on: never commit directly to `main`. Branch naming convention: `feature/` or `fix/` prefix, e.g. `feature-loans`, `fix-navigation-bar`.

```bash
# View current branch
git branch

# Always verify branch before editing
git status
```

**Important:** The bash sandbox mount of the repo is often stale — it may reflect an older version of `index.html`. Always use the `Read` tool (not bash `cat` or `wc -l`) to read the real current file content and get accurate line numbers.

## Architecture

`index.html` has four logical blocks:

1. **`<head>`** (lines ~1–28) — meta tags, SEO, Open Graph, PostHog analytics snippet, canonical URL
2. **CSS** (`<style>`, lines ~29–260) — all styles inline, no external stylesheet. Includes landing overlay styles (`lp-*` classes)
3. **HTML** (`<body>`, lines ~261–820) — landing overlay, sidebar, `<main>` with all page `<section>` elements
4. **JavaScript** (`<script>`, lines ~821–end) — all logic inline

### Landing page overlay

A full-screen `<div id="landing-overlay">` sits at the top of `<body>`, before `<div class="app">`. It is shown on first visit and hidden via JS on subsequent visits (or if the user already has data).

- `checkFirstVisit()` — called first in INIT. Adds `.hidden` class to `#landing-overlay` if `mf_launched` is set in localStorage, or if any financial data already exists (`mf_income`, `mf_recurring`, `mf_cards`). This ensures existing users are never interrupted.
- `launchApp()` — called by the "Launch App" buttons. Sets `mf_launched = '1'` in localStorage and hides the overlay.
- CSS: `#landing-overlay.hidden { display: none; }` drives visibility — no inline style manipulation.

### Sidebar collapse

The entire sidebar can be toggled via a `☰` button (`.sidebar-toggle`).

- `toggleSidebar()` — toggles `.sidebar-collapsed` class on `.app`, persists to `mf_sidebar_collapsed` in localStorage
- `restoreSidebarState()` — reads `mf_sidebar_collapsed` on startup and restores state
- CSS drives all visual changes: `.app.sidebar-collapsed .sidebar { transform: translateX(-230px); }` and `.app.sidebar-collapsed .main { margin-left: 0; }`

### Collapsible navigation

The sidebar nav is grouped into four top-level sections (`overview`, `transactions`, `debt`, `planning`), each a `.nav-group` with id `navg-{key}`.

- `toggleNavGroup(key)` — toggles `.collapsed` class on the group. CSS rule `.nav-group.collapsed .nav-group-items { display: none; }` handles visibility. State persisted to `mf_nav_state` (`{key: bool}`).
- `restoreNavState()` — restores all group and subgroup collapse states on startup.
- The Debt section has two independently collapsible subsections (`navg-sub-creditcards`, `navg-sub-loans`) toggled via `toggleNavSubgroup(key)`. Persisted under `sub-creditcards` / `sub-loans` keys inside `mf_nav_state`.
- **Pure CSS-class approach** — no `style.display` manipulation in JS for nav collapse. JS only adds/removes the `.collapsed` class.

### Navigation / page model

Pages are `<section class="page" id="page-{name}">` elements. Only one is `active` at a time. `navigate(page)` activates the section and calls the render function:

```js
const renders = {
  dashboard: renderDashboard,
  oneoff: renderOneoffList,
  recurring: () => { renderRecurringTable(); renderUpcomingTimeline(); },
  cashflow: renderCashflow,
  credit: renderCardList,
  cctransactions: renderCCTransactions,
  calculators: () => {},   // static page, no render needed
  deals: renderDealsPage,
  loans: renderLoansPage
};
```

`navigate()` also fires a `page_viewed` PostHog event.

Adding a new page requires: (1) sidebar nav item, (2) `<section id="page-{name}">` in `<main>`, (3) entry in the `renders` map, (4) `renderXxx()` function. If the new page uses date inputs, add it to `setDefaultDates()`.

### Data model

All state is module-level `let` variables, loaded once on startup, saved via `saveData()` after every mutation.

| Variable | `localStorage` key | Shape |
|---|---|---|
| `incomeData` | `mf_income` | `[{id, date, category, amount, description}]` |
| `expenseData` | `mf_expenses` | same as income |
| `recurringData` | `mf_recurring` | `[{id, type, name, category, amount, frequency, startDate, endDate}]` |
| `creditCards` | `mf_cards` | `[{id, name, balance, apr, minType, minPct, minFloor, minFixed}]` |
| `interestFreeDeals` | `mf_deals` | `[{id, cardId, amount, startDate, endDate, note}]` |
| `ccTransactions` | `mf_cc_transactions` | `[{id, cardId, date, amount, category, description, type}]` where `type` is `'charge'` or `'payment'` |
| `loansData` | `mf_loans` | `[{id, lender, totalAmount, repaymentAmount, apr, frequency, startDate, endDate, note}]` |

**Other localStorage keys (not financial data):**

| Key | Purpose |
|---|---|
| `mf_launched` | `'1'` once user has clicked "Launch App" — hides landing overlay on return visits |
| `mf_sidebar_collapsed` | `'1'` if sidebar is collapsed, `'0'` if expanded |
| `mf_nav_state` | JSON object `{overview: bool, transactions: bool, debt: bool, planning: bool, 'sub-creditcards': bool, 'sub-loans': bool}` |

**IDs** are always `Date.now()` integers. **Dates** are always `YYYY-MM-DD` strings; always parse with `new Date(ds + 'T00:00:00')` to avoid timezone shifts.

`saveData()` must be called after every mutation to any financial data variable. It writes all seven arrays to `localStorage` in one pass.

#### Data migration

`ccTransactions` was split from a legacy `mf_cc_payments` key. A self-invoking migration function at startup absorbs any old entries and removes the stale key. When adding new fields to existing objects, follow the same pattern: load with a `.map(x => ({ ...x, newField: x.newField ?? default }))` default.

### PostHog analytics

PostHog EU Cloud is initialised in `<head>` with key `phc_yRHinZkin9DDzssWX3jiQMrFcCdgY3QKzFQtw45z3vYS`. All capture calls are guarded with `if (window.posthog)` so they fail silently if the script is blocked.

| Event | Fired in | Properties |
|---|---|---|
| `page_viewed` | `navigate()` | `page` |
| `transaction_added` | `addOneoff()` | `type`, `category` |
| `recurring_added` | `addRecurring()` | `type`, `frequency`, `category` |
| `card_saved` | `saveCard()` | `is_edit`, `min_type` |
| `loan_saved` | `saveLoan()` | `is_edit`, `frequency` |
| `cashflow_viewed` | `renderCashflow()` | `months` |
| `cc_transaction_added` | `addCCTransaction()` | `type`, `category` |
| `js_error` | `window.onerror` / `onunhandledrejection` | `message`, `source`, `line`, `stack` |

### Cashflow projection engine (`generateProjection`, line ~967)

Produces one row per month by rolling card balances forward. Order of operations per month is critical:

1. Recurring income → `recInc`
2. Recurring expenses → `recExp`
3. One-off income from `incomeData` → `oneOffInc`
4. One-off expenses from `expenseData` → `oneOffExp`
5. **CC charges** (`ccTransactions` where `type !== 'payment'`) → increase `card.balance`
6. **CC payments** (`ccTransactions` where `type === 'payment'`) → decrease `card.balance`; also added to `oneOffExp` / `oneOffExpItems` (cash outflow)
7. Interest + minimum payment for each card → `ccTotal`
8. `net = recInc + oneOffInc - recExp - oneOffExp - ccTotal`

Steps 5 and 6 happen **before** interest (step 7) so payments/charges affect that month's interest calculation. Do not reorder.

Interest-free deals are handled by `getInterestFreeAmount(cardId, monthStart)`, which returns the total 0% amount active on that card in that month. Interest is charged only on `balance - ifAmount`.

### Key UI patterns

**Inline row editing** — a `let editingXxxId = null` flag causes the render function to emit `<input>` / `<select>` elements with `data-field="..."` attributes for the row being edited, instead of plain text. The save function reads them back via `row.querySelector('[data-field="..."]')`. See `renderCCTransactions` / `saveCCTEdit` for the canonical implementation.

**Type toggles** — Income/Expense or Charge/Payment pairs use `.toggle-btn.income` / `.toggle-btn.expense` CSS classes. Active state is toggled with `.classList.toggle('active', condition)`. The active styling is already in CSS — do not add inline styles for the active state.

**Filter tabs** — Built dynamically in the render function (not in HTML). Pattern: `'All'` tab plus one tab per card/entity. Active tab stored in a `let currentXxxFilter` module-level variable.

**Toasts** — `toast(msg)` for all user feedback. 2.5 s auto-dismiss.

**Read-only merged rows** — CC payments appear in the One-off Transactions list as read-only rows (no delete button, has a badge linking back to the source page). Flag with `_ccPayment: true` on the merged object. Check `r._ccPayment` in the render to conditionally render the action cell.

### CSS conventions

All colours use hex literals (no CSS variables for theme colours yet). Key classes:

- `.badge-income` green, `.badge-expense` red, `.badge-freq` purple, `.badge-oneoff` amber, `.badge-card` light purple
- `.btn-sm-ghost` neutral action, `.btn-sm-danger` destructive action
- `.cct-edit-input` — shared style for all inline edit inputs/selects
- `.cf-positive` / `.cf-negative` / `.cf-zero` — cashflow table number colouring
- `.no-cards-notice` — amber warning box used when a section requires cards to be set up first
- `lp-*` classes — landing page overlay only; all prefixed `lp-` to avoid collisions with app styles

### JS section locations (approximate line numbers)

| Section | ~Line |
|---|---|
| DATA + saveData | 827 |
| NAVIGATION | 859 |
| HELPERS (fmt, toast, dates) | 884 |
| DEALS helper (getInterestFreeAmount) | 916 |
| RECURRING date generation | 933 |
| CASHFLOW ENGINE (generateProjection) | 967 |
| DASHBOARD | 1087 |
| ONE-OFF TRANSACTIONS | 1137 |
| RECURRING | 1227 |
| CASHFLOW RENDER | 1298 |
| CREDIT CARDS | 1369 |
| 0% DEALS | 1468 |
| LOANS | 1621 |
| CALCULATORS | 1754 |
| CARD TRANSACTIONS | 1815 |
| COLLAPSIBLE NAV (toggleSidebar, toggleNavGroup, toggleNavSubgroup, restoreNavState) | 1981 |
| LANDING PAGE (launchApp, checkFirstVisit) | 2028 |
| INIT | 2048 |

Use `grep -n "^//  "` to find the current line of any section quickly (double-space after `//`).

## Efficient editing approach

1. **Grep before reading** — use `grep -n "functionName\|id=\"element-id\""` to locate the exact lines needed before calling Read.
2. **Read targeted ranges** — pass `offset` + `limit` to Read; avoid reading the whole file (it exceeds the single-read token limit).
3. **Edit surgically** — prefer small `Edit` calls over large rewrites. When replacing a function, match on the full function signature + first line so the `old_string` is unique.
4. **Verify with grep** — after adding a new data variable or function, grep to confirm no stale references to old names remain.
5. **Don't trust bash line counts** — the bash sandbox mount is frequently stale. Use `Read` with known offsets to verify actual file content.
