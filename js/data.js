// ══════════════════════════════════════════════════
//  DATA LAYER  (js/data.js)
//  - Supabase client
//  - In-memory data stores (loaded from localStorage or Supabase)
//  - camelCase ↔ snake_case field mappers
//  - Generic dbUpsert / dbDelete helpers
//  - loadUserData (bulk fetch on sign-in)
//  - saveData (localStorage snapshot)
//
//  Imports: toast from helpers.js (zero other deps)
//  Exports: everything — consumed by app.js
// ══════════════════════════════════════════════════
import { toast } from './helpers.js';

// ── Supabase client ──────────────────────────────
const _sbCreate = (window.supabase || {}).createClient;
export const db = _sbCreate
  ? _sbCreate('https://acqiduorpzwwegzaijdc.supabase.co', 'sb_publishable_BNdn9Z-B74oF3XrRZlu-Rw_ePCyaU2f')
  : null;

// ── Mutable auth state ───────────────────────────
export let currentUser = null;
export function setCurrentUser(u) { currentUser = u; }

// ── Data stores (initialized from localStorage) ──
export let incomeData        = JSON.parse(localStorage.getItem('mf_income')            || '[]');
export let expenseData       = JSON.parse(localStorage.getItem('mf_expenses')          || '[]');
export let recurringData     = JSON.parse(localStorage.getItem('mf_recurring')         || '[]');
export let creditCards       = JSON.parse(localStorage.getItem('mf_cards')             || '[]');
export let interestFreeDeals = JSON.parse(localStorage.getItem('mf_deals')             || '[]');
// Load CC transactions, defaulting legacy entries (no type field) to 'charge'
export let ccTransactions    = JSON.parse(localStorage.getItem('mf_cc_transactions')   || '[]')
  .map(t => ({ ...t, type: t.type || 'charge' }));
export let loansData         = JSON.parse(localStorage.getItem('mf_loans')             || '[]');
export let accountsData      = JSON.parse(localStorage.getItem('mf_accounts')          || '[]');
export let savingsTransfers  = JSON.parse(localStorage.getItem('mf_savings_transfers') || '[]');

// ── Setters (used by app.js when filtering / replacing arrays) ──
export function setIncomeData(v)        { incomeData        = v; }
export function setExpenseData(v)       { expenseData       = v; }
export function setRecurringData(v)     { recurringData     = v; }
export function setCreditCards(v)       { creditCards       = v; }
export function setInterestFreeDeals(v) { interestFreeDeals = v; }
export function setCCTransactions(v)    { ccTransactions    = v; }
export function setLoansData(v)         { loansData         = v; }
export function setAccountsData(v)      { accountsData      = v; }
export function setSavingsTransfers(v)  { savingsTransfers  = v; }

// One-time migration: absorb any entries saved under the old separate CC payments key
(function migrateCCPayments() {
  const old = JSON.parse(localStorage.getItem('mf_cc_payments') || '[]');
  if (!old.length) return;
  old.forEach(p => {
    if (!ccTransactions.find(t => t.id === p.id))
      ccTransactions.push({ ...p, type: 'payment', category: 'CC Payment' });
  });
  localStorage.removeItem('mf_cc_payments');
  localStorage.setItem('mf_cc_transactions', JSON.stringify(ccTransactions));
})();

// ── Persist to localStorage ──────────────────────
export function saveData() {
  localStorage.setItem('mf_income',             JSON.stringify(incomeData));
  localStorage.setItem('mf_expenses',           JSON.stringify(expenseData));
  localStorage.setItem('mf_recurring',          JSON.stringify(recurringData));
  localStorage.setItem('mf_cards',              JSON.stringify(creditCards));
  localStorage.setItem('mf_deals',              JSON.stringify(interestFreeDeals));
  localStorage.setItem('mf_cc_transactions',    JSON.stringify(ccTransactions));
  localStorage.setItem('mf_loans',              JSON.stringify(loansData));
  localStorage.setItem('mf_accounts',           JSON.stringify(accountsData));
  localStorage.setItem('mf_savings_transfers',  JSON.stringify(savingsTransfers));
}

