// =====================================================================
// PATRIMONIA - DATA LAYER & LOGIC ENGINE (v5.0)
// Aligné avec dashboard.html — Fixes: dividendes, ESOP percol, aides, analyse, noms, dark/light, Aptos, fiscalité liée, simulation prêt
// =====================================================================

// 1. CONFIGURATION SUPABASE
const SUPABASE_URL  = 'https://grvxurgvxwmheiollrmp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_7XITRulkeLGYMis4S02PiA_JaDeUQQE';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
let currentUser = null;

const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

// ─── THÈME LIGHT/DARK ─────────────────────────────────────────────────
let currentTheme = localStorage.getItem('patrimonia_theme') || 'dark';

// ─── CSS VARS CACHE ──────────────────────────────────────────────────────
// getComputedStyle force un recalcul layout — on l'appelle UNE seule fois
// au changement de thème, et on stocke dans _css pour tous les charts.
let _css = { muted2: '#71717a', border: 'rgba(255,255,255,0.06)', text: '#f0f2f5', surface: '#111116' };

function _refreshCssCache() {
  const s = getComputedStyle(document.documentElement);
  _css = {
    muted2:  s.getPropertyValue('--muted2').trim()  || '#71717a',
    muted:   s.getPropertyValue('--muted').trim()   || '#52525b',
    border:  s.getPropertyValue('--border').trim()  || 'rgba(255,255,255,0.06)',
    text:    s.getPropertyValue('--text').trim()    || '#f0f2f5',
    surface: s.getPropertyValue('--surface').trim() || '#111116',
    green:   s.getPropertyValue('--green').trim()   || '#22c55e',
    danger:  s.getPropertyValue('--danger').trim()  || '#ef4444',
    accent:  s.getPropertyValue('--accent').trim()  || '#8b5cf6',
    accent2: s.getPropertyValue('--accent2').trim() || '#a78bfa',
  };
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('patrimonia_theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '☽';
  // Rafraîchir le cache CSS après changement de thème
  _refreshCssCache();
}

function toggleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }

// ─── BADGE OFFLINE / ONLINE ──────────────────────────────────────────────
// Informe l'utilisateur en temps réel si la connexion est perdue.
function _setOfflineBadge(offline) {
  let badge = document.getElementById('offlineBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'offlineBadge';
    badge.style.cssText = [
      'position:fixed','top:14px','left:50%','transform:translateX(-50%)',
      'background:rgba(239,68,68,0.92)','color:#fff','font-size:12px','font-weight:500',
      'padding:5px 14px','border-radius:20px','z-index:9999',
      'display:none','align-items:center','gap:6px',
      'box-shadow:0 2px 12px rgba(0,0,0,0.4)','transition:opacity .3s',
    ].join(';');
    badge.innerHTML = '⚠ Hors ligne — données non synchronisées';
    document.body.appendChild(badge);
  }
  badge.style.display = offline ? 'flex' : 'none';
}

window.addEventListener('offline', () => _setOfflineBadge(true));
window.addEventListener('online',  () => {
  _setOfflineBadge(false);
  // Retentative de sync Supabase dès que la connexion revient
  if (currentUser) saveToSupabase();
});

// ─── UTILITAIRES ───────────────────────────────────────────────────────

function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) { splash.classList.add('hidden'); setTimeout(() => { splash.style.display = 'none'; }, 450); }
}

function safeSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showToast(msg, color) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.borderLeft = '3px solid ' + (color || '#3b82f6');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ─── NAVIGATION ────────────────────────────────────────────────────────

const PAGE_TITLES = {
  overview:'Tableau de bord', portfolio:'Portefeuille', savings:'Épargne bancaire',
  salary:'Salaire & Budget', projection:'Projection DCA', analysis:'Analyse complète', benchmarks:'Benchmarks',
  fees:'Scanner de frais', fiscalite:'Fiscalité', sources:'Connexions', settings:'Paramètres',
  loan:'Simulation de prêt'
};

function navigate(pageId) {
  // Fermer sidebar sur mobile
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('open');

  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');
  safeSet('topbarTitle', PAGE_TITLES[pageId] || pageId);
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('active');
    if ((el.getAttribute('onclick') || '').includes("'" + pageId + "'")) el.classList.add('active');
  });
  document.querySelectorAll('.mobile-nav-item').forEach(el => {
    el.classList.remove('active');
    if (el.id === 'mn-' + pageId) el.classList.add('active');
  });
  if (pageId === 'projection') updateProjection();
  if (pageId === 'analysis')   { computeDiversityScore(); renderAnalysisPage(); }
  if (pageId === 'benchmarks') renderBenchmarks();
  if (pageId === 'fees')       renderFees();
  if (pageId === 'savings')    renderSavings();
  if (pageId === 'salary')     renderSalary();
  if (pageId === 'portfolio')  { _restorePortfolioFilters(); renderPortfolio(); renderAssetChart(); }
  if (pageId === 'fiscalite')  { autoFillFiscalFromSalary(); if(typeof calculateTax==='function') calculateTax(); }
  if (pageId === 'loan')       { updateLoanCalc(); renderLoanTracking(); }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}

// ─── INIT ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  });
});

async function initApp() {
  applyTheme(currentTheme);
  const splashTimeout = setTimeout(hideSplash, 5000);
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { clearTimeout(splashTimeout); hideSplash(); window.location.href = 'index.html'; return; }
    currentUser = session.user.id;
    console.log('Connecté:', currentUser);
    const email = session.user.email || '';
    safeSet('userName', email);
    safeSet('settingsEmail', email);
    const av = document.getElementById('userAvatar');
    if (av) av.textContent = email.charAt(0).toUpperCase();

    // 1. Charger localStorage immédiatement (affichage rapide)
    loadLocalData();
    initOverview();

    // 2. Charger depuis Supabase (données cloud — peut override localStorage)
    const fromCloud = await loadFromSupabase();
    if (fromCloud) {
      // Re-render avec les données cloud
      initOverview();
      renderDisconnectButtons();
      if (typeof renderPortfolio === 'function') renderPortfolio();
      if (typeof renderSavings   === 'function') renderSavings();
      if (typeof renderSalary    === 'function') renderSalary();
      showToast('Données synchronisées ✓', '#22c55e');
    } else if (assets.length > 0) {
      // Pas de données cloud mais données locales → les uploader
      saveToSupabase();
    }

    updateProjection();
    autoFillFiscalFromSalary();
    renderDisconnectButtons();
    // Snapshot mensuel — enregistre un point d'historique si nécessaire (offline-safe)
    maybeRecordMonthlySnapshot();

    // Démarrer l'auto-sync si credentials disponibles
    if (localStorage.getItem('patrimonia_sheets_id') && localStorage.getItem('patrimonia_sheets_key')) {
      startAutoSync();
      // Restore select value
      const sel = document.getElementById('syncIntervalSelect');
      if (sel) sel.value = getSyncInterval().toString();
    }
    const now = new Date();
    safeSet('lastUpdate', now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  } catch (err) {
    console.error('Erreur init:', err);
    showToast('Erreur: ' + err.message, '#ef4444');
  } finally {
    clearTimeout(splashTimeout);
    hideSplash();
  }
}

async function logout() { await sb.auth.signOut(); window.location.href = 'index.html'; }

async function refreshData() {
  safeSet('lastUpdate', 'Actualisation...');
  // Si credentials Google Sheets dispo → re-import complet
  const sheetId = localStorage.getItem('patrimonia_sheets_id');
  const apiKey  = localStorage.getItem('patrimonia_sheets_key');
  if (sheetId && apiKey) {
    await silentSheetsSync(sheetId, apiKey);
  } else {
    loadLocalData();
    initOverview();
  }
  autoFillFiscalFromSalary();
  safeSet('lastUpdate', new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  showToast('Actualisé ✓', '#22c55e');
}

// ─── AUTO-SYNC GOOGLE SHEETS ─────────────────────────────────────────────────

let _autoSyncInterval  = null;
let _autoSyncCountdown = null;
let _syncSecondsLeft   = 0;

const AUTO_SYNC_INTERVALS = {
  '5':  5  * 60,
  '15': 15 * 60,
  '30': 30 * 60,
  '60': 60 * 60,
  '0':  0,  // désactivé
};

function getSyncInterval() {
  return parseInt(localStorage.getItem('patrimonia_sync_interval') || '15');
}

function startAutoSync() {
  stopAutoSync();
  const mins = getSyncInterval();
  if (!mins) return; // désactivé
  const secs = mins * 60;
  _syncSecondsLeft = secs;
  updateSyncBadge();

  // Countdown chaque seconde
  _autoSyncCountdown = setInterval(() => {
    _syncSecondsLeft = Math.max(0, _syncSecondsLeft - 1);
    updateSyncBadge();
  }, 1000);

  // Sync effective
  _autoSyncInterval = setInterval(async () => {
    const sid = localStorage.getItem('patrimonia_sheets_id');
    const key = localStorage.getItem('patrimonia_sheets_key');
    if (!sid || !key) { stopAutoSync(); return; }
    await silentSheetsSync(sid, key);
    _syncSecondsLeft = secs;
  }, secs * 1000);
}

function stopAutoSync() {
  clearInterval(_autoSyncInterval);
  clearInterval(_autoSyncCountdown);
  _autoSyncInterval = _autoSyncCountdown = null;
  updateSyncBadge();
}

function updateSyncBadge() {
  const el = document.getElementById('syncCountdown');
  if (!el) return;
  const mins = getSyncInterval();
  if (!mins || !_autoSyncInterval) {
    el.textContent = '';
    el.title = 'Auto-sync désactivé';
    return;
  }
  const m = Math.floor(_syncSecondsLeft / 60);
  const s = _syncSecondsLeft % 60;
  const label = m > 0 ? `${m}m${s > 0 ? s + 's' : ''}` : `${s}s`;
  el.textContent = `↻ ${label}`;
  el.title = `Prochain sync dans ${label}`;
}

function setSyncInterval(mins) {
  localStorage.setItem('patrimonia_sync_interval', mins);
  if (mins === '0' || mins === 0) {
    stopAutoSync();
    showToast('Auto-sync désactivé', '#f59e0b');
  } else {
    startAutoSync();
    showToast(`Auto-sync toutes les ${mins} min ✓`, '#22c55e');
  }
}

// Sync silencieux — appelle connectSheets directement avec les credentials
// SANS passer par les inputs DOM (ancienne approche fragile et risquée)
async function silentSheetsSync(sheetId, apiKey) {
  try {
    await connectSheets(sheetId, apiKey, true);
    safeSet('lastUpdate', new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  } catch(e) { console.warn('Auto-sync failed:', e.message); }
}


// ─── DONNÉES LOCALES ────────────────────────────────────────────────────

let assets = [], savings = [], expenses = [], salaryData = {}, settings = { currency: 'EUR', exposureThreshold: 20 };
let dividends = [], histoPoints = [];

// Dirty flags — seuls les blocs modifiés sont envoyés à Supabase
const _dirty = { assets: false, savings: false, expenses: false, salary: false, settings: false, histo: false, dividends: false };

function _markDirty(...keys) { keys.forEach(k => { _dirty[k] = true; }); }
function _clearDirty()       { Object.keys(_dirty).forEach(k => { _dirty[k] = false; }); }

function loadLocalData() {
  try {
    assets     = JSON.parse(localStorage.getItem('patrimonia_assets')   || '[]');
    savings    = JSON.parse(localStorage.getItem('patrimonia_savings')  || '[]');
    expenses   = JSON.parse(localStorage.getItem('patrimonia_expenses') || '[]');
    salaryData = JSON.parse(localStorage.getItem('patrimonia_salary')   || '{}');
    settings   = JSON.parse(localStorage.getItem('patrimonia_settings') || '{"currency":"EUR","exposureThreshold":20}');
    loansTracked = JSON.parse(localStorage.getItem('patrimonia_loans')  || '[]');
    dividends  = JSON.parse(localStorage.getItem('patrimonia_dividends')|| '[]');
    histoPoints= JSON.parse(localStorage.getItem('patrimonia_histo')    || '[]');
  } catch(e) { console.warn('Erreur données locales:', e); }
}

let _saveDebounceTimer = null;

/**
 * saveLocalData(dirtyKeys?)
 * Sauvegarde immédiate en localStorage, puis sync Supabase debounced.
 * dirtyKeys : tableau de clés modifiées — si omis, toutes sont marquées dirty.
 */
function saveLocalData(dirtyKeys) {
  // Persist en localStorage — toujours (rapide, synchrone)
  localStorage.setItem('patrimonia_assets',   JSON.stringify(assets));
  localStorage.setItem('patrimonia_savings',  JSON.stringify(savings));
  localStorage.setItem('patrimonia_expenses', JSON.stringify(expenses));
  localStorage.setItem('patrimonia_salary',   JSON.stringify(salaryData));
  localStorage.setItem('patrimonia_settings', JSON.stringify(settings));
  localStorage.setItem('patrimonia_loans',    JSON.stringify(loansTracked));
  localStorage.setItem('patrimonia_dividends',JSON.stringify(dividends));
  localStorage.setItem('patrimonia_histo',    JSON.stringify(histoPoints));

  // Marquer les blocs dirty pour Supabase
  if (dirtyKeys && dirtyKeys.length) _markDirty(...dirtyKeys);
  else _markDirty('assets','savings','expenses','salary','settings','histo','dividends');

  // Debounce : évite les appels répétés lors de modifications rapides
  clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(() => saveToSupabase(), 1500);
}

async function saveToSupabase() {
  if (!currentUser) return;
  try {
    // Ne construire le payload qu'avec les blocs réellement modifiés
    const payload = { user_id: currentUser, updated_at: new Date().toISOString() };
    if (_dirty.assets)    payload.assets    = assets;
    if (_dirty.savings)   payload.savings   = savings;
    if (_dirty.expenses)  payload.expenses  = expenses;
    if (_dirty.salary)    payload.salary    = salaryData;
    if (_dirty.settings)  payload.settings  = settings;
    if (_dirty.histo)     payload.histo     = histoPoints;
    if (_dirty.dividends) payload.dividends = dividends;
    // loansTracked est inclus dans assets (stocké séparément, pas dans user_data Supabase)

    // Si rien n'a changé depuis la dernière sync, ne pas appeler Supabase
    const hasChanges = Object.keys(payload).length > 2; // > user_id + updated_at
    if (!hasChanges) return;

    const { error } = await sb.from('user_data').upsert(payload, { onConflict: 'user_id' });
    if (error) {
      console.warn('Supabase save error:', error.message);
    } else {
      _clearDirty();
      const ind = document.getElementById('syncIndicator');
      if (ind) { ind.style.opacity = '1'; setTimeout(() => ind.style.opacity = '0', 2000); }
    }
  } catch(e) { console.warn('Supabase save failed:', e.message); }
}

async function loadFromSupabase() {
  if (!currentUser) return false;
  try {
    const { data, error } = await sb.from('user_data').select('*').eq('user_id', currentUser).single();
    if (error || !data) return false;

    if (Array.isArray(data.assets))   { assets      = data.assets;   localStorage.setItem('patrimonia_assets',   JSON.stringify(assets)); }
    if (Array.isArray(data.savings))  { savings     = data.savings;  localStorage.setItem('patrimonia_savings',  JSON.stringify(savings)); }
    if (Array.isArray(data.expenses)) { expenses    = data.expenses; localStorage.setItem('patrimonia_expenses', JSON.stringify(expenses)); }
    if (data.salary)                  { salaryData  = data.salary;   localStorage.setItem('patrimonia_salary',   JSON.stringify(salaryData)); }
    if (data.settings)                { settings    = data.settings; localStorage.setItem('patrimonia_settings', JSON.stringify(settings)); }
    if (Array.isArray(data.histo)     && data.histo.length > 0)     { histoPoints = data.histo;   localStorage.setItem('patrimonia_histo',     JSON.stringify(histoPoints)); }
    if (Array.isArray(data.dividends) && data.dividends.length > 0) { dividends  = data.dividends;localStorage.setItem('patrimonia_dividends', JSON.stringify(dividends)); }
    return true;
  } catch(e) { console.warn('Supabase load failed:', e.message); return false; }
}


// ─── OVERVIEW ───────────────────────────────────────────────────────────

let chartHistoInstance = null, showSavingsInTotal = true;
// patrimoineMode: 'brut' | 'net' | 'sans-epargne'
let patrimoineMode = localStorage.getItem('patrimonia_mode') || 'brut';

function setPatrimoineMode(mode) {
  patrimoineMode = mode;
  localStorage.setItem('patrimonia_mode', mode);
  // Sync select
  const sel = document.getElementById('patrimoineModeSelect');
  if (sel) sel.value = mode;
  // Sync savings toggle (legacy compat)
  showSavingsInTotal = mode !== 'sans-epargne';
  initOverview();
}

// Compute total debts (mensualités crédit × durée restante — ou capital restant dû si saisi)
function getTotalDebts() {
  // Dettes saisies manuellement dans settings ou expenses catégorie 'credit'
  const creditExpenses = expenses.filter(e => (e.category||'').toLowerCase().includes('crédit') || (e.category||'').toLowerCase().includes('credit') || (e.category||'').toLowerCase().includes('prêt') || (e.category||'').toLowerCase().includes('pret'));
  // Use remainingCapital if set, otherwise 0 (user must enter it manually)
  return creditExpenses.reduce((s, e) => s + (e.remainingCapital || 0), 0);
}


// Helpers : valeur et coût d'un actif (utilise valTotale du Sheet si disponible)
function assetValue(a) {
  if (a.valTotale && a.valTotale > 0) return a.valTotale;
  return (a.qty || 0) * (a.currentPrice || a.buyPrice || 0);
}
function assetCost(a) {
  if (a.investi && a.investi > 0) return a.investi;
  return (a.qty || 0) * (a.buyPrice || 0);
}
function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function initOverview() {
  // Exclude EPA:AIR from sheets-cto to avoid double-counting with sheets-airbus ESOP assets
  const totalAssets = assets
    .filter(a => !a.isESOPCopy)
    .reduce((s, a) => s + assetValue(a), 0);
  const totalSav = savings.reduce((s, sv) => s + (sv.balance || 0), 0);
  const totalDebts = getTotalDebts();

  let total;
  if (patrimoineMode === 'net') {
    total = totalAssets + totalSav - totalDebts;
  } else if (patrimoineMode === 'sans-epargne') {
    total = totalAssets;
  } else {
    total = totalAssets + totalSav; // brut (default)
  }
  showSavingsInTotal = patrimoineMode !== 'sans-epargne';

  // Sync select
  const sel = document.getElementById('patrimoineModeSelect');
  if (sel && sel.value !== patrimoineMode) sel.value = patrimoineMode;

  // Update date label
  const dateLabel = document.getElementById('overviewDateLabel');
  if (dateLabel) {
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    const hasHisto = loadHistoPoints().length > 1;
    const modeLabel = patrimoineMode === 'net' ? 'Patrimoine net' : patrimoineMode === 'sans-epargne' ? 'Patrimoine (sans épargne)' : 'Patrimoine brut';
    dateLabel.innerHTML = `${modeLabel} <span style="color:var(--muted2);font-size:11px;margin-left:6px;">${today}</span>${hasHisto ? ' <span style="font-size:10px;color:var(--green);margin-left:4px;">● Historique réel</span>' : ''}`;
  }
  safeSet('kpi-total', fmt.format(total));
  renderCategoryCards(totalAssets, totalSav, total);
  renderPnlStats(totalAssets);
  renderPeriodPnl(currentHistoPeriod, total);
  renderBudgetWidget();
  renderBestWorst();
  renderHistoChart(total);
  renderDividendsOverview();
}

function renderCategoryCards(totalAssets, totalSav, total) {
  const el = document.getElementById('categoryCards');
  if (!el) return;

  const cats = [
    { id:'stock',   label:'Actions & Fonds', color:'#3b82f6', dot:'#3b82f6' },
    { id:'crypto',  label:'Crypto',          color:'#f59e0b', dot:'#f59e0b' },
    { id:'esop',    label:'ESOP / PER',      color:'#a78bfa', dot:'#a78bfa' },
    { id:'savings', label:'Livrets',         color:'#22c55e', dot:'#22c55e' },
  ];

  const catData = cats.map(cat => {
    let val, inv;
    if (cat.id === 'savings') {
      val = totalSav;
      inv = totalSav; // savings have no gain/loss
    } else if (cat.id === 'stock') {
      const a = assets.filter(a => (a.type || 'stock') === 'stock' && !a.isESOPCopy);
      val = a.reduce((s, x) => s + assetValue(x), 0);
      inv = a.reduce((s, x) => s + assetCost(x), 0);
    } else {
      const a = assets.filter(x => (x.type || 'stock') === cat.id);
      val = a.reduce((s, x) => s + assetValue(x), 0);
      inv = a.reduce((s, x) => s + assetCost(x), 0);
    }
    // YTD P&L from perfYtd field
    let ytdPnl = 0;
    if (cat.id !== 'savings') {
      const catAssets = cat.id === 'stock'
        ? assets.filter(a => (a.type||'stock') === 'stock' && !a.isESOPCopy)
        : assets.filter(a => (a.type||'stock') === cat.id);
      ytdPnl = catAssets.reduce((s, a) => {
        const v = assetValue(a);
        const pctRaw = a.perfYtd;
        if (!pctRaw || isNaN(pctRaw)) return s;
        const pct = normalizePct(pctRaw, a) / 100;
        return s + (v - v / (1 + pct));
      }, 0);
    }
    const pnl  = val - inv;
    const perf = inv > 0 ? (pnl / inv) * 100 : 0;
    return { ...cat, val, inv, pnl, perf, ytdPnl };
  }).filter(d => d.val > 0 || d.inv > 0);

  if (!catData.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="icon">📊</div><p>Ajoutez vos actifs via <b>Connexions</b></p></div>';
    renderDonutChart([], total);
    return;
  }

  // Totals row
  const totalInv  = catData.reduce((s, c) => s + (c.id === 'savings' ? 0 : c.inv), 0);
  const totalVal2 = catData.reduce((s, c) => s + c.val, 0);
  const totalPnl  = totalVal2 - totalInv;
  const totalPerf = totalInv > 0 ? (totalPnl / totalInv) * 100 : 0;

  const perfBar = (perf) => {
    const capped = Math.min(Math.max(perf, -100), 100);
    const color  = perf >= 0 ? '#22c55e' : '#ef4444';
    const bg     = perf >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
    const w      = Math.abs(capped);
    return `<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
      <div style="width:60px;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden;flex-shrink:0;">
        <div style="width:${w}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <span style="font-size:13px;font-weight:600;color:${color};min-width:52px;text-align:right;">${perf >= 0 ? '+' : ''}${perf.toFixed(2)}%</span>
    </div>`;
  };

  el.innerHTML = `
    <!-- Header -->
    <div class="cat-grid-header" style="display:grid;grid-template-columns:1fr 100px 100px 110px 150px;padding:8px 20px;background:var(--surface2);border-bottom:1px solid var(--border);gap:8px;align-items:center;">
      <div style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;">Actif</div>
      <div class="cat-col-inv" style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Investi</div>
      <div style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Val. Totale</div>
      <div style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Plus-Value</div>
      <div class="cat-col-perf" style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Performance</div>
    </div>

    ${catData.map(cat => {
      const pnlColor  = cat.pnl  >= 0 ? 'var(--green)' : 'var(--danger)';
      const isNonInv  = cat.id === 'savings';
      return `<div class="cat-card cat-grid-row" onclick="navigate('${cat.id === 'savings' ? 'savings' : 'portfolio'}')"
        style="display:grid;grid-template-columns:1fr 100px 100px 110px 150px;align-items:center;width:100%;padding:14px 20px;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${cat.dot};flex-shrink:0;"></div>
          <span style="font-size:13px;font-weight:500;line-height:1.3;">${cat.label}</span>
        </div>
        <div class="cat-col-inv cat-inv" style="text-align:right;font-size:13px;color:var(--muted2);">${isNonInv ? '–' : fmt.format(cat.inv)}</div>
        <div class="cat-val" style="text-align:right;font-size:13px;font-weight:600;">${fmt.format(cat.val)}</div>
        <div class="cat-pnl" style="text-align:right;font-size:13px;font-weight:600;color:${pnlColor};">${isNonInv ? '–' : (cat.pnl >= 0 ? '+' : '') + fmt.format(cat.pnl)}</div>
        <div class="cat-col-perf">${isNonInv ? '<div style="text-align:right;color:var(--muted2);font-size:12px;">–</div>' : perfBar(cat.perf)}</div>
      </div>`;
    }).join('')}

    <!-- TOTAL row -->
    <div class="cat-grid-row" style="display:grid;grid-template-columns:1fr 100px 100px 110px 150px;align-items:center;padding:14px 20px;gap:8px;background:var(--surface2);border-top:2px solid var(--border);">
      <div style="font-size:14px;font-weight:700;letter-spacing:-0.3px;">TOTAL</div>
      <div class="cat-col-inv" style="text-align:right;font-size:13px;font-weight:600;">${fmt.format(totalInv)}</div>
      <div style="text-align:right;font-size:13px;font-weight:700;">${fmt.format(totalVal2)}</div>
      <div style="text-align:right;font-size:13px;font-weight:700;color:${totalPnl >= 0 ? 'var(--green)' : 'var(--danger)'};">${totalPnl >= 0 ? '+' : ''}${fmt.format(totalPnl)}</div>
      <div class="cat-col-perf">${perfBar(totalPerf)}</div>
    </div>
  `;

  // Show debts row in net mode
  if (patrimoineMode === 'net') {
    const totalDebts = getTotalDebts();
    if (totalDebts > 0) {
      el.innerHTML += `<div class="cat-card" style="cursor:default;">
        <div style="display:grid;grid-template-columns:1fr 90px 90px 110px;align-items:center;width:100%;padding:14px 20px;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:10px;height:10px;border-radius:50%;background:#ef4444;flex-shrink:0;"></div>
            <span style="font-size:14px;font-weight:500;color:var(--danger);">Dettes / Crédits</span>
          </div>
          <div style="text-align:right;font-size:13px;color:var(--muted2);">–</div>
          <div style="text-align:right;font-size:14px;font-weight:600;color:var(--danger);">-${fmt.format(totalDebts)}</div>
          <div style="text-align:right;font-size:11px;color:var(--muted2);">Capital restant dû</div>
        </div>
      </div>`;
    } else {
      el.innerHTML += `<div style="padding:10px 20px;font-size:12px;color:var(--muted2);">
        💡 Ajoutez vos crédits dans <b>Salaire & Budget → Dépenses fixes</b> (catégorie "Crédit / Prêt") avec le capital restant dû pour voir le patrimoine net.
      </div>`;
    }
  }

  // Update donut total label
  const donutTotal = document.getElementById('donutTotal');
  if (donutTotal) donutTotal.textContent = fmt.format(total);

  renderDonutChart(catData, total);
}

let chartDonutInstance = null;

function renderDonutChart(catData, total) {
  const ctx = document.getElementById('chartDonutOverview');
  if (!ctx) return;
  if (chartDonutInstance) { chartDonutInstance.destroy(); chartDonutInstance = null; }
  if (!catData.length) return;

  const labels = catData.map(c => c.label);
  const data   = catData.map(c => c.val);
  const colors = catData.map(c => c.color);

  chartDonutInstance = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      cutout: '72%',
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt.format(ctx.parsed)} (${total > 0 ? ((ctx.parsed / total)*100).toFixed(1) : 0}%)`
          }
        }
      }
    }
  });

  // Render legend
  const legendEl = document.getElementById('donutLegend');
  if (legendEl) {
    legendEl.innerHTML = catData.map(c => {
      const pct = total > 0 ? ((c.val / total)*100).toFixed(1) : 0;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0;"></div>
          <span style="font-size:12px;color:var(--muted2);">${c.label}</span>
        </div>
        <div style="text-align:right;">
          <span style="font-size:12px;font-weight:600;">${fmt.format(c.val)}</span>
          <span style="font-size:11px;color:var(--muted2);margin-left:6px;">${pct}%</span>
        </div>
      </div>`;
    }).join('');
  }
}


