// ══════════════════════════════════════════════════
//  Finaura E2E DB Sync Tests
//  Tests that UI actions correctly sync data to Supabase.
//  Requires: TEST_USER_PASSWORD env var (GitHub secret)
//  Test user: test@finaura.app (email/password auth in Supabase)
// ══════════════════════════════════════════════════
const { test, expect } = require('@playwright/test');
const { createClient }  = require('@supabase/supabase-js');

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
let testCardId; // card created in beforeAll, used by deal + CC txn tests

// ── Setup & teardown ──────────────────────────────
test.beforeAll(async () => {
  if (!TEST_PASSWORD) throw new Error('TEST_USER_PASSWORD env var is not set');

  client = createClient(SUPABASE_URL, SUPABASE_KEY);
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
  await page.click('button[onclick="addRecurring()"]');

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
