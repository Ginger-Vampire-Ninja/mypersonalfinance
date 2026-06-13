// ══════════════════════════════════════════════════
//  Finaura E2E DB Sync Tests
//  Tests that UI actions correctly sync data to Supabase.
//  Requires: TEST_USER_PASSWORD env var (GitHub secret)
//  Test user: test@finaura.app (email/password auth in Supabase)
// ══════════════════════════════════════════════════
const { test, expect } = require('@playwright/test');
const { createClient }  = require('@supabase/supabase-js');
const ws               = require('ws');

const SUPABASE_URL  = 'https://acqiduorpzwwegzaijdc.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_BNdn9Z-B74oF3XrRZlu-Rw_ePCyaU2f';
const STORAGE_KEY   = 'sb-acqiduorpzwwegzaijdc-auth-token';
const TEST_EMAIL    = 'test@finaura.app';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD;

// Run tests sequentially so credit card exists before deal/CC txn tests
test.describe.configure({ mode: 'serial' });

let client;
let testUserId;
let sessionJson;
let testCardId;       // card created in beforeAll, used by deal + CC txn tests
let testCurrentAccId; // current account created in beforeAll, used by transfer test
let testSavingsAccId; // savings account created in beforeAll, used by transfer test

// ── Setup & teardown ──────────────────────────────
test.beforeAll(async () => {
  if (!TEST_PASSWORD) throw new Error('TEST_USER_PASSWORD env var is not set');

  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: { transport: ws }
  });
  const { data, error } = await client.auth.signInWithPassword({
    email:    TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (error) throw new Error('Test user sign-in failed: ' + error.message);

  testUserId  = data.user.id;
  sessionJson = JSON.stringify(data.session);

  // Create a prerequisite credit card directly via API so deal + CC txn tests
  // don't depend on the credit card UI test passing first.
  testCardId = Date.now();
  const { error: cardErr } = await client.from('credit_cards').insert({
    id:        testCardId,
    user_id:   testUserId,
    name:      'E2E Prereq Card',
    balance:   1000,
    apr:       22.9,
    min_type:  'percent',
    min_pct:   2,
    min_floor: 25,
    min_fixed: null,
  });
  if (cardErr) throw new Error('Failed to create prereq card: ' + cardErr.message);

  // Create prereq accounts so savings transfer test has selectable from/to accounts
  testCurrentAccId = Date.now() + 10;
  testSavingsAccId  = Date.now() + 11;
  const { error: accErr } = await client.from('accounts').insert([
    { id: testCurrentAccId, user_id: testUserId, name: 'E2E Prereq Current',
      type: 'current', balance: 1000, interest_rate: null, note: null },
    { id: testSavingsAccId,  user_id: testUserId, name: 'E2E Prereq Savings',
      type: 'savings', balance: 500,  interest_rate: 3.5,  note: null },
  ]);
  if (accErr) throw new Error('Failed to create prereq accounts: ' + accErr.message);
});

test.afterAll(async () => {
  if (!client || !testUserId) return;
  // Delete all test data for this user so the DB stays clean
  await Promise.all([
    client.from('income').delete().eq('user_id', testUserId),
    client.from('expenses').delete().eq('user_id', testUserId),
    client.from('recurring').delete().eq('user_id', testUserId),
    client.from('promo_deals').delete().eq('user_id', testUserId),
    client.from('cc_transactions').delete().eq('user_id', testUserId),
    client.from('credit_cards').delete().eq('user_id', testUserId),
    client.from('loans').delete().eq('user_id', testUserId),
    client.from('savings_transfers').delete().eq('user_id', testUserId),
    client.from('accounts').delete().eq('user_id', testUserId),
  ]);
  await client.auth.signOut();
});

// ── Helper: inject session + navigate to app ──────
async function loadApp(page) {
  // Inject the auth session into localStorage before the page script runs
  await page.addInitScript(({ key, json }) => {
    localStorage.setItem(key, json);
  }, { key: STORAGE_KEY, json: sessionJson });

  await page.goto('https://finaura.app');
  // Wait for the app shell to be ready (landing overlay hidden)
  await page.waitForFunction(
    () => document.getElementById('landing-overlay')?.classList.contains('hidden'),
    { timeout: 15000 }
  );
}

// ── Tests ─────────────────────────────────────────

