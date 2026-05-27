# CLAUDE.md

This file provides guidance to Claude when working with code in this repository.

## Project overview

Personal finance web app called **Finaura**, live at **https://finaura.app**. The app is split across three files — `index.html`, `styles.css`, and `app.js` (~1318 lines). No framework, no build step, no dependencies except PostHog (CDN) and optional CDN scripts. Deployed to GitHub Pages with a custom domain. All financial data persists in `localStorage`. Open `index.html` directly in a browser to test locally — no server needed.

**Important:** Google AdSense is loaded conditionally via a dynamic `<script>` injection guarded by `location.hostname === 'finaura.app'`. Do not revert this to a static `<script async src="...">` tag — AdSense contains an infinite loop that hangs the page on `file://` URLs (local dev).

## Repository files

| File | Purpose |
|---|---|
| `index.html` | Lean HTML shell — `<head>` with PostHog init, AdSense script, favicon link, inline SVG logo; all `<section>` page markup; links to `styles.css` and `app.js` |
| `styles.css` | All app styles — layout, sidebar, cards, tables, forms, cashflow colours, landing overlay |
| `app.js` | All JavaScript — data model, navigation, render functions, event handlers, INIT |
| `favicon.svg` | Browser tab icon — teal rounded square with white F letterform and mint sparkline |
| `legal.html` | Terms of Service and Privacy Policy (standalone page) |
| `og-image.svg` | 1200×630 Open Graph image for social sharing previews |
| `sitemap.xml` | XML sitemap submitted to Google Search Console |
| `robots.txt` | Allows all crawlers, points to sitemap |
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

**Important:** The bash sandbox mount of the repo is often stale — it may reflect older versions of `index.html`, `styles.css`, and `app.js`. Always use the `Read` tool (not bash `cat` or `wc -l`) to read the real current file content and get accurate line numbers.

## Architecture

The app is split into three files served by GitHub Pages:

- **`index.html`** — `<head>` contains: meta/SEO/Open Graph tags, PostHog init snippet, Google AdSense script, `<link rel="icon" href="favicon.svg">`, and `<link rel="stylesheet" href="styles.css">`. `<body>` has the landing overlay (including inline SVG logo in `.lp-logo`), sidebar (with inline SVG logo in `.sidebar-logo`), and all `<section class="page">` elements. Ends with `<script src="app.js"></script>` just before `</body>`. **PostHog and AdSense scripts must stay in `index.html` `<head>` — never move them to `app.js`.**
- **`styles.css`** — all styles. Teal sidebar (`#0F766E`), card depth, cashflow cell colours, landing overlay (`lp-*` classes), dark mode block (`html[data-theme="dark"] ...`), semantic colour utility classes.
- **`app.js`** (~1318 lines) — all JS logic. Sections are marked with `//  SECTION NAME` (double-space after `//`) for easy grepping.

### PostHog analytics

PostHog EU Cloud init snippet stays in `index.html` `<head>` — **never move it to `app.js`**. Key: `phc_yRHinZkin9DDzssWX3jiQMrFcCdgY3QKzFQtw45z3vYS`, host: `https://eu.i.posthog.com`. All capture calls in `app.js` are guarded with `if (window.posthog)` so they fail silently if the script is blocked.

| Event | Fired in | Properties |
|---|---|---|
| `page_viewed` | `navigate()` | `page` |
| `transaction_added` | `addOneoff()` | `type`, `category` |
| `recurring_added` | `addRecurring()` | `type`, `frequency`, `category` |
| `card_saved` | `saveCard()` | `is_edit`, `min_type` |
| `loan_saved` | `saveLoan()` | `is_edit`, `frequency` |
| `cashflow_viewed` | `renderCashflow()` | `months` |
| `cc_transaction_added` | `addCCTransaction()` | `type`, `category` |
| `dark_mode_toggled` | `toggleDarkMode()` | `theme` (`'dark'` or `'light'`) |
| `js_error` | `window.onerror` / `onunhandledrejection` | `message`, `source`, `line`, `stack` |

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

The sidebar nav is grouped into four top-level sections (`overview`, `transactions`, `debt`, `planning`), each a `.nav-group` with id `navg-{key}`. Adjacent groups are separated by a subtle rule via `.nav-group + .nav-group { border-top: 1px solid rgba(255,255,255,0.1); }`.