// ── Field mapping (camelCase JS ↔ snake_case DB) ─
export function toDbIncome(r)      { return { id: r.id, date: r.date, category: r.category, amount: r.amount, description: r.description || null }; }
export function fromDbIncome(r)    { return { id: r.id, date: r.date, category: r.category, amount: parseFloat(r.amount), description: r.description }; }
export function toDbRecurring(r)   { return { id: r.id, type: r.type, name: r.name, category: r.category, amount: r.amount, frequency: r.frequency, start_date: r.startDate, end_date: r.endDate || null, active_months: r.activeMonths || null }; }
export function fromDbRecurring(r) { return { id: r.id, type: r.type, name: r.name, category: r.category, amount: parseFloat(r.amount), frequency: r.frequency, startDate: r.start_date, endDate: r.end_date, activeMonths: r.active_months || null }; }
export function toDbCard(c)        { return { id: c.id, name: c.name, balance: c.balance, apr: c.apr, min_type: c.minType, min_pct: c.minPct || null, min_floor: c.minFloor || null, min_fixed: c.minFixed || null, credit_limit: c.creditLimit || null }; }
export function fromDbCard(c)      { return { id: c.id, name: c.name, balance: parseFloat(c.balance), apr: parseFloat(c.apr), minType: c.min_type, minPct: c.min_pct ? parseFloat(c.min_pct) : null, minFloor: c.min_floor ? parseFloat(c.min_floor) : null, minFixed: c.min_fixed ? parseFloat(c.min_fixed) : null, creditLimit: c.credit_limit ? parseFloat(c.credit_limit) : null }; }
export function toDbDeal(d)        { return { id: d.id, card_id: d.cardId, amount: d.amount, start_date: d.startDate, end_date: d.endDate, note: d.note || null }; }
export function fromDbDeal(d)      { return { id: d.id, cardId: d.card_id, amount: parseFloat(d.amount), startDate: d.start_date, endDate: d.end_date, note: d.note }; }
export function toDbCCT(t)         { return { id: t.id, card_id: t.cardId, date: t.date, amount: t.amount, category: t.category, description: t.description || null, type: t.type }; }
export function fromDbCCT(t)       { return { id: t.id, cardId: t.card_id, date: t.date, amount: parseFloat(t.amount), category: t.category, description: t.description, type: t.type || 'charge' }; }
export function toDbLoan(l)        { return { id: l.id, lender: l.lender, total_amount: l.totalAmount, repayment_amount: l.repaymentAmount, apr: l.apr || null, frequency: l.frequency, start_date: l.startDate, end_date: l.endDate || null, note: l.note || null }; }
export function fromDbLoan(l)      { return { id: l.id, lender: l.lender, totalAmount: parseFloat(l.total_amount), repaymentAmount: parseFloat(l.repayment_amount), apr: l.apr ? parseFloat(l.apr) : null, frequency: l.frequency, startDate: l.start_date, endDate: l.end_date, note: l.note }; }
export function toDbAccount(a)     { return { id: a.id, name: a.name, type: a.type, balance: a.balance, interest_rate: a.interestRate || null, note: a.note || null }; }
export function fromDbAccount(a)   { return { id: a.id, name: a.name, type: a.type, balance: parseFloat(a.balance), interestRate: a.interest_rate ? parseFloat(a.interest_rate) : null, note: a.note }; }
export function toDbTransfer(t)    { return { id: t.id, from_account_id: t.fromAccountId, to_account_id: t.toAccountId, amount: t.amount, frequency: t.frequency, start_date: t.startDate, end_date: t.endDate || null, note: t.note || null }; }
export function fromDbTransfer(t)  { return { id: t.id, fromAccountId: t.from_account_id, toAccountId: t.to_account_id, amount: parseFloat(t.amount), frequency: t.frequency, startDate: t.start_date, endDate: t.end_date, note: t.note }; }

// ── Generic DB helpers ───────────────────────────
export async function dbUpsert(table, jsObj, toDbFn) {
  if (!currentUser || !db) return;
  const { error } = await db.from(table).upsert({ ...toDbFn(jsObj), user_id: currentUser.id });
  if (error) { console.error('dbUpsert', table, error); toast('⚠️ Sync failed — saved locally but not to cloud.'); }
}
export async function dbDelete(table, id) {
  if (!currentUser || !db) return;
  const { error } = await db.from(table).delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { console.error('dbDelete', table, error); toast('⚠️ Sync failed — deletion saved locally but not to cloud.'); }
}

// ── Bulk load all data for signed-in user ────────
export async function loadUserData() {
  const uid = currentUser.id;
  try {
    const [inc, exp, rec, cards, deals, cct, loans, accs, transfers] = await Promise.all([
      db.from('income').select('*').eq('user_id', uid),
      db.from('expenses').select('*').eq('user_id', uid),
      db.from('recurring').select('*').eq('user_id', uid),
      db.from('credit_cards').select('*').eq('user_id', uid),
      db.from('promo_deals').select('*').eq('user_id', uid),
      db.from('cc_transactions').select('*').eq('user_id', uid),
      db.from('loans').select('*').eq('user_id', uid),
      db.from('accounts').select('*').eq('user_id', uid),
      db.from('savings_transfers').select('*').eq('user_id', uid),
    ]);
    incomeData        = (inc.data       || []).map(fromDbIncome);
    expenseData       = (exp.data       || []).map(fromDbIncome);
    recurringData     = (rec.data       || []).map(fromDbRecurring);
    creditCards       = (cards.data     || []).map(fromDbCard);
    interestFreeDeals = (deals.data     || []).map(fromDbDeal);
    ccTransactions    = (cct.data       || []).map(fromDbCCT);
    loansData         = (loans.data     || []).map(fromDbLoan);
    accountsData      = (accs.data      || []).map(fromDbAccount);
    savingsTransfers  = (transfers.data || []).map(fromDbTransfer);
  } catch (err) {
    console.error('loadUserData failed', err);
    toast('⚠️ Could not load your cloud data — showing locally saved data instead.');
  }
}