test('recurring transaction syncs to DB', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => navigate('recurring'));
  await page.waitForSelector('#rec-name', { state: 'visible' });

  await page.fill('#rec-name', 'E2E Salary');
  await page.fill('#rec-amount', '2500');
  // Start date is pre-filled; leave frequency as Monthly
  await page.click('#rec-save-btn');

  await page.waitForTimeout(2000); // allow async dbUpsert to complete

  const { data, error } = await client
    .from('recurring').select('*')
    .eq('user_id', testUserId).eq('name', 'E2E Salary');
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(parseFloat(data[0].amount)).toBe(2500);
});

test('one-off income syncs to DB', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => navigate('oneoff'));
  await page.waitForSelector('#oneoff-amount', { state: 'visible' });

  await page.click('#oneoff-toggle-income');
  await page.fill('#oneoff-amount', '500');
  await page.fill('#oneoff-description', 'E2E Income Test');
  await page.click('button[onclick="addOneoff()"]');

  await page.waitForTimeout(2000);

  const { data, error } = await client
    .from('income').select('*')
    .eq('user_id', testUserId).eq('description', 'E2E Income Test');
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(parseFloat(data[0].amount)).toBe(500);
});

test('one-off expense syncs to DB', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => navigate('oneoff'));
  await page.waitForSelector('#oneoff-amount', { state: 'visible' });

  await page.click('#oneoff-toggle-expense');
  await page.fill('#oneoff-amount', '75');
  await page.fill('#oneoff-description', 'E2E Expense Test');
  await page.click('button[onclick="addOneoff()"]');

  await page.waitForTimeout(2000);

  const { data, error } = await client
    .from('expenses').select('*')
    .eq('user_id', testUserId).eq('description', 'E2E Expense Test');
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(parseFloat(data[0].amount)).toBe(75);
});

test('credit card syncs to DB', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => navigate('credit'));
  await page.waitForSelector('#cc-name', { state: 'visible' });

  await page.fill('#cc-name', 'E2E Visa Test');
  await page.fill('#cc-balance', '2000');
  await page.fill('#cc-apr', '19.9');
  await page.fill('#cc-min-pct', '2');
  await page.fill('#cc-min-floor', '25');
  await page.click('button[onclick="saveCard()"]');

  await page.waitForTimeout(2000);

  const { data, error } = await client
    .from('credit_cards').select('*')
    .eq('user_id', testUserId).eq('name', 'E2E Visa Test');
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(parseFloat(data[0].balance)).toBe(2000);
});

test('promo deal syncs to DB', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => navigate('deals'));
  await page.waitForSelector('#deal-amount', { state: 'visible' });

  await page.selectOption('#deal-card-id', { value: String(testCardId) });
  await page.fill('#deal-amount', '500');
  await page.fill('#deal-end', '2026-12-31');
  await page.fill('#deal-note', 'E2E Deal Test');
  await page.click('button[onclick="saveDeal()"]');

  await page.waitForTimeout(2000);

  const { data, error } = await client
    .from('promo_deals').select('*')
    .eq('user_id', testUserId).eq('note', 'E2E Deal Test');
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(parseFloat(data[0].amount)).toBe(500);
});

test('CC transaction syncs to DB', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => navigate('cctransactions'));
  await page.waitForSelector('#cct-amount', { state: 'visible' });

  await page.selectOption('#cct-card', { value: String(testCardId) });
  await page.fill('#cct-amount', '99.99');
  await page.fill('#cct-description', 'E2E CC Txn Test');
  await page.click('button[onclick="addCCTransaction()"]');

  await page.waitForTimeout(2000);

  const { data, error } = await client
    .from('cc_transactions').select('*')
    .eq('user_id', testUserId).eq('description', 'E2E CC Txn Test');
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(parseFloat(data[0].amount)).toBe(99.99);
});

test('loan syncs to DB', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => navigate('loans'));
  await page.waitForSelector('#loan-lender', { state: 'visible' });

  await page.fill('#loan-lender', 'E2E Test Bank');
  await page.fill('#loan-total', '10000');
  await page.fill('#loan-repayment', '250');
  await page.click('button[onclick="saveLoan()"]');

  await page.waitForTimeout(2000);

  const { data, error } = await client
    .from('loans').select('*')
    .eq('user_id', testUserId).eq('lender', 'E2E Test Bank');
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(parseFloat(data[0].total_amount)).toBe(10000);
});

test('current account syncs to DB', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => navigate('accounts'));
  await page.waitForSelector('#acc-name', { state: 'visible' });

  await page.fill('#acc-name', 'E2E Current Account');
  await page.fill('#acc-balance', '3000');
  // Type defaults to 'current' — leave as-is
  await page.click('button[onclick="saveAccount()"]');

  await page.waitForTimeout(2000);

  const { data, error } = await client
    .from('accounts').select('*')
    .eq('user_id', testUserId).eq('name', 'E2E Current Account');
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(data[0].type).toBe('current');
  expect(parseFloat(data[0].balance)).toBe(3000);
});

