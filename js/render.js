// ══════════════════════════════════════════════════
//  RENDER  (js/render.js)
//  All DOM-rendering functions for every page/section.
//
//  Imports:
//    data.js    — 9 data stores (read-only here)
//    helpers.js — formatting, constants
//    engine.js  — getOccurrenceDates, generateProjection
//
//  Exports:
//    10 render* functions
//    4 shared UI-state variables + setters (read by render
//    functions AND mutated by CRUD functions in app.js)
// ══════════════════════════════════════════════════
import {
  incomeData, expenseData, recurringData,
  creditCards, interestFreeDeals, ccTransactions,
  loansData, accountsData, savingsTransfers,
} from './data.js';
import {
  FREQ_LABELS, REC_MONTH_NAMES, CC_TXN_CATS,
  fmt, fmtS, esc,
  todayStr, formatDate, formatMonthYear, isThisMonthOrFuture,
  monthlyEquiv, getMonthTotals, buildSparkline, trendBadge,
} from './helpers.js';
import { getOccurrenceDates, generateProjection } from './engine.js';

// ── Shared UI state (mutated by app.js via setters) ─
export let currentOneoffFilter = 'all';
export function setCurrentOneoffFilter(v) { currentOneoffFilter = v; }

export let currentCCTFilter = 'all';
export function setCurrentCCTFilter(v) { currentCCTFilter = v; }

export let editingCCTId = null;
export function setEditingCCTId(v) { editingCCTId = v; }

export let editingLoanId = null;
export function setEditingLoanId(v) { editingLoanId = v; }

// ══════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════
export function renderDashboard() {
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
  document.getElementById('dash-balance').classList.toggle('value-pos', balance >= 0);
  document.getElementById('dash-balance').classList.toggle('value-neg', balance < 0);
  const recNet = recInc - recExp;
  document.getElementById('dash-recurring-net').textContent  = (recNet<0?'-':'+')+fmt(recNet);
  document.getElementById('dash-recurring-net').classList.toggle('value-pos', recNet >= 0);
  document.getElementById('dash-recurring-net').classList.toggle('value-neg', recNet < 0);

  const incMonths = getMonthTotals(incomeData, 6);
  const expMonths = getMonthTotals(expenseData, 6);
  const netMonths = incMonths.map((v, i) => v - expMonths[i]);
  document.getElementById('dash-income-spark').innerHTML   = buildSparkline(incMonths, '#10B981');
  document.getElementById('dash-expenses-spark').innerHTML = buildSparkline(expMonths, '#EF4444');
  document.getElementById('dash-balance-spark').innerHTML  = buildSparkline(netMonths, '#0F766E');
  document.getElementById('dash-income-trend').innerHTML   = trendBadge(incMonths[5], incMonths[4], false);
  document.getElementById('dash-expenses-trend').innerHTML = trendBadge(expMonths[5], expMonths[4], true);
  document.getElementById('dash-balance-trend').innerHTML  = trendBadge(netMonths[5], netMonths[4], false);

  const ri = [...incomeData].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
  document.getElementById('dash-recent-income').innerHTML = ri.length
    ? ri.map(r=>`<tr><td>${formatDate(r.date)}</td><td><span class="badge badge-income">${esc(r.category)}</span></td><td class="text-income">${fmt(r.amount)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-state">No income yet</td></tr>';

  const re = [...expenseData].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
  document.getElementById('dash-recent-expenses').innerHTML = re.length
    ? re.map(r=>`<tr><td>${formatDate(r.date)}</td><td><span class="badge badge-expense">${esc(r.category)}</span></td><td class="text-expense">${fmt(r.amount)}</td></tr>`).join('')
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
        <td style="font-weight:600">${esc(u.name)}</td>
        <td><span class="badge badge-${u.type}">${u.type}</span></td>
        <td class="${u.type==='income'?'text-income':'text-expense'}">${u.type==='income'?'+':'-'}${fmt(u.amount)}</td></tr>`).join('')
    + '</tbody></table></div>';
}

