// ══════════════════════════════════════════════════
//  AUTH  (js/auth.js)
//  - OAuth + email sign-in/out
//  - Account menu UI
//  - Currency UI
//  - Migration banner show/hide
//  - Landing overlay helpers (launchApp, checkFirstVisit)
//
//  Imports: db, currentUser (data.js), toast, currentCurrency (helpers.js)
//  Exports: everything — consumed by app.js
//
//  NOT in this module (would create circular deps before render.js exists):
//    migrateFromLocalStorage  — calls renderDashboard / renderOneoffList
//    The bootstrap IIFE       — calls all render functions + updateUserUI
// ══════════════════════════════════════════════════
import {
  db, currentUser,
  toDbCard, toDbIncome, toDbRecurring, toDbDeal, toDbCCT, toDbLoan,
  loadUserData,
} from './data.js';
import { toast, currentCurrency } from './helpers.js';
import { renderDashboard, renderOneoffList } from './render.js';

// ── OAuth ────────────────────────────────────────
export async function signInWithGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://finaura.app' }
  });
  if (error) toast('⚠️ Sign in failed: ' + error.message);
}
export async function signInWithGitHub() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: 'https://finaura.app' }
  });
  if (error) toast('⚠️ Sign in failed: ' + error.message);
}
export async function signOut() {
  document.getElementById('account-menu-dropdown')?.classList.remove('open');
  await db.auth.signOut();
}

// ── Email auth ───────────────────────────────────
let _authMode = 'signin';

function _showAuthError(msg) {
  const el = document.getElementById('lp-auth-error');
  if (el) { el.textContent = msg; el.style.display = ''; }
}
function _clearAuthError() {
  const el = document.getElementById('lp-auth-error');
  if (el) el.style.display = 'none';
}

export function setAuthMode(mode) {
  _authMode = mode;
  const isSignUp = mode === 'signup';
  document.getElementById('lp-auth-mode-title').textContent = isSignUp ? 'Create an account' : 'Sign in with email';
  document.getElementById('lp-confirm-group').style.display  = isSignUp ? '' : 'none';
  document.getElementById('lp-auth-submit').textContent      = isSignUp ? 'Create account' : 'Sign in';
  document.getElementById('lp-auth-password-confirm')?.setAttribute('autocomplete', isSignUp ? 'new-password' : 'current-password');
  document.getElementById('lp-mode-toggle').innerHTML = isSignUp
    ? 'Already have an account? <button class="btn-link" onclick="setAuthMode(\'signin\')">Sign in</button>'
    : 'Don\'t have an account? <button class="btn-link" onclick="setAuthMode(\'signup\')">Sign up</button>';
  _clearAuthError();
}

export async function submitEmailAuth() {
  const email    = document.getElementById('lp-email')?.value.trim();
  const password = document.getElementById('lp-password')?.value;
  _clearAuthError();

  if (!email || !password) { _showAuthError('Please enter your email and password.'); return; }

  if (_authMode === 'signup') {
    const confirm = document.getElementById('lp-password-confirm')?.value;
    if (password !== confirm)  { _showAuthError('Passwords do not match.'); return; }
    if (password.length < 6)   { _showAuthError('Password must be at least 6 characters.'); return; }

    const { error } = await db.auth.signUp({
      email, password,
      options: { emailRedirectTo: 'https://finaura.app' }
    });
    if (error) { _showAuthError(error.message); return; }

    // Show confirmation prompt — user must verify email before accessing app
    const box = document.getElementById('lp-auth-box');
    if (box) box.innerHTML = `
      <div class="lp-auth-confirm">
        <div style="font-size:2.2rem">📧</div>
        <p>Check your inbox</p>
        <p class="lp-auth-note">A confirmation link has been sent to <strong style="color:rgba(255,255,255,0.75)">${email}</strong>.<br>Click it to activate your account, then sign in.</p>
        <button class="btn-continue-guest" onclick="location.reload()" style="margin-top:6px">Back to sign in</button>
      </div>`;
  } else {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      _showAuthError(error.message === 'Invalid login credentials'
        ? 'Incorrect email or password.' : error.message);
    }
  }
}

// ── Currency UI ──────────────────────────────────
export function updateCurrencyUI() {
  document.querySelectorAll('.currency-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.code === currentCurrency);
  });
}