- `toggleNavGroup(key)` — toggles `.collapsed` class on the group. CSS rule `.nav-group.collapsed .nav-group-items { display: none; }` handles visibility. State persisted to `mf_nav_state` (`{key: bool}`).
- `restoreNavState()` — restores all group and subgroup collapse states on startup.
- The Debt section has two independently collapsible subsections (`navg-sub-creditcards`, `navg-sub-loans`) toggled via `toggleNavSubgroup(key)`. Persisted under `sub-creditcards` / `sub-loans` keys inside `mf_nav_state`.
- **Pure CSS-class approach** — no `style.display` manipulation in JS for nav collapse. JS only adds/removes the `.collapsed` class.
- **Mint dot indicator** — each `.nav-section` and `.nav-subsection` contains `<span class="nav-dot"></span>`. CSS sets it mint (`#2DD4BF`) when expanded, faded white (`rgba(255,255,255,0.3)`) when the group is collapsed.

Current nav item labels (sidebar `index.html`): Dashboard · Recurring · One-off · Manage Credit Cards · Manage Transactions · Manage 0% Periods · Calculators · Manage Loans · Cashflow.

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

Adding a new page requires: (1) sidebar nav item in `index.html`, (2) `<section id="page-{name}">` in `index.html` `<main>`, (3) entry in the `renders` map in `app.js`, (4) `renderXxx()` function in `app.js`. If the new page uses date inputs, add it to `setDefaultDates()`.

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
| `mf_dark_mode` | `'dark'` or `'light'` — persists dark mode preference across sessions |

**IDs** are always `Date.now()` integers. **Dates** are always `YYYY-MM-DD` strings; always parse with `new Date(ds + 'T00:00:00')` to avoid timezone shifts.

`saveData()` must be called after every mutation to any financial data variable. It writes all seven arrays to `localStorage` in one pass.

#### Data migration

`ccTransactions` was split from a legacy `mf_cc_payments` key. A self-invoking migration function at startup absorbs any old entries and removes the stale key. When adding new fields to existing objects, follow the same pattern: load with a `.map(x => ({ ...x, newField: x.newField ?? default }))` default.

### Dark mode

Dark mode is toggled via `html[data-theme="dark"]` attribute on `<html>` (`document.documentElement`).

- `toggleDarkMode()` — flips the attribute, saves preference to `mf_dark_mode` in localStorage, fires PostHog `dark_mode_toggled`, updates the button icon/label.
- `restoreDarkMode()` — called first in INIT (before `checkFirstVisit`). Reads `mf_dark_mode` and restores theme and button state.
- The toggle button lives in `.sidebar-footer` in `index.html`: `<button class="dark-toggle" onclick="toggleDarkMode()">`.
- **CSS rule structure**: the dark mode block in `styles.css` uses `html[data-theme="dark"] .selector { ... }` selectors. Semantic utility classes (`.text-income`, `.value-pos`, etc.) have their dark overrides placed **after** the main dark mode block so cascade order makes them win over any general rules like `html[data-theme="dark"] .bar-value { color: #E2E8F0; }`.

**Critical — inline `style.color` bypasses dark mode.** Never use `element.style.color = '#hex'` or template `style="color:#hex"` for data-bearing colours. These set inline styles with the highest CSS specificity and cannot be overridden by class-based dark mode rules. Always use semantic utility classes instead.

**Semantic colour utility classes** (defined at end of `styles.css`, with `html[data-theme="dark"]` overrides for each):

| Class | Light | Dark | Usage |
|---|---|---|---|
| `.text-income` | `#16a34a` | `#10B981` | Income amounts, income summary figures |
| `.text-expense` | `#dc2626` | `#f87171` | Expense amounts, expense summary figures |
| `.text-muted` | `#888` | `#64748b` | Secondary text, descriptions |
| `.text-muted-sm` | `#888 / 0.82rem` | `#64748b` | Small secondary text, dates, notes |
| `.text-cc` | `#7c3aed` | `#a78bfa` | Credit card amounts, CC-related values |
| `.value-pos` | `#0F766E` | `#2DD4BF` | Positive net values |
| `.value-neg` | `#dc2626` | `#f87171` | Negative net values |
| `.text-paid-off` | `#16a34a bold` | `#34D399` | Card tracker "✓ Paid off" cells |
| `.text-deal-active` | `#065f46 bold` | `#34D399` | Card tracker cells with active 0% deal |
| `.dash-trend-pos` | `#10B981` | `#10B981` | Dashboard trend badge — positive |
| `.dash-trend-neg` | `#ef4444` | `#f87171` | Dashboard trend badge — negative |