/**
 * normalizePct(v, asset?)
 * Convertit une valeur de performance en pourcentage lisible.
 *
 * LOGIQUE DÉTERMINISTE — plus d'heuristique fragile |v| < 2 :
 *   • Si asset.perfUnit === 'ratio' → toujours × 100  (ex: 0.476 → 47.6%)
 *   • Si asset.perfUnit === 'pct'   → valeur directe  (ex: 47.6  → 47.6%)
 *   • Sinon (legacy / actifs manuels) → seuil strict |v| < 1.5
 *     Ce seuil élimine l'ambiguïté : +1.8 (ratio = +180%) vs +48 (déjà en %).
 */
function normalizePct(v, asset) {
  if (v === undefined || v === null || isNaN(v)) return 0;
  if (asset?.perfUnit === 'ratio') return v * 100;
  if (asset?.perfUnit === 'pct')   return v;
  return Math.abs(v) < 1.5 ? v * 100 : v;
}

function renderPnlStats(totalAssets) {
  // Exclude EPA:AIR from sheets-cto (same double-count exclusion as totalAssets)
  const filteredAssets = assets.filter(a => !a.isESOPCopy);

  // Use 'investi' field directly from Sheet when available — it's the most accurate
  // because it includes all deposits over time, not just qty × buyPrice
  const invested = filteredAssets.reduce((s, a) => s + assetCost(a), 0);

  // Total value also filtered consistently
  const totalVal = filteredAssets.reduce((s, a) => s + assetValue(a), 0);
  const savings  = showSavingsInTotal ? window.savings?.reduce((s, sv) => s + (sv.balance || 0), 0) || 0 : 0;

  // P&L = current total (assets + savings if shown) minus invested (assets only — savings have no cost)
  const pnl    = totalVal + savings - invested;
  const pnlPct = invested > 0 ? ((totalVal - invested) / invested * 100).toFixed(2) : 0;

  const color = pnl >= 0 ? '#22c55e' : '#ef4444';
  const el = document.getElementById('kpi-pnl');
  if (el) { el.textContent = (pnl >= 0 ? '+' : '') + fmt.format(pnl); el.style.color = color; }
  const pctEl = document.getElementById('kpi-pnl-pct');
  if (pctEl) { pctEl.textContent = (parseFloat(pnlPct) >= 0 ? '+' : '') + pnlPct + '%'; pctEl.style.color = color; }
  safeSet('statPositions', filteredAssets.length);

  // Update inline P&L in hero section — with click toggle €↔% (Trade Republic style)
  const inlineEl = document.getElementById('kpi-pnl-inline');
  if (inlineEl) {
    inlineEl.dataset.eur  = (pnl >= 0 ? '+' : '') + fmt.format(pnl);
    inlineEl.dataset.pct  = (parseFloat(pnlPct) >= 0 ? '+' : '') + pnlPct + '%';
    inlineEl.dataset.mode = inlineEl.dataset.mode || 'eur'; // default = €
    inlineEl.textContent  = inlineEl.dataset.mode === 'pct' ? inlineEl.dataset.pct : inlineEl.dataset.eur;
    inlineEl.style.color  = color;
    inlineEl.style.cursor = 'pointer';
    inlineEl.title        = 'Cliquer pour basculer €/% ';
    inlineEl.onclick      = () => {
      inlineEl.dataset.mode = inlineEl.dataset.mode === 'eur' ? 'pct' : 'eur';
      inlineEl.textContent  = inlineEl.dataset.mode === 'pct' ? inlineEl.dataset.pct : inlineEl.dataset.eur;
    };
  }
  const inlinePctEl = document.getElementById('kpi-pnl-pct-inline');
  if (inlinePctEl) {
    inlinePctEl.textContent  = (parseFloat(pnlPct) >= 0 ? '+' : '') + pnlPct + '%';
    inlinePctEl.className    = 'badge ' + (parseFloat(pnlPct) >= 0 ? 'badge-up' : 'badge-down');
    inlinePctEl.style.cursor = 'pointer';
    inlinePctEl.title        = 'Cliquer pour basculer €/%';
    inlinePctEl.onclick      = () => {
      if (!inlineEl) return;
      inlineEl.dataset.mode = inlineEl.dataset.mode === 'eur' ? 'pct' : 'eur';
      inlineEl.textContent  = inlineEl.dataset.mode === 'pct' ? inlineEl.dataset.pct : inlineEl.dataset.eur;
    };
  }

  // Compute daily/weekly/monthly/YTD P&L from asset period perf fields
  // Only use assets that actually have period data (non-zero)
  const computePeriodPnl = (field) => {
    return filteredAssets.reduce((s, a) => {
      const val = assetValue(a);
      const pctRaw = a[field];
      if (!pctRaw || isNaN(pctRaw) || pctRaw === 0) return s;
      const pct = normalizePct(pctRaw, a) / 100;
      // val_before = val / (1 + pct), delta = val - val_before
      return s + (val - val / (1 + pct));
    }, 0);
  };

  const d1Val  = computePeriodPnl('perf1d');
  const w1Val  = computePeriodPnl('perfW');
  const m1Val  = computePeriodPnl('perfM');
  const ytdVal = computePeriodPnl('perfYtd');

  [['statD1', d1Val], ['statW1', w1Val], ['statM1', m1Val], ['statYtd', ytdVal]].forEach(([id, v]) => {
    const e = document.getElementById(id);
    if (!e) return;
    if (v === 0) { e.textContent = '–'; e.style.color = 'var(--muted2)'; return; }
    e.textContent = (v >= 0 ? '+' : '') + fmt.format(v);
    e.style.color = v >= 0 ? '#22c55e' : '#ef4444';
  });
}

function renderBestWorst() {
  if (!assets.length) return;
  const withPerf = assets.map(a => {
    let perf;
    if (a.perfTotal && a.perfTotal !== 0) {
      perf = normalizePct(a.perfTotal, a);
    } else {
      const val = assetValue(a), cost = assetCost(a);
      perf = cost > 0 ? (val - cost) / cost * 100 : 0;
    }
    return { name: a.name || '?', perf };
  }).filter(a => !isNaN(a.perf)).sort((a, b) => b.perf - a.perf);
  if (withPerf.length) {
    safeSet('statBestName',  withPerf[0].name);
    safeSet('statBestPct',   (withPerf[0].perf >= 0 ? '+' : '') + withPerf[0].perf.toFixed(1) + '%');
    safeSet('statWorstName', withPerf[withPerf.length - 1].name);
    safeSet('statWorstPct',  withPerf[withPerf.length - 1].perf.toFixed(1) + '%');
  }
}

function renderBudgetWidget() {
  const net = salaryData.net || 0;
  const saved = salaryData.saved || 0;
  const aides = (salaryData.apl||0) + (salaryData.caf||0) + (salaryData.transport||0) + (salaryData.tr||0) + (salaryData.other||0);
  const totalRevenu = net + aides;
  const fixed = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const rate = totalRevenu > 0 ? Math.round((saved / totalRevenu) * 100) : 0;
  safeSet('rateVal', rate + '%');
  safeSet('salaryDisplay',  totalRevenu ? fmt.format(totalRevenu) : '–');
  safeSet('savingsDisplay', saved ? fmt.format(saved) : '–');
  safeSet('expensesDisplay',fixed ? fmt.format(fixed) : '–');
  const sb2 = document.getElementById('savingsBar'), eb = document.getElementById('expensesBar');
  if (sb2) sb2.style.width = Math.min(rate, 100) + '%';
  if (eb && totalRevenu > 0) eb.style.width = Math.min((fixed / totalRevenu) * 100, 100) + '%';
}

function toggleSavingsFilter() {
  // Legacy — now handled by setPatrimoineMode
  setPatrimoineMode(patrimoineMode === 'sans-epargne' ? 'brut' : 'sans-epargne');
}

let currentHistoPeriod = 'YTD';

// Load stored history points
// loadHistoPoints — wrapper pour compatibilité ; retourne la variable globale en mémoire
function loadHistoPoints() {
  return histoPoints || [];
}

