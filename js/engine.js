// ══════════════════════════════════════════════════
//  ENGINE — pure cashflow calculation functions
//  No DOM, no localStorage, no global state.
//  All data passed in as parameters — fully testable.
//  Imports: none (no dependency on helpers.js)
// ══════════════════════════════════════════════════

// ── Occurrence date generation ────────────────────
// Returns every date item falls due between fromDate and toDate,
// respecting frequency, endDate, and activeMonths filter.
export function getOccurrenceDates(item, fromDate, toDate) {
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
  if (item.activeMonths && item.activeMonths.length > 0) {
    return dates.filter(d => item.activeMonths.includes(d.getMonth()));
  }
  return dates;
}

// ── Amount for a calendar month ───────────────────
// Returns the total amount an item contributes in (year, month).
// For monthly items this is just item.amount; for others it counts
// occurrences in the month window.
export function getAmountForMonth(item, year, month) {
  if (item.activeMonths && item.activeMonths.length > 0 && !item.activeMonths.includes(month)) return 0;
  const ms = new Date(year, month, 1);
  const me = new Date(year, month + 1, 0, 23, 59, 59);
  const is = new Date(item.startDate + 'T00:00:00');
  const ie = item.endDate ? new Date(item.endDate + 'T00:00:00') : null;
  if (is > me) return 0;
  if (ie && ie < ms) return 0;
  if (item.frequency === 'monthly') return item.amount;
  return getOccurrenceDates(item, ms, me).length * item.amount;
}

// ── Interest-free deal lookup ─────────────────────
// Returns the total interest-free balance covering cardId in monthStart.
// Pure: deals array passed in rather than read from a global.
export function getInterestFreeAmount(cardId, monthStart, deals) {
  return deals
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

// ── Cashflow projection engine ────────────────────
// Returns an array of numMonths row objects starting from the current month.
// All data is passed in — no global reads.
export function generateProjection(numMonths, {
  recurringData, incomeData, expenseData,
  creditCards, ccTransactions,
  loansData, accountsData, savingsTransfers,
  interestFreeDeals,
}) {
  const now = new Date();
  const sy = now.getFullYear(), sm = now.getMonth();

  // Clone card balances for roll-forward simulation
  const cardStates = creditCards.map(c => ({
    id: c.id, name: c.name, apr: c.apr,
    minType: c.minType, minPct: c.minPct, minFloor: c.minFloor, minFixed: c.minFixed,
    balance: c.balance, limit: c.creditLimit || null
  }));

  // Clone savings account balances for roll-forward projection
  const savingsStates = accountsData
    .filter(a => a.type === 'savings')
    .map(a => ({ id: a.id, name: a.name, balance: a.balance, interestRate: a.interestRate || 0 }));

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
      const loanItem = { frequency: loan.frequency, startDate: loan.startDate, endDate: loan.endDate || null, amount: loan.repaymentAmount };
      const amt = getAmountForMonth(loanItem, yr, mo);
      if (amt > 0) { recExp += amt; expItems.push({ name: loan.lender + ' (loan)', amount: amt }); }
    });

    // Savings transfers from current accounts — cashflow outgoing
    savingsTransfers.forEach(transfer => {
      const fromAcc = accountsData.find(a => a.id === transfer.fromAccountId);
      if (!fromAcc || fromAcc.type !== 'current') return;
      const toAcc = accountsData.find(a => a.id === transfer.toAccountId);
      const label = toAcc ? 'Transfer → ' + toAcc.name : 'Savings transfer';
      let amt = 0;
      if (transfer.frequency === 'one-off') {
        const d = new Date(transfer.startDate + 'T00:00:00');
        if (d.getFullYear() === yr && d.getMonth() === mo) amt = transfer.amount;
      } else {
        const item = { frequency: transfer.frequency, startDate: transfer.startDate, endDate: transfer.endDate || null, amount: transfer.amount };
        amt = getAmountForMonth(item, yr, mo);
      }
      if (amt > 0) { recExp += amt; expItems.push({ name: label, amount: amt }); }
    });

    // Update savings account balances: apply incoming transfers then monthly interest
    savingsTransfers.forEach(transfer => {
      const toSavings = savingsStates.find(s => s.id === transfer.toAccountId);
      if (!toSavings) return;
      let amt = 0;
      if (transfer.frequency === 'one-off') {
        const d = new Date(transfer.startDate + 'T00:00:00');
        if (d.getFullYear() === yr && d.getMonth() === mo) amt = transfer.amount;
      } else {
        const item = { frequency: transfer.frequency, startDate: transfer.startDate, endDate: transfer.endDate || null, amount: transfer.amount };
        amt = getAmountForMonth(item, yr, mo);
      }
      if (amt > 0) toSavings.balance += amt;
    });
    savingsStates.forEach(s => {
      if (s.interestRate > 0) s.balance = s.balance * (1 + s.interestRate / 100 / 12);
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
      const ifAmount        = getInterestFreeAmount(card.id, monthStart, interestFreeDeals);
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
        id: c.id, name: c.name, balance: c.balance, limit: c.limit,
        hasActiveDeal: getInterestFreeAmount(c.id, monthStart, interestFreeDeals) > 0
      })),
      savingsSnapshot: savingsStates.map(s => ({ id: s.id, name: s.name, balance: s.balance }))
    });
  }
  return rows;
}