test('savings transfer syncs to DB', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => navigate('accounts'));
  await page.waitForSelector('#acc-name', { state: 'visible' });

  // Switch to Transfers tab so the from/to selects are populated
  await page.click('#page-accounts .tab:has-text("Transfers")');
  await page.waitForSelector('#acc-transfer-from', { state: 'visible' });

  // Wait for the prereq accounts to populate the dropdowns
  await page.waitForFunction(
    id => document.querySelector(`#acc-transfer-from option[value="${id}"]`) !== null,
    testCurrentAccId
  );

  await page.selectOption('#acc-transfer-from', { value: String(testCurrentAccId) });
  await page.selectOption('#acc-transfer-to',   { value: String(testSavingsAccId) });
  await page.fill('#acc-transfer-amount', '200');
  await page.selectOption('#acc-transfer-frequency', { value: 'monthly' });
  await page.fill('#acc-transfer-start', new Date().toISOString().split('T')[0]);
  await page.click('button[onclick="saveTransfer()"]');

  await page.waitForTimeout(2000);

  const { data, error } = await client
    .from('savings_transfers').select('*')
    .eq('user_id', testUserId)
    .eq('from_account_id', testCurrentAccId)
    .eq('to_account_id',   testSavingsAccId);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(parseFloat(data[0].amount)).toBe(200);
  expect(data[0].frequency).toBe('monthly');
});

