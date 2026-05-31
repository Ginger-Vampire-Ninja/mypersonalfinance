# Finaura Release Notes

---

## v2.0.0 — Cloud Sync & Account Features
*Released: 31 May 2026*

### ✨ New Features

**Google Sign-In & Cloud Sync**
Users can now sign in with their Google account. All financial data (income, expenses, recurring transactions, credit cards, loans, CC transactions and 0% deals) syncs to a secure cloud database in real time. Data persists across devices and survives browser cache clearing. Guest mode (no account) continues to work exactly as before — data stays in localStorage only.

**Account Menu**
A new account menu appears in the top-right corner when signed in, showing the user's Google avatar and first name. The dropdown provides access to:
- Signed-in user name and email
- Currency selector (see below)
- Sign out

**Currency Selector**
Users can now switch between GBP (£), USD ($) and EUR (€) from the account menu. All amounts across the app update instantly. The preference persists across sessions.

**Data Migration**
Users with existing localStorage data are shown a one-click import banner after signing in for the first time, allowing them to move their data to the cloud without losing anything.

**Landing Page**
The landing page hero now offers a Google sign-in option alongside the existing "Continue without account" path. The privacy/trust section has been updated to accurately reflect both guest (fully local) and signed-in (cloud sync) modes.

---

### 🐛 Bug Fixes

- **Loans showing £NaN** — fixed a field mapping bug in `fromDbLoan` where `total_amount` and `repayment_amount` were being read with incorrect camelCase names from the database response.
- **Calendar icon invisible in dark mode** — date input fields now use `color-scheme: dark` so the native browser calendar icon renders correctly in dark mode.
- **Duplicate Supabase script** — removed a duplicate CDN script tag that was causing initialisation issues.
- **0% Deals not syncing in Chrome** — the `interest_free_deals` table has been renamed to `promo_deals` to prevent ad blockers (e.g. McAfee WebAdvisor) from silently blocking HTTP requests containing the word "interest".

---

### 🎨 UI Improvements

- **Sidebar toggle button** — replaced the `☰` character with a clean SVG icon that switches between a hamburger (sidebar open) and a chevron › (sidebar collapsed). Button is slightly larger with a subtle shadow and better spacing from the sidebar edge.
- **Auth box styling** — the landing page sign-in box now uses a dark glass style that matches the landing overlay colour scheme, replacing the white box that clashed with the dark background.

---

### 🔧 Infrastructure

- **Self-hosted Supabase JS** — the Supabase JavaScript library is now served from `finaura.app` directly rather than a CDN, preventing Edge's tracking prevention from blocking it.
- **E2E regression tests** — Playwright tests added covering all 7 data types (recurring, income, expense, credit card, promo deal, CC transaction, loan). Tests run automatically after every GitHub Pages deployment via GitHub Actions and verify that UI actions correctly sync data to the Supabase database.
- **ads.txt** — Google AdSense verification file added to the repository root.

---

## v1.0.0 — Initial Launch
*Released: May 2026*

Core personal finance app with localStorage-based data persistence. Features include: Dashboard with KPI cards and sparklines, One-off income & expense tracking, Recurring transactions, Cashflow projection engine (12–24 months), Credit card tracker with APR and minimum payment modelling, 0% interest-free deal tracking, CC transaction management, Loan management, Debt calculators, Dark mode, Collapsible sidebar navigation.
