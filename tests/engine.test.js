// Unit tests for js/engine.js
// Run with: node --test tests/engine.test.js
// No browser, no Supabase, no DOM required.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOccurrenceDates,
  getAmountForMonth,
  getInterestFreeAmount,
  generateProjection,
} from '../js/engine.js';

const monthStart = (y, m) => new Date(y, m, 1);
const monthEnd   = (y, m) => new Date(y, m + 1, 0, 23, 59, 59);

describe('getOccurrenceDates', () => {

  test('weekly item - 4 occurrences in a standard month window', () => {
    const item = { startDate: '2025-01-06', frequency: 'weekly' };
    const dates = getOccurrenceDates(item, monthStart(2025, 0), monthEnd(2025, 0));
    assert.equal(dates.length, 4); // 6, 13, 20, 27 Jan
  });

  test('fortnightly item - 3 occurrences when month fits three cycles', () => {
    const item = { startDate: '2025-01-01', frequency: 'fortnightly' };
    const dates = getOccurrenceDates(item, monthStart(2025, 0), monthEnd(2025, 0));
    assert.equal(dates.length, 3); // 1, 15, 29 Jan
  });

  test('monthly item - 1 occurrence in its start month', () => {
    const item = { startDate: '2025-03-15', frequency: 'monthly' };
    const dates = getOccurrenceDates(item, monthStart(2025, 2), monthEnd(2025, 2));
    assert.equal(dates.length, 1);
    assert.equal(dates[0].getDate(), 15);
  });

  test('monthly item - 0 occurrences before start month', () => {
    const item = { startDate: '2025-03-15', frequency: 'monthly' };
    const dates = getOccurrenceDates(item, monthStart(2025, 1), monthEnd(2025, 1));
    assert.equal(dates.length, 0);
  });

  test('quarterly item - 1 occurrence per quarter', () => {
    const item = { startDate: '2025-01-01', frequency: 'quarterly' };
    const jan = getOccurrenceDates(item, monthStart(2025, 0), monthEnd(2025, 0));
    const feb = getOccurrenceDates(item, monthStart(2025, 1), monthEnd(2025, 1));
    const apr = getOccurrenceDates(item, monthStart(2025, 3), monthEnd(2025, 3));
    assert.equal(jan.length, 1);
    assert.equal(feb.length, 0);
    assert.equal(apr.length, 1);
  });

  test('annually item - 1 per year, 0 in off-months', () => {
    const item = { startDate: '2025-06-01', frequency: 'annually' };
    const hit  = getOccurrenceDates(item, monthStart(2025, 5), monthEnd(2025, 5));
    const miss = getOccurrenceDates(item, monthStart(2025, 0), monthEnd(2025, 0));
    assert.equal(hit.length, 1);
    assert.equal(miss.length, 0);
  });

  test('endDate is respected - no dates returned after it', () => {
    const item = { startDate: '2025-01-01', endDate: '2025-01-14', frequency: 'weekly' };
    const dates = getOccurrenceDates(item, monthStart(2025, 0), monthEnd(2025, 0));
    assert.equal(dates.length, 2); // 1, 8 only
  });

  test('activeMonths filter excludes non-listed months', () => {
    const item = { startDate: '2025-01-01', frequency: 'monthly', activeMonths: [0, 6] };
    const jan = getOccurrenceDates(item, monthStart(2025, 0), monthEnd(2025, 0));
    const feb = getOccurrenceDates(item, monthStart(2025, 1), monthEnd(2025, 1));
    const jul = getOccurrenceDates(item, monthStart(2025, 6), monthEnd(2025, 6));
    assert.equal(jan.length, 1);
    assert.equal(feb.length, 0);
    assert.equal(jul.length, 1);
  });

});

describe('getAmountForMonth', () => {

  test('monthly item - returns full amount', () => {
    const item = { startDate: '2025-01-01', frequency: 'monthly', amount: 1500 };
    assert.equal(getAmountForMonth(item, 2025, 0), 1500);
  });

  test('monthly item - 0 before start date', () => {
    const item = { startDate: '2025-03-01', frequency: 'monthly', amount: 1000 };
    assert.equal(getAmountForMonth(item, 2025, 1), 0);
  });

  test('monthly item - 0 after end date', () => {
    const item = { startDate: '2025-01-01', endDate: '2025-02-28', frequency: 'monthly', amount: 500 };
    assert.equal(getAmountForMonth(item, 2025, 2), 0);
  });

  test('weekly item - amount times occurrence count', () => {
    const item = { startDate: '2025-01-06', frequency: 'weekly', amount: 100 };
    assert.equal(getAmountForMonth(item, 2025, 0), 400); // 4 Mondays
  });

  test('activeMonths - returns 0 when month not in list', () => {
    const item = { startDate: '2025-01-01', frequency: 'monthly', amount: 200, activeMonths: [0, 6] };
    assert.equal(getAmountForMonth(item, 2025, 1), 0);
    assert.equal(getAmountForMonth(item, 2025, 6), 200);
  });

  test('quarterly item - hits correct months', () => {
    const item = { startDate: '2025-01-01', frequency: 'quarterly', amount: 300 };
    assert.equal(getAmountForMonth(item, 2025, 0), 300);
    assert.equal(getAmountForMonth(item, 2025, 1), 0);
    assert.equal(getAmountForMonth(item, 2025, 3), 300);
  });

});

