# CLAUDE.md

This file provides guidance to Claude when working with code in this repository.

> **Standing instruction — E2E tests:** After completing any code change, always consider whether `tests/e2e.spec.js` needs updating. Specifically: if a new data type or Supabase table is added, a new test block is needed. If a form field ID, button selector, or table name changes, the relevant test must be updated to match. If a mutation function is added or renamed, check whether it's covered. Raise this proactively — don't wait to be asked.

> **Standing instruction — Public-facing pages:** After adding or changing any feature, always assess whether `index.html` (landing page) and `tour.html` need updating. Specifically: if a new feature is added, consider whether it warrants a new feature card on the landing page, a new section in tour.html, or an update to the FAQ. If an existing feature is renamed, changed in scope, or removed, update any copy that references it. If a new export, configuration option, or supported currency is added, check the FAQ answers. Raise this proactively — don't wait to be asked.

## Project overview

Personal finance web app called **Finaura**, live at **https://finaura.app**. The app is split across three files — `index.html`, `styles.css`, and `app.js` (~1940 lines). No framework, no build step. Dependencies: PostHog (CDN), Supabase JS v2 (self-hosted as `supabase.min.js`), optional Google AdSense. Deployed to GitHub Pages with a custom domain.

Users can sign in with Google or GitHub (data syncs to Supabase cloud DB) or use the app as a guest (data stays in `localStorage` only). Both modes work simultaneously — `saveData()` always writes to `localStorage`; `dbUpsert`/`dbDelete` additionally sync to Supabase when `currentUser` is set.

**Important:** Google AdSense is loaded conditionally via a dynamic `<script>` injection guarded by `location.hostname === 'finaura.app'`. Do not revert this to a static `<script async src="...">` tag — AdSense contains an infinite loop that hangs the page on `file://` URLs (local dev).

**Important:** OAuth (`signInWithGoogle`, `signInWithGitHub`) redirects to `https://finaura.app` — it will not complete on `file://` or local file URLs. Test auth on the live site or a local HTTP server.

## Repository files

| File | Purpose |
|---|---|
| `index.html` | HTML shell — `<head>` with PostHog init, Supabase self-hosted script, AdSense script, favicon; all `<section>` page markup; links to `styles.css` and `app.js` |
| `supabase.min.js` | Self-hosted Supabase JS v2 UMD bundle — served from same origin to bypass browser tracking prevention (Edge blocks CDN-loaded Supabase from accessing storage) |
| `styles.css` | All app styles — layout, sidebar, cards, tables, forms, cashflow colours, landing overlay, auth box, account menu |
| `app.js` | All JavaScript — data model, Supabase auth/data layer, navigation, render functions, event handlers, INIT |
| `favicon.svg` | Browser tab icon — teal rounded square with white F letterform and mint sparkline |
| `legal.html` | Terms of Service and Privacy Policy (standalone page) |
| `tour.html` | Feature tour (standalone public page) — SVG UI mockups for each major feature, linked from the landing page nav and hero |
| `og-image.svg` | 1200×630 Open Graph image for social sharing previews |
| `sitemap.xml` | XML sitemap submitted to Google Search Console |
| `robots.txt` | Allows all crawlers, points to sitemap |
| `ads.txt` | Google AdSense verification file |
| `CNAME` | Custom domain config (`finaura.app`) for GitHub Pages |
| `CLAUDE.md` | This file |
| `package.json` | Dev dependencies for E2E tests (Playwright, Supabase JS, ws) |
| `playwright.config.js` | Playwright configuration — targets `https://finaura.app`, chromium only |
| `tests/e2e.spec.js` | E2E DB sync tests — signs in as test user, adds data via UI, verifies rows in Supabase |
| `.github/workflows/e2e.yml` | GitHub Actions workflow — runs E2E tests after every Pages deploy or manual trigger |
| `.gitignore` | Excludes `node_modules/`, `playwright-report/`, `test-results/` |

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

