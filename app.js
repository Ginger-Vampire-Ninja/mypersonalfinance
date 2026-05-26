// ══════════════════════════════════════════════════
//  DATA
// ══════════════════════════════════════════════════
let incomeData       = JSON.parse(localStorage.getItem('mf_income')    || '[]');
let expenseData      = JSON.parse(localStorage.getItem('mf_expenses')  || '[]');
let recurringData    = JSON.parse(localStorage.getItem('mf_recurring') || '[]');
let creditCards      = JSON.parse(localStorage.getItem('mf_cards')     || '[]');
let interestFreeDeals= JSON.parse(localStorage.getItem('mf_deals')     || '[]');
// Load CC transactions, defaulting legacy entries (no type field) to 'charge'
let ccTransactions = JSON.parse(localStorage.getItem('mf_cc_transactions') || '[]')
  .map(t => ({ ...t, type: t.type || 'charge' }));
let loansData = JSON.parse(localStorage.getItem('mf_loans') || '[]');

// One-time migration: absorb any entries saved under the old separate CC payments key
(function migrateCCPayments() {
  const old = JSON.parse(localStorage.getItem('mf_cc_payments') || '[]');
  if (!old.length) return;
  old.forEach(p => { if (!ccTransactions.find(t => t.id === p.id)) ccTransactions.push({ ...p, type: 'payment', category: 'CC Payment' }); });
  localStorage.removeItem('mf_cc_payments');
  localStorage.setItem('mf_cc_transactions', JSON.stringify(ccTransactions));
})();