// ─── COMPARAISON AUX INDICES ───────────────────────────────────────────
// URTH est utilisé comme proxy coté pour MSCI World, faute d'API publique MSCI libre.
const BENCHMARKS = {
  sp500:  { label:'S&P 500', symbol:'^GSPC', color:'#60a5fa' },
  nasdaq: { label:'Nasdaq-100', symbol:'^NDX', color:'#a78bfa' },
  msci:   { label:'MSCI World (ETF)', symbol:'URTH', color:'#34d399' },
  stoxx:  { label:'Euro Stoxx 50', symbol:'^STOXX50E', color:'#fbbf24' },
  cac:    { label:'CAC 40', symbol:'^FCHI', color:'#fb7185' }
};
let selectedBenchmarks = ['sp500','nasdaq','msci'];
let chartBenchmarksInstance = null;

function renderBenchmarkChoices() {
  const box = document.getElementById('benchmarkChoices');
  if (!box) return;
  box.innerHTML = Object.entries(BENCHMARKS).map(([key, item]) => {
    const active = selectedBenchmarks.includes(key);
    return `<button class="btn ${active ? 'btn-accent' : 'btn-ghost'}" style="width:auto;margin:0;padding:7px 11px;font-size:11px;" onclick="toggleBenchmark('${key}')">${active ? '✓ ' : ''}${item.label}</button>`;
  }).join('');
}

function toggleBenchmark(key) {
  selectedBenchmarks = selectedBenchmarks.includes(key) ? selectedBenchmarks.filter(k => k !== key) : [...selectedBenchmarks, key];
  renderBenchmarks();
}

function getPortfolioBenchmarkPoints(period) {
  // Rapport valeur / capital investi : les nouveaux versements n'apparaissent pas comme de la performance.
  const raw = filterHistoByPeriod(loadHistoPoints(), period).filter(p => p.date && Number(p.val) > 0).map(p => ({ date:p.date.slice(0,10), value:Number(p.val) / Math.max(Number(p.inv || p.val), 1) }));
  const current = assets.filter(a => !a.isESOPCopy).reduce((sum, a) => sum + assetValue(a), 0) + savings.reduce((sum, s) => sum + Number(s.balance || 0), 0);
  const invested = assets.filter(a => !a.isESOPCopy).reduce((sum, a) => sum + assetCost(a), 0) + savings.reduce((sum, s) => sum + Number(s.balance || 0), 0);
  const today = new Date().toISOString().slice(0,10);
  if (current > 0 && invested > 0 && (!raw.length || raw[raw.length - 1].date !== today)) raw.push({ date:today, value:current / invested });
  return raw.sort((a,b) => a.date.localeCompare(b.date));
}

async function fetchBenchmarkHistory(symbol, fromDate) {
  const start = Math.floor(new Date(fromDate + 'T00:00:00').getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${Math.floor(Date.now()/1000)}&interval=1d&events=history`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('donnée indisponible');
  const result = (await response.json())?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return (result?.timestamp || []).map((ts, i) => ({ date:new Date(ts * 1000).toISOString().slice(0,10), value:closes[i] })).filter(p => Number.isFinite(p.value));
}

function valueOnOrBefore(points, date) { for (let i=points.length-1; i>=0; i--) if (points[i].date <= date) return points[i].value; return null; }
function normalisePoints(points, labels) { const base=points[0]?.value; return !base ? labels.map(() => null) : labels.map(date => { const value=valueOnOrBefore(points,date); return value===null ? null : +(value/base*100).toFixed(2); }); }

async function renderBenchmarks() {
  renderBenchmarkChoices();
  const status=document.getElementById('benchmarkStatus'), cards=document.getElementById('benchmarkCards'), canvas=document.getElementById('chartBenchmarks');
  if (!canvas || !cards) return;
  const period=document.getElementById('benchmarkPeriod')?.value || 'TOUT', portfolio=getPortfolioBenchmarkPoints(period);
  if (portfolio.length < 2) {
    if (chartBenchmarksInstance) chartBenchmarksInstance.destroy();
    cards.innerHTML='<div class="panel" style="grid-column:1/-1;color:var(--muted2);">Ajoutez au moins deux points d’historique de portefeuille pour lancer la comparaison.</div>';
    if(status){status.textContent='Historique requis';status.className='badge badge-neutral';} return;
  }
  if(status){status.textContent='Chargement des marchés…';status.className='badge badge-neutral';}
  const startDate=portfolio[0].date, chosen=selectedBenchmarks.map(key => ({key,...BENCHMARKS[key]}));
  const results=await Promise.allSettled(chosen.map(item => fetchBenchmarkHistory(item.symbol,startDate)));
  const loaded=chosen.map((item,i)=>({...item,points:results[i].status==='fulfilled'?results[i].value:[]})).filter(item=>item.points.length>1);
  const labels=[...new Set([...portfolio.map(p=>p.date),...loaded.flatMap(item=>item.points.map(p=>p.date))])].filter(date=>date>=startDate).sort();
  const portfolioNorm=normalisePoints(portfolio,labels);
  const datasets=[{label:'Mon portefeuille',data:portfolioNorm,borderColor:'#f8fafc',fill:false,tension:.25,pointRadius:0,borderWidth:3}];
  loaded.forEach(item=>datasets.push({label:item.label,data:normalisePoints(item.points,labels),borderColor:item.color,fill:false,tension:.2,pointRadius:0,borderWidth:2}));
  if(chartBenchmarksInstance)chartBenchmarksInstance.destroy();
  chartBenchmarksInstance=new Chart(canvas.getContext('2d'),{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:getComputedStyle(document.documentElement).getPropertyValue('--muted2'),boxWidth:12,font:{size:11}}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}`}}},scales:{x:{ticks:{color:getComputedStyle(document.documentElement).getPropertyValue('--muted2'),maxTicksLimit:7,font:{size:10}},grid:{display:false}},y:{ticks:{color:getComputedStyle(document.documentElement).getPropertyValue('--muted2'),callback:v=>v.toFixed(0)},grid:{color:'rgba(255,255,255,.06)'}}}}});
  const finalPortfolio=portfolioNorm.filter(v=>v!==null).at(-1)||100, performance=v=>(v-100).toFixed(2);
  const portfolioCard=`<div class="panel"><div class="kpi-label">Mon portefeuille</div><div class="kpi-value" style="color:${finalPortfolio>=100?'var(--green)':'var(--danger)'}">${finalPortfolio>=100?'+':''}${performance(finalPortfolio)}%</div><div class="kpi-sub">Base 100 au ${startDate.split('-').reverse().join('/')}</div></div>`;
  const indexCards=loaded.map(item=>{const end=normalisePoints(item.points,labels).filter(v=>v!==null).at(-1)||100,gap=finalPortfolio-end;return `<div class="panel"><div class="kpi-label">${item.label}</div><div class="kpi-value" style="color:${end>=100?'var(--green)':'var(--danger)'}">${end>=100?'+':''}${performance(end)}%</div><div class="kpi-sub" style="color:${gap>=0?'var(--green)':'var(--danger)'}">Écart : ${gap>=0?'+':''}${gap.toFixed(2)} pts</div></div>`;}).join('');
  cards.innerHTML=portfolioCard+indexCards+(!loaded.length?'<div class="panel">Aucune donnée de marché n’a pu être chargée. Vérifiez votre connexion puis réessayez.</div>':'');
  if(status){status.textContent=loaded.length?`${loaded.length} indice${loaded.length>1?'s':''} chargé${loaded.length>1?'s':''}`:'Données indisponibles';status.className=loaded.length?'badge badge-up':'badge badge-down';}
}

// Filter histo points by period
function filterHistoByPeriod(points, period) {
  if (!points.length) return points;
  // Only use points with real values
  const validPoints = points.filter(h => h.val > 0);
  if (!validPoints.length) return [];

  const now = new Date();
  let cutoff = new Date(now);
  switch(period) {
    case '1J':  cutoff.setDate(now.getDate() - 2);  break; // last 2 days
    case '7J':  cutoff.setDate(now.getDate() - 8);  break; // last 8 days
    case '1M':  cutoff.setMonth(now.getMonth() - 2); break; // last 2 months (for monthly data)
    case '3M':  cutoff.setMonth(now.getMonth() - 3); break;
    case 'YTD': cutoff = new Date(now.getFullYear(), 0, 1); break;
    case '1A':  cutoff.setFullYear(now.getFullYear() - 1); break;
    case 'TOUT': return validPoints;
    default:    cutoff = new Date(now.getFullYear(), 0, 1);
  }
  const filtered = validPoints.filter(h => new Date(h.date) >= cutoff);
  // Always return at least 2 points (take last 2 if filter is too strict)
  return filtered.length >= 2 ? filtered : validPoints.slice(-2);
}

function renderHistoChart(total) {
  const ctx = document.getElementById('chartHistorique');
  if (!ctx) return;
  if (chartHistoInstance) chartHistoInstance.destroy();

  const now = new Date();
  const histoRaw = loadHistoPoints();

  // ── Build curve from REAL historical data if available ──
  const buildRealCurve = (period) => {
    const filtered = filterHistoByPeriod(histoRaw, period).filter(h => h.val > 0);
    if (filtered.length < 2) return null;

    const labels = filtered.map(h => {
      const d = new Date(h.date);
      return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    });
    const data = filtered.map(h => Math.round(h.val));

    // Append current total as last point if it differs from last stored point
    const lastStored = data[data.length - 1];
    if (Math.abs(lastStored - total) > 50) {
      labels.push(now.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }));
      data.push(Math.round(total));
    }
    return { labels, data };
  };

  // ── Fallback: estimate curve from period performance fields ──
  const buildEstimCurve = (pts, monthsBack, perfField) => {
    const labels = [], data = [];
    const assetsWithPerf = assets.filter(a => {
      const v = a[perfField];
      return v !== undefined && v !== null && !isNaN(v) && v !== 0;
    });
    let totalPeriodPnl;
    if (assetsWithPerf.length > 0) {
      totalPeriodPnl = assetsWithPerf.reduce((s, a) => {
        const val = assetValue(a);
        const pct = normalizePct(a[perfField], a) / 100;
        return s + (val - val / (1 + pct));
      }, 0);
    } else {
      const totalCost = assets
        .filter(a => !a.isESOPCopy)
        .reduce((s, a) => s + assetCost(a), 0);
      totalPeriodPnl = total - totalCost - (showSavingsInTotal ? savings.reduce((s,sv)=>s+(sv.balance||0),0) : 0);
    }
    const startVal = Math.max(0, total - totalPeriodPnl);

    for (let i = pts; i >= 0; i--) {
      const d = new Date(now);
      const daysBack = Math.round(i * (monthsBack * 30) / pts);
      d.setDate(d.getDate() - daysBack);
      if (monthsBack <= 1) {
        labels.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
      } else {
        labels.push(d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }));
      }
      const t = 1 - i / pts;
      const eased = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      data.push(Math.round(startVal + (total - startVal) * eased));
    }
    data[data.length - 1] = total;
    return { labels, data };
  };

  let curve;
  // Try real data first for monthly/long periods
  const realCurve = buildRealCurve(currentHistoPeriod);

  if (realCurve && ['YTD','1A','TOUT','3M','1M'].includes(currentHistoPeriod)) {
    curve = realCurve;
  } else {
    switch(currentHistoPeriod) {
      case '1J':   curve = buildEstimCurve(24, 1/30, 'perf1d');  break;
      case '7J':   curve = buildEstimCurve(7,  7/30, 'perfW');   break;
      case '1M':   curve = realCurve || buildEstimCurve(30, 1, 'perfM');   break;
      case '3M':   curve = realCurve || buildEstimCurve(12, 3, 'perfM');   break;
      case 'YTD': {
        const monthsSinceJan = now.getMonth() + now.getDate()/30;
        curve = realCurve || buildEstimCurve(Math.max(6, Math.round(monthsSinceJan * 4)), monthsSinceJan, 'perfYtd');
        break;
      }
      case '1A':   curve = realCurve || buildEstimCurve(12, 12, 'perfYtd');  break;
      case 'TOUT': curve = realCurve || buildEstimCurve(24, 24, 'perfYtd');  break;
      default:     curve = realCurve || buildEstimCurve(12, 12, 'perfYtd');  break;
    }
  }

  // Source indicator — show badge if using real data
  const dateLabel = document.getElementById('overviewDateLabel');
  if (dateLabel) {
    const usingReal = realCurve && ['YTD','1A','TOUT','3M','1M'].includes(currentHistoPeriod);
    dateLabel.innerHTML = `Patrimoine brut ${usingReal ? '<span style="font-size:10px;color:var(--green);margin-left:6px;">● Historique réel</span>' : ''}`;
  }

  // Determine chart color
  const isUp = curve.data[curve.data.length-1] >= curve.data[0];
  const lineColor = isUp ? '#3b82f6' : '#ef4444';
  const fillColor = isUp ? 'rgba(59,130,246,0.08)' : 'rgba(239,68,68,0.06)';

  chartHistoInstance = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: { labels: curve.labels, datasets: [{ data: curve.data, borderColor: lineColor, backgroundColor: fillColor, fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => fmt.format(ctx.parsed.y) }
      }},
      scales: {
        y: {
          display: true,
          position: 'left',
          grid: { color: (_css.border) },
          ticks: {
            color: _css.muted2,
            font: { size: 10 },
            maxTicksLimit: 5,
            callback: v => {
              if (v >= 1000) return (v/1000).toFixed(v%1000===0?0:1) + ' k€';
              return v + ' €';
            }
          }
        },
        x: { grid: { display: false }, ticks: { color: _css.muted2, font: { size: 10 }, maxTicksLimit: 8 } }
      }
    }
  });
}

function setHistoPeriod(period, btn) {
  currentHistoPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active', 'active-default'));
  btn.classList.add('active');
  const totalAssets = assets
    .filter(a => !a.isESOPCopy)
    .reduce((s, a) => s + assetValue(a), 0);
  const totalSav = savings.reduce((s, sv) => s + (sv.balance || 0), 0);
  const total    = showSavingsInTotal ? totalAssets + totalSav : totalAssets;
  renderHistoChart(total);
  renderPeriodPnl(period, total);
}

// Render P&L inline + performance panel based on selected period
function renderPeriodPnl(period, total) {
  const histo = loadHistoPoints();

  // Map period → perf field for live assets
  const perfFieldMap = { '1J':'perf1d', '7J':'perfW', '1M':'perfM', '3M':'perfM', 'YTD':'perfYtd', '1A':'perfYtd', 'TOUT':'perfYtd' };
  const perfField = perfFieldMap[period] || 'perfYtd';

  // Try to get period P&L from historical data first
  let periodPnl = null;
  let periodPct = null;

  if (histo.length >= 2 && ['YTD','1A','TOUT','3M','1M'].includes(period)) {
    const filtered = filterHistoByPeriod(histo, period).filter(h => h.val > 0);
    if (filtered.length >= 2) {
      const startPoint = filtered[0];
      const endPoint   = filtered[filtered.length - 1];
      // Use the actual current total (passed in) as endVal for the most recent period
      // This avoids stale histo data vs current asset values
      const isCurrentPeriod = endPoint === filtered[filtered.length - 1];
      const startVal = startPoint.val;
      const endVal   = total > 0 ? total : endPoint.val; // prefer live total
      if (startVal > 0 && endVal > 0) {
        periodPnl = endVal - startVal;
        periodPct = (periodPnl / startVal) * 100;
      }
    }
  }

  // Fallback: use asset perf fields
  if (periodPnl === null) {
    const filteredAssets = assets.filter(a => !a.isESOPCopy);
    periodPnl = filteredAssets.reduce((s, a) => {
      const val = assetValue(a);
      const pctRaw = a[perfField];
      if (!pctRaw || isNaN(pctRaw) || pctRaw === 0) return s;
      const pct = normalizePct(pctRaw, a) / 100;
      return s + (val - val / (1 + pct));
    }, 0);
    const totalVal = filteredAssets.reduce((s, a) => s + assetValue(a), 0);
    const startVal = totalVal - periodPnl;
    periodPct = startVal > 0 ? (periodPnl / startVal * 100) : 0;
  }

  const color = periodPnl >= 0 ? '#22c55e' : '#ef4444';
  const sign  = periodPnl >= 0 ? '+' : '';

  // Update inline hero P&L
  const inlineEl    = document.getElementById('kpi-pnl-inline');
  const inlinePctEl = document.getElementById('kpi-pnl-pct-inline');
  if (inlineEl) {
    inlineEl.dataset.eur = (sign + fmt.format(periodPnl));
    inlineEl.dataset.pct = (sign + (periodPct).toFixed(2) + '%');
    inlineEl.style.color = color;
    // Respect current toggle mode
    const showPct = inlineEl.dataset.mode === 'pct';
    inlineEl.textContent = showPct ? inlineEl.dataset.pct : inlineEl.dataset.eur;
  }
  if (inlinePctEl) {
    inlinePctEl.textContent = sign + (periodPct).toFixed(2) + '%';
    inlinePctEl.className   = 'badge ' + (periodPnl >= 0 ? 'badge-up' : 'badge-down');
    inlinePctEl.style.cursor = 'pointer';
  }

  // Update performance panel
  const pnlEl    = document.getElementById('kpi-pnl');
  const pnlPctEl = document.getElementById('kpi-pnl-pct');
  if (pnlEl)    { pnlEl.textContent = sign + fmt.format(periodPnl); pnlEl.style.color = color; }
  if (pnlPctEl) { pnlPctEl.textContent = sign + (periodPct).toFixed(2) + '%'; pnlPctEl.style.color = color; }

  // Update period label in performance panel
  const periodLabels = { '1J':'Aujourd\'hui', '7J':'Cette semaine', '1M':'Ce mois', '3M':'3 derniers mois', 'YTD':'Année en cours', '1A':'12 derniers mois', 'TOUT':'Depuis le début' };
  const perfLabelEl = document.querySelector('#kpi-pnl')?.closest('.panel')?.querySelector('[id*="perf-period-label"], .perf-period-label');
  safeSet('perfPeriodLabel', periodLabels[period] || 'Période sélectionnée');
}