- **`index.html`** — `<head>` contains: meta/SEO/Open Graph tags, PostHog init snippet, `<script src="supabase.min.js">` (self-hosted), Google AdSense script, `<link rel="icon" href="favicon.svg">`, and `<link rel="stylesheet" href="styles.css">`. `<body>` has the landing overlay (with `.lp-auth-box` Google sign-in UI), top-right `#account-menu` div, sidebar, migration banner (`#migration-banner`), and all `<section class="page">` elements. Ends with `<script src="app.js"></script>` just before `</body>`. **PostHog, Supabase, and AdSense scripts must stay in `index.html` `<head>` — never move them to `app.js`.**
- **`styles.css`** — all styles. Teal sidebar (`#0F766E`), mint accent `#2DD4BF`, auth box (`lp-auth-box`), account menu (`.account-menu*`), migration banner, dark mode block (`html[data-theme="dark"] ...`), semantic colour utility classes.
- **`app.js`** (~1520 lines) — all JS logic. Sections are marked with `//  SECTION NAME` (double-space after `//`) for easy grepping.

### PostHog analytics

PostHog EU Cloud init snippet stays in `index.html` `<head>` — **never move it to `app.js`**. Key: `phc_yRHinZkin9DDzssWX3jiQMrFcCdgY3QKzFQtw45z3vYS`, host: `https://eu.i.posthog.com`. All capture calls in `app.js` are guarded with `if (window.posthog)` so they fail silently if the script is blocked.

| Event | Fired in | Properties |
|---|---|---|
| `page_viewed` | `navigate()` | `page` |
| `transaction_added` | `addOneoff()` | `type`, `category` |
| `recurring_added` | `saveRecurring()` (add path only) | `type`, `frequency`, `category` |
| `card_saved` | `saveCard()` | `is_edit`, `min_type` |
| `loan_saved` | `saveLoan()` | `is_edit`, `frequency` |
| `cashflow_viewed` | `renderCashflow()` | `months` |
| `cc_transaction_added` | `addCCTransaction()` | `type`, `category` |
| `account_saved` | `saveAccount()` | `is_edit`, `type` (`'current'` or `'savings'`) |
| `transfer_saved` | `saveTransfer()` | `is_edit`, `frequency` |
| `signin_overlay_opened` | `showSignInOverlay()` | `trigger` (`'guest_btn'`) |
| `dark_mode_toggled` | `toggleDarkMode()` | `theme` (`'dark'` or `'light'`) |
| `js_error` | `window.onerror` / `onunhandledrejection` | `message`, `source`, `line`, `col`, `stack` |

### Supabase auth & cloud database

Supabase project: `https://acqiduorpzwwegzaijdc.supabase.co`. The publishable key is in `app.js` (safe to expose client-side). Row Level Security (RLS) is enabled on all tables — every row has a `user_id` column and policies restrict access to the owner only.

```js
const { createClient: _sbCreate } = window.supabase;
const db = _sbCreate('https://acqiduorpzwwegzaijdc.supabase.co', 'sb_publishable_...');
let currentUser = null;
```

**Auth flow:**
1. `signInWithGoogle()` / `signInWithGitHub()` — calls `db.auth.signInWithOAuth({ provider: 'google'|'github', options: { redirectTo: 'https://finaura.app' } })`. Redirects away then back with `#access_token=…` in the URL hash (implicit grant flow).
2. **OAuth callback** — INIT detects `#access_token=` in the hash and registers `onAuthStateChange` **first** (before `getSession()`). In this Supabase build, the token exchange fires `SIGNED_IN` via the listener rather than being processed by `getSession()`. `_initApp()` runs from the listener.
3. **Returning user / page refresh** — no hash in URL, so INIT calls `getSession()` first (reads the session from localStorage without side-effects). If session found, `_initApp()` runs directly; `onAuthStateChange` is registered afterwards for future sign-out events. **Do not register `onAuthStateChange` before `getSession()` in this path** — it triggers an internal Supabase `initialize()` that fires a premature `SIGNED_OUT`, wiping localStorage before `getSession()` can read it.
4. `_initApp(user)` — shared helper: sets `currentUser`, `_applyCurrencyFromUser`, `loadUserData()`, hides landing overlay, updates UI, re-renders.
5. On sign-out (`signOut()`), `SIGNED_OUT` fires. The handler guards with `if (!currentUser) return` to ignore the spurious `SIGNED_OUT` that Supabase fires on initialisation before a session is established. Actual sign-out reloads the page.
6. `checkFirstVisit()` is only called when `getSession()` returns no session (new guest user).

