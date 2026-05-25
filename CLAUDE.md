# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Single-file personal finance web app called **Finaura**: **one file, `index.html`, ~2,050 lines**. No framework, no build step, no dependencies except optional CDN scripts. Deployed to GitHub Pages as-is. All data persists in `localStorage`. Open the file directly in a browser to test — no server needed.

## Git workflow

Feature branches → PR into `main` → GitHub Pages auto-deploys from `main`. Branch protection is on: never commit directly to `main`. Branch naming convention: `feature/` or `fix/` prefix.

```bash
# View current branch
git branch

# Always verify branch before editing
git status
```

## Architecture

The entire app lives in `index.html` in three logical blocks:

1. **CSS** (`<style>`, lines ~8–178) — all styles inline, no external stylesheet
2. **HTML** (`<body>`, lines ~180–560) — sidebar + `<main>` containing all page `<section>` elements
3. **JavaScript** (`<script>`, lines ~561–end) — all logic inline

### Navigation / page model

Pages are `<section class="page" id="page-{name}">` elements. Only one is `active` at a time (CSS `display: none` / `display: block`). Switching pages is done via `navigate(page)`, which activates the section and calls the corresponding render function from a map:

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

Adding a new page requires: (1) sidebar nav item, (2) `<section id="page-{name}">` in `<main>`, (3) entry in the `renders` map, (4) `renderXxx()` function. If the new page is in a nav subsection, also add it to `setDefaultDates()` if it uses date inputs.

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

**IDs** are always `Date.now()` integers. **Dates** are always `YYYY-MM-DD` strings; always parse with `new Date(ds + 'T00:00:00')` to avoid timezone shifts.

`saveData()` must be called after every mutation to any data variable. It writes all seven arrays to `localStorage` in one pass.

#### Data migration

`ccTransactions` was split from a legacy `mf_cc_payments` key. A self-invoking migration function at startup absorbs any old entries and removes the stale key. When adding new fields to existing objects, follow the same pattern: load with a `.map(x => ({ ...x, newField: x.newField ?? default }))` default.

### Cashflow projection engine (`generateProjection`, line ~700)

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

### JS section locations (approximate line numbers)

| Section | ~Line |
|---|---|
| DATA + saveData | 662 |
| NAVIGATION | 694 |
| HELPERS (fmt, toast, dates) | 718 |
| DEALS helper (getInterestFreeAmount) | 750 |
| RECURRING date generation | 767 |
| CASHFLOW ENGINE (generateProjection) | 801 |
| DASHBOARD | 921 |
| ONE-OFF TRANSACTIONS | 971 |
| RECURRING | 1060 |
| CASHFLOW RENDER | 1130 |
| CREDIT CARDS | 1200 |
| 0% DEALS | 1298 |
| LOANS | 1451 |
| CALCULATORS | 1582 |
| CARD TRANSACTIONS | 1643 |
| COLLAPSIBLE NAV | 1808 |
| INIT (restoreNavState, setDefaultDates, renderDashboard) | 1838 |

Use `grep -n "//  SECTION NAME"` to find the current line of any section quickly.

### Collapsible navigation

The sidebar nav is grouped into four top-level sections (`overview`, `transactions`, `debt`, `planning`), each a `.nav-group` with id `navg-{key}`. `toggleNavGroup(key)` toggles the `.collapsed` class and sets `style.display` on the inner `.nav-group-items` div. `restoreNavState()` reads the `mf_nav_state` localStorage key (`{key: bool}`) and restores collapse state on startup — it is called as the first line of the INIT block. The Debt section contains two subsections (Credit Cards, Loans) which are also independently collapsible via `toggleNavSubgroup(key)` with ids `navg-sub-creditcards` and `navg-sub-loans`, persisted under the same `mf_nav_state` key.

## Efficient editing approach

1. **Grep before reading** — use `grep -n "functionName\|id=\"element-id\""` to locate the exact lines needed before calling Read.
2. **Read targeted ranges** — pass `offset` + `limit` to Read; avoid reading the whole file.
3. **Edit surgically** — prefer small `Edit` calls over large rewrites. When replacing a function, match on the full function signature + first line so the `old_string` is unique.
4. **Verify with grep** — after adding a new data variable or function, grep to confirm no stale references to old names remain.