// ══════════════════════════════════════════════════
//  ONE-OFF TRANSACTIONS
// ══════════════════════════════════════════════════
export function renderOneoffList() {
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
    `<span class="text-income">+£${totalInc.toFixed(2)}</span> &nbsp;·&nbsp; `+
    `<span class="text-expense">-£${totalExp.toFixed(2)}</span> &nbsp;·&nbsp; `+
    `<span class="${net>=0?'value-pos':'value-neg'}" style="font-weight:700">Net: ${fmtS(net)}</span>`;

  if (!rows.length) { tbody.innerHTML='<tr><td colspan="7" class="empty-state">No entries yet</td></tr>'; return; }
  tbody.innerHTML = rows.map(r => {
    const future=r.date>today, inFc=isThisMonthOrFuture(r.date);
    let actionCell;
    if (r._ccPayment) {
      actionCell = `<td><span class="badge badge-upcoming" style="font-size:0.7rem;cursor:pointer" onclick="navigate('cctransactions')" title="Manage on CC Transactions page">💸 CC Payment</span></td>`;
    } else {
      const delFn = r.type==='income' ? `deleteIncome(${r.id})` : `deleteExpense(${r.id})`;
      actionCell = `<td><button class="btn-sm-danger" onclick="${delFn}">Delete</button></td>`;
    }
    return `<tr>
      <td>${formatDate(r.date)}${future?` <span class="badge badge-oneoff">future</span>`:''}</td>
      <td><span class="badge badge-${r.type}">${r.type}</span></td>
      <td>${esc(r.category)}</td>
      <td class="text-muted">${esc(r.description)}</td>
      <td class="${r.type==='income'?'text-income':'text-expense'}">${r.type==='income'?'+':'-'}${fmt(r.amount)}</td>
      <td>${inFc?'<span class="badge badge-freq">In forecast</span>':'<span class="text-muted-sm">Historical</span>'}</td>
      ${actionCell}</tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════
//  RECURRING
// ══════════════════════════════════════════════════
export function renderRecurringTable() {
  const tbody = document.getElementById('recurring-table-body');
  // Build loan read-only rows
  const loanRows = loansData.map(loan => `<tr style="opacity:0.8">
    <td><span class="badge badge-expense" style="background:#1e3a5f;color:#93c5fd">🏦 Loan</span></td>
    <td style="font-weight:600">${esc(loan.lender)}</td><td class="text-muted-sm">Loan Repayment</td>
    <td style="font-weight:600">${fmt(loan.repaymentAmount)}</td>
    <td><span class="badge badge-freq">${FREQ_LABELS[loan.frequency]||loan.frequency}</span></td>
    <td class="text-muted">${fmt(monthlyEquiv({ amount: loan.repaymentAmount, frequency: loan.frequency }))}/mo</td>
    <td class="text-muted-sm">${formatDate(loan.startDate)}</td>
    <td class="text-muted-sm">${loan.endDate?formatDate(loan.endDate):'—'}</td>
    <td class="text-muted-sm" style="font-style:italic">Managed in Loans</td></tr>`);
  if (!recurringData.length && !loanRows.length) { tbody.innerHTML='<tr><td colspan="9" class="empty-state">No recurring transactions yet</td></tr>'; return; }
  tbody.innerHTML = recurringData.map(r => {
    const mBadge = r.activeMonths && r.activeMonths.length > 0 && r.activeMonths.length < 12
      ? `<div class="rec-months-badge">${r.activeMonths.length <= 5 ? r.activeMonths.map(m=>REC_MONTH_NAMES[m]).join(', ') : r.activeMonths.length+'/12 months'}</div>` : '';
    return `<tr>
      <td><span class="badge badge-${r.type}">${r.type}</span></td>
      <td style="font-weight:600">${esc(r.name)}${mBadge}</td>
      <td>${esc(r.category)}</td>
      <td style="font-weight:600">${fmt(r.amount)}</td>
      <td><span class="badge badge-freq">${FREQ_LABELS[r.frequency]}</span></td>
      <td class="text-muted">${fmt(monthlyEquiv(r))}/mo</td>
      <td class="text-muted-sm">${formatDate(r.startDate)}</td>
      <td class="text-muted-sm">${r.endDate?formatDate(r.endDate):'—'}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-sm-ghost" onclick="editRecurring(${r.id})">Edit</button>
        <button class="btn-sm-danger" onclick="deleteRecurring(${r.id})">Delete</button>
      </td></tr>`;
  }).join('') + loanRows.join('');
}

export function renderUpcomingTimeline() {
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
      <div class="tl-content"><div><div class="tl-name">${esc(t.name)}</div><div class="tl-cat">${esc(t.category)} · ${FREQ_LABELS[t.freq]}</div></div>
      <div class="tl-amount ${t.type}">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div></div></div>`; });
  });
  div.innerHTML=html+'</div>';
}