**DB tables** (snake_case columns) vs **JS objects** (camelCase):

| Table | Key mapping functions |
|---|---|
| `income` | `toDbIncome` / `fromDbIncome` |
| `expenses` | `toDbIncome` / `fromDbIncome` (same shape) |
| `recurring` | `toDbRecurring` / `fromDbRecurring` (`startDate` ↔ `start_date`, `endDate` ↔ `end_date`, `activeMonths` ↔ `active_months`) — **requires `active_months JSONB DEFAULT NULL` column** |
| `credit_cards` | `toDbCard` / `fromDbCard` (`minType` ↔ `min_type`, `creditLimit` ↔ `credit_limit`) — **requires `credit_limit NUMERIC DEFAULT NULL` column** (run migration before deploying) |
| `promo_deals` | `toDbDeal` / `fromDbDeal` (`cardId` ↔ `card_id`) — renamed from `interest_free_deals` to avoid ad blocker URL blocking |
| `cc_transactions` | `toDbCCT` / `fromDbCCT` (`cardId` ↔ `card_id`) |
| `loans` | `toDbLoan` / `fromDbLoan` (`totalAmount` ↔ `total_amount`, etc.) |
| `accounts` | `toDbAccount` / `fromDbAccount` (`interestRate` ↔ `interest_rate`) |
| `savings_transfers` | `toDbTransfer` / `fromDbTransfer` (`fromAccountId` ↔ `from_account_id`, `toAccountId` ↔ `to_account_id`) |

**Generic helpers:**
- `dbUpsert(table, jsObj, toDbFn)` — no-op if `currentUser` is null (guest mode). Adds `user_id` automatically.
- `dbDelete(table, id)` — no-op if `currentUser` is null.

**Every mutation function calls both `saveData()` (localStorage) and `dbUpsert`/`dbDelete` (Supabase).** Guest users only get the localStorage write; signed-in users get both. This means the app works fully offline/without an account at all times.

**Migration banner** — after first sign-in, if `localStorage` still has financial data, `showMigrationBanner()` shows `#migration-banner`. `migrateFromLocalStorage()` upserts everything to Supabase (cards first, due to FK constraints from deals/transactions), then clears the localStorage keys. `dismissMigration()` hides the banner and sets `mf_migration_dismissed`.

### Account menu (top-right)

When signed in, a fixed `#account-menu` div appears at top-right of the page (`.account-menu`). It shows the user's Google avatar (or initials) and first name. Clicking opens a dropdown (`.account-menu-dropdown.open`) with:
- Name + email header
- Default currency (Soon placeholder)
- Preferences (Soon placeholder)
- Sign out (danger style)

`updateUserUI()` in `app.js` drives all of this. When signed out, the menu is hidden.

`toggleAccountMenu()` handles open/close, and `_closeAccountMenu()` is registered as a one-time `document` click listener to close on outside click.

### Landing page overlay

A full-screen `<div id="landing-overlay">` sits at the top of `<body>`, before `<div class="app">`. The hero contains a `.lp-auth-box` with:
- Google sign-in button (`.btn-google-signin`) — calls `signInWithGoogle()`
- "or" divider (`.lp-auth-divider`)
- "Continue without account" button (`.btn-continue-guest`) — calls `launchApp()`
- Privacy note (`.lp-auth-note`)

`checkFirstVisit()` hides the overlay if `mf_launched` is set or financial data already exists. It is only called from INIT when there is **no active Supabase session** — signed-in users bypass it via the async auth init.