// ── Account menu ─────────────────────────────────
export function updateUserUI() {
  const menuEl = document.getElementById('account-menu');
  if (!menuEl) return;
  if (currentUser) {
    const name     = currentUser.user_metadata?.full_name || currentUser.email || 'Account';
    const email    = currentUser.email || '';
    const avatar   = currentUser.user_metadata?.avatar_url;
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const shortName = name.split(' ')[0];
    menuEl.style.display = 'block';
    const avatarEl = document.getElementById('account-menu-avatar-placeholder');
    if (avatar && avatarEl) {
      avatarEl.outerHTML = `<img class="account-menu-avatar" id="account-menu-avatar-placeholder" src="${avatar}" alt=""/>`;
    } else if (avatarEl) {
      avatarEl.textContent = initials;
    }
    const nameEl = document.getElementById('account-menu-name');
    if (nameEl) nameEl.textContent = shortName;
    const ddName  = document.getElementById('account-dropdown-name');
    const ddEmail = document.getElementById('account-dropdown-email');
    if (ddName)  ddName.textContent  = name;
    if (ddEmail) ddEmail.textContent = email;
    updateCurrencyUI();
  } else {
    menuEl.style.display = 'none';
  }
  const guestBtn = document.getElementById('guest-signin-btn');
  if (guestBtn) guestBtn.style.display = currentUser ? 'none' : 'block';
}

export function toggleAccountMenu() {
  const dropdown = document.getElementById('account-menu-dropdown');
  if (!dropdown) return;
  dropdown.classList.toggle('open');
  if (dropdown.classList.contains('open')) {
    setTimeout(() => document.addEventListener('click', _closeAccountMenu, { once: true }), 0);
  }
}
function _closeAccountMenu(e) {
  const menu = document.getElementById('account-menu');
  if (menu && !menu.contains(e.target)) {
    document.getElementById('account-menu-dropdown')?.classList.remove('open');
  }
}

// ── Migration banner ─────────────────────────────
export function showMigrationBanner() {
  if (localStorage.getItem('mf_migration_dismissed')) return;
  const el = document.getElementById('migration-banner');
  if (el) el.style.display = 'flex';
}
export function dismissMigration() {
  const el = document.getElementById('migration-banner');
  if (el) el.style.display = 'none';
  localStorage.setItem('mf_migration_dismissed', '1');
}

// ── Landing overlay helpers ──────────────────────
export function launchApp() {
  localStorage.setItem('mf_launched', '1');
  document.getElementById('landing-overlay').classList.add('hidden');
}
export function showSignInOverlay() {
  if (window.posthog) posthog.capture('signin_overlay_opened', { trigger: 'guest_btn' });
  document.getElementById('landing-overlay').classList.remove('hidden');
}
export function checkFirstVisit() {
  // Show landing overlay if user has never launched the app before.
  // Skip it if they already have data (existing users who update the app).
  const hasLaunched = localStorage.getItem('mf_launched');
  const hasData     = localStorage.getItem('mf_income') ||
                      localStorage.getItem('mf_recurring') ||
                      localStorage.getItem('mf_cards');
  if (hasLaunched || hasData) {
    document.getElementById('landing-overlay').classList.add('hidden');
  }
}

// ── localStorage → Supabase migration ───────────
export async function migrateFromLocalStorage() {
  if (!currentUser) return;
  toast('⏳ Importing your data…');
  const uid = currentUser.id;
  try {
    const lsIncome    = JSON.parse(localStorage.getItem('mf_income')          || '[]');
    const lsExpenses  = JSON.parse(localStorage.getItem('mf_expenses')        || '[]');
    const lsRecurring = JSON.parse(localStorage.getItem('mf_recurring')       || '[]');
    const lsCards     = JSON.parse(localStorage.getItem('mf_cards')           || '[]');
    const lsDeals     = JSON.parse(localStorage.getItem('mf_deals')           || '[]');
    const lsCCT       = JSON.parse(localStorage.getItem('mf_cc_transactions') || '[]');
    const lsLoans     = JSON.parse(localStorage.getItem('mf_loans')           || '[]');
    if (lsCards.length)     await db.from('credit_cards').upsert(lsCards.map(c => ({ ...toDbCard(c),     user_id: uid })));
    if (lsIncome.length)    await db.from('income').upsert(lsIncome.map(r =>       ({ ...toDbIncome(r),  user_id: uid })));
    if (lsExpenses.length)  await db.from('expenses').upsert(lsExpenses.map(r =>   ({ ...toDbIncome(r),  user_id: uid })));
    if (lsRecurring.length) await db.from('recurring').upsert(lsRecurring.map(r => ({ ...toDbRecurring(r), user_id: uid })));
    if (lsDeals.length)     await db.from('promo_deals').upsert(lsDeals.map(d =>   ({ ...toDbDeal(d),    user_id: uid })));
    if (lsCCT.length)       await db.from('cc_transactions').upsert(lsCCT.map(t => ({ ...toDbCCT(t),     user_id: uid })));
    if (lsLoans.length)     await db.from('loans').upsert(lsLoans.map(l =>         ({ ...toDbLoan(l),    user_id: uid })));
    ['mf_income','mf_expenses','mf_recurring','mf_cards','mf_deals','mf_cc_transactions','mf_loans']
      .forEach(k => localStorage.removeItem(k));
    await loadUserData();
    dismissMigration();
    renderDashboard(); renderOneoffList();
    toast('✅ Data imported successfully!');
  } catch (err) {
    console.error('Migration error:', err);
    toast('⚠️ Import failed — please try again');
  }
}