// ══════════════════════════════════════════════════
//  CASHFLOW
// ══════════════════════════════════════════════════
export function renderCashflow() {
  const numMonths=parseInt(document.getElementById('cf-months-select').value);
  const rows=generateProjection(numMonths, {
    recurringData, incomeData, expenseData,
    creditCards, ccTransactions,
    loansData, accountsData, savingsTransfers,
    interestFreeDeals,
  });
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
  document.getElementById('cf-next-month-net').classList.toggle('value-pos', nextNet >= 0);
  document.getElementById('cf-next-month-net').classList.toggle('value-neg', nextNet < 0);

  // Bar chart
  const maxAbs=Math.max(...rows.map(r=>Math.abs(r.net)),1);
  document.getElementById('cf-bar-chart').innerHTML=rows.map(r=>{
    const pct=Math.min((Math.abs(r.net)/maxAbs)*100,100), pos=r.net>=0;
    const hasOneOff=r.oneOffInc>0||r.oneOffExp>0;
    return `<div class="bar-row" style="${r.isPast?'opacity:0.5':''}">
      <div class="bar-label">${formatMonthYear(r.yr,r.mo)}</div>
      <div class="bar-track"><div class="bar-fill ${pos?'pos':'neg'}" style="width:${pct}%"></div></div>
      <div class="bar-value ${pos?'value-pos':'value-neg'}">${pos?'+':'-'}${fmt(r.net)}${hasOneOff?'<span class="cf-oneoff-dot" title="Includes one-off entries"></span>':''}</div>
    </div>`;
  }).join('')||'<div class="empty-state">Add recurring transactions to see projections</div>';

  // Monthly breakdown table — seed running total from current account balances
  const currentAccBalance = accountsData
    .filter(a => a.type === 'current')
    .reduce((s, a) => s + a.balance, 0);
  let running = currentAccBalance;
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
      <td title="${incTip}" class="text-income" style="cursor:${r.recInc?'help':'default'}">${r.recInc>0?fmt(r.recInc):'—'}</td>
      <td title="${r.oneOffIncItems.map(i=>'📌 '+i.name+': '+fmt(i.amount)).join('\n')}" class="text-income" style="cursor:${r.oneOffIncItems.length?'help':'default'}">${r.oneOffInc>0?fmt(r.oneOffInc):'—'}</td>
      <td title="${expTip}" class="text-expense" style="cursor:${r.recExp?'help':'default'}">${r.recExp>0?fmt(r.recExp):'—'}</td>
      <td title="${r.oneOffExpItems.map(i=>'📌 '+i.name+': '+fmt(i.amount)).join('\n')}" class="text-expense" style="cursor:${r.oneOffExpItems.length?'help':'default'}">${r.oneOffExp>0?fmt(r.oneOffExp):'—'}</td>
      <td title="${ccTip}" class="text-cc" style="cursor:${ccTip?'help':'default'}">${r.ccTotal>0?fmt(r.ccTotal)+(ccHas0?' <span class="zero-pct-tag">0%</span>':''):'—'}</td>
      <td class="${nc}">${fmtS(r.net)}</td>
      <td class="${rc}">${fmtS(running)}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="8" class="empty-state">Add transactions and credit cards to see your forecast</td></tr>';

  // Card balance tracker
  const panel=document.getElementById('cf-card-tracker-panel');
  if (!creditCards.length) { panel.style.display='none'; }
  else {
    panel.style.display='block';
    const table=document.getElementById('cf-card-tracker-table');
    table.innerHTML='<thead><tr><th>Month</th>'+creditCards.map(c=>`<th>${esc(c.name)}</th>`).join('')+'</tr></thead><tbody>'
      +rows.map(r=>`<tr class="${r.isPast?'cf-past':''}"><td>${formatMonthYear(r.yr,r.mo)}</td>`
        +creditCards.map(card=>{
          const snap=r.cardSnapshot.find(s=>s.id===card.id);
          const bal=snap?snap.balance:0;
          if (bal<=0.005) return '<td class="text-paid-off">✓ Paid off</td>';
          const dealActive=snap?snap.hasActiveDeal:false;
          const limit=snap?snap.limit:null;
          let barHtml='';
          if (limit&&limit>0) {
            const pct=Math.min(Math.round(bal/limit*100),100);
            const col=pct>=90?'red':pct>=70?'amber':'green';
            barHtml=`<div class="cc-util-bar-wrap"><div class="cc-util-bar-fill cc-util-bar-${col}" style="width:${pct}%"></div></div><div class="cc-util-label">${pct}%</div>`;
          }
          return `<td class="${dealActive?'text-deal-active':'text-expense'}">${fmt(bal)}${dealActive?' <span class="zero-pct-tag">0%</span>':''}${barHtml}</td>`;
        }).join('')+'</tr>').join('')+'</tbody>';
  }

  // Savings account tracker
  const savingsPanel=document.getElementById('cf-savings-tracker-panel');
  const savingsAccounts=accountsData.filter(a=>a.type==='savings');
  if (!savingsAccounts.length) { savingsPanel.style.display='none'; return; }
  savingsPanel.style.display='block';
  const savingsTable=document.getElementById('cf-savings-tracker-table');
  savingsTable.innerHTML='<thead><tr><th>Month</th>'+savingsAccounts.map(a=>`<th>${esc(a.name)}${a.interestRate?` <span class="acc-rate-badge">${a.interestRate}% AER</span>`:''}</th>`).join('')+'</tr></thead><tbody>'
    +rows.map(r=>`<tr class="${r.isPast?'cf-past':''}"><td>${formatMonthYear(r.yr,r.mo)}</td>`
      +savingsAccounts.map(acc=>{
        const snap=r.savingsSnapshot?r.savingsSnapshot.find(s=>s.id===acc.id):null;
        const bal=snap?snap.balance:acc.balance;
        return `<td class="text-income">${fmt(bal)}</td>`;
      }).join('')+'</tr>').join('')+'</tbody>';
}