`launchApp()` sets `mf_launched = '1'` and hides the overlay (guest path).

### Public-facing pages

Three standalone pages are visible to unauthenticated visitors and are indexed by Google. These must be kept in sync with app features.

#### `index.html` — Landing page overlay (`#landing-overlay`)

Structure (top to bottom):

| Section | Element | Content |
|---|---|---|
| Nav | `.lp-nav` | Logo, "See how it works" link → `tour.html`, "Sign in — Free" CTA |
| Hero | `.lp-hero` | Headline, sub-copy, sign-in auth box, "See features ↓" + "Take a tour →" buttons |
| How it works | `.lp-how` | 3-step onboarding flow (add recurring → add cards/loans → see cashflow) |
| Features | `.lp-features` | 6 feature cards: Cashflow Forecasting, Credit Card Tracker, Recurring Transactions, Loan Management, One-off Transactions, Debt Calculators |
| Trust | `.lp-trust` | Privacy/data model explanation, 4 trust pills |
| FAQ | `.lp-faq` | 6 Q&As: cost, account requirement, data safety, bank connections, currencies, CSV export |
| Final CTA | `.lp-final-cta` | Sign-in button + guest link |
| Footer | `.lp-footer` | Copyright, Tour link, Terms & Privacy link |

**When to update:** add a feature card if a new major feature ships; update FAQ answers if currency support, export formats, or privacy model changes; update the "How it works" steps if the onboarding flow changes significantly.

#### `tour.html` — Feature tour

Standalone dark-themed page at `https://finaura.app/tour.html`. Linked from the landing page nav, hero, and footer. Contains five feature sections in alternating layout (text + SVG UI mockup):

1. **Cashflow Forecasting** — month-by-month projection table mockup
2. **Recurring Transactions** — table with income/expense badges, months badge
3. **Credit Card Tracker** — three cards with green/amber/red utilisation bars
4. **One-off Transactions** — mixed future/historical entries table
5. **Loan Management** — two loan cards with balances and repayment details

**When to update:** add a new section if a significant new feature ships; update the SVG mockup and bullet points for any feature that changes visually or in scope; update the bottom CTA copy if the pricing/account model changes. SVG mockups are inline in `tour.html` — edit the `<svg viewBox="...">` block inside the relevant `.mockup` div.

### Sidebar collapse

The entire sidebar can be toggled via a `☰` button (`.sidebar-toggle`).

- `toggleSidebar()` — toggles `.sidebar-collapsed` on `.app`, persists to `mf_sidebar_collapsed`
- `restoreSidebarState()` — reads `mf_sidebar_collapsed` on startup
- CSS drives all visual changes: `.app.sidebar-collapsed .sidebar { transform: translateX(-230px); }` and `.app.sidebar-collapsed .main { margin-left: 0; }`

### Collapsible navigation

Four top-level `.nav-group` sections (`navg-overview`, `navg-transactions`, `navg-debt`, `navg-planning`). Debt section has two independently collapsible subsections (`navg-sub-creditcards`, `navg-sub-loans`).

- `toggleNavGroup(key)` / `toggleNavSubgroup(key)` — toggle `.collapsed` class. State persisted to `mf_nav_state`.
- `restoreNavState()` — restores all states on startup.
- **Pure CSS-class approach** — JS only toggles `.collapsed`; CSS rule `.nav-group.collapsed .nav-group-items { display: none; }` drives visibility.

### Navigation / page model

Pages are `<section class="page" id="page-{name}">` elements. `navigate(page)` activates one and calls its render function:

```js
const renders = {
  dashboard:      renderDashboard,
  oneoff:         renderOneoffList,
  recurring:      () => { renderRecurringTable(); renderUpcomingTimeline(); },
  cashflow:       renderCashflow,
  credit:         renderCardList,
  cctransactions: renderCCTransactions,
  calculators:    () => {},
  deals:          renderDealsPage,
  loans:          renderLoansPage,
  accounts:       renderAccountsPage,
};
```

