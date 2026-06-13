// ══════════════════════════════════════════════════
//  HELPERS — pure utilities, constants, currency state
//  No imports. Safe to import from any other module.
// ══════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────
export const CURRENCIES = {
  GBP: { symbol: '£', label: '£ GBP', flag: '🇬🇧' },
  USD: { symbol: '$', label: '$ USD', flag: '🇺🇸' },
  EUR: { symbol: '€', label: '€ EUR', flag: '🇪🇺' },
};

export const INCOME_CATS  = ['Salary','Freelance','Bonus','Investment','Rental','Gift','Other'];
export const EXPENSE_CATS = ['Housing','Food & Groceries','Transport','Utilities','Healthcare','Entertainment','Clothing','Subscriptions','Eating Out','Personal Care','Education','Other'];
export const REC_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const CC_TXN_CATS = ['Shopping','Food & Groceries','Transport','Entertainment','Utilities','Healthcare','Travel','Clothing','Electronics','Eating Out','Subscriptions','Other'];

const FREQ_MONTHLY = { weekly:52/12, fortnightly:26/12, monthly:1, quarterly:4/12, annually:1/12, 'one-off':0 };
export const FREQ_LABELS  = { weekly:'Weekly', fortnightly:'Fortnightly', monthly:'Monthly', quarterly:'Quarterly', annually:'Annually', 'one-off':'One-off' };

// ── Currency state (mutable — use setter for reassignment) ──
export let currentCurrency = localStorage.getItem('mf_currency') || 'GBP';
export function setCurrentCurrency(code) { currentCurrency = code; }

// ── Formatting ────────────────────────────────────
export function fmt(n)  { return CURRENCIES[currentCurrency].symbol + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
export function fmtS(n) { return (n < 0 ? '-' : '+') + fmt(n); }

// ── Security helpers ──────────────────────────────
// Cryptographically random integer ID — fits in JS safe integer and PostgreSQL int8
export function genId() {
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  return ((arr[0] & 0x1FFFFF) * 0x100000000) + arr[1];
}

// HTML-escape user-controlled strings before inserting via innerHTML
export function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Date utilities ────────────────────────────────
export function todayStr() { return new Date().toISOString().split('T')[0]; }

export function formatDate(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function formatMonthYear(y, m) {
  return new Date(y, m, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}
export function isThisMonthOrFuture(ds) {
  const now = new Date(); const d = new Date(ds + 'T00:00:00');
  return d.getFullYear() > now.getFullYear() || (d.getFullYear() === now.getFullYear() && d.getMonth() >= now.getMonth());
}

// ── Finance helpers ───────────────────────────────
export function monthlyEquiv(item) { return item.amount * FREQ_MONTHLY[item.frequency]; }

// ── Toast ─────────────────────────────────────────
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── CSV export ────────────────────────────────────
export function exportCSV(filename, headers, rowsData) {
  const escCsv = v => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s; };
  const lines = [headers.map(escCsv).join(','), ...rowsData.map(r => r.map(escCsv).join(','))];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Dashboard sparkline / trend ───────────────────
export function getMonthTotals(data, nMonths) {
  const now = new Date();
  const months = [];
  for (let i = nMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months.push({ key, total: 0 });
  }
  data.forEach(item => {
    const m = months.find(mo => mo.key === item.date.substring(0,7));
    if (m) m.total += item.amount;
  });
  return months.map(m => m.total);
}

export function buildSparkline(values, color) {
  const w = 72, h = 28, pad = 3;
  const max = Math.max(...values, 0.01);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n < 2 ? w / 2 : (i / (n - 1)) * w;
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastX = n < 2 ? w / 2 : w;
  const lastY = (pad + (1 - (values[n-1] - min) / range) * (h - pad * 2)).toFixed(1);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block;flex-shrink:0"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lastX}" cy="${lastY}" r="2.5" fill="${color}"/></svg>`;
}

export function trendBadge(curr, prev, lowerIsBetter) {
  if (prev === 0 && curr === 0) return '';
  if (prev === 0) return `<span class="dash-trend dash-trend-pos">New this month</span>`;
  const pct = Math.round(((curr - prev) / Math.abs(prev)) * 100);
  const positive = lowerIsBetter ? pct <= 0 : pct >= 0;
  const arrow = pct >= 0 ? '↑' : '↓';
  return `<span class="dash-trend ${positive ? 'dash-trend-pos' : 'dash-trend-neg'}">${arrow} ${Math.abs(pct)}% vs last month</span>`;
}
