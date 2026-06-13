import {
  CURRENCIES, INCOME_CATS, EXPENSE_CATS, REC_MONTH_NAMES, CC_TXN_CATS,
  FREQ_LABELS, currentCurrency, setCurrentCurrency,
  fmt, fmtS, genId, esc,
  todayStr, toast, formatDate, formatMonthYear, isThisMonthOrFuture,
  monthlyEquiv, exportCSV,
  getMonthTotals, buildSparkline, trendBadge,
} from './js/helpers.js';
import {
  getOccurrenceDates, getAmountForMonth, generateProjection,
} from './js/engine.js';
import {
  db, currentUser, setCurrentUser,
  incomeData, setIncomeData,
  expenseData, setExpenseData,
  recurringData, setRecurringData,
  creditCards, setCreditCards,
  interestFreeDeals, setInterestFreeDeals,
  ccTransactions, setCCTransactions,
  loansData, setLoansData,
  accountsData, setAccountsData,
  savingsTransfers, setSavingsTransfers,
  saveData, loadUserData,
  toDbIncome, toDbRecurring, toDbCard, toDbDeal, toDbCCT, toDbLoan, toDbAccount, toDbTransfer,
  dbUpsert, dbDelete,
} from './js/data.js';
import {
  signInWithGoogle, signInWithGitHub, signOut,
  setAuthMode, submitEmailAuth,
  updateUserUI, updateCurrencyUI,
  toggleAccountMenu,
  showMigrationBanner, dismissMigration,
  launchApp, showSignInOverlay, checkFirstVisit,
  migrateFromLocalStorage,
} from './js/auth.js';
import {
  renderDashboard, renderOneoffList,
  renderRecurringTable, renderUpcomingTimeline,
  renderCashflow, renderCardList, renderDealsPage,
  renderLoansPage, renderCCTransactions, renderAccountsPage,
  currentOneoffFilter, setCurrentOneoffFilter,
  currentCCTFilter, setCurrentCCTFilter,
  editingCCTId, setEditingCCTId,
  editingLoanId, setEditingLoanId,
} from './js/render.js';

// ══════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + page + "'")) n.classList.add('active');
  });
  const renders = {
    dashboard: renderDashboard,
    oneoff: renderOneoffList,
    recurring: () => { renderRecurringTable(); renderUpcomingTimeline(); },
    cashflow: renderCashflow,
    accounts: renderAccountsPage,
    credit: renderCardList,
    cctransactions: renderCCTransactions,
    calculators: () => {}, // static page, no render needed
    deals: renderDealsPage,
    loans: renderLoansPage
  };
  if (renders[page]) renders[page]();
  if (window.posthog) posthog.capture('page_viewed', { page });
}

// ══════════════════════════════════════════════════
//  HELPERS — currency UI + page-level export fns
//  (pure utils live in ./js/helpers.js)
// ══════════════════════════════════════════════════

function _applyCurrencyFromUser(user) {
  const saved = user?.user_metadata?.currency;
  if (saved && CURRENCIES[saved] && saved !== currentCurrency) {
    setCurrentCurrency(saved);
    localStorage.setItem('mf_currency', saved);
    updateCurrencyUI();
  }
}

function setCurrency(code) {
  if (!CURRENCIES[code]) return;
  setCurrentCurrency(code);
  localStorage.setItem('mf_currency', code);
  updateCurrencyUI();
  // Persist to Supabase user metadata so it syncs across devices
  if (currentUser && db) db.auth.updateUser({ data: { currency: code } });
  // Re-render the active page so all amounts update immediately
  const active = document.querySelector('.page.active');
  if (active) {
    const page = active.id.replace('page-', '');
    navigate(page);
  }
}

function exportRecurring() {
  const rows = recurringData.map(r => [
    r.type, r.name, r.category, r.amount, r.frequency,
    monthlyEquiv(r).toFixed(2),
    r.startDate, r.endDate || '',
    r.activeMonths && r.activeMonths.length > 0 && r.activeMonths.length < 12 ? r.activeMonths.map(m => REC_MONTH_NAMES[m]).join(';') : 'All'
  ]);
  exportCSV('recurring-transactions.csv', ['Type','Name','Category','Amount','Frequency','Monthly Equiv (£)','Start Date','End Date','Active Months'], rows);
}
function exportOneoffs() {
  let items = [];
  if (currentOneoffFilter !== 'expense') incomeData.forEach(r  => items.push({...r, type:'income'}));
  if (currentOneoffFilter !== 'income')  expenseData.forEach(r => items.push({...r, type:'expense'}));
  if (currentOneoffFilter !== 'income') {
    ccTransactions.filter(t => t.type === 'payment').forEach(t => {
      const card = creditCards.find(c => c.id === t.cardId);
      items.push({ date: t.date, type: 'expense', category: 'CC Payment',
        description: t.description ? `${t.description} (${card?card.name:'Unknown'})` : `Payment to ${card?card.name:'Unknown'}`,
        amount: t.amount });
    });
  }
  items.sort((a,b) => new Date(b.date)-new Date(a.date));
  exportCSV('one-off-transactions.csv', ['Date','Type','Category','Description','Amount'],
    items.map(r => [r.date, r.type, r.category, r.description, r.amount]));
}
function exportCCTransactions() {
  const rows = (currentCCTFilter === 'all'
    ? [...ccTransactions]
    : ccTransactions.filter(t => String(t.cardId) === currentCCTFilter)
  ).sort((a,b) => new Date(b.date)-new Date(a.date))
   .map(t => {
     const card = creditCards.find(c => c.id === t.cardId);
     return [t.date, t.type === 'payment' ? 'Payment' : 'Charge', card ? card.name : '', t.category || '', t.description, t.amount];
   });
  exportCSV('cc-transactions.csv', ['Date','Type','Card','Category','Description','Amount'], rows);
}
function setDefaultDates() {
  const t = todayStr();
  ['oneoff-date','rec-start','deal-start','cct-date','loan-start','acc-transfer-start'].forEach(id => { const el = document.getElementById(id); if (el) el.value = t; });
}

// ══════════════════════════════════════════════════
//  ONE-OFF TRANSACTIONS
// ══════════════════════════════════════════════════
let currentOneoffType   = 'income';