// ─── SNAPSHOT MENSUEL AUTOMATIQUE ────────────────────────────────────────
// Enregistre un point d'historique au 1er de chaque mois, même sans Sheets.
// Garantit la continuité de la courbe historique offline.
function maybeRecordMonthlySnapshot() {
  const total = assets.filter(a => !a.isESOPCopy).reduce((s, a) => s + assetValue(a), 0)
              + savings.reduce((s, sv) => s + (sv.balance || 0), 0);
  if (total <= 0) return; // Pas de données — rien à enregistrer

  const now      = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const lastKey   = localStorage.getItem('patrimonia_snapshot_month');

  if (lastKey === thisMonth) return; // Déjà fait ce mois-ci

  const invested = assets.filter(a => !a.isESOPCopy).reduce((s, a) => s + assetCost(a), 0);
  const today    = now.toISOString().substring(0, 10);

  // Ajouter ou mettre à jour le point du mois courant
  const existing = histoPoints.filter(h => !h.date.startsWith(thisMonth));
  histoPoints = [...existing, { date: today, val: Math.round(total), inv: Math.round(invested) }]
    .sort((a, b) => a.date.localeCompare(b.date));

  localStorage.setItem('patrimonia_histo',          JSON.stringify(histoPoints));
  localStorage.setItem('patrimonia_snapshot_month', thisMonth);
  _markDirty('histo');
  console.log(`[Patrimonia] Snapshot mensuel ${thisMonth} enregistré : ${Math.round(total).toLocaleString('fr-FR')} €`);
}

// Persistance tri + filtres entre sessions
let currentSort = localStorage.getItem('patrimonia_sort') || 'val_desc';

function setSortFilter(sort) {
  currentSort = sort;
  localStorage.setItem('patrimonia_sort', sort);
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('sort_' + sort);
  if (btn) btn.classList.add('active');
  renderPortfolio();
}

function _restorePortfolioFilters() {
  const savedSort   = localStorage.getItem('patrimonia_sort')         || 'val_desc';
  const savedSrc    = localStorage.getItem('patrimonia_filter_src')   || 'all';
  const savedType   = localStorage.getItem('patrimonia_filter_type')  || 'all';
  currentSort = savedSort;
  const srcEl  = document.getElementById('filterSource');
  const typeEl = document.getElementById('filterType');
  if (srcEl)  srcEl.value  = savedSrc;
  if (typeEl) typeEl.value = savedType;
  const btn = document.getElementById('sort_' + savedSort);
  if (btn) btn.classList.add('active');
}

function renderPortfolio() {
  const srcEl  = document.getElementById('filterSource');
  const typeEl = document.getElementById('filterType');
  const srcF   = srcEl?.value  || 'all';
  const typF   = typeEl?.value || 'all';
  // Persister les filtres sélectionnés
  localStorage.setItem('patrimonia_filter_src',  srcF);
  localStorage.setItem('patrimonia_filter_type', typF);
  const tbody = document.getElementById('portfolioTbody');
  if (!tbody) return;
  // EPA:AIR (sheets-cto) is shown here under Actions/ETF; ESOP PEG (sheets-airbus) under ESOP/PER
  // Double-counting is avoided in initOverview/renderCategoryCards, not here
  let filtered = assets.filter(a => (srcF === 'all' || a.source === srcF) && (typF === 'all' || a.type === typF));
  filtered.sort((a, b) => {
    const va = assetValue(a), vb = assetValue(b);
    const ca = assetCost(a),  cb = assetCost(b);
    const pa = ca > 0 ? (va-ca)/ca*100 : 0;
    const pb = cb > 0 ? (vb-cb)/cb*100 : 0;
    if (currentSort==='val_desc')         return vb - va;
    if (currentSort==='perf_total_desc')  return pb - pa;
    if (currentSort==='perf_total_asc')   return pa - pb;
    return vb - va;
  });
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:24px;">Aucun actif — ajoutez-en via Connexions</td></tr>';
    return;
  }
  const totalVal = filtered.reduce((s, a) => s + assetValue(a), 0);
  const typeLabels = { stock:'ETF', crypto:'Crypto', savings:'\u00C9pargne', esop:'ESOP' };

  const fmtPct = (v) => {
    if (v === undefined || v === null || isNaN(v)) return '<span class="perf-zero">\u2013</span>';
    const pct = normalizePct(v, a);
    if (Math.abs(pct) < 0.001) return '<span class="perf-zero">\u2013</span>';
    const cls = pct >= 0 ? 'perf-pos' : 'perf-neg';
    return `<span class="${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>`;
  };

  tbody.innerHTML = filtered.map(a => {
    const val   = assetValue(a);
    const cost  = assetCost(a);
    const pnl   = val - cost;
    // Always compute total P&L% from actual val/cost — don't trust perfTotal for "Total" column
    // perfTotal from sheet can be wrong (e.g. Booking -118% due to ratio format mismatch)
    const pnlPct = cost > 0 ? (pnl / cost) * 100
      : (a.perfTotal && a.perfTotal !== 0 ? normalizePct(a.perfTotal, a) : 0);
    const pnlP   = Math.abs(pnlPct) > 0.01 ? pnlPct.toFixed(1) : '\u2013';
    const poids  = totalVal > 0 ? ((val / totalVal) * 100).toFixed(1) : '\u2013';
    const pc     = pnl >= 0 ? 'perf-pos' : 'perf-neg';
    const pcT    = pnlPct >= 0 ? 'perf-pos' : 'perf-neg';
    const displayName = a.name || a.ticker || '\u2013';
    const pnlSign = pnl >= 0 ? '+' : '';
    const pctSign = pnlPct >= 0 ? '+' : '';
    return `<tr>
      <td><div class="asset-name">${displayName} <span class="asset-badge">${typeLabels[a.type]||''}</span></div></td>
      <td class="portfolio-col-source" style="color:var(--muted2);font-size:12px;">${a.source||'manuel'}</td>
      <td>${fmt.format(val)}</td>
      <td class="${pc}">${pnlSign}${fmt.format(pnl)}</td>
      <td class="${pcT}">${pctSign}${pnlP}%</td>
      <td class="portfolio-col-jour">${fmtPct(a.perf1d)}</td>
      <td class="portfolio-col-hebdo">${fmtPct(a.perfW)}</td>
      <td class="portfolio-col-mois">${fmtPct(a.perfM)}</td>
      <td class="portfolio-col-ytd">${fmtPct(a.perfYtd)}</td>
      <td class="${pcT}">${pctSign}${pnlP}%</td>
      <td style="color:var(--muted2);">${poids}%</td>
    </tr>`;
  }).join('');
}

let chartAssetInstance = null;
let currentAssetPeriod = 'YTD';

function setAssetPeriod(period, btn) {
  currentAssetPeriod = period;
  document.querySelectorAll('#page-portfolio .period-btn').forEach(b => b.classList.remove('active', 'active-default'));
  if (btn) btn.classList.add('active');
  renderAssetChart();
}

function renderAssetChart() {
  if (!assets.length) return;

  const ctx = document.getElementById('chartAsset');
  if (!ctx) return;
  if (chartAssetInstance) { chartAssetInstance.destroy(); chartAssetInstance = null; }

  const selectEl  = document.getElementById('assetChartSelect');
  const valEl     = document.getElementById('assetChartVal');
  const deltaEl   = document.getElementById('assetChartDelta');
  const sparkEl   = document.getElementById('assetSparklines');
  const period    = currentAssetPeriod;

  // Populate select if not done yet
  if (selectEl && selectEl.options.length <= 1) {
    assets.forEach((a, i) => {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = a.name || a.ticker || 'Actif ' + i;
      selectEl.appendChild(opt);
    });
  }

  const selectedIdx = selectEl ? parseInt(selectEl.value) : NaN;
  const isGlobal    = isNaN(selectedIdx) || selectEl?.value === '__global__';

  // Total portfolio or single asset
  const totalVal = assets.reduce((s, a) => s + assetValue(a), 0);
  const totalCost = assets.reduce((s, a) => s + assetCost(a), 0);

  // Pick perf for the chosen period
  const getPerfRatio = (a) => {
    // Returns a raw ratio or % value depending on what the sheet sent
    const raw = period === '1J'  ? a.perf1d
              : period === '7J'  ? a.perfW
              : period === '1M'  ? a.perfM
              : period === 'YTD' ? a.perfYtd
              : a.perfTotal;
    return raw || 0;
  };

  const normPct = (v, a) => normalizePct(v, a);

  // Build bar chart data — top 10 by value
  const displayAssets = isGlobal
    ? [...assets].sort((a, b) => assetValue(b) - assetValue(a)).slice(0, 12)
    : [assets[selectedIdx]].filter(Boolean);

  const labels = displayAssets.map(a => (a.ticker || a.name || '?').replace(/\s*\(.*?\)\s*/, '').substring(0, 12));
  const perfData = displayAssets.map(a => parseFloat(normPct(getPerfRatio(a)).toFixed(1)));
  const bgColors = perfData.map(v => v >= 0 ? 'rgba(34,197,94,0.75)' : 'rgba(239,68,68,0.75)');
  const mutedCol = _css.muted2;
  const textCol  = _css.text;
  const gridCol  = _css.border;

  // Display total value and global perf
  if (isGlobal) {
    const globalPnl  = totalVal - totalCost;
    const globalPct  = totalCost > 0 ? (globalPnl / totalCost * 100).toFixed(1) : '0';
    if (valEl)   valEl.textContent   = fmt.format(totalVal);
    if (deltaEl) {
      const sign = globalPnl >= 0 ? '+' : '';
      deltaEl.innerHTML = `<span style="color:${globalPnl >= 0 ? 'var(--green)' : 'var(--danger)'};">${sign}${fmt.format(globalPnl)} (${sign}${globalPct}%)</span>`;
    }
  } else {
    const a = assets[selectedIdx];
    if (a) {
      const v = assetValue(a), c = assetCost(a), pnl = v - c;
      const pct = normPct(getPerfRatio(a));
      if (valEl) valEl.textContent = fmt.format(v);
      if (deltaEl) {
        const sign = pnl >= 0 ? '+' : '';
        deltaEl.innerHTML = `<span style="color:${pnl >= 0 ? 'var(--green)' : 'var(--danger)'};">${sign}${fmt.format(pnl)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</span>`;
      }
    }
  }

  // Render bar chart
  chartAssetInstance = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: perfData,
        backgroundColor: bgColors,
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        y: {
          grid: { color: gridCol },
          ticks: { color: mutedCol, callback: v => (v >= 0 ? '+' : '') + v + '%' }
        },
        x: { grid: { display: false }, ticks: { color: mutedCol, font: { size: 10 } } }
      }
    }
  });

  // Render sparklines (mini cards)
  if (sparkEl && isGlobal) {
    sparkEl.innerHTML = displayAssets.map(a => {
      const v   = assetValue(a);
      const pct = normPct(getPerfRatio(a));
      const col = pct >= 0 ? 'var(--green)' : 'var(--danger)';
      const sign = pct >= 0 ? '+' : '';
      const shortName = (a.name || a.ticker || '?').replace(/\s*\(.*?\)\s*/, '').substring(0, 18);
      return `<div style="background:var(--surface2);border-radius:8px;padding:10px 12px;border:1px solid var(--border);">
        <div style="font-size:11px;color:var(--muted2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${shortName}</div>
        <div style="font-size:16px;font-weight:600;margin-top:4px;">${fmt.format(v)}</div>
        <div style="font-size:12px;font-weight:500;color:${col};">${sign}${pct.toFixed(1)}%</div>
      </div>`;
    }).join('');
  } else if (sparkEl) {
    sparkEl.innerHTML = '';
  }
}

// ─── ÉPARGNE ─────────────────────────────────────────────────────────────

let chartSavingsInstance = null;

function renderSavings() {
  const total = savings.reduce((s,sv)=>s+(sv.balance||0),0);
  const ints  = savings.reduce((s,sv)=>s+(sv.balance||0)*((sv.rate||0)/100),0);
  const avg   = total>0?(savings.reduce((s,sv)=>s+(sv.balance||0)*(sv.rate||0),0)/total).toFixed(2):0;
  safeSet('savingsTotal', fmt.format(total));
  safeSet('savingsInterests', fmt.format(ints));
  safeSet('savingsAvgRate', avg + '%');
  const list = document.getElementById('savingsList');
  if (list) list.innerHTML = savings.length ? savings.map((sv,i)=>`
    <div class="fee-item" style="align-items:center;">
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:500;">${sv.name}</div>
        <div style="font-size:12px;color:var(--muted2);">Taux : ${sv.rate||0}% · Intérêts/an : ${fmt.format((sv.balance||0)*(sv.rate||0)/100)}</div>
      </div>
      <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
        <div style="font-weight:600;font-size:15px;">${fmt.format(sv.balance||0)}</div>
        <div style="display:flex;gap:8px;">
          <button onclick="openEditSavings(${i})" style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:4px;border:1px solid var(--blue);">✏️ Modifier</button>
          <button onclick="deleteSavings(${i})" style="font-size:11px;color:var(--danger);background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:4px;border:1px solid var(--danger);">🗑 Supprimer</button>
        </div>
      </div>
    </div>`).join('') : '<div class="empty-state"><div class="icon">🏦</div><p>Aucun livret</p><p style="font-size:12px;color:var(--muted2);">Cliquez sur "+ Ajouter" pour commencer</p></div>';
  const ctx = document.getElementById('chartSavings');
  if (ctx && savings.length) {
    if (chartSavingsInstance) chartSavingsInstance.destroy();
    chartSavingsInstance = new Chart(ctx.getContext('2d'), {
      type:'doughnut',
      data:{ labels:savings.map(s=>s.name), datasets:[{data:savings.map(s=>s.balance), backgroundColor:['#3b82f6','#22c55e','#f59e0b','#a78bfa','#ef4444','#06b6d4'], borderWidth:0}] },
      options:{cutout:'65%',plugins:{legend:{position:'right',labels:{color:_css.text,font:{size:11}}}}}
    });
  }
}

function openEditSavings(i) {
  const sv = savings[i];
  if (!sv) return;
  document.getElementById('editSavIdx').value  = i;
  document.getElementById('editSavName').value  = sv.name    || '';
  document.getElementById('editSavBal').value   = sv.balance || 0;
  document.getElementById('editSavRate').value  = sv.rate    || 0;
  openModal('editSavings');
}

function saveEditSavings() {
  const i = parseInt(document.getElementById('editSavIdx').value);
  if (isNaN(i) || !savings[i]) return;
  savings[i] = {
    ...savings[i],
    name:    document.getElementById('editSavName').value.trim() || savings[i].name,
    balance: parseFloat(document.getElementById('editSavBal').value)  || 0,
    rate:    parseFloat(document.getElementById('editSavRate').value)  || 0,
  };
  saveLocalData(['savings']); closeModal('editSavings'); renderSavings(); initOverview();
  showToast('Livret mis à jour ✓', '#22c55e');
}