### Dashboard KPI cards

`renderDashboard()` calls three helpers for the sparkline/trend row:

- `getMonthTotals(data, nMonths)` — returns an array of `nMonths` monthly totals (oldest → newest) from an income or expense array.
- `buildSparkline(values, color)` — returns an inline SVG polyline string. Takes a colour hex directly (sparklines are SVG strokes, not affected by dark mode CSS class rules).
- `trendBadge(curr, prev, lowerIsBetter)` — returns a `<span class="dash-trend dash-trend-pos/neg">` string comparing the last two months.

Each KPI card has a `.card-kpi-row` (value + sparkline side-by-side) and a `.card-kpi-footer` (count + trend badge).

### Cashflow projection engine (`generateProjection`, line ~184 in `app.js`)

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

All colours use hex literals (no CSS variables for theme colours yet). Sidebar is teal (`#0F766E`), mint accent `#2DD4BF`. Key classes:

- `.nav-dot` — mint dot in nav section/subsection headers; fades to white when group is collapsed
- `.badge-income` green, `.badge-expense` red, `.badge-freq` purple, `.badge-oneoff` amber, `.badge-card` light purple, `.badge-upcoming` blue
- `.btn-sm-ghost` neutral action, `.btn-sm-danger` destructive action
- `.cct-edit-input` — shared style for all inline edit inputs/selects
- `.cf-positive` / `.cf-negative` / `.cf-zero` — cashflow table number colouring
- `.no-cards-notice` — amber warning box used when a section requires cards to be set up first
- `.panel-info` / `.panel-info-title` / `.panel-info-body` — info panel on the 0% Deals page (has dark mode overrides)
- `.dark-toggle` — sidebar footer dark mode toggle button
- `lp-*` classes — landing page overlay only; all prefixed `lp-` to avoid collisions with app styles
- Semantic colour utility classes — see the **Dark mode** section above for the full table. Always use these instead of inline `style="color:#..."` for any data-bearing colour.

### JS section locations in `app.js` (approximate line numbers)

| Section | ~Line |
|---|---|
| DATA + saveData | 2 |
| NAVIGATION | 34 |
| HELPERS (fmt, toast, dates, getMonthTotals, buildSparkline, trendBadge) | 59 |
| DEALS helper (getInterestFreeAmount) | 133 |
| RECURRING date generation | 149 |
| CASHFLOW ENGINE (generateProjection) | 184 |
| DASHBOARD | 304 |
| ONE-OFF TRANSACTIONS | 364 |
| RECURRING | 453 |
| CASHFLOW RENDER | 524 |
| CREDIT CARDS | 596 |
| 0% DEALS | 696 |
| LOANS | 848 |
| CALCULATORS | 981 |
| CARD TRANSACTIONS | 1042 |
| COLLAPSIBLE NAV (toggleSidebar, toggleNavGroup, toggleNavSubgroup, restoreNavState) | 1208 |
| DARK MODE (toggleDarkMode, restoreDarkMode) | 1254 |
| LANDING PAGE (launchApp, checkFirstVisit) | 1280 |
| INIT | 1300 |

Use `grep -n "^//  "` on `app.js` to find the current line of any section quickly (double-space after `//`).

## Efficient editing approach

1. **Grep before reading** — use `grep -n "functionName\|id=\"element-id\""` on the relevant file (`app.js`, `styles.css`, or `index.html`) to locate the exact lines needed before calling Read.
2. **Read targeted ranges** — pass `offset` + `limit` to Read; avoid reading the whole file.
3. **Edit surgically** — prefer small `Edit` calls over large rewrites. When replacing a function, match on the full function signature + first line so the `old_string` is unique.
4. **Verify with grep** — after adding a new data variable or function, grep to confirm no stale references to old names remain.
5. **Don't trust bash line counts** — the bash sandbox mount is frequently stale. Use `Read` with known offsets to verify actual file content in `index.html`, `styles.css`, and `app.js`.