function setOneoffType(type) {
  currentOneoffType = type;
  document.getElementById('oneoff-toggle-income').classList.toggle('active',  type==='income');
  document.getElementById('oneoff-toggle-expense').classList.toggle('active', type==='expense');
  const cats = type==='income' ? INCOME_CATS : EXPENSE_CATS;
  document.getElementById('oneoff-category').innerHTML = cats.map(c=>`<option>${c}</option>`).join('');
}

function setOneoffFilter(f) {
  setCurrentOneoffFilter(f);
  ['all','income','expense'].forEach(t => document.getElementById('oneoff-tab-'+t).classList.toggle('active', f===t));
  renderOneoffList();
}

function addOneoff() {
  const date=document.getElementById('oneoff-date').value, cat=document.getElementById('oneoff-category').value;
  const amt=parseFloat(document.getElementById('oneoff-amount').value), desc=document.getElementById('oneoff-description').value.trim();
  if (!date) { toast('⚠️ Please pick a date'); return; }
  if (isNaN(amt)||amt<=0) { toast('⚠️ Enter a valid amount'); return; }
  const entry = { id:genId(), date, category:cat, amount:amt, description:desc||cat };
  if (currentOneoffType==='income') { incomeData.push(entry); dbUpsert('income', entry, toDbIncome); }
  else { expenseData.push(entry); dbUpsert('expenses', entry, toDbIncome); }
  saveData(); renderOneoffList(); toast('✅ Entry added!');
  if (window.posthog) posthog.capture('transaction_added', { type: currentOneoffType, category: cat });
  document.getElementById('oneoff-amount').value=''; document.getElementById('oneoff-description').value='';
}

function deleteIncome(id)  { setIncomeData(incomeData.filter(r=>r.id!==id));   dbDelete('income', id);   saveData(); renderOneoffList(); toast('🗑 Deleted'); }
function deleteExpense(id) { setExpenseData(expenseData.filter(r=>r.id!==id)); dbDelete('expenses', id); saveData(); renderOneoffList(); toast('🗑 Deleted'); }

// ══════════════════════════════════════════════════
//  RECURRING
// ══════════════════════════════════════════════════
let currentRecType   = 'income';
let editingRecurringId = null;

function setRecType(type) {
  currentRecType = type;
  document.getElementById('rec-toggle-income').classList.toggle('active', type==='income');
  document.getElementById('rec-toggle-expense').classList.toggle('active', type==='expense');
}

// ── Month picker helpers ──
function onRecFrequencyChange() {
  // Active months only makes sense for monthly frequency — "occurs monthly but skips certain months".
  // All other frequencies (weekly, fortnightly, quarterly, annually) don't need this concept.
  const isMonthly = document.getElementById('rec-frequency').value === 'monthly';
  document.getElementById('rec-months-section').style.display = isMonthly ? '' : 'none';
  if (!isMonthly) {
    // reset the picker so stale month selections don't silently persist
    document.getElementById('rec-months-toggle').checked = false;
    document.getElementById('rec-months-picker').style.display = 'none';
  }
}
function toggleRecMonths() {
  const on = document.getElementById('rec-months-toggle').checked;
  document.getElementById('rec-months-picker').style.display = on ? '' : 'none';
}
function toggleMonthBtn(el) {
  el.classList.toggle('active');
}
function _getActiveMonths() {
  if (!document.getElementById('rec-months-toggle').checked) return null;
  const active = [...document.querySelectorAll('#rec-months-picker .month-btn.active')].map(b => parseInt(b.dataset.m));
  if (active.length === 0 || active.length === 12) return null; // no restriction
  return active.sort((a,b) => a-b);
}
function _setActiveMonths(months) {
  const hasMonths = months && months.length > 0 && months.length < 12;
  document.getElementById('rec-months-toggle').checked = hasMonths;
  document.getElementById('rec-months-picker').style.display = hasMonths ? '' : 'none';
  document.querySelectorAll('#rec-months-picker .month-btn').forEach(b => {
    b.classList.toggle('active', !hasMonths || months.includes(parseInt(b.dataset.m)));
  });
}

function saveRecurring() {
  const name  = document.getElementById('rec-name').value.trim();
  const cat   = document.getElementById('rec-category').value;
  const amt   = parseFloat(document.getElementById('rec-amount').value);
  const freq  = document.getElementById('rec-frequency').value;
  const start = document.getElementById('rec-start').value;
  const end   = document.getElementById('rec-end').value;
  const activeMonths = _getActiveMonths();
  if (!name)              { toast('⚠️ Enter a name'); return; }
  if (isNaN(amt)||amt<=0) { toast('⚠️ Enter a valid amount'); return; }
  if (!start)             { toast('⚠️ Pick a start date'); return; }
  const isEdit = !!editingRecurringId;
  const id = editingRecurringId || genId();
  const rec = { id, type: currentRecType, name, category: cat, amount: amt, frequency: freq, startDate: start, endDate: end||null, activeMonths };
  if (isEdit) { const i = recurringData.findIndex(r => r.id === id); if (i > -1) recurringData[i] = rec; }
  else recurringData.push(rec);
  dbUpsert('recurring', rec, toDbRecurring);
  saveData(); renderRecurringTable(); renderUpcomingTimeline();
  toast(isEdit ? '✅ Recurring transaction updated!' : '✅ Recurring transaction added!');
  if (!isEdit && window.posthog) posthog.capture('recurring_added', { type: currentRecType, frequency: freq, category: cat });
  clearRecurringForm();
}