function addSavings() {
  const name=document.getElementById('savName')?.value?.trim();
  if (!name) return showToast('Entrez un nom','#ef4444');
  savings.push({ name, balance:parseFloat(document.getElementById('savBalance')?.value)||0, rate:parseFloat(document.getElementById('savRate')?.value)||0 });
  // Reset form
  ['savName','savBalance','savRate'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  saveLocalData(['savings']); closeModal('addSavings'); renderSavings(); initOverview(); showToast('Livret ajouté ✓','#22c55e');
}

function deleteSavings(i) {
  if (!confirm(`Supprimer "${savings[i]?.name}" ?`)) return;
  savings.splice(i,1); saveLocalData(['savings']); renderSavings(); initOverview();
}

function switchLoanTab(tab) {
  document.getElementById('loanPane-sim').style.display   = tab === 'sim'   ? 'block' : 'none';
  document.getElementById('loanPane-track').style.display = tab === 'track' ? 'block' : 'none';
  document.getElementById('loanTab-sim').style.background   = tab === 'sim'   ? 'var(--accent)' : 'none';
  document.getElementById('loanTab-sim').style.color        = tab === 'sim'   ? '#fff'          : 'var(--muted2)';
  document.getElementById('loanTab-track').style.background = tab === 'track' ? 'var(--accent)' : 'none';
  document.getElementById('loanTab-track').style.color      = tab === 'track' ? '#fff'          : 'var(--muted2)';
  if (tab === 'track') renderLoanTracking();
}



// loansTracked est initialisé dans loadLocalData()
let loansTracked = [];

function saveLoans() {
  // Utilise saveLocalData avec dirty flag ciblé pour ne pas re-sauvegarder tout
  localStorage.setItem('patrimonia_loans', JSON.stringify(loansTracked));
  _markDirty('assets'); // loansTracked est séparé de user_data — pas de colonne dédiée
  clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(() => saveToSupabase(), 1500);
}

function renderLoanTracking() {
  const container = document.getElementById('loanTrackingList');
  if (!container) return;

  if (!loansTracked.length) {
    container.innerHTML = `<div class="empty-state" style="padding:32px 0;">
      <div class="icon">🏠</div>
      <p>Aucun prêt enregistré</p>
      <p style="font-size:12px;color:var(--muted2);">Ajoutez votre prêt pour suivre l'évolution du capital restant dû</p>
    </div>`;
    return;
  }

  container.innerHTML = loansTracked.map((loan, idx) => {
    const capital     = loan.capital || 0;
    const taux        = (loan.taux || 0) / 100 / 12;
    const dureeM      = (loan.duree || 0) * 12;
    const dateDebut   = new Date(loan.dateDebut || Date.now());
    const now         = new Date();

    // Mensualité
    const mens = taux > 0
      ? capital * taux / (1 - Math.pow(1 + taux, -dureeM))
      : capital / dureeM;

    // Mois écoulés depuis début
    const moisEcoules = Math.max(0, Math.floor(
      (now - dateDebut) / (1000 * 60 * 60 * 24 * 30.44)
    ));
    const moisRestants = Math.max(0, dureeM - moisEcoules);

    // Calcul du capital restant dû
    let capitalRestant = capital;
    let totalInterets = 0;
    let totalCapitalRemb = 0;
    for (let m = 0; m < Math.min(moisEcoules, dureeM); m++) {
      const interetsMois = capitalRestant * taux;
      const capitalMois  = mens - interetsMois;
      totalInterets     += interetsMois;
      totalCapitalRemb  += capitalMois;
      capitalRestant    -= capitalMois;
    }
    capitalRestant = Math.max(0, capitalRestant);
    const pctRembourse = capital > 0 ? ((capital - capitalRestant) / capital * 100) : 0;
    const dateFin = new Date(dateDebut);
    dateFin.setMonth(dateFin.getMonth() + dureeM);

    // Intérêts restants à payer
    let interetsRestants = 0;
    let cr = capitalRestant;
    for (let m = 0; m < moisRestants; m++) {
      const im = cr * taux;
      cr -= (mens - im);
      interetsRestants += im;
    }

    return `<div class="panel" style="margin-bottom:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-size:16px;font-weight:600;">${loan.nom || 'Prêt immobilier'}</div>
          <div style="font-size:12px;color:var(--muted2);">Depuis ${dateDebut.toLocaleDateString('fr-FR',{month:'long',year:'numeric'})} · Fin ${dateFin.toLocaleDateString('fr-FR',{month:'long',year:'numeric'})}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button onclick="openEditLoan(${idx})" style="font-size:11px;color:var(--blue);background:none;border:1px solid var(--blue);border-radius:6px;padding:4px 10px;cursor:pointer;">✏️ Modifier</button>
          <button onclick="deleteLoan(${idx})" style="font-size:11px;color:var(--danger);background:none;border:1px solid var(--danger);border-radius:6px;padding:4px 10px;cursor:pointer;">🗑</button>
        </div>
      </div>

      <!-- Barre de progression -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted2);margin-bottom:6px;">
          <span>${moisEcoules} mois remboursés</span>
          <span>${moisRestants} mois restants</span>
        </div>
        <div style="height:10px;background:var(--surface2);border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${pctRembourse.toFixed(1)}%;background:linear-gradient(90deg,#22c55e,#3b82f6);border-radius:5px;transition:width 0.5s;"></div>
        </div>
        <div style="text-align:center;font-size:11px;color:var(--muted2);margin-top:4px;">${pctRembourse.toFixed(1)}% remboursé</div>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:16px;">
        <div style="padding:12px;background:var(--surface2);border-radius:8px;text-align:center;">
          <div style="font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Capital emprunté</div>
          <div style="font-size:15px;font-weight:600;">${fmt.format(capital)}</div>
        </div>
        <div style="padding:12px;background:rgba(239,68,68,0.06);border-radius:8px;text-align:center;border:1px solid rgba(239,68,68,0.15);">
          <div style="font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Capital restant dû</div>
          <div style="font-size:15px;font-weight:700;color:var(--danger);">${fmt.format(capitalRestant)}</div>
        </div>
        <div style="padding:12px;background:rgba(34,197,94,0.06);border-radius:8px;text-align:center;border:1px solid rgba(34,197,94,0.15);">
          <div style="font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Capital remboursé</div>
          <div style="font-size:15px;font-weight:700;color:var(--green);">${fmt.format(capital - capitalRestant)}</div>
        </div>
        <div style="padding:12px;background:var(--surface2);border-radius:8px;text-align:center;">
          <div style="font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Mensualité</div>
          <div style="font-size:15px;font-weight:600;">${fmt.format(mens)}</div>
        </div>
        <div style="padding:12px;background:var(--surface2);border-radius:8px;text-align:center;">
          <div style="font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Intérêts payés</div>
          <div style="font-size:15px;font-weight:600;color:var(--muted);">${fmt.format(totalInterets)}</div>
        </div>
        <div style="padding:12px;background:var(--surface2);border-radius:8px;text-align:center;">
          <div style="font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Intérêts restants</div>
          <div style="font-size:15px;font-weight:600;color:var(--muted);">${fmt.format(interetsRestants)}</div>
        </div>
      </div>

      <!-- Détails -->
      <div style="font-size:12px;color:var(--muted2);display:flex;flex-wrap:wrap;gap:12px;padding-top:12px;border-top:1px solid var(--border);">
        <span>📊 Taux : <b>${loan.taux || 0}%</b></span>
        <span>⏱ Durée : <b>${loan.duree || 0} ans</b></span>
        <span>💰 Coût total crédit : <b>${fmt.format(totalInterets + interetsRestants)}</b></span>
        ${loan.assurance ? `<span>🛡 Assurance : <b>${fmt.format(loan.assurance)}/mois</b></span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openAddLoan() {
  // Reset form
  ['loanTrackedNom','loanTrackedCapital','loanTrackedTaux','loanTrackedDuree','loanTrackedDate','loanTrackedAssurance'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('loanTrackedIdx').value = -1;
  document.getElementById('modal-addLoanTracked').querySelector('.modal-title').textContent = 'Ajouter un prêt';
  openModal('addLoanTracked');
}

function openEditLoan(idx) {
  const loan = loansTracked[idx];
  if (!loan) return;
  document.getElementById('loanTrackedIdx').value        = idx;
  document.getElementById('loanTrackedNom').value        = loan.nom || '';
  document.getElementById('loanTrackedCapital').value    = loan.capital || '';
  document.getElementById('loanTrackedTaux').value       = loan.taux || '';
  document.getElementById('loanTrackedDuree').value      = loan.duree || '';
  document.getElementById('loanTrackedDate').value       = loan.dateDebut ? loan.dateDebut.substring(0,7) : '';
  document.getElementById('loanTrackedAssurance').value  = loan.assurance || '';
  document.getElementById('modal-addLoanTracked').querySelector('.modal-title').textContent = 'Modifier le prêt';
  openModal('addLoanTracked');
}

function saveLoanTracked() {
  const nom       = document.getElementById('loanTrackedNom')?.value?.trim() || 'Mon prêt';
  const capital   = parseFloat(document.getElementById('loanTrackedCapital')?.value) || 0;
  const taux      = parseFloat(document.getElementById('loanTrackedTaux')?.value)    || 0;
  const duree     = parseInt(document.getElementById('loanTrackedDuree')?.value)     || 0;
  const dateRaw   = document.getElementById('loanTrackedDate')?.value;
  const assurance = parseFloat(document.getElementById('loanTrackedAssurance')?.value) || 0;

  if (!capital || !duree) return showToast('Renseignez le capital et la durée', '#ef4444');
  // Parse month input (YYYY-MM) → first of month
  const dateDebut = dateRaw ? dateRaw + '-01' : new Date().toISOString().substring(0,10);

  const loan = { nom, capital, taux, duree, dateDebut, assurance };
  const idx  = parseInt(document.getElementById('loanTrackedIdx')?.value ?? -1);
  if (idx >= 0 && loansTracked[idx]) {
    loansTracked[idx] = loan;
    showToast('Prêt mis à jour ✓', '#22c55e');
  } else {
    loansTracked.push(loan);
    showToast('Prêt ajouté ✓', '#22c55e');
  }
  saveLoans();
  closeModal('addLoanTracked');
  renderLoanTracking();
}

function deleteLoan(idx) {
  if (!confirm(`Supprimer "${loansTracked[idx]?.nom || 'ce prêt'}" ?`)) return;
  loansTracked.splice(idx, 1);
  saveLoans();
  renderLoanTracking();
}


function renderSalary() {
  const net=salaryData.net||0, saved=salaryData.saved||0;
  const apl=salaryData.apl||0, caf=salaryData.caf||0, transport=salaryData.transport||0, tr2=salaryData.tr||0, other=salaryData.other||0;
  const aides=apl+caf+transport+tr2+other;
  const totalRevenu=net+aides;
  const fixed=expenses.reduce((s,e)=>s+(e.amount||0),0);
  const avail=totalRevenu-saved-fixed, rate=totalRevenu>0?Math.round((saved/totalRevenu)*100):0;
  safeSet('grossDisplay', salaryData.gross?fmt.format(salaryData.gross):'–');
  safeSet('netDisplay',   net?fmt.format(net):'–');
  safeSet('interDisplay', salaryData.inter?fmt.format(salaryData.inter):'–');
  safeSet('partDisplay',  salaryData.part?fmt.format(salaryData.part):'–');
  safeSet('rateValBig',   rate+'%');
  safeSet('savedMonthly', saved?fmt.format(saved):'–');
  safeSet('fixedExp',     fixed?fmt.format(fixed):'–');
  safeSet('available',    fmt.format(Math.max(avail,0)));
  // Affiche les aides dans la section revenus
  const aidesEl=document.getElementById('aidesDisplay');
  if(aidesEl) {
    const rows=[];
    if(apl)       rows.push(`<div class="flex-between text-sm mt-8"><span class="color-muted">APL / aide logement</span><span>${fmt.format(apl)}/mois</span></div>`);
    if(caf)       rows.push(`<div class="flex-between text-sm mt-8"><span class="color-muted">Allocations CAF</span><span>${fmt.format(caf)}/mois</span></div>`);
    if(transport) rows.push(`<div class="flex-between text-sm mt-8"><span class="color-muted">Prime transport</span><span>${fmt.format(transport)}/mois</span></div>`);
    if(tr2)       rows.push(`<div class="flex-between text-sm mt-8"><span class="color-muted">Tickets restaurant</span><span>${fmt.format(tr2)}/mois</span></div>`);
    if(other)     rows.push(`<div class="flex-between text-sm mt-8"><span class="color-muted">Autres revenus</span><span>${fmt.format(other)}/mois</span></div>`);
    if(rows.length) aidesEl.innerHTML='<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-size:11px;color:var(--accent2);font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Aides & revenus complémentaires</div>'+rows.join('')+'<div class="flex-between text-sm mt-8" style="font-weight:600;border-top:1px solid var(--border);padding-top:8px;"><span>Total revenus</span><span style="color:var(--accent2);">'+fmt.format(totalRevenu)+'/mois</span></div></div>';
    else aidesEl.innerHTML='';
  }
  const pct=v=>totalRevenu>0?Math.min((v/totalRevenu)*100,100):0;
  [['netBar',pct(net)],['savedBar',pct(saved)],['fixedBar',pct(fixed)],['availBar',Math.max(pct(avail),0)]].forEach(([id,w])=>{
    const el=document.getElementById(id); if(el) el.style.width=w+'%';
  });
  const list=document.getElementById('expensesList');
  if (list) list.innerHTML = expenses.length ? expenses.map((e,i)=>`
    <div class="fee-item">
      <div><div style="font-size:13px;font-weight:500;">${e.label}</div><div style="font-size:11px;color:var(--muted2);">${e.category||''}</div></div>
      <div style="display:flex;align-items:center;gap:12px;"><span style="font-weight:600;">${fmt.format(e.amount||0)}/mois</span>
      <button onclick="deleteExpense(${i})" style="font-size:11px;color:var(--danger);background:none;border:none;cursor:pointer;">✕</button></div>
    </div>`).join('') : '<div class="empty-state"><div class="icon">💳</div><p>Aucune dépense fixe</p></div>';
}

function estimateNet() {
  const g=parseFloat(document.getElementById('salGross')?.value)||0;
  const n=Math.round(g*0.77);
  const el=document.getElementById('netEstimate'); if(el&&g) el.textContent='Estimation : '+fmt.format(n)+'/mois';
  const ni=document.getElementById('salNet'); if(ni&&g&&!ni.value) ni.value=n;
}

function saveSalary() {
  const g=id=>parseFloat(document.getElementById(id)?.value)||0;
  salaryData={gross:g('salGross'),net:g('salNet'),inter:g('salInter'),part:g('salPart'),saved:g('salSaved'),abond:g('salAbond'),apl:g('salApl'),caf:g('salCaf'),transport:g('salTransport'),tr:g('salTr'),other:g('salOther')};
  saveLocalData(['salary']); closeModal('editSalary'); renderSalary(); initOverview();
  autoFillFiscalFromSalary();
  showToast('Salaire enregistré ✓','#22c55e');
}

function toggleCreditField() {
  const cat = document.getElementById('expCategory')?.value;
  const field = document.getElementById('creditCapitalField');
  if (field) field.style.display = (cat === 'credit') ? 'block' : 'none';
}

function addExpense() {
  const label = document.getElementById('expLabel')?.value?.trim();
  if (!label) return showToast('Entrez un libellé','#ef4444');
  const category = document.getElementById('expCategory')?.value || 'autre';
  const remainingCapital = category === 'credit' ? (parseFloat(document.getElementById('expRemainingCapital')?.value) || 0) : 0;
  expenses.push({ label, amount: parseFloat(document.getElementById('expAmount')?.value)||0, category, remainingCapital });
  // Reset credit field
  const capField = document.getElementById('expRemainingCapital');
  if (capField) capField.value = '';
  const creditDiv = document.getElementById('creditCapitalField');
  if (creditDiv) creditDiv.style.display = 'none';
  saveLocalData(['expenses']); closeModal('addExpense'); renderSalary(); initOverview(); showToast('Dépense ajoutée ✓','#22c55e');
}

function deleteExpense(i) { expenses.splice(i,1); saveLocalData(['expenses']); renderSalary(); initOverview(); }

// ─── PROJECTION DCA ──────────────────────────────────────────────────────

let chartProjInstance = null;

function updateProjection() {
  const start=parseFloat(document.getElementById('projStartCapital')?.value)||0;
  const dca  =parseFloat(document.getElementById('projMonthly')?.value)||500;
  const rate =(parseFloat(document.getElementById('projRate')?.value)||8)/100;
  const years=parseInt(document.getElementById('projYears')?.value)||20;
  let capital=start, invested=start;
  const labels=[],dataCap=[],dataInv=[];
  for(let i=0;i<=years;i++){
    labels.push('Année '+i); dataCap.push(Math.round(capital)); dataInv.push(Math.round(invested));
    if(i<years){ capital=(capital+dca*12)*(1+rate); invested+=dca*12; }
  }
  const gains=capital-invested;
  safeSet('projectedValue', fmt.format(capital));
  safeSet('projectedGains', fmt.format(gains));
  safeSet('projectionMeta', years+' ans · '+(rate*100).toFixed(0)+'% / an · DCA '+fmt.format(dca)+'/mois');
  const msEl=document.getElementById('milestones');
  if(msEl){
    const targets=[10000,50000,100000,250000,500000,1000000];
    msEl.innerHTML=targets.map(t=>{
      let yr=null; for(let i=0;i<dataCap.length;i++){if(dataCap[i]>=t){yr=i;break;}}
      const c=yr!==null?'#22c55e':'var(--muted)';
      return `<div style="padding:10px 16px;background:var(--surface2);border-radius:8px;text-align:center;min-width:100px;">
        <div style="font-size:11px;color:var(--muted2);">Objectif</div>
        <div style="font-size:15px;font-weight:600;color:${c};">${fmt.format(t)}</div>
        <div style="font-size:11px;color:${c};">${yr!==null?'Année '+yr:'Non atteint'}</div></div>`;
    }).join('');
  }
  const ctx=document.getElementById('chartProjection');
  if(!ctx) return;
  if(chartProjInstance) chartProjInstance.destroy();
  chartProjInstance=new Chart(ctx.getContext('2d'),{
    type:'line',
    data:{labels,datasets:[
      {label:'Capital projeté',data:dataCap,borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,0.08)',fill:true,tension:0.4,pointRadius:0},
      {label:'Total investi',  data:dataInv,borderColor:'#52525b',borderDash:[5,5],fill:false,pointRadius:0}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{labels:{color:_css.muted2,font:{size:11}}}},
      scales:{y:{grid:{color:_css.border},ticks:{color:_css.muted2,callback:v=>fmt.format(v)}},
              x:{grid:{display:false},ticks:{color:_css.muted2,maxTicksLimit:8}}}}
  });
}

// ─── SCANNER DE FRAIS ────────────────────────────────────────────────────

function renderFees() {
  const total=assets.reduce((s,a)=>s+(a.qty||1)*(a.currentPrice||0),0);
  const fees =assets.reduce((s,a)=>s+(a.qty||1)*(a.currentPrice||0)*((a.fees||0)/100),0);
  safeSet('feeTotal',  fmt.format(fees));
  safeSet('feeImpact', fmt.format(fees*20));
  safeSet('feeScore',  (fees>0&&total>0?Math.max(1,10-Math.round((fees/total)*1000)):10)+'/10');
  const el=document.getElementById('feesBreakdown');
  if(!el) return;
  if(!assets.length){el.innerHTML='<div class="empty-state"><div class="icon">🔍</div><p>Ajoutez des actifs pour analyser les frais</p></div>';return;}
  el.innerHTML=assets.map(a=>{
    const val=(a.qty||1)*(a.currentPrice||0), fee=val*((a.fees||0)/100);
    const dot=(a.fees||0)<=0.2?'#22c55e':(a.fees||0)<=0.5?'#f59e0b':'#ef4444';
    return `<div class="fee-item"><div class="fee-score" style="background:${dot};"></div>
      <div style="flex:1;"><div style="font-size:13px;font-weight:500;">${a.name||'–'}</div><div style="font-size:11px;color:var(--muted2);">${a.fees||0}% / an</div></div>
      <div style="text-align:right;"><div style="font-weight:600;color:var(--danger);">${fmt.format(fee)}/an</div><div style="font-size:11px;color:var(--muted2);">${fmt.format(val)} investi</div></div></div>`;
  }).join('');
}

// ─── AJOUT ACTIF ─────────────────────────────────────────────────────────

function addAsset() {
  const name=document.getElementById('assetName')?.value?.trim();
  if(!name) return showToast('Entrez un nom / ticker','#ef4444');
  const g=id=>document.getElementById(id);
  assets.push({ name, type:g('assetType')?.value||'stock', source:g('assetSource')?.value||'manual',
    qty:parseFloat(g('assetQty')?.value)||1, buyPrice:parseFloat(g('assetBuyPrice')?.value)||0,
    currentPrice:parseFloat(g('assetCurrentPrice')?.value)||0, geo:g('assetGeo')?.value||'world',
    sector:g('assetSector')?.value||'mixed', currency:g('assetCurrency')?.value||'EUR',
    fees:parseFloat(g('assetFees')?.value)||0 });
  saveLocalData(['assets']); closeModal('addAsset'); initOverview(); renderPortfolio(); showToast(name+' ajouté ✓','#22c55e');
}

// ─── CONNEXIONS ──────────────────────────────────────────────────────────

/**
 * connectSheets(sheetIdOrNull, apiKeyOrNull, silent)
 * Peut être appelée de deux façons :
 *   1. Par l'UI  → connectSheets() : lit les inputs DOM
 *   2. Par sync  → connectSheets(sheetId, apiKey, true) : paramètres directs, jamais de DOM
 */
async function connectSheets(sheetIdParam, apiKeyParam, silent = false) {
  // Résolution des credentials : paramètres > DOM > localStorage
  let apiKey, sheetId;
  if (sheetIdParam && apiKeyParam) {
    sheetId = sheetIdParam;
    apiKey  = apiKeyParam;
  } else {
    apiKey  = document.getElementById('sheetsApiKey')?.value?.trim();
    const url = document.getElementById('sheetsUrl')?.value?.trim();
    if (!apiKey || !url) return showToast('Clé API et URL requis', '#ef4444');
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return showToast('URL invalide', '#ef4444');
    sheetId = match[1];
  }
  const btn = document.getElementById('importSheetsBtn');

  // Parse number: handles French locale "1 282,40" → 1282.40, "1.282,40" → 1282.40
  const p = s => {
    if (s === null || s === undefined || s === '') return 0;
    let str = s.toString().trim();
    // Remove any currency symbols or % signs
    str = str.replace(/[€$£%\s]/g, '');
    // If dot is thousands separator (e.g. "1.282,40"), remove dots before comma
    if (str.includes(',') && str.includes('.') && str.lastIndexOf('.') < str.lastIndexOf(',')) {
      str = str.replace(/\./g, '');
    }
    // Replace comma decimal separator with dot
    str = str.replace(',', '.');
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  };
  const t = s => (s||'').toString().trim();

  async function fetchTab(name) {
    try {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(name)}?key=${apiKey}`);
      const data = await res.json();
      if (data.error) { console.warn(`Onglet "${name}" ignoré:`, data.error.message); return null; }
      return data.values || [];
    } catch(e) { return null; }
  }

  try {
    if (btn) btn.textContent = '⏳ Import en cours...';
    assets = assets.filter(a => !a.source?.startsWith('sheets-'));
    let imported = 0;

    // ── FETCH PARALLÈLE phase 1 : onglets de données ─────────────────────
    const [ctoRows, airbusRows, cryptoRows] = await Promise.all([
      fetchTab('CTO'),
      fetchTab('AIRBUS'),
      fetchTab('Crypto'),
    ]);

    // CTO — A=Ticker B=Nom C=Qté D=PRU E=Prix(devise locale) F=Investi(€) G=ValTotale(€)
    //        H=1J I=Hebdo J=1Mois K=6Mois L=YTD M=Perf% N=Catégorie O=Secteur P=ZoneGéo
    //        U=TickerLocal V=TickerYahoo W=Devise X=PrixSecours
    if (ctoRows) {
      ctoRows.slice(1).forEach(row => {
        const ticker = t(row[0]);
        if (!ticker || ticker.toUpperCase() === 'TOTAL' || !ticker) return;

        const nom        = t(row[1]) || ticker;
        const qty        = p(row[2]);
        const pru        = p(row[3]);           // PRU en devise locale
        const prixBrut   = p(row[4]);           // Prix actuel en devise locale (peut être USD)
        const investi    = p(row[5]);            // Investi en EUR ✓
        const valTotale  = p(row[6]);            // Valeur totale en EUR ✓ (déjà convertie)
        const devise     = t(row[23]) || t(row[22]) || 'EUR';
        const prixSecours = p(row[24]);          // Prix secours (EUR)

        // Ignorer les lignes vides
        if (qty === 0 && valTotale === 0 && investi === 0) return;

        // Prix affiché : utiliser valTotale/qty si dispo (déjà en EUR)
        // Sinon prix brut (attention : peut être USD si devise='USD')
        const prixEUR = valTotale > 0 && qty > 0 ? valTotale / qty
                      : prixSecours > 0 ? prixSecours
                      : prixBrut;

        const geoRaw = t(row[15]).toLowerCase();
        const geoMap = {'usa':'us','états-unis':'us','etats-unis':'us','europe':'eu',
                        'france':'fr','monde':'world','emergent':'em','emergents':'em'};
        const geo    = geoMap[geoRaw] || 'world';
        const secRaw = t(row[14]).toLowerCase();
        const sector = secRaw.includes('tech')     ? 'tech'
                     : secRaw.includes('nerg')     ? 'energy'
                     : secRaw.includes('inanc')    ? 'finance'
                     : secRaw.includes('sant') || secRaw.includes('alth') ? 'health'
                     : secRaw.includes('onautique') || secRaw.includes('ndustri') ? 'industry'
                     : secRaw.includes('rypto')    ? 'crypto'
                     : 'mixed';

        assets.push({
          name:         `${nom} (${ticker})`,
          ticker,
          source:       'sheets-cto',
          type:         'stock',
          qty,
          buyPrice:     pru,
          currentPrice: prixEUR,
          investi,
          valTotale,
          // Colonnes H/I/J/K = ratio (ex: -0.007 = -0.7%) → perfUnit:'ratio'
          // Colonne M (perfTotal) = % direct (ex: 47.6) → non concernée par perfUnit
          perfUnit:  'ratio',
          perf1d:   p(row[7]),
          perfW:    p(row[8]),
          perfM:    p(row[9]),
          perfYtd:  p(row[11]),
          perfTotal:p(row[12]),
          geo, sector,
          currency: devise,
          fees:     0,
        });
        imported++;
      });
    }

    // AIRBUS — A=Année B=Enveloppe C=Nom D=Investi E=ActionsAchetées F=ActionsOffertes
    //          G=PartsDividendes H=TotalQté I=PRUAchat J=PRURéel K=Cours L=ValTotale M=Perf%
    if (airbusRows) {
      airbusRows.slice(1).forEach(row => {
        const enveloppe = t(row[1]).toUpperCase();  // PEG ou PERCOL
        const nom       = t(row[2]);
        if (!nom || nom.toUpperCase() === 'TOTAL' || !enveloppe) return;

        const investi   = p(row[3]);
        const totalQty  = p(row[7]);
        const pruAchat  = p(row[8]);
        const cours     = p(row[10]);
        const valTotale = p(row[11]);
        const perf      = p(row[12]);

        // Intéressement PEG → c'est une action Airbus dans le portefeuille PEG
        // On l'inclut comme actif EPA:AIR avec l'enveloppe PEG
        const nomLower = nom.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove accents
        
        const isInteressement = nomLower.includes('interessement') || nomLower.includes('participation');

        // Ignorer lignes 100% vides
        if (valTotale === 0 && totalQty === 0 && investi === 0) return;

        // Ticker : tout ce qui est PEG ou Airbus/ESOP → EPA:AIR
        //          PERCOL PME/Diversifié → PME
        const ticker = (enveloppe === 'PEG' || nom.toLowerCase().includes('airbus') || nom.toLowerCase().includes('esop'))
                      ? 'EPA:AIR' : 'PERCOL-PME';

        const serial   = p(row[0]);
        const annee    = serial > 40000
          ? new Date(Math.round((serial - 25569) * 86400 * 1000)).getFullYear()
          : '';

        // Calcul valeur : préférer valTotale de la feuille (déjà en EUR)
        const val = valTotale > 0 ? valTotale : (totalQty > 0 && cours > 0 ? totalQty * cours : 0);
        if (val === 0 && investi === 0) return;

        const shortLabel = isInteressement ? `Int\u00E9ressement ${enveloppe}` : nom;
        const displayName = `${shortLabel} ${enveloppe} ${annee}`.trim();

        assets.push({
          name:         displayName,
          ticker,
          source:       'sheets-airbus',
          type:         'esop',
          qty:          totalQty,
          buyPrice:     pruAchat,
          currentPrice: cours,
          investi,
          valTotale:    val,
          perfUnit:     'pct',          // col M Airbus = % direct (ex: 42.3 = +42.3%)
          perfTotal:    perf,
          // FLAG : actif EPA:AIR ESOP — exclu du total CTO pour éviter le double-comptage
          isESOPCopy:   ticker === 'EPA:AIR',
          enveloppe,
          geo:          'eu',
          sector:       'industry',
          currency:     'EUR',
          fees:         0,
        });
        imported++;
      });

      // L'intéressement va AUSSI dans le salaire annuel (montant investi = versement annuel)
      const interRows = airbusRows.slice(1).filter(row => {
        const n = (row[2]||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        return n.includes('interessement') || n.includes('participation');
      });
      const interTotal = interRows.reduce((s, row) => s + p(row[3]), 0);
      if (interTotal > 0) salaryData.inter = interTotal;
    }

    // CRYPTO — A=Ticker B=Nom C=Qté D=PRU E=Prix€ F=Investi G=ValTotale H=Perf%
    if (cryptoRows) {
      cryptoRows.slice(1).forEach(row => {
        const ticker = t(row[0]);
        if (!ticker || ticker.toUpperCase() === 'TOTAL') return;
        const nom = t(row[1]) || ticker;
        const qty = p(row[2]); const prix = p(row[4]);
        if (qty === 0 && prix === 0) return;
        assets.push({ name:`${nom} (${ticker})`, ticker, source:'sheets-crypto', type:'crypto',
          qty, buyPrice:p(row[3]), currentPrice:prix, investi:p(row[5]), valTotale:p(row[6]),
          perfTotal:p(row[7]), perfUnit:'pct',
          geo:'other', sector:'crypto', currency:'EUR', fees:0 });
        imported++;
      });
    }

    // ─── HISTORIQUE MENSUEL ──────────────────────────────────────────────
    // Lit "Suivi patrimoine" (vue globale) + onglets Suivi CTO/Airbus/Crypto
    // Structure attendue : col A=Date, col B=Investi, col C=Valeur Totale

    const parseHistoRow = (row) => {
      const rawDate = t(row[0]);
      const rawVal  = p(row[2]);  // col C = Valeur Totale (MUST be > 0 = real data)
      const rawInv  = p(row[1]);  // col B = Investi
      if (!rawDate || rawDate.toUpperCase() === 'DATE' || rawDate.toUpperCase() === 'TOTAL') return null;
      if (rawVal <= 0) return null;

      let dateObj = null;
      const serial = parseFloat(rawDate.replace(',', '.'));
      if (!isNaN(serial) && serial > 40000) {
        dateObj = new Date(Math.round((serial - 25569) * 86400 * 1000));
      } else {
        const parts = rawDate.split(/[\/\-]/);
        if (parts.length === 3) {
          if (parts[0].length === 4) dateObj = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
          else dateObj = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
        }
      }
      if (!dateObj || isNaN(dateObj.getTime())) return null;
      if (dateObj > new Date()) return null;
      return { date: dateObj, val: rawVal, inv: rawInv };
    };

    const histoByMonth = {};
    const activeSources = new Set();

    const addToHisto = (rows, tabName) => {
      if (!rows) return;
      let hasData = false;
      rows.slice(1).forEach(row => {
        const h = parseHistoRow(row);
        if (!h) return;
        hasData = true;
        const key = `${h.date.getFullYear()}-${String(h.date.getMonth()+1).padStart(2,'0')}`;
        if (!histoByMonth[key]) histoByMonth[key] = { val: 0, inv: 0, sources: new Set(), date: h.date };
        histoByMonth[key].val += h.val;
        histoByMonth[key].inv += h.inv;
        histoByMonth[key].sources.add(tabName);
      });
      if (hasData) activeSources.add(tabName);
    };

    // ── FETCH PARALLÈLE — tous les onglets en une seule salve réseau ──────
    // Avant : 6 awaits séquentiels (~3s). Maintenant : 1 Promise.all (~1s).
    // Note : suiviCtoRows est réutilisé pour les dividendes (pas de double fetch).
    const [suiviCtoRows, suiviAirbusRows, suiviCryptoRows] = await Promise.all([
      fetchTab('Suivi CTO 2026'),
      fetchTab('Suivi Airbus'),
      fetchTab('Suivi Crypto'),
    ]);

    addToHisto(suiviCtoRows,    'CTO');
    addToHisto(suiviAirbusRows, 'Airbus');
    addToHisto(suiviCryptoRows, 'Crypto');

    // Only keep months where ALL active sources contributed
    const nSources = activeSources.size || 1;
    const newHistoPoints = Object.entries(histoByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, v]) => v.sources.size >= nSources)
      .map(([, v]) => ({
        date: v.date.toISOString().substring(0, 10),
        val:  v.val,
        inv:  v.inv,
      }));

    if (newHistoPoints.length > 1) {
      histoPoints = newHistoPoints;
      localStorage.setItem('patrimonia_histo', JSON.stringify(histoPoints));
    }

    // DIVIDENDES — réutilise suiviCtoRows (déjà fetchté ci-dessus, pas de 2ème appel)
    // col I(8)=Date J(9)=Société K(10)=Montant L(11)=Div/action
    if (suiviCtoRows) {
      const newDivs = [];
      suiviCtoRows.slice(1).forEach(row => {
        const societe = t(row[9]); const montant = p(row[10]);
        if (!societe || societe.toUpperCase() === 'TOTAL' || montant <= 0) return;
        const serial = parseFloat(row[8]);
        let dateStr = '';
        if (!isNaN(serial) && serial > 40000) {
          dateStr = new Date(Math.round((serial-25569)*86400*1000)).toLocaleDateString('fr-FR');
        } else { dateStr = t(row[8]); }
        newDivs.push({ date:dateStr, ticker:societe, amount:montant, divPerShare:p(row[11]), source:'sheets' });
      });
      if (newDivs.length) {
        dividends = newDivs;
        localStorage.setItem('patrimonia_dividends', JSON.stringify(dividends));
      }
    }

    _markDirty('assets', 'salary', 'histo', 'dividends');
    saveLocalData(['assets', 'salary', 'histo', 'dividends']);
    initOverview();
    const statusEl = document.getElementById('sheetsStatus');
    if (statusEl) { statusEl.textContent='Connecté'; statusEl.className='badge badge-up'; }
    const det = document.getElementById('dashboardDetected');
    if (det) det.style.display='block';

    // ── Sauvegarder les credentials pour l'auto-sync (seulement import manuel) ──
    if (!silent) {
      localStorage.setItem('patrimonia_sheets_id',  sheetId);
      localStorage.setItem('patrimonia_sheets_key', apiKey);
      startAutoSync();
      showToast(imported+' actifs importés ✓', '#22c55e');
    } else {
      // Sync silencieux : juste mettre à jour le badge
      const ind = document.getElementById('syncIndicator');
      if (ind) { ind.textContent = '☁ Synced'; ind.style.opacity = '1'; setTimeout(() => ind.style.opacity = '0', 2000); }
    }
    autoFillFiscalFromSalary();
    renderDisconnectButtons();

  } catch(err) {
    if (!silent) showToast('Erreur : '+err.message, '#ef4444');
    console.error(err);
  } finally {
    if (!silent && btn) btn.textContent='\u2B07 Importer mon Google Sheet';
  }
}


async function connectBinance() {
  const manual=document.getElementById('binanceManual')?.value?.trim();
  if(!manual) return showToast('Entrez vos soldes','#ef4444');
  const pairs=manual.split(',').map(s=>s.trim()).filter(Boolean);
  const cgIds={btc:'bitcoin',eth:'ethereum',bnb:'binancecoin',sol:'solana',xrp:'ripple',ada:'cardano',cro:'crypto-com-chain',matic:'matic-network',avax:'avalanche-2',dot:'polkadot'};
  try {
    const ids=pairs.map(p=>cgIds[p.split(':')[0].toLowerCase()]||p.split(':')[0].toLowerCase()).join(',');
    const res=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur`);
    const prices=await res.json();
    pairs.forEach(p=>{
      const [coin,qtyStr]=p.split(':'), qty=parseFloat(qtyStr)||0;
      const cgId=cgIds[coin.toLowerCase()]||coin.toLowerCase(), price=prices[cgId]?.eur||0;
      const idx=assets.findIndex(a=>a.name?.toLowerCase()===coin.toLowerCase()&&a.source==='binance');
      const asset={name:coin.toUpperCase(),source:'binance',type:'crypto',qty,buyPrice:price,currentPrice:price,geo:'other',sector:'crypto',currency:'EUR',fees:0};
      if(idx>=0) assets[idx]=asset; else assets.push(asset);
    });
    saveLocalData(); initOverview();
    document.getElementById('binanceStatus').textContent='Connecté';
    document.getElementById('binanceStatus').className='badge badge-up';
    showToast('Binance importé ✓','#22c55e');
    renderDisconnectButtons();
  } catch(err){ showToast('Erreur prix : '+err.message,'#ef4444'); }
}

function connectCrypto() {
  const manual=document.getElementById('cryptoManual')?.value?.trim();
  if(!manual) return showToast('Entrez vos soldes','#ef4444');
  manual.split(',').forEach(p=>{
    const [coin,qtyStr]=p.trim().split(':'); if(!coin) return;
    const idx=assets.findIndex(a=>a.name?.toLowerCase()===coin.toLowerCase()&&a.source==='crypto');
    const asset={name:coin.toUpperCase(),source:'crypto',type:'crypto',qty:parseFloat(qtyStr)||0,buyPrice:0,currentPrice:0,geo:'other',sector:'crypto',currency:'EUR',fees:0};
    if(idx>=0) assets[idx]=asset; else assets.push(asset);
  });
  saveLocalData(); initOverview();
  document.getElementById('cryptoStatus').textContent='Connecté';
  document.getElementById('cryptoStatus').className='badge badge-up';
  showToast('Crypto.com importé ✓','#22c55e');
  renderDisconnectButtons();
}

function connectTR() { showToast('Import PDF Trade Republic — en développement','#f59e0b'); }

// ─── DÉCONNEXION PAR SOURCE ──────────────────────────────────────────────

function disconnectSource(sourcePrefix, labelName) {
  if (!confirm(`Supprimer tous les actifs de la source "${labelName}" ?\nLes autres données (épargne, salaire, crypto...) ne seront pas affectées.`)) return;
  const before = assets.length;
  assets = assets.filter(a => !a.source?.startsWith(sourcePrefix));
  const removed = before - assets.length;
  saveLocalData();
  initOverview();
  if (typeof renderPortfolio === 'function') renderPortfolio();
  // Reset status badge
  const statusMap = {
    'sheets': 'sheetsStatus',
    'binance': 'binanceStatus',
    'crypto': 'cryptoStatus',
    'tr': 'trStatus',
    'file': 'fileImportStatus',
  };
  // Find which key matches
  const key = Object.keys(statusMap).find(k => sourcePrefix.startsWith(k));
  if (key) {
    const el = document.getElementById(statusMap[key]);
    if (el) { el.textContent = 'Non connecté'; el.className = 'badge badge-neutral'; }
  }
  // Hide detected badge for sheets + clear historical data + credentials
  if (sourcePrefix === 'sheets') {
    const det = document.getElementById('dashboardDetected');
    if (det) det.style.display = 'none';
    histoPoints = []; dividends = [];
    localStorage.removeItem('patrimonia_histo');
    localStorage.removeItem('patrimonia_dividends');
    localStorage.removeItem('patrimonia_sheets_id');
    localStorage.removeItem('patrimonia_sheets_key');
    localStorage.removeItem('patrimonia_snapshot_month');
    stopAutoSync();
  }
  showToast(`${removed} actif(s) supprimé(s) — ${labelName} déconnecté`, '#f59e0b');
  renderDisconnectButtons();
}

function renderDisconnectButtons() {
  // For each source container, show/hide the disconnect button based on whether assets exist
  const sources = [
    { prefix: 'sheets', containerId: 'deleteContainer_sheets', label: 'Google Sheets' },
    { prefix: 'binance', containerId: 'deleteContainer_binance', label: 'Binance' },
    { prefix: 'crypto', containerId: 'deleteContainer_crypto', label: 'Crypto.com' },
    { prefix: 'tr', containerId: 'deleteContainer_tr', label: 'Trade Republic' },
  ];
  sources.forEach(({ prefix, containerId, label }) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    const hasAssets = assets.some(a => a.source?.startsWith(prefix));
    if (hasAssets) {
      const count = assets.filter(a => a.source?.startsWith(prefix)).length;
      el.innerHTML = `<button onclick="disconnectSource('${prefix}', '${label}')" 
        style="margin-top:10px;width:100%;padding:8px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;color:var(--danger);font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;"
        onmouseover="this.style.background='rgba(239,68,68,0.15)'" 
        onmouseout="this.style.background='rgba(239,68,68,0.08)'">
        🗑 Déconnecter ${label} <span style="opacity:0.6;">(${count} actif${count>1?'s':''})</span>
      </button>`;
      // Also update status badge to "Connecté"
      const statusMap = { sheets: 'sheetsStatus', binance: 'binanceStatus', crypto: 'cryptoStatus', tr: 'trStatus' };
      const statusEl = document.getElementById(statusMap[prefix]);
      if (statusEl && statusEl.textContent === 'Non connecté') {
        statusEl.textContent = 'Connecté'; statusEl.className = 'badge badge-up';
      }
    } else {
      el.innerHTML = '';
    }
  });
}


// ─── PARAMÈTRES ──────────────────────────────────────────────────────────

function saveSettings() {
  settings.currency=document.getElementById('currency')?.value||'EUR';
  settings.exposureThreshold=parseInt(document.getElementById('exposureThreshold')?.value)||20;
  saveLocalData(['settings']); showToast('Paramètres sauvegardés ✓','#22c55e');
}

// ─── DIVIDENDES ──────────────────────────────────────────────────────────

function renderDividendsOverview() {
  const divEl = document.getElementById('dividendsOverview');
  if (!divEl) return;

  // Utilise la variable globale chargée dans loadLocalData — pas de re-parse localStorage
  const divs = dividends || [];

  // Aggregate dividends from history: group by ticker then by year
  const byTickerYear = {};
  divs.forEach(d => {
    if (!d.amount || d.amount <= 0) return;
    const ticker = d.ticker || '?';
    // Parse date to get year
    let year = new Date().getFullYear();
    if (d.date) {
      const parts = d.date.split('/');
      if (parts.length === 3) year = parseInt(parts[2]) || year;
      else { const dt = new Date(d.date); if (!isNaN(dt)) year = dt.getFullYear(); }
    }
    if (!byTickerYear[ticker]) byTickerYear[ticker] = {};
    byTickerYear[ticker][year] = (byTickerYear[ticker][year] || 0) + d.amount;
  });

  // Estimated annual dividends from asset dividend/action field
  const annualDivs = assets.filter(a => (a.dividend||0) > 0).map(a => ({
    name: a.name || a.ticker || '?',
    ticker: a.ticker || '?',
    annual: (a.qty||1) * (a.dividend||0),
    yield: a.currentPrice > 0 ? ((a.dividend||0)/a.currentPrice*100).toFixed(2) : '–'
  }));
  const totalAnnualEstim = annualDivs.reduce((s,d)=>s+d.annual,0);

  // Total received this year from history
  const currentYear = new Date().getFullYear();
  const totalReceivedThisYear = divs.filter(d => {
    if (!d.date) return false;
    const parts = d.date.split('/');
    const yr = parts.length===3 ? parseInt(parts[2]) : new Date(d.date).getFullYear();
    return yr === currentYear;
  }).reduce((s,d)=>s+(d.amount||0),0);

  if (!divs.length && !annualDivs.length) {
    divEl.innerHTML = '<div style="font-size:13px;color:var(--muted2);padding:8px 0;">Aucun dividende enregistré. Renseignez le montant dividende/action dans votre Google Sheet ou la colonne "Suivi CTO".</div>';
    return;
  }

  let html = '';

  // Summary cards
  const totalToShow = totalReceivedThisYear || totalAnnualEstim;
  if (totalToShow > 0) {
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="padding:14px;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.15);border-radius:8px;">
        <div style="font-size:11px;color:var(--muted2);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Reçus ${currentYear}</div>
        <div style="font-size:22px;font-weight:600;color:var(--green);">${fmt.format(totalReceivedThisYear)}</div>
        <div style="font-size:11px;color:var(--muted2);">soit ${fmt.format(totalReceivedThisYear/12)}/mois</div>
      </div>
      ${totalAnnualEstim > 0 ? `<div style="padding:14px;background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.15);border-radius:8px;">
        <div style="font-size:11px;color:var(--muted2);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Estimé annuel</div>
        <div style="font-size:22px;font-weight:600;color:var(--accent2);">${fmt.format(totalAnnualEstim)}</div>
        <div style="font-size:11px;color:var(--muted2);">basé sur div/action</div>
      </div>` : ''}
    </div>`;
  }

  // Dividends aggregated by asset per year (from history)
  if (Object.keys(byTickerYear).length > 0) {
    const years = [...new Set(divs.map(d => {
      if (!d.date) return currentYear;
      const parts = d.date.split('/');
      return parts.length===3 ? parseInt(parts[2]) : new Date(d.date).getFullYear();
    }))].sort((a,b)=>b-a);

    html += `<div style="font-size:12px;font-weight:600;color:var(--muted2);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Par actif — historique reçu</div>`;
    html += `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);font-weight:500;">Actif</th>
        ${years.map(y=>`<th style="text-align:right;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);font-weight:500;">${y}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${Object.entries(byTickerYear).sort((a,b)=>{
          const ta = Object.values(a[1]).reduce((s,v)=>s+v,0);
          const tb = Object.values(b[1]).reduce((s,v)=>s+v,0);
          return tb - ta;
        }).map(([ticker, yearMap])=>{
          const total = Object.values(yearMap).reduce((s,v)=>s+v,0);
          return `<tr style="border-top:1px solid var(--border);">
            <td style="padding:8px 10px;font-weight:500;">${ticker}</td>
            ${years.map(y=>`<td style="padding:8px 10px;text-align:right;color:${yearMap[y]?'var(--green)':'var(--muted)'};">${yearMap[y]?fmt.format(yearMap[y]):'–'}</td>`).join('')}
          </tr>`;
        }).join('')}
        <tr style="border-top:2px solid var(--border2);font-weight:600;">
          <td style="padding:8px 10px;color:var(--green);">Total</td>
          ${years.map(y=>{
            const s = Object.values(byTickerYear).reduce((acc,m)=>acc+(m[y]||0),0);
            return `<td style="padding:8px 10px;text-align:right;color:var(--green);">${s>0?fmt.format(s):'–'}</td>`;
          }).join('')}
        </tr>
      </tbody>
    </table></div>`;
  }

  // Estimated annuals from asset fields
  if (annualDivs.length > 0) {
    html += `<div style="font-size:12px;font-weight:600;color:var(--muted2);margin:16px 0 8px;text-transform:uppercase;letter-spacing:0.5px;">Estimés annuels (div/action × qté)</div>`;
    html += annualDivs.map(d=>`<div class="fee-item"><div style="flex:1"><div style="font-size:13px;font-weight:500;">${d.name}</div><div style="font-size:11px;color:var(--muted2);">Rendement ${d.yield}%</div></div><div style="font-weight:600;color:var(--green);">${fmt.format(d.annual)}/an</div></div>`).join('');
  }

  divEl.innerHTML = html;
}

// ─── AUTO-REMPLISSAGE FISCALITÉ ──────────────────────────────────────────

function autoFillFiscalFromSalary() {
  if (!salaryData) return;
  // Salaire brut annuel
  const grossAnn = (salaryData.gross||0)*12;
  const el = document.getElementById('taxGross');
  if (el && !el.value && grossAnn > 0) el.value = grossAnn;
  // Intéressement/participation
  const otherAnn = (salaryData.inter||0) + (salaryData.part||0);
  const elOther = document.getElementById('taxOther');
  if (elOther && !elOther.value && otherAnn > 0) elOther.value = otherAnn;
  // Dividendes annuels estimés
  const annualDivs = assets.filter(a=>(a.dividend||0)>0).reduce((s,a)=>s+(a.qty||1)*(a.dividend||0),0);
  const elDiv = document.getElementById('taxDividends');
  if (elDiv && !elDiv.value && annualDivs > 0) elDiv.value = Math.round(annualDivs);
  // Versements PER depuis Airbus (PERCOL)
  const perVers = salaryData.abond ? salaryData.abond * 12 : 0;
  const elPer = document.getElementById('taxPer');
  if (elPer && !elPer.value && perVers > 0) elPer.value = Math.round(perVers);
}

// ─── ANALYSE ─────────────────────────────────────────────────────────────

function renderAnalysisPage() {
  if (typeof assets === 'undefined' || !assets.length) {
    ['chartGeo','chartSector','chartCurrency','chartAllocation'].forEach(id=>{
      const ctx=document.getElementById(id); if(ctx){const c=ctx.getContext('2d');c.clearRect(0,0,ctx.width,ctx.height);}
    });
    const el=document.getElementById('concentrationAlerts');
    if(el) el.innerHTML='<div style="font-size:13px;color:var(--muted);padding:12px 0;">Ajoutez des actifs pour voir l\'analyse.</div>';
    return;
  }
  // computeDiversityScore is defined inline in dashboard.html, just ensure it runs
  if (typeof computeDiversityScore === 'function') computeDiversityScore();
}

// ─── SIMULATION DE PRÊT ──────────────────────────────────────────────────

const BANK_RATES = {
  'BNP Paribas':       { rate20: 3.65, rate25: 3.80, fee: 1.0 },
  'Crédit Agricole':   { rate20: 3.55, rate25: 3.70, fee: 0.8 },
  'Société Générale':  { rate20: 3.70, rate25: 3.85, fee: 1.0 },
  'LCL':               { rate20: 3.60, rate25: 3.75, fee: 0.9 },
  'Caisse d\'Épargne': { rate20: 3.50, rate25: 3.65, fee: 0.7 },
  'Banque Populaire':  { rate20: 3.55, rate25: 3.72, fee: 0.8 },
  'CIC':               { rate20: 3.68, rate25: 3.82, fee: 0.9 },
  'ING':               { rate20: 3.45, rate25: 3.60, fee: 0.5 },
  'Boursorama':        { rate20: 3.40, rate25: 3.55, fee: 0.3 },
  'Hello Bank':        { rate20: 3.42, rate25: 3.57, fee: 0.4 },
};

function updateLoanCalc() {
  // Auto-populate from salaryData if fields are empty
  const loanNetInput = document.getElementById('loanNet');
  if (loanNetInput && !loanNetInput.value && salaryData.net) loanNetInput.value = salaryData.net;
  const loanExpInput = document.getElementById('loanMensExp');
  if (loanExpInput && !loanExpInput.value && expenses.length) {
    loanExpInput.value = expenses.reduce((s,e)=>s+(e.amount||0),0);
  }

  const net   = parseFloat(document.getElementById('loanNet')?.value)   || (salaryData.net||0);
  const aides = (salaryData.apl||0)+(salaryData.caf||0)+(salaryData.transport||0)+(salaryData.tr||0)+(salaryData.other||0);
  const totalRevenu = net + aides;
  const apport    = parseFloat(document.getElementById('loanApport')?.value)   || 0;
  const duree     = parseInt(document.getElementById('loanDuree')?.value)      || 20;
  const prixBien  = parseFloat(document.getElementById('loanPrix')?.value)     || 0;
  const mensExp   = parseFloat(document.getElementById('loanMensExp')?.value)  || expenses.reduce((s,e)=>s+(e.amount||0),0);
  
  if (!net) {
    const el=document.getElementById('loanNetDisplay'); if(el) el.textContent='–';
    return;
  }

  // Capacité d'endettement max (33% des revenus nets)
  const maxMens = totalRevenu * 0.33 - mensExp;
  const loanNet_el = document.getElementById('loanNetDisplay');
  if (loanNet_el) loanNet_el.textContent = fmt.format(totalRevenu) + '/mois';

  // Calcul capacité d'emprunt pour chaque banque
  const tbody = document.getElementById('loanBankTbody');
  if (!tbody) return;

  let rows = '';
  Object.entries(BANK_RATES).forEach(([bank, b]) => {
    const rate = (duree <= 20 ? b.rate20 : b.rate25) / 100 / 12;
    const n = duree * 12;
    // Capacité max basée sur mensualité max
    const capMax = maxMens > 0 ? Math.round(maxMens * (1 - Math.pow(1+rate,-n)) / rate) + apport : 0;
    // Mensualité pour le prix du bien demandé
    const montantEmprunt = Math.max(0, prixBien - apport);
    const mensualite = montantEmprunt > 0 ? Math.round(montantEmprunt * rate / (1 - Math.pow(1+rate,-n))) : 0;
    const tauxEndet = totalRevenu > 0 ? ((mensualite + mensExp) / totalRevenu * 100).toFixed(1) : '–';
    const coutTotal = mensualite > 0 ? Math.round(mensualite * n + b.fee/100 * montantEmprunt - montantEmprunt) : 0;
    const feasible = montantEmprunt > 0 ? mensualite + mensExp <= totalRevenu * 0.35 : true;
    const color = feasible ? 'var(--green)' : 'var(--danger)';
    const taux = (duree <= 20 ? b.rate20 : b.rate25).toFixed(2);
    rows += `<tr>
      <td style="font-weight:500;">${bank}</td>
      <td style="color:var(--accent2);">${taux}%</td>
      <td style="font-weight:600;color:var(--accent2);">${capMax>0?fmt.format(capMax):'–'}</td>
      <td>${montantEmprunt>0?fmt.format(mensualite)+'/mois':'–'}</td>
      <td style="color:${color};">${tauxEndet}%</td>
      <td style="color:var(--muted2);font-size:12px;">${coutTotal>0?fmt.format(coutTotal):'–'}</td>
      <td><span class="badge ${feasible?'badge-up':'badge-down'}">${feasible?'✓ Possible':'✗ Serré'}</span></td>
    </tr>`;
  });
  tbody.innerHTML = rows || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px;">Renseignez votre salaire pour comparer</td></tr>';

  // KPIs
  const bestRate = Math.min(...Object.values(BANK_RATES).map(b=>duree<=20?b.rate20:b.rate25));
  safeSet('loanCapacite', maxMens > 0 ? fmt.format(Math.round(maxMens * (1 - Math.pow(1+(bestRate/100/12),-(duree*12))) / (bestRate/100/12)) + apport) : '–');
  safeSet('loanMensMax', fmt.format(Math.max(0,maxMens)));
  safeSet('loanTauxEndet', maxMens > 0 ? '33%' : '–');
}

function exportData() {
  const blob=new Blob([JSON.stringify({assets,savings,expenses,salaryData,settings},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='my-investbook_export.json'; a.click();
}

function importData() { document.getElementById('importFile')?.click(); }

function handleImport(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const d=JSON.parse(e.target.result);
      if(d.assets)    assets=d.assets;
      if(d.savings)   savings=d.savings;
      if(d.expenses)  expenses=d.expenses;
      if(d.salaryData) salaryData=d.salaryData;
      if(d.settings)  settings=d.settings;
      saveLocalData(); initOverview(); showToast('Données importées ✓','#22c55e');
    } catch(err){ showToast('Fichier invalide','#ef4444'); }
  };
  reader.readAsText(file);
}

function clearData() {
  if(!confirm('Réinitialiser toutes les données ? Action irréversible.')) return;
  assets = []; savings = []; expenses = []; salaryData = {};
  settings = { currency:'EUR', exposureThreshold:20 };
  dividends = []; histoPoints = []; loansTracked = [];
  _markDirty('assets','savings','expenses','salary','settings','histo','dividends');
  [
    'patrimonia_assets','patrimonia_savings','patrimonia_expenses',
    'patrimonia_salary','patrimonia_settings','patrimonia_histo',
    'patrimonia_dividends','patrimonia_loans','patrimonia_snapshot_month',
    'patrimonia_sort','patrimonia_filter_src','patrimonia_filter_type',
  ].forEach(k => localStorage.removeItem(k));
  saveToSupabase();
  initOverview(); renderDisconnectButtons();
  if (typeof renderPortfolio === 'function') renderPortfolio();
  if (typeof renderSavings   === 'function') renderSavings();
  if (typeof renderSalary    === 'function') renderSalary();
  showToast('Données réinitialisées','#f59e0b');
}

// ─── SUPPRESSION COMPTE ──────────────────────────────────────────────────

function checkDeleteConfirm() {
  const val = document.getElementById('deleteConfirmText')?.value || '';
  const btn = document.getElementById('deleteAccountBtn');
  if (!btn) return;
  const ok = val.trim().toUpperCase() === 'SUPPRIMER';
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '0.4';
  btn.style.cursor  = ok ? 'pointer' : 'not-allowed';
}

function deleteAccount() {
  closeModal('deleteAccount');
  document.getElementById('deletePassword').value = '';
  document.getElementById('deleteErrorMsg').style.display = 'none';
  openModal('deletePassword');
}

async function confirmDeleteAccount() {
  const password = document.getElementById('deletePassword')?.value?.trim();
  const errEl    = document.getElementById('deleteErrorMsg');
  const btnEl    = document.getElementById('deletePasswordBtn');
  if (!password) { if(errEl){errEl.textContent='Entrez votre mot de passe.';errEl.style.display='block';} return; }
  if (btnEl) { btnEl.textContent = 'Suppression...'; btnEl.disabled = true; }
  try {
    // 1. Ré-authentifier
    const { data: { session } } = await sb.auth.getSession();
    const email = session?.user?.email;
    if (!email) throw new Error('Session expirée, reconnectez-vous.');
    const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error('Mot de passe incorrect.');
    // 2. Effacer les données locales
    ['patrimonia_assets','patrimonia_savings','patrimonia_expenses','patrimonia_salary','patrimonia_settings','patrimonia_dividends','patrimonia_histo','patrimonia_theme'].forEach(k=>localStorage.removeItem(k));
    // 3. Supprimer le compte Supabase
    const { error: delErr } = await sb.auth.admin?.deleteUser(session.user.id)
      .catch(()=>({error:null})) || {};
    // 4. Déconnexion propre (même si delete échoue, l'user est déconnecté)
    await sb.auth.signOut();
    showToast('Compte supprimé. Au revoir !', '#22c55e');
    setTimeout(()=>{ window.location.href='index.html'; }, 2000);
  } catch(err) {
    if(errEl){ errEl.textContent = err.message; errEl.style.display='block'; }
    if(btnEl){ btnEl.textContent='Supprimer mon compte'; btnEl.disabled=false; }
  }
}

// ─── IMPORT FICHIER CSV / XLSX / JSON ────────────────────────────────────

let _pendingFileAssets = [];

function handleFileDrop(event) {
  event.preventDefault();
  document.getElementById('fileDropZone').style.borderColor = 'var(--border2)';
  const file = event.dataTransfer.files[0];
  if (file) processImportFile(file);
}

function handleFileImport(event) {
  const file = event.target.files[0];
  if (file) processImportFile(file);
}

function processImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const preview = document.getElementById('fileImportPreview');
  const status  = document.getElementById('fileImportStatus');
  if (preview) preview.innerHTML = '<div style="font-size:12px;color:var(--muted2);">Lecture du fichier...</div>';

  if (ext === 'json') {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const d = JSON.parse(e.target.result);
        // JSON Patrimonia export
        if (d.assets) {
          if(d.assets) assets=d.assets;
          if(d.savings) savings=d.savings;
          if(d.expenses) expenses=d.expenses;
          if(d.salaryData) salaryData=d.salaryData;
          if(d.settings) settings=d.settings;
          saveLocalData(); initOverview();
          if(status){status.textContent='Importé';status.className='badge badge-up';}
          if(preview) preview.innerHTML=`<div style="font-size:12px;color:var(--green);">${assets.length} actifs importés depuis JSON ✓</div>`;
          showToast('Données JSON importées ✓','#22c55e');
        } else {
          // JSON tableau d'actifs
          const arr = Array.isArray(d) ? d : [];
          _pendingFileAssets = arr;
          showFilePreview(arr, file.name);
        }
      } catch(err){ if(preview) preview.innerHTML=`<div style="font-size:12px;color:var(--danger);">Erreur: ${err.message}</div>`; }
    };
    reader.readAsText(file);
  } else if (ext === 'csv') {
    const reader = new FileReader();
    reader.onload = e => {
      const parsed = parseCSV(e.target.result);
      _pendingFileAssets = parsed;
      showFilePreview(parsed, file.name);
    };
    reader.readAsText(file, 'UTF-8');
  } else if (ext === 'xlsx' || ext === 'xls') {
    // XLSX nécessite la librairie SheetJS — on charge dynamiquement
    if (typeof XLSX === 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = () => readXLSX(file);
      script.onerror = () => { if(preview) preview.innerHTML='<div style="font-size:12px;color:var(--danger);">Impossible de charger le lecteur XLSX. Vérifiez votre connexion.</div>'; };
      document.head.appendChild(script);
    } else {
      readXLSX(file);
    }
  } else {
    if(preview) preview.innerHTML='<div style="font-size:12px;color:var(--danger);">Format non supporté. Utilisez CSV, XLSX ou JSON.</div>';
  }
}

function readXLSX(file) {
  const preview = document.getElementById('fileImportPreview');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type:'array' });
      // Cherche d'abord CTO, puis prend le premier onglet
      const sheetName = wb.SheetNames.includes('CTO') ? 'CTO'
                      : wb.SheetNames.includes('Crypto') ? 'Crypto'
                      : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
      // Détecter si structure Patrimonia (Ticker en col A, Nom en col B)
      const detected = [];
      rows.slice(1).forEach(row => {
        const ticker = (row[0]||'').toString().trim();
        if (!ticker || ticker.toUpperCase() === 'TOTAL') return;
        const nom = (row[1]||ticker).toString().trim();
        const qty  = parseFloat((row[2]||'0').toString()) || 0;
        const pru  = parseFloat((row[3]||'0').toString()) || 0;
        const prix = parseFloat((row[4]||'0').toString()) || 0;
        if (qty === 0 && prix === 0) return;
        detected.push({ ticker, nom, qty, pru, prix,
          investi:  parseFloat((row[5]||'0').toString()) || 0,
          valTotale:parseFloat((row[6]||'0').toString()) || 0,
          perf1d:   parseFloat((row[7]||'0').toString()) || 0,
          perfYtd:  parseFloat((row[11]||'0').toString()) || 0,
          secteur:  (row[14]||'').toString(),
          geo:      (row[15]||'').toString(),
          devise:   (row[23]||'EUR').toString() || 'EUR',
          type:     sheetName.toLowerCase().includes('rypto') ? 'crypto' : sheetName.toLowerCase().includes('irbus') ? 'esop' : 'stock',
          source:   'file-' + sheetName.toLowerCase(),
        });
      });
      _pendingFileAssets = detected;
      showFilePreview(detected, file.name + ' [' + sheetName + ']');
    } catch(err){ if(preview) preview.innerHTML=`<div style="font-size:12px;color:var(--danger);">Erreur XLSX: ${err.message}</div>`; }
  };
  reader.readAsArrayBuffer(file);
}

function parseCSV(text) {
  const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim());
  if (!lines.length) return [];
  // Détect séparateur (virgule ou point-virgule ou tab)
  const sep = lines[0].includes('\t') ? '\t' : lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const headers = lines[0].split(sep).map(h=>h.trim().replace(/^["']|["']$/g,'').toLowerCase());
  const result = [];
  const colIdx = (names) => { for(const n of names){ const i=headers.indexOf(n); if(i>=0)return i; } return -1; };
  const iT = colIdx(['ticker','actif','symbole','symbol','isin']);
  const iN = colIdx(['nom','name','libelle','libellé']);
  const iQ = colIdx(['quantité','quantite','quantity','qté','qty']);
  const iP = colIdx(['pru','prix achat','buy price','pa','prix moyen','cost']);
  const iC = colIdx(['prix','price','cours','valeur unitaire','current price','prix actuel','cours actuel']);
  const iV = colIdx(['val. totale','val totale','value','valeur','total value','montant']);
  const iI = colIdx(['investi','invested','montant investi']);
  lines.slice(1).forEach(line => {
    const cols = line.split(sep).map(c=>c.trim().replace(/^["']|["']$/g,''));
    const ticker = iT>=0 ? cols[iT] : cols[0];
    if (!ticker || ticker.toUpperCase() === 'TOTAL') return;
    const nom = iN>=0 ? cols[iN] : ticker;
    const qty = parseFloat(cols[iQ>=0?iQ:2]) || 0;
    const pru = parseFloat(cols[iP>=0?iP:3]) || 0;
    const prix= parseFloat(cols[iC>=0?iC:4]) || 0;
    if (qty===0 && prix===0) return;
    result.push({ ticker, nom, qty, pru, prix,
      investi:  iI>=0 ? parseFloat(cols[iI])||0 : qty*pru,
      valTotale:iV>=0 ? parseFloat(cols[iV])||0 : qty*prix,
      type:'stock', source:'file-csv' });
  });
  return result;
}

function showFilePreview(parsedAssets, filename) {
  const preview = document.getElementById('fileImportPreview');
  const status  = document.getElementById('fileImportStatus');
  const btn     = document.getElementById('fileImportBtn');
  if (!preview) return;
  if (!parsedAssets.length) {
    preview.innerHTML='<div style="font-size:12px;color:var(--danger);">Aucun actif détecté. Vérifiez le format.</div>';
    return;
  }
  if(status){ status.textContent=parsedAssets.length+' actifs détectés'; status.className='badge badge-up'; }
  if(btn){ btn.style.display='block'; }
  const rows = parsedAssets.slice(0,8).map(a=>
    `<tr><td style="font-size:12px;padding:4px 6px;font-weight:500;">${a.ticker||'?'}</td>
     <td style="font-size:11px;padding:4px 6px;color:var(--muted2);">${(a.nom||'').substring(0,20)}</td>
     <td style="font-size:12px;padding:4px 6px;">${a.qty||0}</td>
     <td style="font-size:12px;padding:4px 6px;">${fmt.format(a.prix||0)}</td>
     <td style="font-size:12px;padding:4px 6px;color:var(--green);">${fmt.format(a.valTotale||a.qty*a.prix||0)}</td></tr>`
  ).join('');
  preview.innerHTML = `
    <div style="font-size:11px;color:var(--muted2);margin-bottom:6px;">Aperçu — ${filename} (${parsedAssets.length} lignes)</div>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th style="font-size:10px;text-transform:uppercase;color:var(--muted);padding:4px 6px;text-align:left;">Ticker</th>
        <th style="font-size:10px;text-transform:uppercase;color:var(--muted);padding:4px 6px;text-align:left;">Nom</th>
        <th style="font-size:10px;text-transform:uppercase;color:var(--muted);padding:4px 6px;">Qté</th>
        <th style="font-size:10px;text-transform:uppercase;color:var(--muted);padding:4px 6px;">Prix</th>
        <th style="font-size:10px;text-transform:uppercase;color:var(--muted);padding:4px 6px;">Valeur</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${parsedAssets.length > 8 ? `<div style="font-size:11px;color:var(--muted2);margin-top:6px;">... et ${parsedAssets.length-8} autres actifs</div>` : ''}`;
}

function confirmFileImport() {
  if (!_pendingFileAssets.length) return;
  // Supprimer les anciens actifs de la même source
  const firstSrc = _pendingFileAssets[0]?.source || 'file';
  assets = assets.filter(a => a.source !== firstSrc);
  // Ajouter les nouveaux
  _pendingFileAssets.forEach(a => {
    const geoRaw = (a.geo||'').toLowerCase();
    const geoMap = {'usa':'us','etats-unis':'us','états-unis':'us','europe':'eu','france':'fr','monde':'world','emergent':'em','emergents':'em'};
    const secRaw = (a.secteur||'').toLowerCase();
    assets.push({
      name: a.nom && a.nom !== a.ticker ? `${a.nom} (${a.ticker})` : a.ticker,
      ticker: a.ticker,
      source: a.source || 'file',
      type:   a.type || 'stock',
      qty:    a.qty, buyPrice: a.pru, currentPrice: a.prix,
      investi: a.investi, valTotale: a.valTotale,
      perf1d:  a.perf1d||0, perfYtd: a.perfYtd||0, perfTotal: a.perfTotal||0,
      geo:    geoMap[geoRaw] || 'world',
      sector: secRaw.includes('tech')?'tech':secRaw.includes('nerg')?'energy':secRaw.includes('inanc')?'finance':secRaw.includes('rypto')?'crypto':'mixed',
      currency: a.devise||'EUR', fees:0,
    });
  });
  saveLocalData(); initOverview();
  showToast(`${_pendingFileAssets.length} actifs import\u00E9s \u2713`, '#22c55e');
  const status = document.getElementById('fileImportStatus');
  if(status){ status.textContent='Import\u00E9'; status.className='badge badge-up'; }
  const btn = document.getElementById('fileImportBtn');
  if(btn) btn.style.display='none';
  _pendingFileAssets = [];
  if(typeof renderPortfolio==='function') renderPortfolio();
}

// ─── MODALS ──────────────────────────────────────────────────────────────

function openModal(id)  { const el=document.getElementById('modal-'+id); if(el) el.classList.add('open'); }
function closeModal(id) { const el=document.getElementById('modal-'+id); if(el) el.classList.remove('open'); }

// ─── ANALYSE DIVERSIFICATION (appelée depuis dashboard.html) ─────────────
// La fonction computeDiversityScore() est définie dans dashboard.html
// On s'assure qu'elle existe, sinon on crée un stub
if (typeof computeDiversityScore === 'undefined') {
  window.computeDiversityScore = function() {};
}

// ─── SERVICE WORKER : auto-nettoyage au démarrage ─────────────────────────
// Force le rechargement du SW et vide les anciens caches si besoin
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    // Désenregistrer les anciens SW (sauf le plus récent)
    regs.forEach((reg, i) => {
      if (i > 0) reg.unregister();
    });
  });
  // Écouter les mises à jour SW
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[Patrimonia] Nouveau SW actif — rechargement...');
  });
}

// ─── VIDER LE CACHE NAVIGATEUR ────────────────────────────────────────────
async function forceClearCache() {
  try {
    // Désenregistrer tous les Service Workers
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    // Vider tous les caches CacheStorage
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    showToast('Cache vidé — rechargement...', '#22c55e');
    // Recharger sans cache après 1 seconde
    setTimeout(() => window.location.reload(true), 1000);
  } catch(err) {
    showToast('Erreur: ' + err.message, '#ef4444');
    window.location.reload(true);
  }
}
// =====================================================================
// INTERFACE CONTROLLER : PRIVACY MODE & PORTFOLIO INJECTION V2
// =====================================================================

let isPrivacyEnabled = localStorage.getItem('patrimonia_privacy') === 'true';

function initPrivacyMode() {
  const body = document.body;
  const btn = document.getElementById('privacyToggleBtn');
  if (!btn) return;
  
  if (isPrivacyEnabled) {
    body.classList.add('privacy-active');
    btn.innerHTML = '🙈 Masqué';
  } else {
    body.classList.remove('privacy-active');
    btn.innerHTML = '👁️ Mode Public';
  }
}

function togglePrivacyMode() {
  isPrivacyEnabled = !isPrivacyEnabled;
  localStorage.setItem('patrimonia_privacy', isPrivacyEnabled);
  initPrivacyMode();
}

/**
 * Appelle le moteur financier et met à jour les éléments visuels du DOM
 */
async function updateDashboardV2(userId) {
  if (!userId) return;
  
  try {
    const summary = await getPortfolioSummary(userId);
    
    // Formatage des éléments ciblés
    document.getElementById('valeurTotaleDisplay').textContent = formatterEUR.format(summary.portfolioValue);
    document.getElementById('capitalInvestiDisplay').textContent = formatterEUR.format(summary.investedCapital);
    
    const pnlAbsoluEl = document.getElementById('pnlAbsoluDisplay');
    const pnlRelatifEl = document.getElementById('pnlRelatifDisplay');
    const ytdPerfEl = document.getElementById('ytdPerfDisplay');

    pnlAbsoluEl.textContent = (summary.pnlAbsolu >= 0 ? '+' : '') + formatterEUR.format(summary.pnlAbsolu);
    pnlRelatifEl.textContent = (summary.pnlRelatif >= 0 ? '+' : '') + summary.pnlRelatif.toFixed(2) + ' %';
    ytdPerfEl.textContent = (summary.ytdPerf >= 0 ? '+' : '') + summary.ytdPerf.toFixed(2) + ' %';

    // Application des couleurs dynamiques (Vert/Rouge doux)
    const trendColor = summary.pnlAbsolu >= 0 ? '#22c55e' : '#ef4444';
    const badgeBg = summary.pnlAbsolu >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
    const badgeText = summary.pnlAbsolu >= 0 ? '#4ade80' : '#f87171';

    pnlAbsoluEl.style.color = trendColor;
    pnlRelatifEl.style.color = badgeText;
    pnlRelatifEl.style.backgroundColor = badgeBg;
    
    ytdPerfEl.style.color = summary.ytdPerf >= 0 ? '#22c55e' : '#ef4444';

  } catch (err) {
    console.error("Erreur d'injection visuelle V2 :", err);
  }
}

// Liaison avec les hooks de chargement existants
document.addEventListener('DOMContentLoaded', () => {
  initPrivacyMode();
  
  // Si un utilisateur Supabase est déjà connecté dans app.js, on force la mise à jour
  if (sb && sb.auth) {
    sb.auth.getUser().then(({ data }) => {
      if (data && data.user) {
        updateDashboardV2(data.user.id);
      }
    });
  }
});