// ══════════════════════════════════════════════════
//  CREDIT CARDS
// ══════════════════════════════════════════════════
export function renderCardList() {
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
      return `<span class="badge badge-active" title="${esc(d.note||'')}">0% on ${fmt(d.amount)} — ${days}d left</span>`;
    }).join(' ');
    return `<div class="card-list-item">
      <div>
        <div class="card-name">💳 ${esc(c.name)}</div>
        <div class="card-meta">${c.apr}% APR &nbsp;·&nbsp; Min: ${minLabel} &nbsp;·&nbsp; Monthly interest: ${fmt(interest)} ${dealBadges?'&nbsp;'+dealBadges:''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div>
          <div style="font-size:0.72rem;color:#aaa;text-align:right">Balance${c.creditLimit?` / Limit`:''}</div>
          <div class="card-balance">${fmt(c.balance)}${c.creditLimit?`<span style="font-size:0.78rem;color:#aaa;font-weight:500"> / ${fmt(c.creditLimit)}</span>`:''}</div>
          ${c.creditLimit?(()=>{const pct=Math.min(Math.round(c.balance/c.creditLimit*100),100);const col=pct>=90?'red':pct>=70?'amber':'green';return `<div class="cc-util-bar-wrap"><div class="cc-util-bar-fill cc-util-bar-${col}" style="width:${pct}%"></div></div><div class="cc-util-label">${pct}% used</div>`;})():''}
        </div>
        <div><div style="font-size:0.72rem;color:#aaa;text-align:right">Next min payment</div><div class="text-cc" style="font-weight:700">${fmt(minPay)}</div></div>
        <div style="display:flex;gap:8px">
          <button class="btn-sm-ghost" onclick="editCard(${c.id})">Edit</button>
          <button class="btn-sm-danger" onclick="deleteCard(${c.id})">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════
//  0% DEALS
// ══════════════════════════════════════════════════
export function renderDealsPage() {
  const today = new Date(todayStr() + 'T00:00:00');

  // Populate card selector
  const sel = document.getElementById('deal-card-id');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">— select a card —</option>'
    + creditCards.map(c => `<option value="${c.id}">${esc(c.name)} (${fmt(c.balance)} balance)</option>`).join('');
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
        <div class="deal-card-name">💳 ${esc(ccName)}</div>
        <div class="deal-meta">
          ${badge}
          ${d.note ? `<span class="text-muted">${esc(d.note)}</span>` : ''}
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

// ══════════════════════════════════════════════════
//  LOANS
// ══════════════════════════════════════════════════
export function renderLoansPage() {
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
      <td style="font-weight:600">${esc(l.lender)}</td>
      <td>${fmt(l.totalAmount)}</td>
      <td style="font-weight:600">${fmt(l.repaymentAmount)}</td>
      <td><span class="badge badge-freq">${FREQ_LABELS[l.frequency] || l.frequency}</span></td>
      <td class="text-muted">${l.apr ? l.apr + '%' : '—'}</td>
      <td class="text-muted-sm">${formatDate(l.startDate)}</td>
      <td class="text-muted-sm">${l.endDate ? formatDate(l.endDate) : '—'}</td>
      <td class="text-muted-sm">${esc(l.note || '—')}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm" onclick="editLoan(${l.id})" style="margin-right:4px">Edit</button>
        <button class="btn-sm-danger" onclick="deleteLoan(${l.id})">Delete</button>
      </td></tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════
//  CARD TRANSACTIONS
// ══════════════════════════════════════════════════
export function renderCCTransactions() {
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
      + creditCards.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
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
    if (charges.length)  parts.push(`<span class="text-cc">${charges.length} charge${charges.length!==1?'s':''}: ${fmt(totalCharged)}</span>`);
    if (payments.length) parts.push(`<span class="text-income">${payments.length} payment${payments.length!==1?'s':''}: ${fmt(totalPaid)}</span>`);
    summaryEl.innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No transactions yet</td></tr>';
    return;
  }

  const catOpts  = (sel) => CC_TXN_CATS.map(c => `<option${c===sel?' selected':''}>${c}</option>`).join('');
  const cardOpts = (sel) => creditCards.map(c => `<option value="${c.id}"${c.id===sel?' selected':''}>${esc(c.name)}</option>`).join('');

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
        <td>${isPayment ? '<span class="text-muted-sm">—</span>' : `<select class="cct-edit-input" data-field="cat" style="width:130px">${catOpts(t.category)}</select>`}</td>
        <td><input class="cct-edit-input" data-field="desc" type="text" value="${esc(t.description)}" placeholder="Description"/></td>
        <td><input class="cct-edit-input" data-field="amount" type="number" value="${t.amount}" min="0.01" step="0.01" style="width:90px"/></td>
        <td>${inFc?'<span class="badge badge-freq">In forecast</span>':'<span class="text-muted-sm">Historical</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn-sm-ghost" onclick="saveCCTEdit(${t.id})">Save</button>
          <button class="btn-sm-ghost" onclick="cancelCCTEdit()" style="margin-left:4px">Cancel</button>
        </td>
      </tr>`;
    }

    return `<tr>
      <td>${formatDate(t.date)}${future?` <span class="badge badge-oneoff">future</span>`:''}</td>
      <td><span class="badge ${isPayment?'badge-income':'badge-expense'}" style="font-size:0.72rem">${isPayment?'💸 Payment':'💳 Charge'}</span></td>
      <td><span class="badge badge-card">💳 ${esc(cardName)}</span></td>
      <td class="text-muted">${isPayment ? '—' : esc(t.category)}</td>
      <td class="text-muted">${esc(t.description)}</td>
      <td class="${isPayment?'text-income':'text-cc'}">${isPayment?'-':'-'}${fmt(t.amount)}</td>
      <td>${inFc?'<span class="badge badge-freq">In forecast</span>':'<span class="text-muted-sm">Historical</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm-ghost" onclick="editCCTransaction(${t.id})" style="margin-right:4px">Edit</button>
        <button class="btn-sm-danger" onclick="deleteCCTransaction(${t.id})">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════
//  ACCOUNTS
// ══════════════════════════════════════════════════
export function renderAccountsPage() {
  const currentAccs  = accountsData.filter(a => a.type === 'current');
  const savingsAccs  = accountsData.filter(a => a.type === 'savings');
  const totalCurrent = currentAccs.reduce((s, a) => s + a.balance, 0);
  const totalSavings = savingsAccs.reduce((s, a) => s + a.balance, 0);
  const monthlyOut   = savingsTransfers
    .filter(t => t.frequency !== 'one-off')
    .reduce((s, t) => s + monthlyEquiv(t), 0);

  document.getElementById('acc-current-total').textContent  = fmt(totalCurrent);
  document.getElementById('acc-current-count').textContent  = currentAccs.length + ' account' + (currentAccs.length !== 1 ? 's' : '');
  document.getElementById('acc-savings-total').textContent  = fmt(totalSavings);
  document.getElementById('acc-savings-count').textContent  = savingsAccs.length + ' account' + (savingsAccs.length !== 1 ? 's' : '');
  document.getElementById('acc-net-worth').textContent      = fmt(totalCurrent + totalSavings);
  document.getElementById('acc-monthly-out').textContent    = fmt(monthlyOut);

  // Accounts list
  const listEl = document.getElementById('acc-accounts-list');
  listEl.innerHTML = !accountsData.length
    ? '<div class="empty-state" style="padding:24px 0">No accounts saved yet. Add your first account above.</div>'
    : accountsData.map(a => `
      <div class="acc-account-item">
        <div class="acc-account-info">
          <div class="acc-account-name">
            <span class="badge ${a.type==='current'?'badge-freq':'badge-income'}">${a.type==='current'?'🏦 Current':'💰 Savings'}</span>
            ${esc(a.name)}
          </div>
          ${a.interestRate != null ? `<div class="acc-account-sub">${a.interestRate}% AER · interest compounded monthly</div>` : ''}
          ${a.note ? `<div class="acc-account-sub text-muted">${esc(a.note)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="acc-account-balance">${fmt(a.balance)}</div>
          <button class="btn-sm-ghost" onclick="editAccount(${a.id})">Edit</button>
          <button class="btn-sm-danger" onclick="deleteAccount(${a.id})">Delete</button>
        </div>
      </div>`).join('');

  // Transfers list
  const transfersEl = document.getElementById('acc-transfers-list');
  transfersEl.innerHTML = !savingsTransfers.length
    ? '<div class="empty-state" style="padding:24px 0">No transfers set up yet.</div>'
    : '<div class="table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Amount</th><th>Frequency</th><th>Start</th><th>End</th><th>Note</th><th></th></tr></thead><tbody>'
      + savingsTransfers.map(t => {
          const fromAcc = accountsData.find(a => a.id === t.fromAccountId);
          const toAcc   = accountsData.find(a => a.id === t.toAccountId);
          return `<tr>
            <td>${fromAcc ? esc(fromAcc.name) : '<span class="text-muted">deleted</span>'}</td>
            <td>${toAcc   ? esc(toAcc.name)   : '<span class="text-muted">deleted</span>'}</td>
            <td class="text-expense">${fmt(t.amount)}</td>
            <td><span class="badge badge-freq">${FREQ_LABELS[t.frequency]||t.frequency}</span></td>
            <td>${formatDate(t.startDate)}</td>
            <td>${t.endDate ? formatDate(t.endDate) : '—'}</td>
            <td class="text-muted">${esc(t.note || '—')}</td>
            <td style="white-space:nowrap">
              <button class="btn-sm-ghost" onclick="editTransfer(${t.id})" style="margin-right:4px">Edit</button>
              <button class="btn-sm-danger" onclick="deleteTransfer(${t.id})">Delete</button>
            </td>
          </tr>`;
        }).join('')
      + '</tbody></table></div>';
}