function editRecurring(id) {
  const r = recurringData.find(r => r.id === id); if (!r) return;
  editingRecurringId = id;
  setRecType(r.type);
  document.getElementById('rec-name').value      = r.name;
  document.getElementById('rec-category').value  = r.category;
  document.getElementById('rec-amount').value    = r.amount;
  document.getElementById('rec-frequency').value = r.frequency;
  document.getElementById('rec-start').value     = r.startDate;
  document.getElementById('rec-end').value       = r.endDate || '';
  onRecFrequencyChange();
  _setActiveMonths(r.activeMonths);
  document.getElementById('rec-form-title').textContent = 'Edit Recurring Transaction';
  document.getElementById('rec-save-btn').textContent   = 'Save Changes';
  document.getElementById('rec-cancel-btn').style.display = '';
  document.getElementById('rec-name').focus();
  document.querySelector('#page-recurring .panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('✏️ Editing — update fields and save');
}

function cancelRecurringEdit() { clearRecurringForm(); }

function clearRecurringForm() {
  const preservedType = currentRecType; // remember what was selected before clearing
  editingRecurringId = null;
  ['rec-name','rec-amount','rec-end'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('rec-frequency').value = 'monthly';
  document.getElementById('rec-category').value  = 'Salary';
  setRecType(preservedType); // stay on the same income/expense type
  onRecFrequencyChange();
  _setActiveMonths(null);
  document.getElementById('rec-form-title').textContent   = 'Add Recurring Transaction';
  document.getElementById('rec-save-btn').textContent     = '+ Add Recurring';
  document.getElementById('rec-cancel-btn').style.display = 'none';
}

function deleteRecurring(id) {
  setRecurringData(recurringData.filter(r => r.id !== id));
  dbDelete('recurring', id);
  saveData(); renderRecurringTable(); renderUpcomingTimeline(); toast('🗑 Deleted');
}function switchRecTab(tab, el) {
  document.querySelectorAll('#page-recurring .tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('#page-recurring .tab-pane').forEach(p=>p.classList.remove('active'));
  el.classList.add('active'); document.getElementById('rec-tab-'+tab).classList.add('active');
}

// ══════════════════════════════════════════════════
//  CREDIT CARDS
// ══════════════════════════════════════════════════
function toggleCCMinInput() {
  const t=document.getElementById('cc-min-type').value;
  document.getElementById('cc-pct-group').style.display  =t==='percent'?'':'none';
  document.getElementById('cc-floor-group').style.display=t==='percent'?'':'none';
  document.getElementById('cc-fixed-group').style.display=t==='fixed'?'':'none';
}
function saveCard() {
  const editId=document.getElementById('cc-edit-id').value;
  const name=document.getElementById('cc-name').value.trim();
  const balance=parseFloat(document.getElementById('cc-balance').value);
  const apr=parseFloat(document.getElementById('cc-apr').value);
  const minType=document.getElementById('cc-min-type').value;
  const minPct=parseFloat(document.getElementById('cc-min-pct').value);
  const minFloor=parseFloat(document.getElementById('cc-min-floor').value)||25;
  const minFixed=parseFloat(document.getElementById('cc-min-fixed').value);
  const creditLimitRaw=parseFloat(document.getElementById('cc-credit-limit').value);
  const creditLimit=(!isNaN(creditLimitRaw)&&creditLimitRaw>0)?creditLimitRaw:null;
  if (!name)                    { toast('⚠️ Enter a card name'); return; }
  if (isNaN(balance)||balance<0){ toast('⚠️ Enter a valid balance'); return; }
  if (isNaN(apr)||apr<=0)       { toast('⚠️ Enter a valid APR'); return; }
  if (minType==='percent'&&(isNaN(minPct)||minPct<=0)) { toast('⚠️ Enter a valid minimum %'); return; }
  if (minType==='fixed'&&(isNaN(minFixed)||minFixed<=0)){ toast('⚠️ Enter a valid fixed payment'); return; }
  const card={ id:editId?parseInt(editId):genId(), name, balance, apr, minType, minPct, minFloor, minFixed, creditLimit };
  if (editId) setCreditCards(creditCards.map(c=>c.id===card.id?card:c)); else creditCards.push(card);
  dbUpsert('credit_cards', card, toDbCard);
  saveData(); renderCardList(); clearCardForm(); toast(editId?'✅ Card updated!':'✅ Card saved!');
  if (window.posthog) posthog.capture('card_saved', { is_edit: !!editId, min_type: minType });
}
function clearCardForm() {
  ['cc-name','cc-balance','cc-apr','cc-min-pct','cc-min-fixed','cc-credit-limit'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cc-min-floor').value='25';
  document.getElementById('cc-min-type').value='percent';
  document.getElementById('cc-edit-id').value='';
  document.getElementById('cc-form-title').textContent='Add a Card';
  document.getElementById('cc-cancel-btn').style.display='none';
  toggleCCMinInput();
}
function cancelCardEdit() { clearCardForm(); }
function editCard(id) {
  const c=creditCards.find(c=>c.id===id); if(!c) return;
  document.getElementById('cc-name').value  =c.name;
  document.getElementById('cc-balance').value=c.balance;
  document.getElementById('cc-apr').value   =c.apr;
  document.getElementById('cc-min-type').value=c.minType;
  document.getElementById('cc-min-pct').value =c.minPct||'';
  document.getElementById('cc-min-floor').value=c.minFloor||25;
  document.getElementById('cc-min-fixed').value=c.minFixed||'';
  document.getElementById('cc-credit-limit').value=c.creditLimit||'';
  document.getElementById('cc-edit-id').value =id;
  document.getElementById('cc-form-title').textContent='Editing: '+c.name;
  document.getElementById('cc-cancel-btn').style.display='';
  toggleCCMinInput(); document.getElementById('cc-name').focus();
  toast('✏️ Editing — update fields and save');
}
function deleteCard(id) {
  if (interestFreeDeals.some(d=>d.cardId===id)) {
    if (!confirm('This card has interest-free deals linked to it. Deleting the card will also remove those deals. Continue?')) return;
    interestFreeDeals.filter(d=>d.cardId===id).forEach(d => dbDelete('promo_deals', d.id));
    setInterestFreeDeals(interestFreeDeals.filter(d=>d.cardId!==id));
  }
  setCreditCards(creditCards.filter(c=>c.id!==id));
  dbDelete('credit_cards', id);
  saveData(); renderCardList(); toast('🗑 Card deleted');
}
// ══════════════════════════════════════════════════
//  0% DEALS PAGE
// ══════════════════════════════════════════════════

function saveDeal() {
  const editId  = document.getElementById('deal-edit-id').value;
  const cardId  = parseInt(document.getElementById('deal-card-id').value);
  const amount  = parseFloat(document.getElementById('deal-amount').value);
  const start   = document.getElementById('deal-start').value;
  const end     = document.getElementById('deal-end').value;
  const note    = document.getElementById('deal-note').value.trim();

  if (!cardId || isNaN(cardId)) { toast('⚠️ Select a card'); return; }
  if (isNaN(amount)||amount<=0) { toast('⚠️ Enter a valid amount'); return; }
  if (!start)                   { toast('⚠️ Enter a start date'); return; }
  if (!end)                     { toast('⚠️ Enter an end date'); return; }
  if (end <= start)             { toast('⚠️ End date must be after start date'); return; }

  const deal = { id: editId ? parseInt(editId) : genId(), cardId, amount, startDate: start, endDate: end, note };
  if (editId) setInterestFreeDeals(interestFreeDeals.map(d => d.id === deal.id ? deal : d));
  else        interestFreeDeals.push(deal);
  dbUpsert('promo_deals', deal, toDbDeal);
  saveData(); clearDealForm(); renderDealsPage(); toast(editId ? '✅ Deal updated!' : '✅ Deal saved!');
}

function clearDealForm() {
  document.getElementById('deal-card-id').value  = '';
  document.getElementById('deal-amount').value   = '';
  document.getElementById('deal-start').value    = todayStr();
  document.getElementById('deal-end').value      = '';
  document.getElementById('deal-note').value     = '';
  document.getElementById('deal-edit-id').value  = '';
  document.getElementById('deal-form-title').textContent = 'Add a 0% Deal';
  document.getElementById('deal-cancel-btn').style.display = 'none';
}

function cancelDealEdit() { clearDealForm(); }

function editDeal(id) {
  const d = interestFreeDeals.find(d => d.id === id); if (!d) return;
  document.getElementById('deal-card-id').value  = d.cardId;
  document.getElementById('deal-amount').value   = d.amount;
  document.getElementById('deal-start').value    = d.startDate;
  document.getElementById('deal-end').value      = d.endDate;
  document.getElementById('deal-note').value     = d.note || '';
  document.getElementById('deal-edit-id').value  = id;
  document.getElementById('deal-form-title').textContent = 'Editing Deal';
  document.getElementById('deal-cancel-btn').style.display = '';
  document.getElementById('deal-card-id').focus();
  toast('✏️ Editing deal — update and save');
}

function deleteDeal(id) {
  setInterestFreeDeals(interestFreeDeals.filter(d => d.id !== id));
  dbDelete('promo_deals', id);
  saveData(); renderDealsPage(); toast('🗑 Deal deleted');
}

// ══════════════════════════════════════════════════
//  LOANS
// ══════════════════════════════════════════════════

function saveLoan() {
  const lender = document.getElementById('loan-lender').value.trim();
  const totalAmount = parseFloat(document.getElementById('loan-total').value);
  const repaymentAmount = parseFloat(document.getElementById('loan-repayment').value);
  const frequency = document.getElementById('loan-frequency').value;
  const apr = document.getElementById('loan-apr').value ? parseFloat(document.getElementById('loan-apr').value) : null;
  const startDate = document.getElementById('loan-start').value;
  const endDate = document.getElementById('loan-end').value || null;
  const note = document.getElementById('loan-note').value.trim();

  if (!lender) { toast('⚠️ Please enter a lender name'); return; }
  if (!totalAmount || totalAmount <= 0) { toast('⚠️ Please enter a valid total loan amount'); return; }
  if (!repaymentAmount || repaymentAmount <= 0) { toast('⚠️ Please enter a valid repayment amount'); return; }
  if (!startDate) { toast('⚠️ Please enter a start date'); return; }

  const editId = document.getElementById('loan-edit-id').value;
  if (editId) {
    const idx = loansData.findIndex(l => l.id === parseInt(editId));
    if (idx !== -1) { loansData[idx] = { ...loansData[idx], lender, totalAmount, repaymentAmount, frequency, apr, startDate, endDate, note }; dbUpsert('loans', loansData[idx], toDbLoan); }
    setEditingLoanId(null);
    toast('✅ Loan updated');
    if (window.posthog) posthog.capture('loan_saved', { is_edit: true, frequency });
  } else {
    const id = genId();
    const loan = { id, lender, totalAmount, repaymentAmount, frequency, apr, startDate, endDate, note };
    loansData.push(loan); dbUpsert('loans', loan, toDbLoan);
    toast('✅ Loan saved');
    if (window.posthog) posthog.capture('loan_saved', { is_edit: false, frequency });
  }
  saveData();
  clearLoanForm();
  renderLoansPage();
  renderRecurringTable();
}

function clearLoanForm() {
  ['loan-lender','loan-total','loan-repayment','loan-apr','loan-start','loan-end','loan-note'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('loan-frequency').value = 'monthly';
  document.getElementById('loan-edit-id').value = '';
  document.getElementById('loan-cancel-btn').style.display = 'none';
  document.getElementById('loan-form-title').textContent = 'Add a Loan';
  // Reset start date to today
  const startEl = document.getElementById('loan-start');
  if (startEl) startEl.value = todayStr();
  setEditingLoanId(null);
}

function editLoan(id) {
  setEditingLoanId(id);
  renderLoansPage();
  document.getElementById('loans-form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelLoanEdit() {
  setEditingLoanId(null);
  clearLoanForm();
  renderLoansPage();
}

function deleteLoan(id) {
  setLoansData(loansData.filter(l => l.id !== id));
  dbDelete('loans', id);
  saveData();
  renderLoansPage();
  renderRecurringTable();
  toast('🗑 Loan deleted');
}

// ══════════════════════════════════════════════════
//  CALCULATORS
// ══════════════════════════════════════════════════
function switchCalcTab(tab, el) {
  document.querySelectorAll('#page-calculators .tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('#page-calculators .tab-pane').forEach(p=>p.classList.remove('active'));
  el.classList.add('active'); document.getElementById('calc-tab-'+tab).classList.add('active');
}
function toggleMinPayInput() {
  const t=document.getElementById('mp-type').value;
  document.getElementById('mp-percent-group').style.display=t==='percent'?'':'none';
  document.getElementById('mp-fixed-group').style.display=t==='fixed'?'':'none';
}
function runPayoffSim(balance, apr, getPayment) {
  const mr=apr/100/12; let bal=balance,ti=0,tp=0,months=0; const sched=[];
  while(bal>0.005&&months<600){
    months++; const interest=bal*mr; bal+=interest; ti+=interest;
    let pay=getPayment(bal);
    if(pay<=interest&&months>1) return{error:true,interest,payment:pay};
    pay=Math.min(pay,bal); bal-=pay; tp+=pay; if(bal<0.005)bal=0;
    if(sched.length<60) sched.push({month:months,interest,payment:pay,balance:Math.max(bal,0)});
  }
  return{months,totalInterest:ti,totalPaid:tp,schedule:sched};
}
function payoffResultHtml(r, balance) {
  if(r.error) return `<div class="result-box"><h3>⚠️ Payment too low</h3><p class="text-cc" style="font-size:0.85rem">Payment doesn't cover monthly interest. Debt will never reduce.</p></div>`;
  const y=Math.floor(r.months/12),m=r.months%12,ts=y>0?`${y}yr ${m>0?m+'mo':''}`.trim():`${m} months`;
  return `<div class="result-box"><h3>📊 Payoff Summary</h3>
    <div class="result-row"><span>Time to pay off</span><span class="val">${r.months>=600?'50+ years!':ts}</span></div>
    <div class="result-row"><span>Total paid</span><span class="val">${fmt(r.totalPaid)}</span></div>
    <div class="result-row"><span>Total interest</span><span class="val value-neg">${fmt(r.totalInterest)}</span></div>
    <div class="result-row"><span>Interest as % of balance</span><span class="val">${((r.totalInterest/balance)*100).toFixed(1)}%</span></div>
  </div>
  <div class="payoff-table"><p class="text-muted-sm" style="margin:10px 0 5px">First ${r.schedule.length} months</p>
    <table><thead><tr><th>Month</th><th>Interest</th><th>Payment</th><th>Balance</th></tr></thead>
    <tbody>${r.schedule.map(s=>`<tr><td>${s.month}</td><td class="value-neg">£${s.interest.toFixed(2)}</td><td class="value-pos">£${s.payment.toFixed(2)}</td><td style="font-weight:600">£${s.balance.toFixed(2)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function calcMinPayment() {
  const b=parseFloat(document.getElementById('mp-balance').value),r=parseFloat(document.getElementById('mp-rate').value);
  const t=document.getElementById('mp-type').value,p=parseFloat(document.getElementById('mp-percent').value)/100,f=parseFloat(document.getElementById('mp-fixed').value);
  if(isNaN(b)||b<=0||isNaN(r)||r<=0){toast('⚠️ Fill in all fields');return;}
  document.getElementById('mp-result').innerHTML=payoffResultHtml(runPayoffSim(b,r,bal=>t==='percent'?Math.max(bal*p,10):f),b);
}
function calcFixedPayment() {
  const b=parseFloat(document.getElementById('fp-balance').value),r=parseFloat(document.getElementById('fp-rate').value),p=parseFloat(document.getElementById('fp-payment').value);
  if(isNaN(b)||b<=0||isNaN(r)||r<=0||isNaN(p)||p<=0){toast('⚠️ Fill in all fields');return;}
  document.getElementById('fp-result').innerHTML=payoffResultHtml(runPayoffSim(b,r,()=>p),b);
}
function calcInterestComparison() {
  const b=parseFloat(document.getElementById('ic-balance').value),r=parseFloat(document.getElementById('ic-rate').value);
  if(isNaN(b)||b<=0||isNaN(r)||r<=0){toast('⚠️ Fill in all fields');return;}
  const mi=b*(r/100/12);
  const pmts=[...new Set([Math.ceil(mi*1.1),Math.ceil(mi*1.5),Math.ceil(b*0.02),Math.ceil(b*0.03),Math.ceil(b*0.05),Math.ceil(b*0.10)].filter(p=>p>mi).sort((a,b)=>a-b))];
  const rows=pmts.map(p=>{const res=runPayoffSim(b,r,()=>p);const y=Math.floor(res.months/12),m=res.months%12;return{p,months:res.months,interest:res.totalInterest,time:y>0?`${y}y ${m>0?m+'m':''}`.trim():`${m}m`};});
  document.getElementById('ic-result').innerHTML=`<div style="margin-top:16px;overflow-x:auto"><table>
    <thead><tr><th>Monthly Payment</th><th>Time</th><th>Total Interest</th><th>Total Cost</th></tr></thead>
    <tbody>${rows.map((r,i)=>`<tr style="${i===rows.length-1?'background:#f0fdf4':''}"><td style="font-weight:600">${fmt(r.p)}</td><td>${r.time}</td><td class="value-neg">${fmt(r.interest)}</td><td style="font-weight:600">${fmt(b+r.interest)}</td></tr>`).join('')}</tbody>
  </table><p style="font-size:0.75rem;color:#aaa;margin-top:8px">Balance: ${fmt(b)} · Rate: ${r}% APR · Monthly interest: ${fmt(mi)}</p></div>`;
}

// ══════════════════════════════════════════════════
//  CARD TRANSACTIONS (charges + payments)
// ══════════════════════════════════════════════════
let currentCCTTypeInput = 'charge';

function setCCTFilter(f) {
  setCurrentCCTFilter(f);
  renderCCTransactions();
}

function setCCTType(type) {
  currentCCTTypeInput = type;
  document.getElementById('cct-toggle-charge').classList.toggle('active',  type === 'charge');
  document.getElementById('cct-toggle-payment').classList.toggle('active', type === 'payment');
  const catGrp = document.getElementById('cct-category-group');
  if (catGrp) catGrp.style.display = type === 'charge' ? '' : 'none';
  const addBtn = document.getElementById('cct-add-btn');
  if (addBtn) addBtn.textContent = type === 'charge' ? '+ Add Charge' : '+ Record Payment';
  const descInput = document.getElementById('cct-description');
  if (descInput) descInput.placeholder = type === 'charge' ? 'e.g. Amazon purchase' : 'e.g. Lump sum payment';
}

function addCCTransaction() {
  const cardId = parseInt(document.getElementById('cct-card').value);
  const date   = document.getElementById('cct-date').value;
  const amount = parseFloat(document.getElementById('cct-amount').value);
  const type   = currentCCTTypeInput;
  const cat    = type === 'charge' ? document.getElementById('cct-category').value : 'CC Payment';
  const desc   = document.getElementById('cct-description').value.trim();
  if (!cardId || isNaN(cardId))    { toast('⚠️ Select a card'); return; }
  if (!date)                        { toast('⚠️ Pick a date'); return; }
  if (isNaN(amount) || amount <= 0) { toast('⚠️ Enter a valid amount'); return; }
  const newTxn = { id: genId(), cardId, date, amount, category: cat, description: desc || (type === 'charge' ? cat : 'CC Payment'), type };
  ccTransactions.push(newTxn); dbUpsert('cc_transactions', newTxn, toDbCCT);
  saveData(); renderCCTransactions(); toast(type === 'charge' ? '✅ Charge added!' : '✅ Payment recorded!');
  if (window.posthog) posthog.capture('cc_transaction_added', { type, category: cat });
  document.getElementById('cct-amount').value = '';
  document.getElementById('cct-description').value = '';
}

function deleteCCTransaction(id) {
  setCCTransactions(ccTransactions.filter(t => t.id !== id));
  dbDelete('cc_transactions', id);
  saveData(); renderCCTransactions(); renderOneoffList(); toast('🗑 Deleted');
}

function editCCTransaction(id) { setEditingCCTId(id); renderCCTransactions(); }
function cancelCCTEdit()       { setEditingCCTId(null); renderCCTransactions(); }

function saveCCTEdit(id) {
  const row    = document.getElementById('cct-edit-row-' + id);
  if (!row) return;
  const txn    = ccTransactions.find(t => t.id === id);
  const date   = row.querySelector('[data-field="date"]').value;
  const cardId = parseInt(row.querySelector('[data-field="card"]').value);
  const desc   = row.querySelector('[data-field="desc"]').value.trim();
  const amount = parseFloat(row.querySelector('[data-field="amount"]').value);
  const catEl  = row.querySelector('[data-field="cat"]');
  const cat    = catEl ? catEl.value : (txn ? txn.category : 'CC Payment');
  if (!date)                        { toast('⚠️ Pick a date'); return; }
  if (!cardId || isNaN(cardId))    { toast('⚠️ Select a card'); return; }
  if (isNaN(amount) || amount <= 0) { toast('⚠️ Enter a valid amount'); return; }
  setCCTransactions(ccTransactions.map(t => t.id === id ? { ...t, date, cardId, category: cat, description: desc || cat, amount } : t));
  const updatedTxn = ccTransactions.find(t => t.id === id);
  if (updatedTxn) dbUpsert('cc_transactions', updatedTxn, toDbCCT);
  saveData(); setEditingCCTId(null); renderCCTransactions(); toast('✅ Updated!');
}

// ══════════════════════════════════════════════════
//  ACCOUNTS
// ══════════════════════════════════════════════════
let editingAccountId  = null;
let editingTransferId = null;

function toggleAccInterestInput() {
  const type = document.getElementById('acc-type').value;
  document.getElementById('acc-interest-group').style.display = type === 'savings' ? '' : 'none';
}

function switchAccountTab(tab, el) {
  document.querySelectorAll('#page-accounts .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-accounts .tab-pane').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('acc-tab-' + tab).classList.add('active');
  if (tab === 'transfers') _populateTransferSelects();
}

function _populateTransferSelects() {
  const opts = accountsData.map(a =>
    `<option value="${a.id}">${esc(a.name)} (${a.type === 'current' ? 'Current' : 'Savings'})</option>`).join('');
  ['acc-transfer-from','acc-transfer-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts || '<option value="">— add accounts first —</option>';
  });
  const notice = document.getElementById('acc-no-accounts-notice');
  const fields  = document.getElementById('acc-transfer-form-fields');
  const hide    = accountsData.length < 2;
  if (notice) notice.style.display = hide ? '' : 'none';
  if (fields)  fields.style.display = hide ? 'none' : '';
}

function saveAccount() {
  const name        = document.getElementById('acc-name').value.trim();
  const type        = document.getElementById('acc-type').value;
  const balance     = parseFloat(document.getElementById('acc-balance').value) || 0;
  const interestRate= type === 'savings' ? (parseFloat(document.getElementById('acc-interest-rate').value) || null) : null;
  const note        = document.getElementById('acc-note').value.trim();
  if (!name) { toast('Please enter an account name.'); return; }
  const isEdit = !!editingAccountId;
  const id     = editingAccountId || genId();
  const account = { id, name, type, balance, interestRate, note };
  if (isEdit) { const i = accountsData.findIndex(a => a.id === id); if (i > -1) accountsData[i] = account; }
  else accountsData.push(account);
  saveData();
  dbUpsert('accounts', account, toDbAccount);
  if (window.posthog) posthog.capture('account_saved', { is_edit: isEdit, type });
  editingAccountId = null;
  ['acc-name','acc-balance','acc-interest-rate','acc-note'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('acc-type').value = 'current';
  document.getElementById('acc-cancel-btn').style.display = 'none';
  document.getElementById('acc-form-title').textContent = 'Add an Account';
  document.getElementById('acc-edit-id').value = '';
  toggleAccInterestInput();
  renderAccountsPage();
  toast(isEdit ? 'Account updated.' : 'Account saved.');
}

function editAccount(id) {
  const a = accountsData.find(a => a.id === id);
  if (!a) return;
  editingAccountId = id;
  document.getElementById('acc-name').value    = a.name;
  document.getElementById('acc-type').value    = a.type;
  document.getElementById('acc-balance').value = a.balance;
  if (a.interestRate != null) document.getElementById('acc-interest-rate').value = a.interestRate;
  document.getElementById('acc-note').value    = a.note || '';
  document.getElementById('acc-edit-id').value = id;
  document.getElementById('acc-cancel-btn').style.display = '';
  document.getElementById('acc-form-title').textContent = 'Edit Account';
  toggleAccInterestInput();
  // Switch to accounts tab and scroll to form
  document.querySelectorAll('#page-accounts .tab')[0]?.click();
  document.getElementById('acc-form-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelAccountEdit() {
  editingAccountId = null;
  ['acc-name','acc-balance','acc-interest-rate','acc-note'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('acc-type').value = 'current';
  document.getElementById('acc-cancel-btn').style.display = 'none';
  document.getElementById('acc-form-title').textContent = 'Add an Account';
  document.getElementById('acc-edit-id').value = '';
  toggleAccInterestInput();
}

function deleteAccount(id) {
  if (!confirm('Delete this account? Any transfers involving it will also be removed.')) return;
  setAccountsData(accountsData.filter(a => a.id !== id));
  const orphans = savingsTransfers.filter(t => t.fromAccountId === id || t.toAccountId === id);
  setSavingsTransfers(savingsTransfers.filter(t => t.fromAccountId !== id && t.toAccountId !== id));
  orphans.forEach(t => dbDelete('savings_transfers', t.id));
  saveData();
  dbDelete('accounts', id);
  renderAccountsPage();
  toast('Account deleted.');
}

function saveTransfer() {
  const fromId    = parseInt(document.getElementById('acc-transfer-from').value);
  const toId      = parseInt(document.getElementById('acc-transfer-to').value);
  const amount    = parseFloat(document.getElementById('acc-transfer-amount').value);
  const frequency = document.getElementById('acc-transfer-frequency').value;
  const startDate = document.getElementById('acc-transfer-start').value;
  const endDate   = document.getElementById('acc-transfer-end').value;
  const note      = document.getElementById('acc-transfer-note').value.trim();
  if (!fromId || !toId)     { toast('Please select both accounts.'); return; }
  if (fromId === toId)      { toast('From and To accounts must be different.'); return; }
  if (!amount || amount<=0) { toast('Please enter a valid amount.'); return; }
  if (!startDate)           { toast('Please enter a start date.'); return; }
  const isEdit   = !!editingTransferId;
  const id       = editingTransferId || genId();
  const transfer = { id, fromAccountId: fromId, toAccountId: toId, amount, frequency, startDate, endDate: endDate || null, note };
  if (isEdit) { const i = savingsTransfers.findIndex(t => t.id === id); if (i > -1) savingsTransfers[i] = transfer; }
  else savingsTransfers.push(transfer);
  saveData();
  dbUpsert('savings_transfers', transfer, toDbTransfer);
  if (window.posthog) posthog.capture('transfer_saved', { is_edit: isEdit, frequency });
  editingTransferId = null;
  ['acc-transfer-amount','acc-transfer-end','acc-transfer-note'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('acc-transfer-frequency').value = 'monthly';
  document.getElementById('acc-transfer-cancel-btn').style.display = 'none';
  document.getElementById('acc-transfer-form-title').textContent = 'Add a Transfer';
  document.getElementById('acc-transfer-edit-id').value = '';
  renderAccountsPage();
  toast(isEdit ? 'Transfer updated.' : 'Transfer saved.');
}

function editTransfer(id) {
  const t = savingsTransfers.find(t => t.id === id);
  if (!t) return;
  editingTransferId = id;
  _populateTransferSelects();
  document.getElementById('acc-transfer-from').value      = t.fromAccountId;
  document.getElementById('acc-transfer-to').value        = t.toAccountId;
  document.getElementById('acc-transfer-amount').value    = t.amount;
  document.getElementById('acc-transfer-frequency').value = t.frequency;
  document.getElementById('acc-transfer-start').value     = t.startDate;
  document.getElementById('acc-transfer-end').value       = t.endDate || '';
  document.getElementById('acc-transfer-note').value      = t.note || '';
  document.getElementById('acc-transfer-edit-id').value   = id;
  document.getElementById('acc-transfer-cancel-btn').style.display = '';
  document.getElementById('acc-transfer-form-title').textContent   = 'Edit Transfer';
  // Switch to transfers tab
  document.querySelectorAll('#page-accounts .tab')[1]?.click();
}

function cancelTransferEdit() {
  editingTransferId = null;
  ['acc-transfer-amount','acc-transfer-end','acc-transfer-note'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('acc-transfer-frequency').value = 'monthly';
  document.getElementById('acc-transfer-cancel-btn').style.display = 'none';
  document.getElementById('acc-transfer-form-title').textContent = 'Add a Transfer';
  document.getElementById('acc-transfer-edit-id').value = '';
}

function deleteTransfer(id) {
  if (!confirm('Delete this transfer?')) return;
  setSavingsTransfers(savingsTransfers.filter(t => t.id !== id));
  saveData();
  dbDelete('savings_transfers', id);
  renderAccountsPage();
  toast('Transfer deleted.');
}

// ══════════════════════════════════════════════════
//  COLLAPSIBLE NAV
// ══════════════════════════════════════════════════
function toggleSidebar() {
  const app = document.querySelector('.app');
  const isNowCollapsed = app.classList.toggle('sidebar-collapsed');
  localStorage.setItem('mf_sidebar_collapsed', isNowCollapsed ? '1' : '0');
  _updateSidebarToggleIcon(isNowCollapsed);
}

function _updateSidebarToggleIcon(collapsed) {
  const icon = document.getElementById('sidebar-toggle-icon');
  if (!icon) return;
  if (collapsed) {
    // Show chevron-right (expand)
    icon.innerHTML = `<polyline points="6,4 14,10 6,16"/>`;
  } else {
    // Show hamburger (collapse)
    icon.innerHTML = `<line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/>`;
  }
}

function restoreSidebarState() {
  const collapsed = localStorage.getItem('mf_sidebar_collapsed') === '1';
  if (collapsed) document.querySelector('.app').classList.add('sidebar-collapsed');
  _updateSidebarToggleIcon(collapsed);
}

function toggleNavGroup(key) {
  const group = document.getElementById('navg-' + key);
  if (!group) return;
  const isNowCollapsed = group.classList.toggle('collapsed');
  const states = JSON.parse(localStorage.getItem('mf_nav_state') || '{}');
  states[key] = isNowCollapsed;
  localStorage.setItem('mf_nav_state', JSON.stringify(states));
}

function toggleNavSubgroup(key) {
  const group = document.getElementById('navg-sub-' + key);
  if (!group) return;
  const isNowCollapsed = group.classList.toggle('collapsed');
  const states = JSON.parse(localStorage.getItem('mf_nav_state') || '{}');
  states['sub-' + key] = isNowCollapsed;
  localStorage.setItem('mf_nav_state', JSON.stringify(states));
}

function restoreNavState() {
  const states = JSON.parse(localStorage.getItem('mf_nav_state') || '{}');
  ['overview','transactions','debt','planning'].forEach(key => {
    const g = document.getElementById('navg-' + key);
    if (!g) return;
    g.classList.toggle('collapsed', states[key] === true);
  });
  ['creditcards','loans'].forEach(key => {
    const g = document.getElementById('navg-sub-' + key);
    if (!g) return;
    g.classList.toggle('collapsed', states['sub-' + key] === true);
  });
}

// ══════════════════════════════════════════════════
//  DARK MODE
// ══════════════════════════════════════════════════
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next   = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('mf_dark_mode', next);
  if (window.posthog) posthog.capture('dark_mode_toggled', { theme: next });
  const icon  = document.getElementById('dark-toggle-icon');
  const label = document.getElementById('dark-toggle-label');
  if (icon)  icon.textContent  = next === 'dark' ? '☀️' : '🌙';
  if (label) label.textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
}

function restoreDarkMode() {
  if (localStorage.getItem('mf_dark_mode') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const icon  = document.getElementById('dark-toggle-icon');
    const label = document.getElementById('dark-toggle-label');
    if (icon)  icon.textContent  = '☀️';
    if (label) label.textContent = 'Light mode';
  }
}

// ══════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════
restoreDarkMode();
restoreSidebarState();
restoreNavState();
updateCurrencyUI();
setDefaultDates();
renderDashboard();
renderOneoffList();

(async () => {
  if (!db) { checkFirstVisit(); updateUserUI(); return; }

  // Shared app-init: called once a user session is confirmed.
  async function _initApp(user) {
    setCurrentUser(user);
    _applyCurrencyFromUser(currentUser);
    await loadUserData();
    const hasLocalData = ['mf_income','mf_expenses','mf_recurring'].some(k => {
      try { return JSON.parse(localStorage.getItem(k) || '[]').length > 0; } catch(e) { return false; }
    });
    if (hasLocalData) showMigrationBanner();
    document.getElementById('landing-overlay').classList.add('hidden');
    updateUserUI();
    renderDashboard();
    renderOneoffList();
  }

  // ── OAuth callback (implicit grant: #access_token=… in URL) ───────────
  // In this Supabase build, getSession() does not process the URL hash.
  // The token exchange fires a SIGNED_IN event via onAuthStateChange instead.
  // Register the listener FIRST, then bail — _initApp runs when SIGNED_IN fires.
  if (window.location.hash.startsWith('#access_token=')) {
    db.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN') await _initApp(session.user);
      else if (event === 'SIGNED_OUT' && currentUser) {
        setCurrentUser(null); updateUserUI(); window.location.reload();
      }
    });
    return; // _initApp called by the listener above; nothing more to do here
  }

  // ── Normal flow: page refresh / returning user ─────────────────────────
  // getSession() reads the session from localStorage without side-effects on it.
  // Registering onAuthStateChange FIRST in this Supabase build fires SIGNED_OUT
  // prematurely and wipes localStorage before getSession() can read it, so we
  // always call getSession() first for non-OAuth page loads.
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    await _initApp(session.user);
  } else {
    checkFirstVisit();
    updateUserUI(); // show guest sign-in button for returning guests
  }

  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && !currentUser) await _initApp(session.user);
    else if (event === 'SIGNED_OUT' && currentUser) {
      setCurrentUser(null); updateUserUI(); window.location.reload();
    }
  });
})();

// ══════════════════════════════════════════════════
//  WINDOW EXPORTS
//  ES modules don't pollute window; expose every
//  function called from inline HTML onclick/onchange.
// ══════════════════════════════════════════════════
Object.assign(window, {
  // Auth / landing
  signInWithGoogle, signInWithGitHub, submitEmailAuth, setAuthMode,
  launchApp, showSignInOverlay, signOut,
  // Account menu & currency
  toggleAccountMenu, setCurrency,
  // Navigation & sidebar
  navigate, toggleSidebar, toggleNavGroup, toggleNavSubgroup, toggleDarkMode,
  // Migration banner
  migrateFromLocalStorage, dismissMigration,
  // One-off transactions
  addOneoff, setOneoffType, setOneoffFilter, exportOneoffs,
  deleteIncome, deleteExpense,
  // Recurring transactions
  saveRecurring, cancelRecurringEdit, setRecType, switchRecTab,
  onRecFrequencyChange, toggleRecMonths, toggleMonthBtn, exportRecurring,
  editRecurring, deleteRecurring,
  // Cashflow
  renderCashflow,
  // Credit cards
  saveCard, cancelCardEdit, editCard, deleteCard, toggleCCMinInput,
  // Calculators
  switchCalcTab, toggleMinPayInput, calcMinPayment, calcFixedPayment, calcInterestComparison,
  // 0% Deals
  saveDeal, cancelDealEdit, editDeal, deleteDeal,
  // CC Transactions
  addCCTransaction, setCCTType, setCCTFilter, exportCCTransactions,
  editCCTransaction, deleteCCTransaction, saveCCTEdit, cancelCCTEdit,
  // Loans
  saveLoan, cancelLoanEdit, editLoan, deleteLoan,
  // Accounts & Transfers
  saveAccount, cancelAccountEdit, editAccount, deleteAccount,
  switchAccountTab, toggleAccInterestInput,
  saveTransfer, cancelTransferEdit, editTransfer, deleteTransfer,
});

// Error telemetry
window.onerror = function(msg, src, line, col, err) {
  if (window.posthog) posthog.capture('js_error', { message: msg, source: src, line, col, stack: err && err.stack });
};
window.onunhandledrejection = function(e) {
  if (window.posthog) posthog.capture('js_error', { message: 'Unhandled promise rejection: ' + e.reason, type: 'promise' });
};