describe('getInterestFreeAmount', () => {

  const deals = [
    { cardId: 1, amount: 2000, startDate: '2025-01-01', endDate: '2025-06-30' },
    { cardId: 1, amount: 500,  startDate: '2025-03-01', endDate: '2025-12-31' },
    { cardId: 2, amount: 1000, startDate: '2025-01-01', endDate: '2025-12-31' },
  ];

  test('returns deal amount within deal dates', () => {
    assert.equal(getInterestFreeAmount(1, monthStart(2025, 1), deals), 2000);
  });

  test('sums multiple deals for same card and month', () => {
    assert.equal(getInterestFreeAmount(1, monthStart(2025, 3), deals), 2500);
  });

  test('returns 0 before deal start', () => {
    assert.equal(getInterestFreeAmount(1, monthStart(2024, 11), deals), 0);
  });

  test('returns only active deals when one has expired', () => {
    assert.equal(getInterestFreeAmount(1, monthStart(2025, 7), deals), 500);
  });

  test('filters by cardId - wrong card returns 0', () => {
    assert.equal(getInterestFreeAmount(99, monthStart(2025, 1), deals), 0);
  });

  test('deal end month is fully included', () => {
    assert.equal(getInterestFreeAmount(1, monthStart(2025, 5), deals), 2500);
  });

  test('returns 0 with empty deals array', () => {
    assert.equal(getInterestFreeAmount(1, monthStart(2025, 0), []), 0);
  });

});

describe('generateProjection', () => {

  const emptyData = {
    recurringData: [], incomeData: [], expenseData: [],
    creditCards: [], ccTransactions: [],
    loansData: [], accountsData: [], savingsTransfers: [],
    interestFreeDeals: [],
  };

  test('returns correct number of rows', () => {
    assert.equal(generateProjection(6, emptyData).length, 6);
  });

  test('first row is current month', () => {
    const now = new Date();
    const rows = generateProjection(1, emptyData);
    assert.equal(rows[0].yr, now.getFullYear());
    assert.equal(rows[0].mo, now.getMonth());
  });

  test('net is 0 with all empty data', () => {
    generateProjection(3, emptyData).forEach(r => assert.equal(r.net, 0));
  });

  test('recurring monthly income appears in every row', () => {
    const data = {
      ...emptyData,
      recurringData: [{ type: 'income', name: 'Salary', amount: 3000, frequency: 'monthly', startDate: '2020-01-01' }],
    };
    generateProjection(3, data).forEach(r => {
      assert.equal(r.recInc, 3000);
      assert.equal(r.net, 3000);
    });
  });

  test('recurring expense reduces net', () => {
    const data = {
      ...emptyData,
      recurringData: [
        { type: 'income',  name: 'Salary', amount: 3000, frequency: 'monthly', startDate: '2020-01-01' },
        { type: 'expense', name: 'Rent',   amount: 1200, frequency: 'monthly', startDate: '2020-01-01' },
      ],
    };
    const rows = generateProjection(1, data);
    assert.equal(rows[0].recInc, 3000);
    assert.equal(rows[0].recExp, 1200);
    assert.equal(rows[0].net, 1800);
  });

  test('one-off income appears only in its calendar month', () => {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const data = {
      ...emptyData,
      incomeData: [{ date: yr + '-' + mo + '-15', amount: 500, category: 'Bonus', description: 'Q2 bonus' }],
    };
    const rows = generateProjection(2, data);
    assert.equal(rows[0].oneOffInc, 500);
    assert.equal(rows[1].oneOffInc, 0);
  });

  test('credit card interest accrues and appears in ccTotal', () => {
    const data = {
      ...emptyData,
      creditCards: [{
        id: 1, name: 'Test Card', apr: 24,
        minType: 'fixed', minFixed: 25, minPct: null, minFloor: null,
        balance: 1000, creditLimit: null,
      }],
    };
    const rows = generateProjection(1, data);
    assert.equal(rows[0].ccTotal, 25);
    assert.ok(rows[0].ccPayments[0].interest > 0);
  });

  test('zero-balance card produces no payment', () => {
    const data = {
      ...emptyData,
      creditCards: [{
        id: 1, name: 'Paid Off', apr: 24,
        minType: 'fixed', minFixed: 25, minPct: null, minFloor: null,
        balance: 0, creditLimit: null,
      }],
    };
    const rows = generateProjection(1, data);
    assert.equal(rows[0].ccTotal, 0);
    assert.equal(rows[0].ccPayments[0].payment, 0);
  });

  test('interest-free deal suppresses interest on covered amount', () => {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const nextYr = String(yr + 1);
    const data = {
      ...emptyData,
      creditCards: [{
        id: 1, name: 'Deal Card', apr: 24,
        minType: 'fixed', minFixed: 25, minPct: null, minFloor: null,
        balance: 1000, creditLimit: null,
      }],
      interestFreeDeals: [{
        cardId: 1, amount: 1000,
        startDate: yr + '-' + mo + '-01',
        endDate: nextYr + '-' + mo + '-01',
      }],
    };
    const rows = generateProjection(1, data);
    assert.equal(rows[0].ccPayments[0].interest, 0);
    assert.equal(rows[0].ccPayments[0].interestFree, true);
  });

  test('loan repayment appears as recurring expense', () => {
    const data = {
      ...emptyData,
      loansData: [{
        lender: 'Bank', frequency: 'monthly', startDate: '2020-01-01',
        endDate: null, repaymentAmount: 400,
      }],
    };
    const rows = generateProjection(1, data);
    assert.equal(rows[0].recExp, 400);
    assert.ok(rows[0].expItems.some(e => e.name.includes('Bank')));
  });

  test('does not mutate input card balances', () => {
    const cards = [{
      id: 1, name: 'Card', apr: 24,
      minType: 'fixed', minFixed: 25, minPct: null, minFloor: null,
      balance: 500, creditLimit: null,
    }];
    const originalBalance = cards[0].balance;
    generateProjection(3, { ...emptyData, creditCards: cards });
    assert.equal(cards[0].balance, originalBalance);
  });

});
