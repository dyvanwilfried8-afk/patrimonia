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

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('patrimonia_theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '☽';
}

function toggleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }

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
  salary:'Salaire & Budget', projection:'Projection DCA', analysis:'Analyse complète',
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
  if (pageId === 'fees')       renderFees();
  if (pageId === 'savings')    renderSavings();
  if (pageId === 'salary')     renderSalary();
  if (pageId === 'portfolio')  { renderPortfolio(); renderAssetChart(); }
  if (pageId === 'fiscalite')  { autoFillFiscalFromSalary(); if(typeof calculateTax==='function') calculateTax(); }
  if (pageId === 'loan')       updateLoanCalc();
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
  loadLocalData(); initOverview();
  autoFillFiscalFromSalary();
  safeSet('lastUpdate', new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  showToast('Actualisé ✓', '#22c55e');
}

// ─── DONNÉES LOCALES ────────────────────────────────────────────────────

let assets = [], savings = [], expenses = [], salaryData = {}, settings = { currency: 'EUR', exposureThreshold: 20 };

function loadLocalData() {
  try {
    assets     = JSON.parse(localStorage.getItem('patrimonia_assets')   || '[]');
    savings    = JSON.parse(localStorage.getItem('patrimonia_savings')  || '[]');
    expenses   = JSON.parse(localStorage.getItem('patrimonia_expenses') || '[]');
    salaryData = JSON.parse(localStorage.getItem('patrimonia_salary')   || '{}');
    settings   = JSON.parse(localStorage.getItem('patrimonia_settings') || '{"currency":"EUR","exposureThreshold":20}');
  } catch(e) { console.warn('Erreur données locales:', e); }
}

let _saveDebounceTimer = null;

function saveLocalData() {
  // 1. Sauvegarde immédiate en localStorage (cache offline)
  localStorage.setItem('patrimonia_assets',   JSON.stringify(assets));
  localStorage.setItem('patrimonia_savings',  JSON.stringify(savings));
  localStorage.setItem('patrimonia_expenses', JSON.stringify(expenses));
  localStorage.setItem('patrimonia_salary',   JSON.stringify(salaryData));
  localStorage.setItem('patrimonia_settings', JSON.stringify(settings));
  // 2. Sync Supabase avec debounce 1.5s pour éviter les appels répétés
  clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(() => saveToSupabase(), 1500);
}