Adding a new page requires: (1) sidebar nav item in `index.html`, (2) `<section id="page-{name}">` in `index.html` `<main>`, (3) entry in the `renders` map, (4) `renderXxx()` function in `app.js`. If the page uses date inputs, add it to `setDefaultDates()`.

### Data model

All state is module-level `let` variables, loaded from `localStorage` on startup (or replaced by `loadUserData()` if signed in). `saveData()` writes all seven arrays to `localStorage` after every mutation.

| Variable | `localStorage` key | Shape |
|---|---|---|
| `incomeData` | `mf_income` | `[{id, date, category, amount, description}]` |
| `expenseData` | `mf_expenses` | same as income |
| `recurringData` | `mf_recurring` | `[{id, type, name, category, amount, frequency, startDate, endDate, activeMonths}]` — `activeMonths` is `number[] \| null` (0=Jan…11=Dec); null means all months |
| `creditCards` | `mf_cards` | `[{id, name, balance, apr, minType, minPct, minFloor, minFixed, creditLimit}]` — `creditLimit` is optional (null if not set) |
| `interestFreeDeals` | `mf_deals` | `[{id, cardId, amount, startDate, endDate, note}]` |
| `ccTransactions` | `mf_cc_transactions` | `[{id, cardId, date, amount, category, description, type}]` where `type` is `'charge'` or `'payment'` |
| `loansData` | `mf_loans` | `[{id, lender, totalAmount, repaymentAmount, apr, frequency, startDate, endDate, note}]` |
| `accountsData` | `mf_accounts` | `[{id, name, type: 'current'\|'savings', balance, interestRate, note}]` |
| `savingsTransfers` | `mf_savings_transfers` | `[{id, fromAccountId, toAccountId, amount, frequency, startDate, endDate, note}]` — frequency includes `'one-off'` |

**Other localStorage keys:**

| Key | Purpose |
|---|---|
| `mf_launched` | `'1'` once user clicks "Continue without account" — hides landing overlay on return guest visits |
| `mf_sidebar_collapsed` | `'1'` if sidebar collapsed |
| `mf_nav_state` | JSON `{overview, transactions, debt, planning, 'sub-creditcards', 'sub-loans': bool}` |
| `mf_dark_mode` | `'dark'` or `'light'` |
| `mf_migration_dismissed` | `'1'` once migration banner is dismissed — prevents it showing again |
| `mf_currency` | `'GBP'`, `'USD'`, or `'EUR'` — selected display currency (defaults to GBP) |

**IDs** are always `Date.now()` integers. **Dates** are always `YYYY-MM-DD` strings; always parse with `new Date(ds + 'T00:00:00')` to avoid timezone shifts.

### Dark mode

- `toggleDarkMode()` — flips `html[data-theme="dark"]` attribute, saves to `mf_dark_mode`, fires PostHog event, updates button.
- `restoreDarkMode()` — called first in INIT.
- **Critical — inline `style.color` bypasses dark mode.** Never use `element.style.color = '#hex'` or `style="color:#hex"` for data-bearing colours. Always use semantic utility classes.

**Semantic colour utility classes** (defined at end of `styles.css`, with `html[data-theme="dark"]` overrides):

| Class | Light | Dark | Usage |
|---|---|---|---|
| `.text-income` | `#16a34a` | `#10B981` | Income amounts |
| `.text-expense` | `#dc2626` | `#f87171` | Expense amounts |
| `.text-muted` | `#888` | `#64748b` | Secondary text |
| `.text-muted-sm` | `#888 / 0.82rem` | `#64748b` | Small secondary text |
| `.text-cc` | `#7c3aed` | `#a78bfa` | Credit card amounts |
| `.value-pos` | `#0F766E` | `#2DD4BF` | Positive net values |
| `.value-neg` | `#dc2626` | `#f87171` | Negative net values |
| `.text-paid-off` | `#16a34a bold` | `#34D399` | Card tracker "✓ Paid off" |
| `.text-deal-active` | `#065f46 bold` | `#34D399` | Card tracker 0% deal cells |
| `.dash-trend-pos` | `#10B981` | `#10B981` | Dashboard trend — positive |
| `.dash-trend-neg` | `#ef4444` | `#f87171` | Dashboard trend — negative |