function saveData() {
  localStorage.setItem('mf_income',    JSON.stringify(incomeData));
  localStorage.setItem('mf_expenses',  JSON.stringify(expenseData));
  localStorage.setItem('mf_recurring', JSON.stringify(recurringData));
  localStorage.setItem('mf_cards',     JSON.stringify(creditCards));
  localStorage.setItem('mf_deals',           JSON.stringify(interestFreeDeals));
  localStorage.setItem('mf_cc_transactions', JSON.stringify(ccTransactions));
  localStorage.setItem('mf_loans',           JSON.stringify(loansData));
}

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
//  HELPERS
// ══════════════════════════════════════════════════
function fmt(n)  { return '£' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtS(n) { return (n < 0 ? '-' : '+') + fmt(n); }
function todayStr() { return new Date().toISOString().split('T')[0]; }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function formatDate(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatMonthYear(y, m) {
  return new Date(y, m, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}
function isThisMonthOrFuture(ds) {
  const now = new Date(); const d = new Date(ds + 'T00:00:00');
  return d.getFullYear() > now.getFullYear() || (d.getFullYear() === now.getFullYear() && d.getMonth() >= now.getMonth());
}
function setDefaultDates() {
  const t = todayStr();
  ['oneoff-date','rec-start','deal-start','cct-date','loan-start'].forEach(id => { const el = document.getElementById(id); if (el) el.value = t; });
}

const FREQ_MONTHLY = { weekly:52/12, fortnightly:26/12, monthly:1, quarterly:4/12, annually:1/12 };
const FREQ_LABELS  = { weekly:'Weekly', fortnightly:'Fortnightly', monthly:'Monthly', quarterly:'Quarterly', annually:'Annually' };
function monthlyEquiv(item) { return item.amount * FREQ_MONTHLY[item.frequency]; }

// ══════════════════════════════════════════════════
//  DEALS — helper to get total interest-free amount
//  for a given card in a given month
// ══════════════════════════════════════════════════
function getInterestFreeAmount(cardId, monthStart) {
  return interestFreeDeals
    .filter(d => {
      if (d.cardId !== cardId) return false;
      const start = new Date(d.startDate + 'T00:00:00');
      const end   = new Date(d.endDate   + 'T00:00:00');
      // Set end to end of day so the end month is fully included
      end.setHours(23, 59, 59);
      return start <= monthStart && end >= monthStart;
    })
    .reduce((sum, d) => sum + d.amount, 0);
}

// ══════════════════════════════════════════════════
//  RECURRING — date generation
// ══════════════════════════════════════════════════
function getOccurrenceDates(item, fromDate, toDate) {
  const dates = [];
  const start = new Date(item.startDate + 'T00:00:00');
  const endCap= item.endDate ? new Date(item.endDate + 'T00:00:00') : null;
  let cur = new Date(start);
  function advance() {
    switch (item.frequency) {
      case 'weekly':      cur.setDate(cur.getDate() + 7); break;
      case 'fortnightly': cur.setDate(cur.getDate() + 14); break;
      case 'monthly':     cur.setMonth(cur.getMonth() + 1); break;
      case 'quarterly':   cur.setMonth(cur.getMonth() + 3); break;
      case 'annually':    cur.setFullYear(cur.getFullYear() + 1); break;
    }
  }
  while (cur < fromDate) advance();
  const effEnd = endCap ? new Date(Math.min(endCap, toDate)) : toDate;
  while (cur <= effEnd) { dates.push(new Date(cur)); advance(); if (dates.length > 1000) break; }
  return dates;
}

function getAmountForMonth(item, year, month) {
  const ms = new Date(year, month, 1);
  const me = new Date(year, month + 1, 0, 23, 59, 59);
  const is = new Date(item.startDate + 'T00:00:00');
  const ie = item.endDate ? new Date(item.endDate + 'T00:00:00') : null;
  if (is > me) return 0;
  if (ie && ie < ms) return 0;
  if (item.frequency === 'monthly') return item.amount;
  return getOccurrenceDates(item, ms, me).length * item.amount;
}

// ══════════════════════════════════════════════════
//  CASHFLOW PROJECTION ENGINE
// ══════════════════════════════════════════════════
function generateProjection(numMonths) {
  const now = new Date();
  const sy = now.getFullYear(), sm = now.getMonth();

  // Clone card balances for roll-forward simulation
  const cardStates = creditCards.map(c => ({
    id: c.id, name: c.name, apr: c.apr,
    minType: c.minType, minPct: c.minPct, minFloor: c.minFloor, minFixed: c.minFixed,
    balance: c.balance
  }));

  const rows = [];

  for (let i = 0; i < numMonths; i++) {
    const yr = sy + Math.floor((sm + i) / 12);
    const mo = (sm + i) % 12;
    const monthStart = new Date(yr, mo, 1);
    const isPast = monthStart < new Date(now.getFullYear(), now.getMonth(), 1);

    // Recurring income
    let recInc = 0; const incItems = [];
    recurringData.filter(r => r.type === 'income').forEach(r => {
      const amt = getAmountForMonth(r, yr, mo);
      if (amt > 0) { recInc += amt; incItems.push({ name: r.name, amount: amt }); }
    });

    // Recurring expenses
    let recExp = 0; const expItems = [];
    recurringData.filter(r => r.type === 'expense').forEach(r => {
      const amt = getAmountForMonth(r, yr, mo);
      if (amt > 0) { recExp += amt; expItems.push({ name: r.name, amount: amt }); }
    });
    // Loan repayments treated as recurring expenses
    loansData.forEach(loan => {
      const loanItem = { frequency: loan.frequency, startDate: loan.startDate, endDate: loan.endDate || null };
      const amt = getAmountForMonth(loanItem, yr, mo);
      if (amt > 0) { recExp += amt; expItems.push({ name: loan.lender + ' (loan)', amount: amt }); }
    });

    // One-off income for this calendar month
    let oneOffInc = 0; const oneOffIncItems = [];
    incomeData.filter(r => {
      const d = new Date(r.date + 'T00:00:00');
      return d.getFullYear() === yr && d.getMonth() === mo;
    }).forEach(r => { oneOffInc += r.amount; oneOffIncItems.push({ name: r.description || r.category, amount: r.amount }); });

    // One-off expenses for this calendar month
    let oneOffExp = 0; const oneOffExpItems = [];
    expenseData.filter(r => {
      const d = new Date(r.date + 'T00:00:00');
      return d.getFullYear() === yr && d.getMonth() === mo;
    }).forEach(r => { oneOffExp += r.amount; oneOffExpItems.push({ name: r.description || r.category, amount: r.amount }); });

    // Apply CC charges for this month (new purchases increase the balance before interest)
    ccTransactions.filter(t => {
      if (t.type === 'payment') return false;
      const d = new Date(t.date + 'T00:00:00');
      return d.getFullYear() === yr && d.getMonth() === mo;
    }).forEach(t => {
      const card = cardStates.find(c => c.id === t.cardId);
      if (card) card.balance += t.amount;
    });

    // Apply CC payments for this month (reduce balance before interest; cash outflow added to one-off expenses)
    ccTransactions.filter(t => {
      if (t.type !== 'payment') return false;
      const d = new Date(t.date + 'T00:00:00');
      return d.getFullYear() === yr && d.getMonth() === mo;
    }).forEach(t => {
      const card = cardStates.find(c => c.id === t.cardId);
      if (card) card.balance = Math.max(0, card.balance - t.amount);
      oneOffExp += t.amount;
      const cardName = card ? card.name : 'CC';
      oneOffExpItems.push({ name: (t.description || 'Payment') + ' → ' + cardName, amount: t.amount });
    });

    // Credit card minimum payments (with interest-free deal awareness)
    let ccTotal = 0; const ccPayments = [];
    cardStates.forEach(card => {
      if (card.balance <= 0.005) {
        ccPayments.push({ name: card.name, payment: 0, interest: 0, newBalance: 0, interestFree: false });
        return;
      }
      const monthlyRate     = card.apr / 100 / 12;
      const ifAmount        = getInterestFreeAmount(card.id, monthStart);
      const chargeableAmt   = Math.max(0, card.balance - ifAmount);
      const interest        = chargeableAmt * monthlyRate;
      const hasActiveDeal   = ifAmount > 0 && chargeableAmt < card.balance;
      card.balance         += interest;

      let payment;
      if (card.minType === 'percent') {
        payment = Math.max(card.balance * (card.minPct / 100), card.minFloor || 25);
      } else {
        payment = card.minFixed;
      }
      payment = Math.min(payment, card.balance);
      card.balance = Math.max(0, card.balance - payment);
      ccTotal += payment;
      ccPayments.push({ name: card.name, payment, interest, newBalance: card.balance, interestFree: hasActiveDeal, ifAmount });
    });

    const net = recInc + oneOffInc - recExp - oneOffExp - ccTotal;
    rows.push({
      yr, mo, isPast, net,
      recInc, oneOffInc, incItems, oneOffIncItems,
      recExp, oneOffExp, expItems, oneOffExpItems,
      ccTotal, ccPayments,
      cardSnapshot: cardStates.map(c => ({
        id: c.id, name: c.name, balance: c.balance,
        hasActiveDeal: getInterestFreeAmount(c.id, monthStart) > 0
      }))
    });
  }
  return rows;
}

// ══════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════
function renderDashboard() {
  const totalInc = incomeData.reduce((s, r) => s + r.amount, 0);
  const totalExp = expenseData.reduce((s, r) => s + r.amount, 0);
  const balance  = totalInc - totalExp;
  const recInc   = recurringData.filter(r=>r.type==='income').reduce((s,r)=>s+monthlyEquiv(r),0);
  const recExp   = recurringData.filter(r=>r.type==='expense').reduce((s,r)=>s+monthlyEquiv(r),0);

  document.getElementById('dash-income').textContent         = fmt(totalInc);
  document.getElementById('dash-income-count').textContent   = incomeData.length + ' entries';
  document.getElementById('dash-expenses').textContent       = fmt(totalExp);
  document.getElementById('dash-expenses-count').textContent = expenseData.length + ' entries';
  document.getElementById('dash-balance').textContent        = (balance<0?'-':'')+fmt(balance);
  document.getElementById('dash-balance').style.color        = balance>=0?'#0F766E':'#ef4444';
  const recNet = recInc - recExp;
  document.getElementById('dash-recurring-net').textContent  = (recNet<0?'-':'+')+fmt(recNet);
  document.getElementById('dash-recurring-net').style.color  = recNet>=0?'#22c55e':'#ef4444';

  const ri = [...incomeData].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
  document.getElementById('dash-recent-income').innerHTML = ri.length
    ? ri.map(r=>`<tr><td>${formatDate(r.date)}</td><td><span class="badge badge-income">${r.category}</span></td><td style="color:#16a34a;font-weight:600">${fmt(r.amount)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-state">No income yet</td></tr>';

  const re = [...expenseData].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
  document.getElementById('dash-recent-expenses').innerHTML = re.length
    ? re.map(r=>`<tr><td>${formatDate(r.date)}</td><td><span class="badge badge-expense">${r.category}</span></td><td style="color:#dc2626;font-weight:600">${fmt(r.amount)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-state">No expenses yet</td></tr>';

  const today = new Date(); today.setHours(0,0,0,0);
  const in14  = new Date(today); in14.setDate(in14.getDate()+14);
  const upcoming = [];
  recurringData.forEach(item => getOccurrenceDates(item, today, in14).forEach(d =>
    upcoming.push({ date: d, type: item.type, name: item.name, amount: item.amount })));
  upcoming.sort((a,b) => a.date - b.date);

  const upDiv = document.getElementById('dash-upcoming');
  if (!upcoming.length) {
    upDiv.innerHTML = '<div class="empty-state" style="padding:24px 0">No recurring transactions in the next 14 days</div>';
    return;
  }
  upDiv.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Amount</th></tr></thead><tbody>'
    + upcoming.map(u => `<tr><td>${formatDate(u.date.toISOString().split('T')[0])}</td>
        <td style="font-weight:600">${u.name}</td>
        <td><span class="badge badge-${u.type}">${u.type}</span></td>
        <td style="font-weight:600;color:${u.type==='income'?'#16a34a':'#dc2626'}">${u.type==='income'?'+':'-'}${fmt(u.amount)}</td></tr>`).join('')
    + '</tbody></table></div>';
}

// ══════════════════════════════════════════════════
//  ONE-OFF TRANSACTIONS
// ══════════════════════════════════════════════════
const INCOME_CATS  = ['Salary','Freelance','Bonus','Investment','Rental','Gift','Other'];
const EXPENSE_CATS = ['Housing','Food & Groceries','Transport','Utilities','Healthcare','Entertainment','Clothing','Subscriptions','Eating Out','Personal Care','Education','Other'];

let currentOneoffType   = 'income';
let currentOneoffFilter = 'all';

function setOneoffType(type) {
  currentOneoffType = type;
  document.getElementById('oneoff-toggle-income').classList.toggle('active',  type==='income');
  document.getElementById('oneoff-toggle-expense').classList.toggle('active', type==='expense');
  const cats = type==='income' ? INCOME_CATS : EXPENSE_CATS;
  document.getElementById('oneoff-category').innerHTML = cats.map(c=>`<option>${c}</option>`).join('');
}

function setOneoffFilter(f) {
  currentOneoffFilter = f;
  ['all','income','expense'].forEach(t => document.getElementById('oneoff-tab-'+t).classList.toggle('active', f===t));
  renderOneoffList();
}

function addOneoff() {
  const date=document.getElementById('oneoff-date').value, cat=document.getElementById('oneoff-category').value;
  const amt=parseFloat(document.getElementById('oneoff-amount').value), desc=document.getElementById('oneoff-description').value.trim();
  if (!date) { toast('⚠️ Please pick a date'); return; }
  if (isNaN(amt)||amt<=0) { toast('⚠️ Enter a valid amount'); return; }
  const entry = { id:Date.now(), date, category:cat, amount:amt, description:desc||cat };
  if (currentOneoffType==='income') { incomeData.push(entry); } else { expenseData.push(entry); }
  saveData(); renderOneoffList(); toast('✅ Entry added!');
  if (window.posthog) posthog.capture('transaction_added', { type: currentOneoffType, category: cat });
  document.getElementById('oneoff-amount').value=''; document.getElementById('oneoff-description').value='';
}

function deleteIncome(id)  { incomeData =incomeData.filter(r=>r.id!==id);  saveData(); renderOneoffList(); toast('🗑 Deleted'); }
function deleteExpense(id) { expenseData=expenseData.filter(r=>r.id!==id); saveData(); renderOneoffList(); toast('🗑 Deleted'); }

function renderOneoffList() {
  const tbody = document.getElementById('oneoff-table-body');
  if (!tbody) return;
  const today = todayStr();
  let rows = [];
  if (currentOneoffFilter !== 'expense') incomeData.forEach(r  => rows.push({...r, type:'income'}));
  if (currentOneoffFilter !== 'income')  expenseData.forEach(r => rows.push({...r, type:'expense'}));
  // Merge in CC payments as read-only expense rows
  if (currentOneoffFilter !== 'income') {
    ccTransactions.filter(t => t.type === 'payment').forEach(t => {
      const card = creditCards.find(c => c.id === t.cardId);
      const cardName = card ? card.name : 'Unknown Card';
      rows.push({
        id: t.id, date: t.date, type: 'expense',
        category: 'CC Payment',
        description: t.description ? `${t.description} (${cardName})` : `Payment to ${cardName}`,
        amount: t.amount, _ccPayment: true
      });
    });
  }
  rows.sort((a,b) => new Date(b.date)-new Date(a.date));

  const totalInc = incomeData.reduce((s,r)=>s+r.amount,0);
  const totalExp = expenseData.reduce((s,r)=>s+r.amount,0) + ccTransactions.filter(t=>t.type==='payment').reduce((s,t)=>s+t.amount,0);
  const net = totalInc - totalExp;
  const summaryEl = document.getElementById('oneoff-summary');
  if (summaryEl) summaryEl.innerHTML =
    `<span style="color:#16a34a">+£${totalInc.toFixed(2)}</span> &nbsp;·&nbsp; `+
    `<span style="color:#dc2626">-£${totalExp.toFixed(2)}</span> &nbsp;·&nbsp; `+
    `<span style="color:${net>=0?'#0F766E':'#dc2626'};font-weight:700">Net: ${fmtS(net)}</span>`;

  if (!rows.length) { tbody.innerHTML='<tr><td colspan="7" class="empty-state">No entries yet</td></tr>'; return; }
  tbody.innerHTML = rows.map(r => {
    const future=r.date>today, inFc=isThisMonthOrFuture(r.date);
    let actionCell;
    if (r._ccPayment) {
      actionCell = `<td><span class="badge" style="background:#dbeafe;color:#1d4ed8;font-size:0.7rem;cursor:pointer" onclick="navigate('cctransactions')" title="Manage on CC Transactions page">💸 CC Payment</span></td>`;
    } else {
      const delFn = r.type==='income' ? `deleteIncome(${r.id})` : `deleteExpense(${r.id})`;
      actionCell = `<td><button class="btn-sm-danger" onclick="${delFn}">Delete</button></td>`;
    }
    return `<tr>
      <td>${formatDate(r.date)}${future?` <span class="badge badge-oneoff">future</span>`:''}</td>
      <td><span class="badge badge-${r.type}">${r.type}</span></td>
      <td>${r.category}</td>
      <td style="color:#666">${r.description}</td>
      <td style="font-weight:600;color:${r.type==='income'?'#16a34a':'#dc2626'}">${r.type==='income'?'+':'-'}${fmt(r.amount)}</td>
      <td>${inFc?'<span class="badge badge-freq">In forecast</span>':'<span style="color:#ccc;font-size:0.8rem">Historical</span>'}</td>
      ${actionCell}</tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════
//  RECURRING
// ══════════════════════════════════════════════════
let currentRecType = 'income';
function setRecType(type) {
  currentRecType = type;
  document.getElementById('rec-toggle-income').classList.toggle('active', type==='income');
  document.getElementById('rec-toggle-expense').classList.toggle('active', type==='expense');
}
function addRecurring() {
  const name=document.getElementById('rec-name').value.trim(), cat=document.getElementById('rec-category').value;
  const amt=parseFloat(document.getElementById('rec-amount').value), freq=document.getElementById('rec-frequency').value;
  const start=document.getElementById('rec-start').value, end=document.getElementById('rec-end').value;
  if (!name) { toast('⚠️ Enter a name'); return; }
  if (isNaN(amt)||amt<=0) { toast('⚠️ Enter a valid amount'); return; }
  if (!start) { toast('⚠️ Pick a start date'); return; }
  recurringData.push({ id:Date.now(), type:currentRecType, name, category:cat, amount:amt, frequency:freq, startDate:start, endDate:end||null });
  saveData(); renderRecurringTable(); renderUpcomingTimeline(); toast('✅ Recurring transaction added!');
  if (window.posthog) posthog.capture('recurring_added', { type: currentRecType, frequency: freq, category: cat });
  document.getElementById('rec-name').value=''; document.getElementById('rec-amount').value=''; document.getElementById('rec-end').value='';
}
function deleteRecurring(id) { recurringData=recurringData.filter(r=>r.id!==id); saveData(); renderRecurringTable(); renderUpcomingTimeline(); toast('🗑 Deleted'); }
function renderRecurringTable() {
  const tbody=document.getElementById('recurring-table-body');
  // Build loan read-only rows
  const loanRows = loansData.map(loan => `<tr style="opacity:0.8">
    <td><span class="badge badge-expense" style="background:#1e3a5f;color:#93c5fd">🏦 Loan</span></td>
    <td style="font-weight:600">${loan.lender}</td><td style="color:#888;font-size:0.82rem">Loan Repayment</td>
    <td style="font-weight:600">${fmt(loan.repaymentAmount)}</td>
    <td><span class="badge badge-freq">${FREQ_LABELS[loan.frequency]||loan.frequency}</span></td>
    <td style="color:#666">${fmt(monthlyEquiv({ amount: loan.repaymentAmount, frequency: loan.frequency }))}/mo</td>
    <td style="color:#888;font-size:0.82rem">${formatDate(loan.startDate)}</td>
    <td style="color:#888;font-size:0.82rem">${loan.endDate?formatDate(loan.endDate):'—'}</td>
    <td style="color:#aaa;font-size:0.78rem;font-style:italic">Managed in Loans</td></tr>`);
  if (!recurringData.length && !loanRows.length) { tbody.innerHTML='<tr><td colspan="9" class="empty-state">No recurring transactions yet</td></tr>'; return; }
  tbody.innerHTML=recurringData.map(r=>`<tr>
    <td><span class="badge badge-${r.type}">${r.type}</span></td>
    <td style="font-weight:600">${r.name}</td><td>${r.category}</td>
    <td style="font-weight:600">${fmt(r.amount)}</td>
    <td><span class="badge badge-freq">${FREQ_LABELS[r.frequency]}</span></td>
    <td style="color:#666">${fmt(monthlyEquiv(r))}/mo</td>
    <td style="color:#888;font-size:0.82rem">${formatDate(r.startDate)}</td>
    <td style="color:#888;font-size:0.82rem">${r.endDate?formatDate(r.endDate):'—'}</td>
    <td><button class="btn-sm-danger" onclick="deleteRecurring(${r.id})">Delete</button></td></tr>`).join('') + loanRows.join('');
}
function renderUpcomingTimeline() {
  const today=new Date(); today.setHours(0,0,0,0);
  const in60=new Date(today); in60.setDate(in60.getDate()+60);
  const items=[];
  recurringData.forEach(item => getOccurrenceDates(item,today,in60).forEach(d =>
    items.push({ date:d, type:item.type, name:item.name, category:item.category, amount:item.amount, freq:item.frequency })));
  items.sort((a,b)=>a.date-b.date);
  const div=document.getElementById('recurring-timeline');
  if (!items.length) { div.innerHTML='<div class="empty-state" style="padding:40px 0">No upcoming transactions in the next 60 days</div>'; return; }
  const byDate={};
  items.forEach(item=>{ const k=item.date.toISOString().split('T')[0]; if(!byDate[k])byDate[k]=[]; byDate[k].push(item); });
  let html='<div class="timeline">';
  Object.entries(byDate).forEach(([ds,txns])=>{
    const label=new Date(ds+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
    txns.forEach(t=>{ html+=`<div class="tl-item"><div class="tl-dot ${t.type}"></div><div class="tl-date">${label}</div>
      <div class="tl-content"><div><div class="tl-name">${t.name}</div><div class="tl-cat">${t.category} · ${FREQ_LABELS[t.freq]}</div></div>
      <div class="tl-amount ${t.type}">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div></div></div>`; });
  });
  div.innerHTML=html+'</div>';
}
function switchRecTab(tab, el) {
  document.querySelectorAll('#page-recurring .tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('#page-recurring .tab-pane').forEach(p=>p.classList.remove('active'));
  el.classList.add('active'); document.getElementById('rec-tab-'+tab).classList.add('active');
}

// ══════════════════════════════════════════════════
//  CASHFLOW RENDER
// ══════════════════════════════════════════════════
function renderCashflow() {
  const numMonths=parseInt(document.getElementById('cf-months-select').value);
  const rows=generateProjection(numMonths);
  if (window.posthog) posthog.capture('cashflow_viewed', { months: numMonths });

  const avgInc   =recurringData.filter(r=>r.type==='income').reduce((s,r)=>s+monthlyEquiv(r),0);
  const avgExp   =recurringData.filter(r=>r.type==='expense').reduce((s,r)=>s+monthlyEquiv(r),0);
  const totalDebt=creditCards.reduce((s,c)=>s+c.balance,0);
  const nextNet  =rows.length?rows[0].net:0;

  document.getElementById('cf-monthly-income').textContent   =fmt(avgInc);
  document.getElementById('cf-monthly-expenses').textContent =fmt(avgExp);
  document.getElementById('cf-cc-debt').textContent          =fmt(totalDebt);
  document.getElementById('cf-cc-count').textContent         =creditCards.length+' card'+(creditCards.length!==1?'s':'');
  document.getElementById('cf-next-month-net').textContent   =(nextNet<0?'-':'+')+fmt(nextNet);
  document.getElementById('cf-next-month-net').style.color   =nextNet>=0?'#22c55e':'#ef4444';

  // Bar chart
  const maxAbs=Math.max(...rows.map(r=>Math.abs(r.net)),1);
  document.getElementById('cf-bar-chart').innerHTML=rows.map(r=>{
    const pct=Math.min((Math.abs(r.net)/maxAbs)*100,100), pos=r.net>=0;
    const col=pos?'#22c55e':'#ef4444';
    const hasOneOff=r.oneOffInc>0||r.oneOffExp>0;
    return `<div class="bar-row" style="${r.isPast?'opacity:0.5':''}">
      <div class="bar-label">${formatMonthYear(r.yr,r.mo)}</div>
      <div class="bar-track"><div class="bar-fill ${pos?'pos':'neg'}" style="width:${pct}%"></div></div>
      <div class="bar-value" style="color:${col}">${pos?'+':'-'}${fmt(r.net)}${hasOneOff?'<span class="cf-oneoff-dot" title="Includes one-off entries"></span>':''}</div>
    </div>`;
  }).join('')||'<div class="empty-state">Add recurring transactions to see projections</div>';

  // Monthly breakdown table
  let running=0;
  document.getElementById('cf-table-body').innerHTML=rows.map(r=>{
    running+=r.net;
    const nc=r.net>0?'cf-positive':r.net<0?'cf-negative':'cf-zero';
    const rc=running>0?'cf-positive':running<0?'cf-negative':'cf-zero';
    const incTip=[...r.incItems.map(i=>'🔁 '+i.name+': '+fmt(i.amount)),...r.oneOffIncItems.map(i=>'📌 '+i.name+': '+fmt(i.amount))].join('\n');
    const expTip=[...r.expItems.map(i=>'🔁 '+i.name+': '+fmt(i.amount)),...r.oneOffExpItems.map(i=>'📌 '+i.name+': '+fmt(i.amount))].join('\n');
    const ccTip=r.ccPayments.filter(p=>p.payment>0).map(p=>p.name+': '+fmt(p.payment)+(p.interestFree?' (0% deal active, no interest)':' (inc. '+fmt(p.interest)+' interest)')).join('\n');
    const ccHas0=r.ccPayments.some(p=>p.interestFree&&p.payment>0);
    return `<tr class="${r.isPast?'cf-past':''}">
      <td>${formatMonthYear(r.yr,r.mo)}</td>
      <td title="${incTip}" style="color:#16a34a;cursor:${r.recInc?'help':'default'}">${r.recInc>0?fmt(r.recInc):'—'}</td>
      <td title="${r.oneOffIncItems.map(i=>'📌 '+i.name+': '+fmt(i.amount)).join('\n')}" style="color:#16a34a;cursor:${r.oneOffIncItems.length?'help':'default'}">${r.oneOffInc>0?fmt(r.oneOffInc):'—'}</td>
      <td title="${expTip}" style="color:#dc2626;cursor:${r.recExp?'help':'default'}">${r.recExp>0?fmt(r.recExp):'—'}</td>
      <td title="${r.oneOffExpItems.map(i=>'📌 '+i.name+': '+fmt(i.amount)).join('\n')}" style="color:#dc2626;cursor:${r.oneOffExpItems.length?'help':'default'}">${r.oneOffExp>0?fmt(r.oneOffExp):'—'}</td>
      <td title="${ccTip}" style="color:#7c3aed;cursor:${ccTip?'help':'default'}">${r.ccTotal>0?fmt(r.ccTotal)+(ccHas0?' <span class="zero-pct-tag">0%</span>':''):'—'}</td>
      <td class="${nc}">${fmtS(r.net)}</td>
      <td class="${rc}">${fmtS(running)}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="8" class="empty-state">Add transactions and credit cards to see your forecast</td></tr>';

  // Card balance tracker
  const panel=document.getElementById('cf-card-tracker-panel');
  if (!creditCards.length) { panel.style.display='none'; return; }
  panel.style.display='block';
  const table=document.getElementById('cf-card-tracker-table');
  table.innerHTML='<thead><tr><th>Month</th>'+creditCards.map(c=>`<th>${c.name}</th>`).join('')+'</tr></thead><tbody>'
    +rows.map(r=>`<tr class="${r.isPast?'cf-past':''}"><td>${formatMonthYear(r.yr,r.mo)}</td>`
      +creditCards.map(card=>{
        const snap=r.cardSnapshot.find(s=>s.id===card.id);
        const bal=snap?snap.balance:0;
        if (bal<=0.005) return '<td style="color:#16a34a;font-weight:600">✓ Paid off</td>';
        const dealActive=snap?snap.hasActiveDeal:false;
        return `<td style="color:${dealActive?'#065f46':'#dc2626'};font-weight:600">${fmt(bal)}${dealActive?' <span class="zero-pct-tag">0%</span>':''}</td>`;
      }).join('')+'</tr>').join('')+'</tbody>';
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
  if (!name)                    { toast('⚠️ Enter a card name'); return; }
  if (isNaN(balance)||balance<0){ toast('⚠️ Enter a valid balance'); return; }
  if (isNaN(apr)||apr<=0)       { toast('⚠️ Enter a valid APR'); return; }
  if (minType==='percent'&&(isNaN(minPct)||minPct<=0)) { toast('⚠️ Enter a valid minimum %'); return; }
  if (minType==='fixed'&&(isNaN(minFixed)||minFixed<=0)){ toast('⚠️ Enter a valid fixed payment'); return; }
  const card={ id:editId?parseInt(editId):Date.now(), name, balance, apr, minType, minPct, minFloor, minFixed };
  if (editId) creditCards=creditCards.map(c=>c.id===card.id?card:c); else creditCards.push(card);
  saveData(); renderCardList(); clearCardForm(); toast(editId?'✅ Card updated!':'✅ Card saved!');
  if (window.posthog) posthog.capture('card_saved', { is_edit: !!editId, min_type: minType });
}
function clearCardForm() {
  ['cc-name','cc-balance','cc-apr','cc-min-pct','cc-min-fixed'].forEach(id=>document.getElementById(id).value='');
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
  document.getElementById('cc-edit-id').value =id;
  document.getElementById('cc-form-title').textContent='Editing: '+c.name;
  document.getElementById('cc-cancel-btn').style.display='';
  toggleCCMinInput(); document.getElementById('cc-name').focus();
  toast('✏️ Editing — update fields and save');
}
function deleteCard(id) {
  if (interestFreeDeals.some(d=>d.cardId===id)) {
    if (!confirm('This card has interest-free deals linked to it. Deleting the card will also remove those deals. Continue?')) return;
    interestFreeDeals=interestFreeDeals.filter(d=>d.cardId!==id);
  }
  creditCards=creditCards.filter(c=>c.id!==id);
  saveData(); renderCardList(); toast('🗑 Card deleted');
}
function renderCardList() {
  const div=document.getElementById('cc-card-list');
  if (!creditCards.length) { div.innerHTML='<div class="empty-state" style="padding:24px 0">No cards saved yet. Add your first card above.</div>'; return; }
  const today=todayStr();
  div.innerHTML=creditCards.map(c=>{
    const interest=c.balance*(c.apr/100/12);
    let minPay=c.minType==='percent'?Math.max(c.balance*(c.minPct/100),c.minFloor||25):c.minFixed;
    minPay=Math.min(minPay,c.balance);
    const minLabel=c.minType==='percent'?`${c.minPct}% (min £${c.minFloor||25})`:`£${c.minFixed} fixed`;
    // Active deals for this card
    const now=new Date(today+'T00:00:00');
    const activeDeals=interestFreeDeals.filter(d=>{
      if(d.cardId!==c.id) return false;
      const s=new Date(d.startDate+'T00:00:00'), e=new Date(d.endDate+'T00:00:00'); e.setHours(23,59,59);
      return s<=now && e>=now;
    });
    const dealBadges=activeDeals.map(d=>{
      const e=new Date(d.endDate+'T00:00:00');
      const days=Math.round((e-now)/86400000);
      return `<span class="badge badge-active" title="${d.note||''}">0% on ${fmt(d.amount)} — ${days}d left</span>`;
    }).join(' ');
    return `<div class="card-list-item">
      <div>
        <div class="card-name">💳 ${c.name}</div>
        <div class="card-meta">${c.apr}% APR &nbsp;·&nbsp; Min: ${minLabel} &nbsp;·&nbsp; Monthly interest: ${fmt(interest)} ${dealBadges?'&nbsp;'+dealBadges:''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div><div style="font-size:0.72rem;color:#aaa;text-align:right">Balance</div><div class="card-balance">${fmt(c.balance)}</div></div>
        <div><div style="font-size:0.72rem;color:#aaa;text-align:right">Next min payment</div><div style="font-weight:700;color:#7c3aed">${fmt(minPay)}</div></div>
        <div style="display:flex;gap:8px">
          <button class="btn-sm-ghost" onclick="editCard(${c.id})">Edit</button>
          <button class="btn-sm-danger" onclick="deleteCard(${c.id})">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════
//  0% DEALS PAGE
// ══════════════════════════════════════════════════

function renderDealsPage() {
  const today = new Date(todayStr() + 'T00:00:00');

  // Populate card selector
  const sel = document.getElementById('deal-card-id');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">— select a card —</option>'
    + creditCards.map(c => `<option value="${c.id}">${c.name} (${fmt(c.balance)} balance)</option>`).join('');
  if (currentVal) sel.value = currentVal;

  // Show/hide form based on whether any cards exist
  document.getElementById('deals-no-cards-notice').style.display = creditCards.length ? 'none' : '';
  document.getElementById('deals-form-fields').style.display     = creditCards.length ? '' : 'none';

  // Categorise deals
  const active=[], upcoming=[], expiringSoon=[], expired=[];
  interestFreeDeals.forEach(d => {
    const s = new Date(d.startDate + 'T00:00:00');
    const e = new Date(d.endDate   + 'T00:00:00'); e.setHours(23,59,59);
    const daysLeft = Math.round((e - today) / 86400000);
    if (e < today)      expired.push({ ...d, daysLeft });
    else if (s > today) upcoming.push({ ...d, daysLeft });
    else if (daysLeft <= 90) expiringSoon.push({ ...d, daysLeft });
    else                active.push({ ...d, daysLeft });
  });

  // Summary cards
  const allActive = [...active, ...expiringSoon];
  document.getElementById('deals-active-count').textContent    = allActive.length;
  document.getElementById('deals-active-count').className      = 'card-value ' + (allActive.length ? 'green' : '');
  document.getElementById('deals-free-balance').textContent    = fmt(allActive.reduce((s,d)=>s+d.amount,0));
  document.getElementById('deals-expiring-count').textContent  = expiringSoon.length;
  document.getElementById('deals-expiring-count').className    = 'card-value ' + (expiringSoon.length ? 'amber' : '');
  document.getElementById('deals-expired-count').textContent   = expired.length;

  // Render deals list
  const allDeals = [
    ...expiringSoon.map(d=>({...d,_status:'expiring'})),
    ...active.map(d=>({...d,_status:'active'})),
    ...upcoming.map(d=>({...d,_status:'upcoming'})),
    ...expired.map(d=>({...d,_status:'expired'}))
  ];

  if (!allDeals.length) {
    document.getElementById('deals-list').innerHTML = '<div class="empty-state" style="padding:36px 0">No deals saved yet. Add your first deal above.</div>';
    return;
  }

  const card4 = id => creditCards.find(c => c.id === id);

  document.getElementById('deals-list').innerHTML = allDeals.map(d => {
    const cc = card4(d.cardId);
    const ccName = cc ? cc.name : '(card deleted)';
    const s = new Date(d.startDate + 'T00:00:00');
    const e = new Date(d.endDate   + 'T00:00:00');
    const totalDays   = Math.round((e - s) / 86400000);
    const elapsed     = Math.round((today - s) / 86400000);
    const progressPct = d._status === 'expired' ? 100 :
                        d._status === 'upcoming' ? 0 :
                        Math.min(Math.max((elapsed / totalDays) * 100, 0), 100);

    let badge, cls;
    if      (d._status === 'expiring') { badge = `<span class="badge badge-warning">⚠️ Expiring in ${d.daysLeft}d</span>`; cls = 'active-deal'; }
    else if (d._status === 'active')   { badge = `<span class="badge badge-active">Active — ${d.daysLeft}d left</span>`;    cls = 'active-deal'; }
    else if (d._status === 'upcoming') { badge = `<span class="badge badge-upcoming">Starts ${formatDate(d.startDate)}</span>`; cls = 'upcoming-deal'; }
    else                               { badge = `<span class="badge badge-expired">Expired ${formatDate(d.endDate)}</span>`;   cls = 'expired-deal'; }

    return `<div class="deal-item ${cls}">
      <div style="flex:1;min-width:220px">
        <div class="deal-card-name">💳 ${ccName}</div>
        <div class="deal-meta">
          ${badge}
          ${d.note ? `<span style="color:#888">${d.note}</span>` : ''}
        </div>
        <div class="deal-meta" style="margin-top:6px">
          <span>📅 ${formatDate(d.startDate)} → ${formatDate(d.endDate)}</span>
        </div>
        ${d._status !== 'upcoming' ? `<div class="deal-progress">
          <div style="font-size:0.72rem;color:#aaa;margin-top:6px">${d._status==='expired'?'Completed':'Deal used so far'}</div>
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${progressPct}%"></div></div>
        </div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div style="text-align:right">
          <div style="font-size:0.72rem;color:#aaa">Interest-free amount</div>
          <div class="deal-amount">${fmt(d.amount)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn-sm-ghost" onclick="editDeal(${d.id})">Edit</button>
          <button class="btn-sm-danger" onclick="deleteDeal(${d.id})">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

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

  const deal = { id: editId ? parseInt(editId) : Date.now(), cardId, amount, startDate: start, endDate: end, note };
  if (editId) interestFreeDeals = interestFreeDeals.map(d => d.id === deal.id ? deal : d);
  else        interestFreeDeals.push(deal);

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
  interestFreeDeals = interestFreeDeals.filter(d => d.id !== id);
  saveData(); renderDealsPage(); toast('🗑 Deal deleted');
}

// ══════════════════════════════════════════════════
//  LOANS
// ══════════════════════════════════════════════════
let editingLoanId = null;

function renderLoansPage() {
  const today = todayStr();
  // Summary counts
  const active = loansData.filter(l => !l.endDate || l.endDate >= today);
  const completed = loansData.filter(l => l.endDate && l.endDate < today);
  const totalBorrowed = loansData.reduce((s, l) => s + l.totalAmount, 0);
  // Estimate monthly total from all active loans
  const monthlyTotal = active.reduce((s, l) => s + monthlyEquiv({ amount: l.repaymentAmount, frequency: l.frequency }), 0);

  document.getElementById('loans-active-count').textContent = active.length;
  document.getElementById('loans-completed-count').textContent = completed.length;
  document.getElementById('loans-total-amount').textContent = fmt(totalBorrowed);
  document.getElementById('loans-monthly-total').textContent = fmt(monthlyTotal);

  // Restore form state if editing
  const formTitle = document.getElementById('loan-form-title');
  const cancelBtn = document.getElementById('loan-cancel-btn');
  if (editingLoanId !== null) {
    formTitle.textContent = 'Edit Loan';
    cancelBtn.style.display = '';
    const loan = loansData.find(l => l.id === editingLoanId);
    if (loan) {
      document.getElementById('loan-lender').value = loan.lender;
      document.getElementById('loan-total').value = loan.totalAmount;
      document.getElementById('loan-repayment').value = loan.repaymentAmount;
      document.getElementById('loan-frequency').value = loan.frequency;
      document.getElementById('loan-apr').value = loan.apr || '';
      document.getElementById('loan-start').value = loan.startDate;
      document.getElementById('loan-end').value = loan.endDate || '';
      document.getElementById('loan-note').value = loan.note || '';
      document.getElementById('loan-edit-id').value = loan.id;
    }
  } else {
    formTitle.textContent = 'Add a Loan';
    cancelBtn.style.display = 'none';
  }

  const tbody = document.getElementById('loans-table-body');
  if (!loansData.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No loans saved yet. Add your first loan above.</td></tr>';
    return;
  }
  tbody.innerHTML = loansData.map(l => {
    const isActive = !l.endDate || l.endDate >= today;
    return `<tr>
      <td style="font-weight:600">${l.lender}</td>
      <td>${fmt(l.totalAmount)}</td>
      <td style="font-weight:600">${fmt(l.repaymentAmount)}</td>
      <td><span class="badge badge-freq">${FREQ_LABELS[l.frequency] || l.frequency}</span></td>
      <td style="color:#888">${l.apr ? l.apr + '%' : '—'}</td>
      <td style="color:#888;font-size:0.82rem">${formatDate(l.startDate)}</td>
      <td style="color:#888;font-size:0.82rem">${l.endDate ? formatDate(l.endDate) : '—'}</td>
      <td style="color:#888;font-size:0.82rem">${l.note || '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm" onclick="editLoan(${l.id})" style="margin-right:4px">Edit</button>
        <button class="btn-sm-danger" onclick="deleteLoan(${l.id})">Delete</button>
      </td></tr>`;
  }).join('');
}

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
    if (idx !== -1) loansData[idx] = { ...loansData[idx], lender, totalAmount, repaymentAmount, frequency, apr, startDate, endDate, note };
    editingLoanId = null;
    toast('✅ Loan updated');
    if (window.posthog) posthog.capture('loan_saved', { is_edit: true, frequency });
  } else {
    const id = Date.now();
    loansData.push({ id, lender, totalAmount, repaymentAmount, frequency, apr, startDate, endDate, note });
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
  editingLoanId = null;
}

function editLoan(id) {
  editingLoanId = id;
  renderLoansPage();
  document.getElementById('loans-form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelLoanEdit() {
  editingLoanId = null;
  clearLoanForm();
  renderLoansPage();
}

function deleteLoan(id) {
  loansData = loansData.filter(l => l.id !== id);
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
  if(r.error) return `<div class="result-box"><h3>⚠️ Payment too low</h3><p style="font-size:0.85rem;color:#7c3aed">Payment doesn't cover monthly interest. Debt will never reduce.</p></div>`;
  const y=Math.floor(r.months/12),m=r.months%12,ts=y>0?`${y}yr ${m>0?m+'mo':''}`.trim():`${m} months`;
  return `<div class="result-box"><h3>📊 Payoff Summary</h3>
    <div class="result-row"><span>Time to pay off</span><span class="val">${r.months>=600?'50+ years!':ts}</span></div>
    <div class="result-row"><span>Total paid</span><span class="val">${fmt(r.totalPaid)}</span></div>
    <div class="result-row"><span>Total interest</span><span class="val" style="color:#dc2626">${fmt(r.totalInterest)}</span></div>
    <div class="result-row"><span>Interest as % of balance</span><span class="val">${((r.totalInterest/balance)*100).toFixed(1)}%</span></div>
  </div>
  <div class="payoff-table"><p style="font-size:0.75rem;color:#aaa;margin:10px 0 5px">First ${r.schedule.length} months</p>
    <table><thead><tr><th>Month</th><th>Interest</th><th>Payment</th><th>Balance</th></tr></thead>
    <tbody>${r.schedule.map(s=>`<tr><td>${s.month}</td><td style="color:#dc2626">£${s.interest.toFixed(2)}</td><td style="color:#16a34a">£${s.payment.toFixed(2)}</td><td style="font-weight:600">£${s.balance.toFixed(2)}</td></tr>`).join('')}
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
    <tbody>${rows.map((r,i)=>`<tr style="${i===rows.length-1?'background:#f0fdf4':''}"><td style="font-weight:600">${fmt(r.p)}</td><td>${r.time}</td><td style="color:#dc2626">${fmt(r.interest)}</td><td style="font-weight:600">${fmt(b+r.interest)}</td></tr>`).join('')}</tbody>
  </table><p style="font-size:0.75rem;color:#aaa;margin-top:8px">Balance: ${fmt(b)} · Rate: ${r}% APR · Monthly interest: ${fmt(mi)}</p></div>`;
}

// ══════════════════════════════════════════════════
//  CARD TRANSACTIONS (charges + payments)
// ══════════════════════════════════════════════════
const CC_TXN_CATS = ['Shopping','Food & Groceries','Transport','Entertainment','Utilities','Healthcare','Travel','Clothing','Electronics','Eating Out','Subscriptions','Other'];

let currentCCTFilter    = 'all';
let currentCCTTypeInput = 'charge';
let editingCCTId        = null;

function setCCTFilter(f) {
  currentCCTFilter = f;
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
  ccTransactions.push({ id: Date.now(), cardId, date, amount, category: cat, description: desc || (type === 'charge' ? cat : 'CC Payment'), type });
  saveData(); renderCCTransactions(); toast(type === 'charge' ? '✅ Charge added!' : '✅ Payment recorded!');
  if (window.posthog) posthog.capture('cc_transaction_added', { type, category: cat });
  document.getElementById('cct-amount').value = '';
  document.getElementById('cct-description').value = '';
}

function deleteCCTransaction(id) {
  ccTransactions = ccTransactions.filter(t => t.id !== id);
  saveData(); renderCCTransactions(); renderOneoffList(); toast('🗑 Deleted');
}

function editCCTransaction(id) { editingCCTId = id; renderCCTransactions(); }
function cancelCCTEdit()       { editingCCTId = null; renderCCTransactions(); }

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
  ccTransactions = ccTransactions.map(t => t.id === id ? { ...t, date, cardId, category: cat, description: desc || cat, amount } : t);
  saveData(); editingCCTId = null; renderCCTransactions(); toast('✅ Updated!');
}

function renderCCTransactions() {
  const tbody = document.getElementById('cct-table-body');
  if (!tbody) return;
  const today = todayStr();

  // Show/hide form based on whether cards exist
  const noCardsEl    = document.getElementById('cct-no-cards');
  const formFieldsEl = document.getElementById('cct-form-fields');
  if (noCardsEl && formFieldsEl) {
    noCardsEl.style.display    = creditCards.length ? 'none' : '';
    formFieldsEl.style.display = creditCards.length ? '' : 'none';
  }

  // Repopulate card selector
  const cardSel = document.getElementById('cct-card');
  if (cardSel && creditCards.length) {
    const prev = cardSel.value;
    cardSel.innerHTML = '<option value="">— select a card —</option>'
      + creditCards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    if (prev) cardSel.value = prev;
  }

  // Build filter tabs dynamically (All + one per card)
  const tabsEl = document.getElementById('cct-tabs');
  if (tabsEl) {
    tabsEl.innerHTML =
      `<div class="tab ${currentCCTFilter==='all'?'active':''}" onclick="setCCTFilter('all')">All</div>`
      + creditCards.map(c =>
          `<div class="tab ${currentCCTFilter===String(c.id)?'active':''}" onclick="setCCTFilter('${c.id}')">${c.name}</div>`
        ).join('');
  }

  // Filter rows by selected card
  const rows = (currentCCTFilter === 'all'
    ? [...ccTransactions]
    : ccTransactions.filter(t => String(t.cardId) === currentCCTFilter)
  ).sort((a, b) => new Date(b.date) - new Date(a.date));

  // Summary — separate totals for charges and payments
  const charges  = ccTransactions.filter(t => t.type !== 'payment');
  const payments = ccTransactions.filter(t => t.type === 'payment');
  const totalCharged = charges.reduce((s, t) => s + t.amount, 0);
  const totalPaid    = payments.reduce((s, t) => s + t.amount, 0);
  const summaryEl = document.getElementById('cct-summary');
  if (summaryEl) {
    const parts = [];
    if (charges.length)  parts.push(`<span style="color:#7c3aed">${charges.length} charge${charges.length!==1?'s':''}: ${fmt(totalCharged)}</span>`);
    if (payments.length) parts.push(`<span style="color:#16a34a">${payments.length} payment${payments.length!==1?'s':''}: ${fmt(totalPaid)}</span>`);
    summaryEl.innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No transactions yet</td></tr>';
    return;
  }

  const catOpts  = (sel) => CC_TXN_CATS.map(c => `<option${c===sel?' selected':''}>${c}</option>`).join('');
  const cardOpts = (sel) => creditCards.map(c => `<option value="${c.id}"${c.id===sel?' selected':''}>${c.name}</option>`).join('');

  tbody.innerHTML = rows.map(t => {
    const card      = creditCards.find(c => c.id === t.cardId);
    const cardName  = card ? card.name : '(card deleted)';
    const isPayment = t.type === 'payment';
    const future    = t.date > today;
    const inFc      = isThisMonthOrFuture(t.date);

    if (editingCCTId === t.id) {
      return `<tr id="cct-edit-row-${t.id}" style="background:${isPayment?'#f0fdf4':'#faf5ff'}">
        <td><input class="cct-edit-input" data-field="date" type="date" value="${t.date}" style="width:130px"/></td>
        <td><span class="badge ${isPayment?'badge-income':'badge-expense'}" style="font-size:0.72rem">${isPayment?'💸 Payment':'💳 Charge'}</span></td>
        <td><select class="cct-edit-input" data-field="card" style="width:140px">${cardOpts(t.cardId)}</select></td>
        <td>${isPayment ? '<span style="color:#aaa;font-size:0.82rem">—</span>' : `<select class="cct-edit-input" data-field="cat" style="width:130px">${catOpts(t.category)}</select>`}</td>
        <td><input class="cct-edit-input" data-field="desc" type="text" value="${t.description}" placeholder="Description"/></td>
        <td><input class="cct-edit-input" data-field="amount" type="number" value="${t.amount}" min="0.01" step="0.01" style="width:90px"/></td>
        <td>${inFc?'<span class="badge badge-freq">In forecast</span>':'<span style="color:#ccc;font-size:0.8rem">Historical</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn-sm-ghost" onclick="saveCCTEdit(${t.id})">Save</button>
          <button class="btn-sm-ghost" onclick="cancelCCTEdit()" style="margin-left:4px">Cancel</button>
        </td>
      </tr>`;
    }

    return `<tr>
      <td>${formatDate(t.date)}${future?` <span class="badge badge-oneoff">future</span>`:''}</td>
      <td><span class="badge ${isPayment?'badge-income':'badge-expense'}" style="font-size:0.72rem">${isPayment?'💸 Payment':'💳 Charge'}</span></td>
      <td><span class="badge badge-card">💳 ${cardName}</span></td>
      <td style="color:#666">${isPayment ? '<span style="color:#aaa">—</span>' : t.category}</td>
      <td style="color:#666">${t.description}</td>
      <td style="font-weight:600;color:${isPayment?'#16a34a':'#7c3aed'}">${isPayment?'-':'-'}${fmt(t.amount)}</td>
      <td>${inFc?'<span class="badge badge-freq">In forecast</span>':'<span style="color:#ccc;font-size:0.8rem">Historical</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm-ghost" onclick="editCCTransaction(${t.id})" style="margin-right:4px">Edit</button>
        <button class="btn-sm-danger" onclick="deleteCCTransaction(${t.id})">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════
//  COLLAPSIBLE NAV
// ══════════════════════════════════════════════════
function toggleSidebar() {
  const app = document.querySelector('.app');
  const isNowCollapsed = app.classList.toggle('sidebar-collapsed');
  localStorage.setItem('mf_sidebar_collapsed', isNowCollapsed ? '1' : '0');
}

function restoreSidebarState() {
  if (localStorage.getItem('mf_sidebar_collapsed') === '1') {
    document.querySelector('.app').classList.add('sidebar-collapsed');
  }
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
//  LANDING PAGE
// ══════════════════════════════════════════════════
function launchApp() {
  localStorage.setItem('mf_launched', '1');
  document.getElementById('landing-overlay').classList.add('hidden');
}

function checkFirstVisit() {
  // Show landing overlay if user has never launched the app before
  // Skip it if they already have data (existing users who update the app)
  const hasLaunched  = localStorage.getItem('mf_launched');
  const hasData      = localStorage.getItem('mf_income') ||
                       localStorage.getItem('mf_recurring') ||
                       localStorage.getItem('mf_cards');
  if (hasLaunched || hasData) {
    document.getElementById('landing-overlay').classList.add('hidden');
  }
}

// ══════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════
checkFirstVisit();
restoreSidebarState();
restoreNavState();
setDefaultDates();
renderDashboard();
renderOneoffList();

// Error telemetry
window.onerror = function(msg, src, line, col, err) {
  if (window.posthog) posthog.capture('js_error', { message: msg, source: src, line, col, stack: err && err.stack });
};
window.onunhandledrejection = function(e) {
  if (window.posthog) posthog.capture('js_error', { message: 'Unhandled promise rejection: ' + e.reason, type: 'promise' });
};