async function saveToSupabase() {
  if (!currentUser) return;
  try {
    const histo = (() => { try { return JSON.parse(localStorage.getItem('patrimonia_histo')||'[]'); } catch(e){ return []; } })();
    const divs  = (() => { try { return JSON.parse(localStorage.getItem('patrimonia_dividends')||'[]'); } catch(e){ return []; } })();
    const { error } = await sb
      .from('user_data')
      .upsert({
        user_id:    currentUser,
        assets:     assets,
        savings:    savings,
        expenses:   expenses,
        salary:     salaryData,
        settings:   settings,
        histo:      histo,
        dividends:  divs,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) console.warn('Supabase save error:', error.message);
    else {
      // Show subtle sync indicator
      const ind = document.getElementById('syncIndicator');
      if (ind) { ind.style.opacity = '1'; setTimeout(() => ind.style.opacity = '0', 2000); }
    }
  } catch(e) { console.warn('Supabase save failed:', e.message); }
}

async function loadFromSupabase() {
  if (!currentUser) return false;
  try {
    const { data, error } = await sb
      .from('user_data')
      .select('*')
      .eq('user_id', currentUser)
      .single();
    if (error || !data) return false;

    if (Array.isArray(data.assets))   { assets    = data.assets;   localStorage.setItem('patrimonia_assets',   JSON.stringify(assets)); }
    if (Array.isArray(data.savings))  { savings   = data.savings;  localStorage.setItem('patrimonia_savings',  JSON.stringify(savings)); }
    if (Array.isArray(data.expenses)) { expenses  = data.expenses; localStorage.setItem('patrimonia_expenses', JSON.stringify(expenses)); }
    if (data.salary)   { salaryData = data.salary;   localStorage.setItem('patrimonia_salary',   JSON.stringify(salaryData)); }
    if (data.settings) { settings   = data.settings; localStorage.setItem('patrimonia_settings', JSON.stringify(settings)); }
    if (Array.isArray(data.histo)     && data.histo.length     > 0) localStorage.setItem('patrimonia_histo',     JSON.stringify(data.histo));
    if (Array.isArray(data.dividends) && data.dividends.length > 0) localStorage.setItem('patrimonia_dividends', JSON.stringify(data.dividends));
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
    .filter(a => !(a.source === 'sheets-cto' && a.ticker === 'EPA:AIR'))
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
      const a = assets.filter(a => (a.type || 'stock') === 'stock' && !(a.source === 'sheets-cto' && a.ticker === 'EPA:AIR'));
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
        ? assets.filter(a => (a.type||'stock') === 'stock' && !(a.source === 'sheets-cto' && a.ticker === 'EPA:AIR'))
        : assets.filter(a => (a.type||'stock') === cat.id);
      ytdPnl = catAssets.reduce((s, a) => {
        const v = assetValue(a);
        const pctRaw = a.perfYtd;
        if (!pctRaw || isNaN(pctRaw)) return s;
        const pct = normalizePct(pctRaw) / 100;
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
    <div style="display:grid;grid-template-columns:1fr 100px 100px 110px 150px;padding:8px 20px;background:var(--surface2);border-bottom:1px solid var(--border);gap:8px;">
      <div style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;">Actif</div>
      <div style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Investi</div>
      <div style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Val. Totale</div>
      <div style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Plus-Value</div>
      <div style="font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Performance</div>
    </div>

    ${catData.map(cat => {
      const pnlColor  = cat.pnl  >= 0 ? 'var(--green)' : 'var(--danger)';
      const isNonInv  = cat.id === 'savings';
      return `<div class="cat-card" onclick="navigate('${cat.id === 'savings' ? 'savings' : 'portfolio'}')">
        <div style="display:grid;grid-template-columns:1fr 100px 100px 110px 150px;align-items:center;width:100%;padding:14px 20px;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:10px;height:10px;border-radius:50%;background:${cat.dot};flex-shrink:0;"></div>
            <span style="font-size:14px;font-weight:500;">${cat.label}</span>
          </div>
          <div style="text-align:right;font-size:13px;color:var(--muted2);">${isNonInv ? '–' : fmt.format(cat.inv)}</div>
          <div style="text-align:right;font-size:14px;font-weight:600;">${fmt.format(cat.val)}</div>
          <div style="text-align:right;font-size:13px;font-weight:600;color:${pnlColor};">${isNonInv ? '–' : (cat.pnl >= 0 ? '+' : '') + fmt.format(cat.pnl)}</div>
          <div>${isNonInv ? '<div style="text-align:right;color:var(--muted2);font-size:12px;">–</div>' : perfBar(cat.perf)}</div>
        </div>
      </div>`;
    }).join('')}

    <!-- TOTAL row -->
    <div style="display:grid;grid-template-columns:1fr 100px 100px 110px 150px;align-items:center;padding:14px 20px;gap:8px;background:var(--surface2);border-top:2px solid var(--border);">
      <div style="font-size:14px;font-weight:700;letter-spacing:-0.3px;">TOTAL</div>
      <div style="text-align:right;font-size:13px;font-weight:600;">${fmt.format(totalInv)}</div>
      <div style="text-align:right;font-size:14px;font-weight:700;">${fmt.format(totalVal2)}</div>
      <div style="text-align:right;font-size:13px;font-weight:700;color:${totalPnl >= 0 ? 'var(--green)' : 'var(--danger)'};">${totalPnl >= 0 ? '+' : ''}${fmt.format(totalPnl)}</div>
      <div>${perfBar(totalPerf)}</div>
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


function normalizePct(v) {
  // Normalize: ratio (e.g. 0.476) or already % (e.g. 47.6)
  // Daily/weekly moves rarely exceed ±50%, so values between -2 and +2 are treated as ratios
  // For larger values (like period perfs), values > 2 or < -2 are already in %
  if (v === undefined || v === null || isNaN(v)) return 0;
  // If absolute value is very small (< 2) → ratio format → multiply by 100
  // But if value is like 5.0 or 49.0, it's already in %
  // Heuristic: sheets mixing both — we treat |v| < 2 as ratio, else as %
  // Exception: values like -1.18 are ratios (-118%) but also -0.07 = -7%
  return Math.abs(v) < 2 ? v * 100 : v;
}

function renderPnlStats(totalAssets) {
  // Exclude EPA:AIR from sheets-cto (same double-count exclusion as totalAssets)
  const filteredAssets = assets.filter(a => !(a.source === 'sheets-cto' && a.ticker === 'EPA:AIR'));

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

  // Update inline P&L in hero section (next to total)
  const inlineEl = document.getElementById('kpi-pnl-inline');
  if (inlineEl) {
    inlineEl.textContent = (pnl >= 0 ? '+' : '') + fmt.format(pnl);
    inlineEl.style.color = color;
  }
  const inlinePctEl = document.getElementById('kpi-pnl-pct-inline');
  if (inlinePctEl) {
    inlinePctEl.textContent = (parseFloat(pnlPct) >= 0 ? '+' : '') + pnlPct + '%';
    inlinePctEl.className = 'badge ' + (parseFloat(pnlPct) >= 0 ? 'badge-up' : 'badge-down');
  }

  // Compute daily/weekly/monthly/YTD P&L from asset period perf fields
  // Only use assets that actually have period data (non-zero)
  const computePeriodPnl = (field) => {
    return filteredAssets.reduce((s, a) => {
      const val = assetValue(a);
      const pctRaw = a[field];
      if (!pctRaw || isNaN(pctRaw) || pctRaw === 0) return s;
      const pct = normalizePct(pctRaw) / 100;
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
      perf = normalizePct(a.perfTotal);
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
function loadHistoPoints() {
  try {
    return JSON.parse(localStorage.getItem('patrimonia_histo') || '[]');
  } catch(e) { return []; }
}

// Filter histo points by period
function filterHistoByPeriod(points, period) {
  if (!points.length) return points;
  const now = new Date();
  let cutoff = new Date(now);
  switch(period) {
    case '1J':  cutoff.setDate(now.getDate() - 1); break;
    case '7J':  cutoff.setDate(now.getDate() - 7); break;
    case '1M':  cutoff.setMonth(now.getMonth() - 1); break;
    case '3M':  cutoff.setMonth(now.getMonth() - 3); break;
    case 'YTD': cutoff = new Date(now.getFullYear(), 0, 1); break;
    case '1A':  cutoff.setFullYear(now.getFullYear() - 1); break;
    case 'TOUT': return points;
    default:    cutoff = new Date(now.getFullYear(), 0, 1);
  }
  return points.filter(h => new Date(h.date) >= cutoff);
}

function renderHistoChart(total) {
  const ctx = document.getElementById('chartHistorique');
  if (!ctx) return;
  if (chartHistoInstance) chartHistoInstance.destroy();

  const now = new Date();
  const histoRaw = loadHistoPoints();

  // ── Build curve from REAL historical data if available ──
  const buildRealCurve = (period) => {
    const filtered = filterHistoByPeriod(histoRaw, period);
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
        const pct = normalizePct(a[perfField]) / 100;
        return s + (val - val / (1 + pct));
      }, 0);
    } else {
      const totalCost = assets
        .filter(a => !(a.source === 'sheets-cto' && a.ticker === 'EPA:AIR'))
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
          grid: { color: (getComputedStyle(document.documentElement).getPropertyValue('--border')||'rgba(255,255,255,0.06)') },
          ticks: {
            color: getComputedStyle(document.documentElement).getPropertyValue('--muted2')||'#71717a',
            font: { size: 10 },
            maxTicksLimit: 5,
            callback: v => {
              if (v >= 1000) return (v/1000).toFixed(v%1000===0?0:1) + ' k€';
              return v + ' €';
            }
          }
        },
        x: { grid: { display: false }, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted2')||'#52525b', font: { size: 10 }, maxTicksLimit: 8 } }
      }
    }
  });
}

function setHistoPeriod(period, btn) {
  currentHistoPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active', 'active-default'));
  btn.classList.add('active');
  const totalAssets = assets
    .filter(a => !(a.source === 'sheets-cto' && a.ticker === 'EPA:AIR'))
    .reduce((s, a) => s + assetValue(a), 0);
  const totalSav = savings.reduce((s, sv) => s + (sv.balance || 0), 0);
  const total    = showSavingsInTotal ? totalAssets + totalSav : totalAssets;
  renderHistoChart(total);
}

// ─── PORTEFEUILLE ────────────────────────────────────────────────────────

let currentSort = 'val_desc';

function setSortFilter(sort) {
  currentSort = sort;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('sort_' + sort);
  if (btn) btn.classList.add('active');
  renderPortfolio();
}

function renderPortfolio() {
  const tbody = document.getElementById('portfolioTbody');
  if (!tbody) return;
  const srcF = document.getElementById('filterSource')?.value || 'all';
  const typF = document.getElementById('filterType')?.value   || 'all';
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
    const pct = normalizePct(v);
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
      : (a.perfTotal && a.perfTotal !== 0 ? normalizePct(a.perfTotal) : 0);
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

  const normPct = (v) => normalizePct(v);

  // Build bar chart data — top 10 by value
  const displayAssets = isGlobal
    ? [...assets].sort((a, b) => assetValue(b) - assetValue(a)).slice(0, 12)
    : [assets[selectedIdx]].filter(Boolean);

  const labels = displayAssets.map(a => (a.ticker || a.name || '?').replace(/\s*\(.*?\)\s*/, '').substring(0, 12));
  const perfData = displayAssets.map(a => parseFloat(normPct(getPerfRatio(a)).toFixed(1)));
  const bgColors = perfData.map(v => v >= 0 ? 'rgba(34,197,94,0.75)' : 'rgba(239,68,68,0.75)');
  const mutedCol = getCssVar('--muted2') || '#71717a';
  const textCol  = getCssVar('--text')   || '#f0f2f5';
  const gridCol  = getCssVar('--border') || 'rgba(255,255,255,0.06)';

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
    <div class="fee-item">
      <div><div style="font-size:14px;font-weight:500;">${sv.name}</div><div style="font-size:12px;color:var(--muted2);">Taux : ${sv.rate||0}%</div></div>
      <div style="text-align:right;"><div style="font-weight:600;">${fmt.format(sv.balance||0)}</div>
      <button onclick="deleteSavings(${i})" style="font-size:11px;color:var(--danger);background:none;border:none;cursor:pointer;">Supprimer</button></div>
    </div>`).join('') : '<div class="empty-state"><div class="icon">🏦</div><p>Aucun livret</p></div>';
  const ctx = document.getElementById('chartSavings');
  if (ctx && savings.length) {
    if (chartSavingsInstance) chartSavingsInstance.destroy();
    chartSavingsInstance = new Chart(ctx.getContext('2d'), {
      type:'doughnut',
      data:{ labels:savings.map(s=>s.name), datasets:[{data:savings.map(s=>s.balance), backgroundColor:['#3b82f6','#22c55e','#f59e0b','#a78bfa','#ef4444'], borderWidth:0}] },
      options:{cutout:'65%',plugins:{legend:{position:'right',labels:{color:getComputedStyle(document.documentElement).getPropertyValue('--text')||'#fff',font:{size:11}}}}}
    });
  }
}

function addSavings() {
  const name=document.getElementById('savName')?.value?.trim();
  if (!name) return showToast('Entrez un nom','#ef4444');
  savings.push({ name, balance:parseFloat(document.getElementById('savBalance')?.value)||0, rate:parseFloat(document.getElementById('savRate')?.value)||0 });
  saveLocalData(); closeModal('addSavings'); renderSavings(); initOverview(); showToast('Livret ajouté ✓','#22c55e');
}

function deleteSavings(i) { savings.splice(i,1); saveLocalData(); renderSavings(); initOverview(); }

// ─── SALAIRE ─────────────────────────────────────────────────────────────

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
  saveLocalData(); closeModal('editSalary'); renderSalary(); initOverview();
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
  saveLocalData(); closeModal('addExpense'); renderSalary(); initOverview(); showToast('Dépense ajoutée ✓','#22c55e');
}

function deleteExpense(i) { expenses.splice(i,1); saveLocalData(); renderSalary(); initOverview(); }

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
      plugins:{legend:{labels:{color:getComputedStyle(document.documentElement).getPropertyValue('--muted2')||'#94a3b8',font:{size:11}}}},
      scales:{y:{grid:{color:getComputedStyle(document.documentElement).getPropertyValue('--border')||'rgba(255,255,255,0.04)'},ticks:{color:getComputedStyle(document.documentElement).getPropertyValue('--muted2')||'#52525b',callback:v=>fmt.format(v)}},
              x:{grid:{display:false},ticks:{color:getComputedStyle(document.documentElement).getPropertyValue('--muted2')||'#52525b',maxTicksLimit:8}}}}
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
  saveLocalData(); closeModal('addAsset'); initOverview(); renderPortfolio(); showToast(name+' ajouté ✓','#22c55e');
}

// ─── CONNEXIONS ──────────────────────────────────────────────────────────

async function connectSheets() {
  const apiKey = document.getElementById('sheetsApiKey')?.value?.trim();
  const url    = document.getElementById('sheetsUrl')?.value?.trim();
  if (!apiKey || !url) return showToast('Clé API et URL requis', '#ef4444');
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return showToast('URL invalide', '#ef4444');
  const sheetId = match[1];
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

    // CTO — A=Ticker B=Nom C=Qté D=PRU E=Prix(devise locale) F=Investi(€) G=ValTotale(€)
    //        H=1J I=Hebdo J=1Mois K=6Mois L=YTD M=Perf% N=Catégorie O=Secteur P=ZoneGéo
    //        U=TickerLocal V=TickerYahoo W=Devise X=PrixSecours
    //        Note: Prix (col E) peut être en USD pour les actions US.
    //              Investi (col F) et ValTotale (col G) sont TOUJOURS en EUR.
    const ctoRows = await fetchTab('CTO');
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
          buyPrice:     pru,           // PRU en devise locale (pour calcul % relatif)
          currentPrice: prixEUR,       // Prix en EUR
          investi,                     // Coût total en EUR ✓
          valTotale,                   // Valeur totale en EUR ✓
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
    const airbusRows = await fetchTab('AIRBUS');
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
          perfTotal:    perf,
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
    const cryptoRows = await fetchTab('Crypto');
    if (cryptoRows) {
      cryptoRows.slice(1).forEach(row => {
        const ticker = t(row[0]);
        if (!ticker || ticker.toUpperCase() === 'TOTAL') return;
        const nom = t(row[1]) || ticker;
        const qty = p(row[2]); const prix = p(row[4]);
        if (qty === 0 && prix === 0) return;
        assets.push({ name:`${nom} (${ticker})`, ticker, source:'sheets-crypto', type:'crypto',
          qty, buyPrice:p(row[3]), currentPrice:prix, investi:p(row[5]), valTotale:p(row[6]),
          perfTotal:p(row[7]), geo:'other', sector:'crypto', currency:'EUR', fees:0 });
        imported++;
      });
    }

    // ─── HISTORIQUE MENSUEL ──────────────────────────────────────────────
    // Lit "Suivi patrimoine" (vue globale) + onglets Suivi CTO/Airbus/Crypto
    // Structure attendue : col A=Date, col B=Investi, col C=Valeur Totale

    const parseHistoRow = (row) => {
      // Date : peut être un serial Google Sheets (nombre) ou une chaîne DD/MM/YYYY
      const rawDate = t(row[0]);
      const rawVal  = p(row[2]);  // col C = Valeur Totale
      const rawInv  = p(row[1]);  // col B = Investi
      if (!rawDate || rawDate.toUpperCase() === 'DATE' || rawDate.toUpperCase() === 'TOTAL') return null;
      if (rawVal <= 0 && rawInv <= 0) return null;

      let dateObj = null;
      const serial = parseFloat(rawDate.replace(',', '.'));
      if (!isNaN(serial) && serial > 40000) {
        // Google Sheets date serial
        dateObj = new Date(Math.round((serial - 25569) * 86400 * 1000));
      } else {
        // DD/MM/YYYY or YYYY-MM-DD
        const parts = rawDate.split(/[\/\-]/);
        if (parts.length === 3) {
          if (parts[0].length === 4) dateObj = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
          else dateObj = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
        }
      }
      if (!dateObj || isNaN(dateObj.getTime())) return null;
      return { date: dateObj, val: rawVal, inv: rawInv };
    };

    // Consolidate history from multiple Suivi tabs — each tab contributes its own category
    // We aggregate by month to build a total patrimoine curve
    const histoByMonth = {}; // key: "YYYY-MM" → { val, inv, sources: Set }

    const addToHisto = (rows, tabName) => {
      if (!rows) return;
      rows.slice(1).forEach(row => {
        const h = parseHistoRow(row);
        if (!h) return;
        const key = `${h.date.getFullYear()}-${String(h.date.getMonth()+1).padStart(2,'0')}`;
        if (!histoByMonth[key]) histoByMonth[key] = { val: 0, inv: 0, sources: new Set(), date: h.date };
        histoByMonth[key].val += h.val;
        histoByMonth[key].inv += h.inv;
        histoByMonth[key].sources.add(tabName);
      });
    };

    // Onglet "Suivi patrimoine" = tableau statique par catégorie (CTO, AIRBUS, Crypto...) — pas une série temporelle
    // On utilise les onglets de suivi mensuel pour construire la courbe historique
    // Onglets de suivi mensuel pour la courbe historique (Epargne exclu pour l'instant)
    const suiviCtoRows    = await fetchTab('Suivi CTO 2026');
    const suiviAirbusRows = await fetchTab('Suivi Airbus');
    const suiviCryptoRows = await fetchTab('Suivi Crypto');
    addToHisto(suiviCtoRows,    'CTO');
    addToHisto(suiviAirbusRows, 'Airbus');
    addToHisto(suiviCryptoRows, 'Crypto');

    // Sort and store history
    const histoPoints = Object.entries(histoByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ key, date: v.date, val: v.val, inv: v.inv }));

    if (histoPoints.length > 1) {
      localStorage.setItem('patrimonia_histo', JSON.stringify(
        histoPoints.map(h => ({
          date: h.date.toISOString().substring(0, 10),
          val:  h.val,
          inv:  h.inv,
        }))
      ));
    }

    // DIVIDENDES — "Suivi CTO 2026" col I(8)=Date J(9)=Société K(10)=Montant L(11)=Div/action
    const suiviRows = await fetchTab('Suivi CTO 2026');
    if (suiviRows) {
      const divs = [];
      suiviRows.slice(1).forEach(row => {
        const societe = t(row[9]); const montant = p(row[10]);
        if (!societe || societe.toUpperCase() === 'TOTAL' || montant <= 0) return;
        const serial = parseFloat(row[8]);
        let dateStr = '';
        if (!isNaN(serial) && serial > 40000) {
          dateStr = new Date(Math.round((serial-25569)*86400*1000)).toLocaleDateString('fr-FR');
        } else { dateStr = t(row[8]); }
        divs.push({ date:dateStr, ticker:societe, amount:montant, divPerShare:p(row[11]), source:'sheets' });
      });
      if (divs.length) localStorage.setItem('patrimonia_dividends', JSON.stringify(divs));
    }

    saveLocalData(); initOverview();
    const statusEl = document.getElementById('sheetsStatus');
    if (statusEl) { statusEl.textContent='Connecté'; statusEl.className='badge badge-up'; }
    const det = document.getElementById('dashboardDetected');
    if (det) det.style.display='block';
    showToast(imported+' actifs import\u00E9s \u2713', '#22c55e');
    autoFillFiscalFromSalary();
    renderDisconnectButtons();

  } catch(err) {
    showToast('Erreur : '+err.message, '#ef4444'); console.error(err);
  } finally {
    if (btn) btn.textContent='\u2B07 Importer mon Google Sheet';
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
  // Hide detected badge for sheets + clear historical data
  if (sourcePrefix === 'sheets') {
    const det = document.getElementById('dashboardDetected');
    if (det) det.style.display = 'none';
    localStorage.removeItem('patrimonia_histo');
    localStorage.removeItem('patrimonia_dividends');
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
  saveLocalData(); showToast('Paramètres sauvegardés ✓','#22c55e');
}

// ─── DIVIDENDES ──────────────────────────────────────────────────────────

function renderDividendsOverview() {
  const divEl = document.getElementById('dividendsOverview');
  if (!divEl) return;

  let divs = [];
  try { divs = JSON.parse(localStorage.getItem('patrimonia_dividends')||'[]'); } catch(e){}

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
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='patrimonia_export.json'; a.click();
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
  assets = []; savings = []; expenses = []; salaryData = {}; settings = { currency:'EUR', exposureThreshold:20 };
  ['patrimonia_assets','patrimonia_savings','patrimonia_expenses','patrimonia_salary','patrimonia_settings','patrimonia_histo','patrimonia_dividends'].forEach(k=>localStorage.removeItem(k));
  // Sync la réinitialisation vers Supabase
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