### Dashboard KPI cards

`renderDashboard()` uses:
- `getMonthTotals(data, nMonths)` — monthly totals array (oldest → newest)
- `buildSparkline(values, color)` — inline SVG polyline (colour passed directly, not via CSS)
- `trendBadge(curr, prev, lowerIsBetter)` — `<span class="dash-trend dash-trend-pos/neg">` string

Each KPI card has `.card-kpi-row` (value + sparkline) and `.card-kpi-footer` (count + trend badge).

### Cashflow projection engine (`generateProjection`, ~line 318 in `app.js`)

Rolls card balances forward month by month. Order per month is critical:

1. Recurring income → `recInc`
2. Recurring expenses + loan repayments → `recExp`
3. One-off income from `incomeData` → `oneOffInc`
4. One-off expenses from `expenseData` → `oneOffExp`
5. **CC charges** (`type !== 'payment'`) → increase `card.balance`
6. **CC payments** (`type === 'payment'`) → decrease `card.balance`; added to `oneOffExp` (cash outflow)
7. Interest + minimum payment per card → `ccTotal`
8. `net = recInc + oneOffInc - recExp - oneOffExp - ccTotal`

Steps 5 and 6 happen **before** interest (step 7). Do not reorder.

### Key UI patterns

- **Inline row editing** — `let editingXxxId = null` flag causes render to emit `<input data-field="...">` for that row. Save reads back via `row.querySelector('[data-field="..."]')`. See `renderCCTransactions` / `saveCCTEdit`.
- **Type toggles** — `.toggle-btn.income` / `.toggle-btn.expense`. Active state via `.classList.toggle('active', condition)`.
- **Filter tabs** — built dynamically in render functions. Active tab in `let currentXxxFilter`.
- **Toasts** — `toast(msg)` for all feedback. 2.5 s auto-dismiss.
- **Read-only merged rows** — CC payments appear in One-off list as read-only rows (`_ccPayment: true` flag).

### CSS conventions

Sidebar teal (`#0F766E`), mint accent `#2DD4BF`. Key classes:

- `.nav-dot` — mint dot in nav headers; fades when group collapsed
- `.badge-income/.badge-expense/.badge-freq/.badge-oneoff/.badge-card/.badge-upcoming` — type badges
- `.btn-sm-ghost` neutral, `.btn-sm-danger` destructive
- `.cct-edit-input` — inline edit inputs/selects
- `.cf-positive/.cf-negative/.cf-zero` — cashflow table colouring
- `.no-cards-notice` — amber warning box
- `.panel-info/.panel-info-title/.panel-info-body` — info panel (0% Deals page)
- `.dark-toggle` — sidebar footer dark mode button
- `lp-*` — landing page overlay only
- `.lp-auth-box` — hero sign-in card (dark glass style matching landing overlay)
- `.btn-google-signin` — white Google button (follows Google branding guidelines)
- `.btn-github-signin` — dark GitHub button (`#24292e` background, white text/icon)
- `.btn-continue-guest` — ghost button for no-account path
- `.migration-banner` — amber banner shown post sign-in when localStorage data exists
- `.account-menu` / `.account-menu-btn` / `.account-menu-dropdown` — fixed top-right account dropdown (has dark mode overrides)
- `.acc-account-item` — account card row in the accounts list
- `.acc-account-info` — left side of account row (name + sub-text)
- `.acc-account-name` — account display name
- `.acc-account-sub` — account sub-text (type label or note)
- `.acc-account-balance` — right-aligned balance figure
- `.acc-rate-badge` — teal pill showing interest rate on savings accounts
- Semantic colour utility classes — see **Dark mode** section. Always use instead of inline `style="color:#..."`.

### JS section locations in `app.js` (approximate line numbers)