// ══════════════════════════════════════════════════
//  Dashboard & Cashflow Calculation Tests
//
//  These tests verify that the app correctly calculates
//  and displays figures across all transaction types.
//
//  Known test data inserted via API (not UI):
//    - Current account:   £5,000 balance (seeds cashflow running total)
//    - Recurring income:  £3,000/month
//    - Recurring expense: £800/month
//    - One-off income:    £500
//    - One-off expense:   £200
//    - Credit card:       £1,000 balance, 24% APR, 2% min (£25 floor)
//    - CC charge:         £100 this month
//    - CC payment:        £50  this month
//    - Loan repayment:    £200/month
//
//  Expected dashboard:
//    income = £500, expenses = £200, balance = £300, rec net = +£2,200
//
//  Expected cashflow month 1:
//    recInc=£3,000 | recExp=£1,000 | oneOffInc=£500
//    oneOffExp=£250 (£200 + £50 CC payment) | ccMin=£25
//    net = £2,225 | running = £7,225 (£5,000 seed + £2,225) | card balance after = £1,046
// ══════════════════════════════════════════════════
test.describe('Dashboard and Cashflow calculations', () => {
  const today = new Date().toISOString().split('T')[0];
  let calcCardId;

  test.beforeAll(async () => {
    // Clear ALL test user data so previous sync tests don't affect figures
    await Promise.all([
      client.from('income').delete().eq('user_id', testUserId),
      client.from('expenses').delete().eq('user_id', testUserId),
      client.from('recurring').delete().eq('user_id', testUserId),
      client.from('promo_deals').delete().eq('user_id', testUserId),
      client.from('cc_transactions').delete().eq('user_id', testUserId),
      client.from('credit_cards').delete().eq('user_id', testUserId),
      client.from('loans').delete().eq('user_id', testUserId),
      client.from('savings_transfers').delete().eq('user_id', testUserId),
      client.from('accounts').delete().eq('user_id', testUserId),
    ]);

    const base = Date.now();
    calcCardId = base;

    // Insert card first (FK dependency for CC transactions)
    const { error: cardErr } = await client.from('credit_cards').insert({
      id: calcCardId, user_id: testUserId, name: 'Calc Test Card',
      balance: 1000, apr: 24, min_type: 'percent', min_pct: 2, min_floor: 25, min_fixed: null,
    });
    if (cardErr) throw new Error('Failed to insert calc card: ' + cardErr.message);

    // Insert a £5,000 current account — seeds the cashflow running total
    const { error: accErr } = await client.from('accounts').insert({
      id: base + 20, user_id: testUserId, name: 'Calc Current Account',
      type: 'current', balance: 5000, interest_rate: null, note: null,
    });
    if (accErr) throw new Error('Failed to insert calc account: ' + accErr.message);

    const inserts = await Promise.all([
      client.from('recurring').insert({ id: base+1, user_id: testUserId, type: 'income',
        name: 'Calc Salary', category: 'Salary', amount: 3000, frequency: 'monthly',
        start_date: today, end_date: null }),
      client.from('recurring').insert({ id: base+2, user_id: testUserId, type: 'expense',
        name: 'Calc Rent', category: 'Housing', amount: 800, frequency: 'monthly',
        start_date: today, end_date: null }),
      client.from('income').insert({ id: base+3, user_id: testUserId,
        date: today, category: 'Bonus', amount: 500, description: 'Calc One-off Income' }),
      client.from('expenses').insert({ id: base+4, user_id: testUserId,
        date: today, category: 'Other', amount: 200, description: 'Calc One-off Expense' }),
      client.from('cc_transactions').insert({ id: base+5, user_id: testUserId,
        card_id: calcCardId, date: today, amount: 100, category: 'Shopping',
        description: 'Calc CC Charge', type: 'charge' }),
      client.from('cc_transactions').insert({ id: base+6, user_id: testUserId,
        card_id: calcCardId, date: today, amount: 50, category: 'CC Payment',
        description: 'Calc CC Payment', type: 'payment' }),
      client.from('loans').insert({ id: base+7, user_id: testUserId,
        lender: 'Calc Bank', total_amount: 5000, repayment_amount: 200,
        apr: null, frequency: 'monthly', start_date: today, end_date: null, note: null }),
    ]);

    const failed = inserts.find(r => r.error);
    if (failed) throw new Error('Failed to insert calc test data: ' + failed.error.message);
  });

  test('dashboard totals are correct across all transaction types', async ({ page }) => {
    await loadApp(page);
    await page.waitForSelector('#dash-income', { state: 'visible' });

    const income       = await page.$eval('#dash-income',        el => el.textContent.trim());
    const expenses     = await page.$eval('#dash-expenses',      el => el.textContent.trim());
    const balance      = await page.$eval('#dash-balance',       el => el.textContent.trim());
    const recurringNet = await page.$eval('#dash-recurring-net', el => el.textContent.trim());

    expect(income).toBe('£500.00');         // one-off income only
    expect(expenses).toBe('£200.00');       // one-off expense only (CC payments excluded)
    expect(balance).toBe('£300.00');        // 500 - 200
    expect(recurringNet).toBe('+£2,200.00'); // 3,000 - 800 (loans not in recurring net KPI)
  });

  test('cashflow month 1 is correct including recurring, one-offs, CC and loan', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => navigate('cashflow'));
    await page.waitForSelector('#cf-table-body tr', { state: 'visible' });

    const row = await page.$eval('#cf-table-body tr:first-child', tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.replace(/\s+/g, '').trim());
      return {
        recInc:    cells[1],  // Rec. Income
        oneOffInc: cells[2],  // One-off Inc.
        recExp:    cells[3],  // Rec. Expenses (includes loan repayment)
        oneOffExp: cells[4],  // One-off Exp. (includes CC payment cash outflow)
        ccMin:     cells[5],  // CC Payments (minimum payment after interest)
        net:       cells[6],  // Net Cashflow
        running:   cells[7],  // Running Total
      };
    });

    // Recurring income: £3,000/month salary
    expect(row.recInc).toBe('£3,000.00');

    // One-off income: £500
    expect(row.oneOffInc).toBe('£500.00');

    // Recurring expenses: £800 recurring + £200 loan = £1,000
    expect(row.recExp).toBe('£1,000.00');

    // One-off expenses: £200 (expense) + £50 (CC payment cash outflow) = £250
    expect(row.oneOffExp).toBe('£250.00');

    // CC minimum payment:
    //   balance 1,000 + 100 (charge) - 50 (payment) = 1,050
    //   interest = 1,050 × 24%/12 = 21 → balance = 1,071
    //   min = max(1,071 × 2%, 25) = 25
    expect(row.ccMin).toBe('£25.00');

    // Net = 3,000 + 500 - 1,000 - 250 - 25 = £2,225
    expect(row.net).toBe('+£2,225.00');

    // Running total = current account seed (£5,000) + net (£2,225) = £7,225
    expect(row.running).toBe('+£7,225.00');
  });

  test('cashflow card tracker shows correct balance after CC activity and interest', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => navigate('cashflow'));
    await page.waitForSelector('#cf-card-tracker-panel', { state: 'visible' });

    // Month 1 card balance: 1,000 + 100 (charge) - 50 (payment) + 21 (interest) - 25 (min) = £1,046
    const cardBalance = await page.$eval('#cf-card-tracker-table tbody tr:first-child td:nth-child(2)',
      el => el.textContent.trim());

    expect(cardBalance).toBe('£1,046.00');
  });
});