| Section | ~Line |
|---|---|
| DATA + saveData | 2 |
| SUPABASE (client, field mapping, dbUpsert/dbDelete, loadUserData, auth, updateUserUI, migration) | 33 |
| NAVIGATION | 166 |
| HELPERS (fmt, toast, dates, getMonthTotals, buildSparkline, trendBadge) | 199 |
| DEALS helper (getInterestFreeAmount) | 266 |
| RECURRING date generation | 283 |
| CASHFLOW ENGINE (generateProjection) | 318 |
| DASHBOARD | 437 |
| ONE-OFF TRANSACTIONS | 499 |
| RECURRING | 589 |
| CASHFLOW RENDER | 661 |
| CREDIT CARDS | 731 |
| 0% DEALS | 831 |
| LOANS | 983 |
| CALCULATORS | 1116 |
| CARD TRANSACTIONS | 1177 |
| ACCOUNTS | 1589 |
| COLLAPSIBLE NAV | 1343 |
| DARK MODE | 1389 |
| LANDING PAGE (launchApp, checkFirstVisit) | 1413 |
| INIT | 1898 |

Use `grep -n "^//  "` on `app.js` to find the current line of any section quickly (double-space after `//`).

## E2E regression tests

Playwright tests live in `tests/e2e.spec.js` and verify that every data type syncs correctly from the UI to Supabase after a deploy.

**Test user:** `test@finaura.app` (email/password auth in Supabase, confirmed via SQL). Password stored as `TEST_USER_PASSWORD` GitHub secret.

**How tests work:**
1. Sign in programmatically via Supabase `signInWithPassword`
2. Inject the session into `localStorage` (`sb-acqiduorpzwwegzaijdc-auth-token`) before page load using `page.addInitScript`
3. Navigate to `https://finaura.app` — app detects session and skips landing overlay
4. Interact with each page's form to add a test record
5. Query Supabase directly to assert the row exists with correct values
6. `afterAll` deletes all rows for the test user so the DB stays clean

**Tables covered:** `income`, `expenses`, `recurring`, `credit_cards`, `promo_deals`, `cc_transactions`, `loans`, `accounts`, `savings_transfers` — **9 DB sync tests** plus 3 calc suite tests (12 total).

**Prerequisite records** are inserted directly via the Supabase API in `beforeAll` so later tests don't depend on earlier UI tests passing:
- `E2E Prereq Card` — credit card used by the promo deal and CC transaction tests
- `E2E Prereq Current` + `E2E Prereq Savings` — current and savings accounts used by the savings transfer test; the current account is also inserted by the calc suite `beforeAll` (seeded at £5,000) so the running-total assertion (`+£7,225.00`) is predictable

`afterAll` cleans all rows for the test user across all nine tables, including `savings_transfers` and `accounts`.

**Running locally:**
```bash
npm install
npx playwright install chromium
TEST_USER_PASSWORD=xxx npm run test:e2e
```

**CI trigger:** `deployment_status` event (fires after every successful GitHub Pages deploy) plus `workflow_dispatch` for manual runs. The `deployment_status` event fires multiple times per deploy — only the `state == 'success'` event runs the job; others are skipped. This causes multiple workflow entries in the Actions tab which is expected.

**Important:** `promo_deals` was renamed from `interest_free_deals` — ad blockers (McAfee WebAdvisor etc.) block HTTP requests whose URL contains "interest", silently preventing Supabase upserts. Always avoid table/field names containing financial ad-targeting keywords (`interest`, `free`, `deal`, `offer`) in Supabase table names used from the browser.

## Efficient editing approach

1. **Grep before reading** — use `grep -n "functionName\|id=\"element-id\""` on the relevant file to locate exact lines before calling Read.
2. **Read targeted ranges** — pass `offset` + `limit` to Read; avoid reading the whole file.
3. **Edit surgically** — prefer small `Edit` calls over large rewrites.
4. **Verify with grep** — after adding a new variable or function, grep to confirm no stale references remain.
5. **Don't trust bash line counts** — the bash sandbox mount is frequently stale. Use `Read` with known offsets to verify actual file content.
