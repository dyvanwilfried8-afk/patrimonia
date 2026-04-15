// ══════════════════════════════════════════════════════════════
//  PATRIMONIA — app.js
//  Auth guard → Supabase data layer → render → charts → events
// ══════════════════════════════════════════════════════════════

// ── SUPABASE CONFIG ─────────────────────────────────────────
// 🔧 Remplacez ces deux valeurs par celles de votre projet Supabase
//    (Settings → API dans le dashboard Supabase)
const SUPABASE_URL  = 'https://grvxurgvxwmheiollrmp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_7XITRulkeLGYMis4S02PiA_JaDeUQQE';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── AUTH GUARD + INIT ────────────────────────────────────────
// Tout le démarrage est async : on attend la session avant de rendre quoi que ce soit
let currentUser = null;

async function initApp() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  currentUser = session.user.id;

  // Afficher l'email de l'utilisateur dans la sidebar si l'élément existe
  const emailEl = document.getElementById('userEmail');
  if (emailEl) emailEl.textContent = session.user.email;

  // Charger toutes les données depuis Supabase, puis démarrer l'app
  await loadAllData();
  init(); // Initialiser l'UI (dropdowns, champs salaire, etc.)
  hideSplash();
}

// ── DATA HELPERS (localStorage + Supabase) ──────────────────
const _cache = {};

function getData(key, def) {
  const cached = _cache[key];
  if (cached !== undefined) return cached;
  const raw = localStorage.getItem('pat_' + key);
  if (raw === null) return def;
  try { return JSON.parse(raw); } catch { return raw; }
}

function setData(key, value) {
  _cache[key] = value;
  localStorage.setItem('pat_' + key, JSON.stringify(value));
  if (currentUser) {
    sb.from('user_data').upsert({ user_id: currentUser, key, value }).catch(() => {});
  }
}


// ══════════════════════════════════════════════════════════════
//  THEME MANAGER — Light / Dark
// ══════════════════════════════════════════════════════════════

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  const btnDark  = document.getElementById('btnDark');
  const btnLight = document.getElementById('btnLight');

  if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';

  // Highlight active button in settings
  if (btnDark)  btnDark.classList.toggle('active-theme',  theme === 'dark');
  if (btnLight) btnLight.classList.toggle('active-theme', theme === 'light');

  // Mettre à jour Chart.js global defaults pour les couleurs des axes
  if (window.Chart) {
    const gridColor  = theme === 'light' ? 'rgba(0,0,0,0.06)'  : 'rgba(255,255,255,0.04)';
    const tickColor  = theme === 'light' ? '#9ca3af'             : '#6b7280';
    Chart.defaults.color = tickColor;
    Chart.defaults.scale.grid.color = gridColor;
    // Redessiner tous les charts existants
    Object.values(chartInstances || {}).forEach(c => {
      try {
        c.options.scales?.x && (c.options.scales.x.grid.color = gridColor);
        c.options.scales?.x && (c.options.scales.x.ticks.color = tickColor);
        c.options.scales?.y && (c.options.scales.y.grid.color = gridColor);
        c.options.scales?.y && (c.options.scales.y.ticks.color = tickColor);
        c.update('none');
      } catch(e) {}
    });
  }
}

function setTheme(theme) {
  localStorage.setItem('patrimonia_theme', theme);
  applyTheme(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// Appliquer le thème sauvegardé au chargement
(function() {
  const saved = localStorage.getItem('patrimonia_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

// ── CHARGEMENT INITIAL DE TOUTES LES DONNÉES ────────────────
async function loadAllData() {
  // Charger toutes les clés en une seule requête pour la performance
  try {
    const { data, error } = await sb
      .from('user_data')
      .select('key, value')
      .eq('user_id', currentUser);
    if (!error && data) {
      data.forEach(row => { _cache[row.key] = row.value; });
    }
  } catch (e) { console.error('loadAllData error', e); }

  assets   = _cache['assets']   ?? [];
  savings  = _cache['savings']  ?? [];
  salary   = _cache['salary']   ?? { gross: 0, net: 0, inter: 0, part: 0, saved: 0 };
  expenses = _cache['expenses'] ?? [];
  settings = _cache['settings'] ?? { currency: 'EUR', exposureThreshold: 20 };
  sources  = _cache['sources']  ?? {};
}

// ── STATE ─────────────────────────────────────────────────────
let assets    = [];
let savings   = [];
let salary    = { gross: 0, net: 0, inter: 0, part: 0, saved: 0 };
let expenses  = [];
let settings  = { currency: 'EUR', exposureThreshold: 20 };
let sources   = {};
let chartInstances = {};

// ── CHART HELPERS ─────────────────────────────────────────────
const CHART_COLORS = [
  '#c8f25a','#5af2c8','#f25a8a','#60a5fa','#fbbf24',
  '#a78bfa','#fb923c','#34d399','#f472b6','#38bdf8'
];

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function makeDonut(id, labels, data, title = '') {
  destroyChart(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  chartInstances[id] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: CHART_COLORS, borderColor: '#111318', borderWidth: 3, hoverOffset: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.parsed)} (${((ctx.parsed / ctx.dataset.data.reduce((a,b)=>a+b,0))*100).toFixed(1)}%)` } }
      }
    }
  });
}

function makeLine(id, labels, datasets) {
  destroyChart(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  chartInstances[id] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7280', font: { size: 10 }, maxTicksLimit: 10 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7280', font: { size: 10 }, callback: v => fmt(v) } }
      }
    }
  });
}

// ── FORMATTING ────────────────────────────────────────────────
const currencySymbol = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF' };

function fmt(v, decimals = 0) {
  const sym = currencySymbol[settings.currency] || '€';
  if (Math.abs(v) >= 1e6) return `${(v/1e6).toFixed(2)}M${sym}`;
  if (Math.abs(v) >= 1e3) return `${(v/1e3).toFixed(1)}k${sym}`;
  return `${Number(v).toFixed(decimals)}${sym}`;
}

function pct(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }

function colorClass(v) { return v >= 0 ? 'color-accent' : 'color-danger'; }

function badgeClass(v) { return v >= 0 ? 'badge-up' : 'badge-down'; }

// ── NAVIGATION ────────────────────────────────────────────────
const pageTitles = {
  overview: 'Tableau de bord', portfolio: 'Portefeuille',
  savings: 'Épargne bancaire', salary: 'Salaire & Budget',
  loan: '🏠 Simulateur de prêt',
  projection: 'Projection DCA', dividends: '💰 Dividendes',
  ai: '🤖 Analyse IA', analysis: 'Analyse complète',
  fees: 'Scanner de frais', fiscalite: '🏛️ Fiscalité',
  sources: 'Connexions', settings: 'Paramètres'
};

function navigate(page) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('onclick')?.includes(`'${page}'`)) el.classList.add('active');
  });
  document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`mn-${page}`)?.classList.add('active');

  document.getElementById('topbarTitle').textContent = pageTitles[page] || page;
  if (window.innerWidth <= 900) toggleSidebar(false);
  renderPage(page);
}

function renderPage(page) {
  if (page === 'overview')   renderOverview();
  if (page === 'portfolio')  { renderPortfolio(); renderAssetChart(); }
  if (page === 'savings')    renderSavings();
  if (page === 'salary')     renderSalary();
  if (page === 'loan')       { calcLoan(); calcCapacite(); calcComparatif(); }
  if (page === 'projection') updateProjection();
  if (page === 'dividends')  renderDividendsPage();
  if (page === 'ai')         renderAIPage();
  if (page === 'analysis')   renderAnalysis();
  if (page === 'fees')       renderFees();
  if (page === 'fiscalite')  { calculateTax(); renderFiscalite(); }
  if (page === 'sources')    renderSourcesPage();
}

// ── SIDEBAR ───────────────────────────────────────────────────
function toggleSidebar(force) {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  const isOpen = force !== undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', isOpen);
  ov.classList.toggle('open', isOpen);
}

// ── LOGOUT ────────────────────────────────────────────────────
async function logout() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// ── MODALS ────────────────────────────────────────────────────
function openModal(id) { document.getElementById(`modal-${id}`)?.classList.add('open'); }
function closeModal(id) { document.getElementById(`modal-${id}`)?.classList.remove('open'); }

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

// ── HISTORY SNAPSHOT ─────────────────────────────────────────
// On enregistre le patrimoine total chaque fois que les données sont chargées
// Stocké par utilisateur : tableau de { date, total, byAsset: {name: val} }
function recordSnapshot() {
  const { totalValue } = computeTotals();
  if (totalValue === 0) return;

  const history = getData('history', []);
  const today = new Date().toISOString().slice(0, 10);

  // Snapshot par actif
  const byAsset = {};
  assets.forEach(a => {
    const val = (a.qty || 1) * (a.currentPrice || 0);
    if (val > 0) byAsset[a.name] = val;
  });

  // Remplacer ou ajouter snapshot du jour
  const existIdx = history.findIndex(h => h.date === today);
  const snap = { date: today, total: Math.round(totalValue), byAsset };
  if (existIdx >= 0) history[existIdx] = snap;
  else history.push(snap);

  // Garder max 365 jours
  if (history.length > 365) history.splice(0, history.length - 365);
  setData('history', history);
}

// ── HISTORIQUE CHART ──────────────────────────────────────────
let currentHistoPeriod = 'YTD';
let currentAssetPeriod = 'YTD';

function filterHistoryByPeriod(period) {
  const history = getData('history', []);
  if (!history.length) return generateSimulatedHistory(period);

  const now = new Date();
  let cutoff;

  if (period === '1J') {
    // Juste les 2 derniers points
    return history.slice(-2);
  } else if (period === '7J') {
    cutoff = new Date(now); cutoff.setDate(now.getDate() - 7);
  } else if (period === '1M') {
    cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 1);
  } else if (period === '3M') {
    cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 3);
  } else if (period === 'YTD') {
    cutoff = new Date(now.getFullYear(), 0, 1);
  } else if (period === '1A') {
    cutoff = new Date(now); cutoff.setFullYear(now.getFullYear() - 1);
  } else {
    return history; // TOUT
  }

  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const filtered = history.filter(h => h.date >= cutoffStr);
  return filtered.length > 1 ? filtered : history.slice(-Math.min(history.length, 30));
}

// Génère un historique simulé plausible à partir des données actuelles
function generateSimulatedHistory(period) {
  const { totalValue } = computeTotals();
  if (totalValue === 0) return [];

  const now = new Date();
  let days;
  if (period === '1J') days = 1;
  else if (period === '7J') days = 7;
  else if (period === '1M') days = 30;
  else if (period === '3M') days = 90;
  else if (period === 'YTD') days = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / 86400000);
  else if (period === '1A') days = 365;
  else days = 180;

  const points = Math.min(days + 1, 60);
  const result = [];

  // Partir d'une valeur estimée en début de période
  const perfMap = { '1J': -0.005, '7J': 0.012, '1M': 0.03, '3M': 0.045, 'YTD': 0.08, '1A': 0.12, 'TOUT': 0.15 };
  const startRatio = 1 - (perfMap[period] || 0.08);
  const startVal = totalValue * startRatio;

  for (let i = 0; i < points; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (points - 1 - i) * Math.ceil(days / points));
    const progress = i / (points - 1);
    // Interpolation non-linéaire + bruit
    const noise = (Math.sin(i * 2.3) * 0.015 + Math.cos(i * 1.7) * 0.01) * totalValue;
    const val = Math.round(startVal + (totalValue - startVal) * Math.pow(progress, 0.8) + noise);
    result.push({ date: d.toISOString().slice(0, 10), total: val });
  }

  // S'assurer que le dernier point est la valeur actuelle
  if (result.length > 0) result[result.length - 1].total = Math.round(totalValue);
  return result;
}

function setHistoPeriod(period, btn) {
  currentHistoPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => {
    if (b.closest('#page-overview')) {
      b.classList.remove('active', 'active-default');
    }
  });
  btn?.classList.add('active');
  renderHistoChart();
}

function setAssetPeriod(period, btn) {
  currentAssetPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => {
    if (b.closest('#page-portfolio')) {
      b.classList.remove('active', 'active-default');
    }
  });
  btn?.classList.add('active');
  renderAssetChart();
}

function renderHistoChart() {
  const data = filterHistoryByPeriod(currentHistoPeriod);
  if (!data.length) return;

  const labels = data.map(d => {
    const dt = new Date(d.date);
    if (currentHistoPeriod === '1J') return dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (['7J', '1M'].includes(currentHistoPeriod)) return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  });

  const values = data.map(d => d.total);
  const first = values[0] || 0;
  const last = values[values.length - 1] || 0;
  const delta = last - first;
  const deltaPct = first > 0 ? (delta / first) * 100 : 0;
  const isPositive = delta >= 0;
  const lineColor = isPositive ? '#22c55e' : '#ef4444';
  const fillColor = isPositive ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)';

  // Update header display
  document.getElementById('chartTotalDisplay').textContent = fmt(last);
  const deltaEl = document.getElementById('chartDeltaVal');
  const pctEl = document.getElementById('chartDeltaPct');
  deltaEl.textContent = `${delta >= 0 ? '+' : ''}${fmt(delta)}`;
  deltaEl.style.color = isPositive ? '#22c55e' : 'var(--danger)';
  pctEl.textContent = `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%`;
  pctEl.style.background = isPositive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
  pctEl.style.color = isPositive ? '#22c55e' : 'var(--danger)';

  destroyChart('chartHistorique');
  const ctx = document.getElementById('chartHistorique')?.getContext('2d');
  if (!ctx) return;

  chartInstances['chartHistorique'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: lineColor,
        backgroundColor: fillColor,
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: lineColor,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(13,19,35,0.95)',
          borderColor: 'rgba(59,130,246,0.3)',
          borderWidth: 1,
          titleColor: '#a8b4c8',
          bodyColor: '#e8edf5',
          titleFont: { size: 11, family: 'Inter' },
          bodyFont: { size: 14, family: 'Cormorant Garamond', weight: '400' },
          padding: 12,
          callbacks: {
            label: ctx => fmt(ctx.parsed.y),
            title: ctx => ctx[0].label,
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#4a5568', font: { size: 10, family: 'Inter' },
            maxTicksLimit: 6, maxRotation: 0,
          },
          border: { display: false }
        },
        y: {
          grid: { color: 'rgba(59,130,246,0.04)', drawBorder: false },
          ticks: {
            color: '#4a5568', font: { size: 10 },
            callback: v => fmt(v), maxTicksLimit: 4,
          },
          border: { display: false }
        }
      }
    }
  });
}

// ── GRAPHIQUE PAR ACTIF ───────────────────────────────────────
function renderAssetChart() {
  const select = document.getElementById('assetChartSelect');
  const selectedName = select?.value || '__global__';

  const history = getData('history', []);

  // Populate dropdown
  if (select) {
    const current = select.value;
    select.innerHTML = '<option value="__global__">— Vue globale —</option>';
    assets.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = `${a.name} — ${a.label || a.name}`;
      select.appendChild(opt);
    });
    select.value = current || '__global__';
  }

  let dataPoints = [];

  if (selectedName === '__global__') {
    dataPoints = filterHistoryByPeriod(currentAssetPeriod);
  } else {
    // Extraire l'historique de cet actif spécifique
    const raw = filterHistoryByPeriod(currentAssetPeriod);
    if (raw.length && raw[0].byAsset) {
      dataPoints = raw
        .filter(h => h.byAsset && h.byAsset[selectedName] !== undefined)
        .map(h => ({ date: h.date, total: h.byAsset[selectedName] }));
    }
    // Si pas d'historique pour cet actif, simuler à partir de son prix actuel
    if (dataPoints.length < 2) {
      const asset = assets.find(a => a.name === selectedName);
      if (asset) {
        const currentVal = (asset.qty || 1) * (asset.currentPrice || 0);
        const buyVal = (asset.qty || 1) * (asset.buyPrice || asset.currentPrice || 0);
        const perfMap = { '1J': 0, '7J': asset.perf?.w1 || 0, '1M': asset.perf?.m1 || 0, 'YTD': asset.perf?.ytd || 0, '1A': asset.perf?.total || 0, 'TOUT': asset.perf?.total || 0 };
        const perf = perfMap[currentAssetPeriod] || 0;
        const startVal = currentVal / (1 + perf);
        const points = 20;
        dataPoints = Array.from({ length: points }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (points - 1 - i));
          const progress = i / (points - 1);
          const noise = Math.sin(i * 1.8) * currentVal * 0.01;
          return { date: d.toISOString().slice(0, 10), total: Math.round(startVal + (currentVal - startVal) * progress + noise) };
        });
        dataPoints[dataPoints.length - 1].total = Math.round(currentVal);
      }
    }
  }

  if (!dataPoints.length) return;

  const labels = dataPoints.map(d => new Date(d.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
  const values = dataPoints.map(d => d.total);
  const first = values[0] || 0;
  const last = values[values.length - 1] || 0;
  const delta = last - first;
  const deltaPct = first > 0 ? (delta / first) * 100 : 0;
  const isPos = delta >= 0;
  const col = isPos ? '#22c55e' : '#ef4444';

  document.getElementById('assetChartVal').textContent = fmt(last);
  const dEl = document.getElementById('assetChartDelta');
  dEl.textContent = `${delta >= 0 ? '+' : ''}${fmt(delta)} (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%)`;
  dEl.style.color = isPos ? '#22c55e' : 'var(--danger)';

  destroyChart('chartAsset');
  const ctx = document.getElementById('chartAsset')?.getContext('2d');
  if (!ctx) return;

  chartInstances['chartAsset'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: col,
        backgroundColor: isPos ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.06)',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: col,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(13,19,35,0.95)',
          borderColor: 'rgba(59,130,246,0.3)',
          borderWidth: 1,
          titleColor: '#a8b4c8', bodyColor: '#e8edf5',
          padding: 10,
          callbacks: { label: ctx => fmt(ctx.parsed.y) }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#4a5568', font: { size: 10 }, maxTicksLimit: 5 }, border: { display: false } },
        y: { grid: { color: 'rgba(59,130,246,0.04)' }, ticks: { color: '#4a5568', font: { size: 10 }, callback: v => fmt(v), maxTicksLimit: 4 }, border: { display: false } }
      }
    }
  });

  // Mini sparklines par actif
  renderSparklines();
}

function renderSparklines() {
  const container = document.getElementById('assetSparklines');
  if (!container) return;

  const topAssets = [...assets]
    .sort((a, b) => ((b.qty || 1) * (b.currentPrice || 0)) - ((a.qty || 1) * (a.currentPrice || 0)))
    .slice(0, 12);

  container.innerHTML = topAssets.map((a, i) => {
    const val = (a.qty || 1) * (a.currentPrice || 0);
    const inv = (a.qty || 1) * (a.buyPrice || a.currentPrice || 0);
    const pnl = val - inv;
    const pnlPct = inv > 0 ? (pnl / inv) * 100 : 0;
    const isPos = pnl >= 0;
    const col = isPos ? '#22c55e' : '#ef4444';
    return `
      <div onclick="selectAsset('${a.name}')" style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;transition:border-color .2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${getAssetLogo(a)}
            <div>
              <div style="font-size:12px;font-weight:500;color:var(--text2);">${a.name}</div>
              <div style="font-size:10px;color:var(--muted);">${a.label || ''}</div>
            </div>
          </div>
          <span class="asset-badge badge-${a.type}" style="font-size:9px;">${a.type}</span>
        </div>
        <canvas id="spark-${i}" height="40" style="width:100%;height:40px;"></canvas>
        <div style="display:flex;justify-content:space-between;margin-top:8px;">
          <div style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:400;">${fmt(val)}</div>
          <div style="font-size:11px;color:${col};font-weight:500;">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</div>
        </div>
      </div>`;
  }).join('');

  // Draw sparklines after DOM update
  setTimeout(() => {
    topAssets.forEach((a, i) => {
      const canvas = document.getElementById(`spark-${i}`);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const val = (a.qty || 1) * (a.currentPrice || 0);
      const perf = a.perf?.total || 0;
      const pts = 12;
      const startVal = val / (1 + perf);
      const data = Array.from({ length: pts }, (_, j) => {
        const t = j / (pts - 1);
        const noise = Math.sin(j * 2.1 + i) * val * 0.015;
        return startVal + (val - startVal) * t + noise;
      });
      data[data.length - 1] = val;
      const isPos = perf >= 0;
      const col = isPos ? '#22c55e' : '#ef4444';

      destroyChart(`spark-${i}`);
      chartInstances[`spark-${i}`] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.map((_, j) => j),
          datasets: [{ data, borderColor: col, borderWidth: 1.5, tension: 0.4, fill: false, pointRadius: 0 }]
        },
        options: {
          responsive: false, maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { x: { display: false }, y: { display: false } }
        }
      });
    });
  }, 50);
}

function selectAsset(name) {
  const select = document.getElementById('assetChartSelect');
  if (select) { select.value = name; renderAssetChart(); }
  // Scroll to chart
  document.getElementById('chartAsset')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function toast(msg, color = 'var(--accent2)') {
  // Supprimer les toasts existants
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span style="color:${color};font-weight:500;">${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// ── COMPUTED TOTALS ───────────────────────────────────────────
function computeTotals() {
  let totalValue = 0, totalInvested = 0;
  const byType = { stock: 0, crypto: 0, savings: 0, esop: 0 };

  assets.forEach(a => {
    const val = (a.qty || 1) * (a.currentPrice || 0);
    const inv = (a.qty || 1) * (a.buyPrice || a.currentPrice || 0);
    totalValue += val;
    totalInvested += inv;
    byType[a.type] = (byType[a.type] || 0) + val;
  });

  const bankTotal = savings.reduce((s, x) => s + (x.balance || 0), 0);
  totalValue += bankTotal;
  byType.savings = (byType.savings || 0) + bankTotal;

  const pnl = totalValue - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

  const savingsRate = salary.net > 0 ? ((salary.saved || 0) / salary.net) * 100 : 0;
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  return { totalValue, totalInvested, pnl, pnlPct, byType, bankTotal, savingsRate, totalExpenses };
}

// ── RENDER OVERVIEW ───────────────────────────────────────────
function renderOverview() {
  const { totalValue, totalInvested, pnl, pnlPct, byType, bankTotal, savingsRate, totalExpenses } = computeTotals();

  // ── Total patrimoine + variation ──
  const totalEl = document.getElementById('kpi-total');
  if (totalEl) totalEl.textContent = fmt(totalValue);

  const pctEl = document.getElementById('kpi-total-pct');
  if (pctEl) {
    pctEl.textContent = pct(pnlPct);
    pctEl.className = `badge ${badgeClass(pnlPct)}`;
  }

  const pnlEl = document.getElementById('kpi-pnl');
  if (pnlEl) {
    pnlEl.textContent = `${pnl >= 0 ? '+' : ''}${fmt(pnl)}`;
    pnlEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  }

  const pnlPctEl = document.getElementById('kpi-pnl-pct');
  if (pnlPctEl) {
    pnlPctEl.textContent = pct(pnlPct);
    pnlPctEl.style.color = pnlPct >= 0 ? 'var(--green)' : 'var(--red)';
  }

  // Delta sur graphique (en haut)
  const deltaEl = document.getElementById('chartDeltaVal');
  if (deltaEl) {
    deltaEl.textContent = `${pnl >= 0 ? '+' : ''}${fmt(pnl)}`;
    deltaEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  }

  // Budget
  document.getElementById('rateVal').textContent = `${savingsRate.toFixed(0)}%`;
  document.getElementById('salaryDisplay').textContent = fmt(salary.net || 0);
  document.getElementById('savingsDisplay').textContent = fmt(salary.saved || 0);
  document.getElementById('expensesDisplay').textContent = fmt(totalExpenses);
  document.getElementById('savingsBar').style.width = `${Math.min(savingsRate, 100)}%`;
  const expPct = salary.net > 0 ? (totalExpenses / salary.net) * 100 : 0;
  document.getElementById('expensesBar').style.width = `${Math.min(expPct, 100)}%`;

  // ── CATEGORY CARDS style Finary ──
  const catConfig = [
    {
      key: 'stock', label: 'Actions & ETF',
      icon: '📈', bg: 'rgba(59,130,246,0.12)', color: '#3b82f6',
      sub: () => `${assets.filter(a=>a.type==='stock').length} positions`,
      navigate: () => { navigate('portfolio'); document.getElementById('filterType').value='stock'; renderPortfolio(); }
    },
    {
      key: 'crypto', label: 'Crypto',
      icon: '₿', bg: 'rgba(245,158,11,0.12)', color: '#f59e0b',
      sub: () => `${assets.filter(a=>a.type==='crypto').length} actifs`,
      navigate: () => { navigate('portfolio'); document.getElementById('filterType').value='crypto'; renderPortfolio(); }
    },
    {
      key: 'savings', label: 'Épargne bancaire',
      icon: '🏦', bg: 'rgba(34,197,94,0.12)', color: '#22c55e',
      sub: () => `${savings.length} livret${savings.length>1?'s':''}`,
      navigate: () => navigate('savings')
    },
    {
      key: 'esop', label: 'Épargne salariale',
      icon: '✈️', bg: 'rgba(139,92,246,0.12)', color: '#a78bfa',
      sub: () => `PEG · PERCOL · Airbus`,
      navigate: () => { navigate('portfolio'); document.getElementById('filterType').value='esop'; renderPortfolio(); }
    },
  ];

  const cardsEl = document.getElementById('categoryCards');
  if (cardsEl) {
    cardsEl.innerHTML = catConfig.map(cat => {
      const val  = byType[cat.key] || 0;
      const pct  = totalValue > 0 ? (val / totalValue) * 100 : 0;
      // P&L estimé pour cette catégorie
      const catAssets = assets.filter(a => a.type === cat.key);
      const catInv = catAssets.reduce((s,a) => s + (a.qty||1)*(a.buyPrice||a.currentPrice||0), 0);
      const catPnl = val - catInv;
      const catPnlPct = catInv > 0 ? (catPnl/catInv)*100 : 0;
      const perfColor = catPnl >= 0 ? 'var(--green)' : 'var(--red)';

      return `<div class="cat-card" onclick="${cat.navigate.toString().replace(/\(\)\s*=>\s*\{/, '').replace(/\}$/, '').replace(/\(\)\s*=>\s*/, '')}">
        <div class="cat-icon" style="background:${cat.bg};">
          <span style="font-size:15px;">${cat.icon}</span>
        </div>
        <div class="cat-info">
          <div class="cat-name">${cat.label}</div>
          <div class="cat-sub">${cat.sub()} · ${pct.toFixed(1)}%</div>
        </div>
        <div class="cat-right">
          <div class="cat-val">${fmt(val)}</div>
          <div class="cat-perf" style="color:${perfColor};">${catPnl >= 0 ? '+' : ''}${catPnlPct.toFixed(2)}%</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted2);flex-shrink:0;margin-left:4px;">
          <polyline points="9,18 15,12 9,6"/>
        </svg>
      </div>`;
    }).join('');
  }

  // Enregistrer snapshot + dessiner graphique
  recordSnapshot();
  renderHistoChart();

  // ── Portfolio stats ──
  const assetsWithVal = assets.filter(a => a.currentPrice > 0);

  function getRealPerfPct(a) {
    if (a.buyPrice > 0 && a.currentPrice > 0) return (a.currentPrice - a.buyPrice) / a.buyPrice;
    if (a.perf?.total !== undefined && a.perf.total !== 0) return a.perf.total;
    return 0;
  }

  if (assetsWithVal.length) {
    const sorted = [...assetsWithVal]
      .map(a => ({ ...a, _perf: getRealPerfPct(a) }))
      .filter(a => a._perf !== 0)
      .sort((a, b) => b._perf - a._perf);

    const best  = sorted[0];
    const worst = sorted[sorted.length - 1];

    if (best) {
      document.getElementById('statBestName').textContent = best.label || best.name;
      document.getElementById('statBestPct').textContent = `+${(best._perf * 100).toFixed(2)}%`;
    }
    if (worst) {
      document.getElementById('statWorstName').textContent = worst.label || worst.name;
      document.getElementById('statWorstPct').textContent = `${(worst._perf * 100).toFixed(2)}%`;
    }

    // Weighted avg perf by period
    const totalVal2 = assetsWithVal.reduce((s,a) => s + (a.qty||1)*(a.currentPrice||0), 0) || 1;
    function wavg(key) {
      return assetsWithVal.reduce((s,a) => {
        const w = ((a.qty||1)*(a.currentPrice||0)) / totalVal2;
        return s + (a.perf?.[key]||0) * w;
      }, 0);
    }
    const d1  = wavg('d1'), w1 = wavg('w1'), m1 = wavg('m1'), ytd = wavg('ytd');
    const totalPnlPct = totalInvested > 0 ? (totalValue - totalInvested) / totalInvested : 0;

    const setStatEl = (id, val, isPct=true) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = isPct ? `${val>=0?'+':''}${(val*100).toFixed(2)}%` : `${val>=0?'+':''}${fmt(val)}`;
      el.className = `kpi-value ${val >= 0 ? 'color-accent' : 'color-danger'}`;
    };

    setStatEl('statD1', d1);
    setStatEl('statW1', w1);
    setStatEl('statM1', m1);
    setStatEl('statYtd', ytd);
    setStatEl('statGlobalPnl', totalPnlPct);
    document.getElementById('statPositions').textContent = assets.length;
  }

  // ── Dividendes ──
  const dividends = getData('dividends', []);
  const divEl = document.getElementById('dividendsOverview');
  const received = dividends.filter(d => d.amount > 0);
  const totalDiv = received.reduce((s,d) => s + d.amount, 0);
  if (!received.length) {
    divEl.innerHTML = '<div class="empty-state"><div class="icon">💰</div><p>Importez votre DASHBOARD pour voir vos dividendes</p></div>';
  } else {
    divEl.innerHTML = `
      <div class="flex-between mb-16" style="padding:0 4px;">
        <div><span class="text-sm color-muted">Total reçu</span> <span class="fw-bold color-accent">${fmt(totalDiv, 2)}</span></div>
        <div><span class="text-sm color-muted">${received.length} versements</span></div>
      </div>
      <div style="overflow-x:auto;">
      <table class="data-table">
        <thead><tr><th>Date</th><th>Société</th><th>Montant</th><th>Par action</th></tr></thead>
        <tbody>
          ${received.map(d => `<tr>
            <td class="color-muted">${d.date || '–'}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;">
                ${getAssetLogo({name:d.ticker||d.company,label:d.company,type:'stock'})}
                <span class="fw-bold">${d.company}</span>
              </div>
            </td>
            <td class="color-accent fw-bold">+${fmt(d.amount, 2)}</td>
            <td class="color-muted">${d.perShare > 0 ? fmt(d.perShare, 2) : '–'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`;
  }
}


// ── LOGOS D'ACTIFS ────────────────────────────────────────────
// Mapping manuel pour les tickers les plus courants
const TICKER_DOMAIN = {
  // Actions françaises
  'EPA:AIR': 'airbus.com', 'AI': 'airbus.com',
  'EPA:OR':  'loreal.com', 'EPA:MC': 'lvmh.com',
  'EPA:TTE': 'totalenergies.com', 'TTE': 'totalenergies.com',
  'EPA:SAN': 'sanofi.com', 'EPA:BNP': 'bnpparibas.com',
  'EPA:SGO': 'saint-gobain.com', 'EPA:SAF': 'safran-group.com',
  'EPA:SU': 'se.com', 'EPA:CS': 'axaim.com',
  'EPA:CAP': 'capgemini.com', 'EPA:DSY': 'dassault-systemes.com',
  'EPA:KER': 'kering.com', 'EPA:RMS': 'hermes.com',

  // Actions US
  'AAPL': 'apple.com', 'MSFT': 'microsoft.com', 'GOOGL': 'abc.xyz',
  'GOOG': 'abc.xyz', 'AMZN': 'amazon.com', 'NVDA': 'nvidia.com',
  'TSLA': 'tesla.com', 'META': 'meta.com', 'NFLX': 'netflix.com',
  'AVGO': 'broadcom.com', 'JPM': 'jpmorganchase.com', 'V': 'visa.com',
  'MA': 'mastercard.com', 'BRK.B': 'berkshirehathaway.com',
  'XOM': 'exxonmobil.com', 'JNJ': 'jnj.com', 'PG': 'pg.com',
  'HD': 'homedepot.com', 'CVX': 'chevron.com', 'MRK': 'merck.com',
  'ABBV': 'abbvie.com', 'PEP': 'pepsico.com', 'KO': 'coca-cola.com',
  'BAC': 'bankofamerica.com', 'WMT': 'walmart.com', 'DIS': 'thewaltdisneycompany.com',
  'PYPL': 'paypal.com', 'INTC': 'intel.com', 'CSCO': 'cisco.com',
  'ADBE': 'adobe.com', 'CRM': 'salesforce.com', 'ORCL': 'oracle.com',
  'AMD': 'amd.com', 'QCOM': 'qualcomm.com', 'TXN': 'ti.com',
  'IBM': 'ibm.com', 'GE': 'ge.com', 'BA': 'boeing.com',
  'CAT': 'caterpillar.com', 'MMM': '3m.com', 'GS': 'goldmansachs.com',
  'MS': 'morganstanley.com', 'C': 'citigroup.com', 'WFC': 'wellsfargo.com',

  // Crypto
  'BTC': 'bitcoin.org', 'ETH': 'ethereum.org', 'BNB': 'bnbchain.org',
  'SOL': 'solana.com', 'XRP': 'ripple.com', 'ADA': 'cardano.org',
  'DOGE': 'dogecoin.com', 'MATIC': 'polygon.technology', 'DOT': 'polkadot.network',
  'AVAX': 'avax.network', 'LINK': 'chain.link', 'UNI': 'uniswap.org',
  'LTC': 'litecoin.org', 'ATOM': 'cosmos.network', 'XLM': 'stellar.org',

  // ETFs communs
  'IWDA': 'ishares.com', 'CSPX': 'ishares.com', 'VWCE': 'vanguard.com',
  'MSCI': 'msci.com', 'SPY': 'ssga.com', 'QQQ': 'invesco.com',
  'VTI': 'vanguard.com', 'VOO': 'vanguard.com', 'VGT': 'vanguard.com',
  'ARKK': 'ark-invest.com', 'GLD': 'spdrgoldshares.com',
};

// Couleurs de fallback par type
const TYPE_COLORS = {
  stock:   { bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa' },
  crypto:  { bg: 'rgba(245,158,11,0.15)',  color: '#fbbf24' },
  etf:     { bg: 'rgba(34,197,94,0.15)',   color: '#22c55e' },
  savings: { bg: 'rgba(139,92,246,0.15)',  color: '#a78bfa' },
  esop:    { bg: 'rgba(99,102,241,0.15)',  color: '#818cf8' },
};

function getAssetLogo(asset) {
  const name   = (asset.name  || '').trim();
  const label  = (asset.label || '').trim();
  const type   = asset.type || 'stock';

  // 1. Chercher dans le mapping manuel par ticker exact
  const domain = TICKER_DOMAIN[name.toUpperCase()] || TICKER_DOMAIN[name];

  if (domain) {
    // Utilise Clearbit Logo API (gratuit, pas de clé requise)
    const logoUrl = `https://logo.clearbit.com/${domain}`;
    return `<div style="width:32px;height:32px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--surface2);display:flex;align-items:center;justify-content:center;">
      <img src="${logoUrl}" width="32" height="32" style="border-radius:50%;object-fit:cover;"
           onerror="this.parentElement.innerHTML=getAssetInitial('${label||name}','${type}')"
           loading="lazy"/>
    </div>`;
  }

  // 2. Fallback : initiale colorée
  return getAssetInitialEl(label || name, type);
}

function getAssetInitialEl(name, type) {
  const col   = TYPE_COLORS[type] || TYPE_COLORS.stock;
  const initials = name.trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase()||'').join('');
  return `<div style="width:32px;height:32px;border-radius:50%;flex-shrink:0;background:${col.bg};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${col.color};">${initials||'?'}</div>`;
}

function getAssetInitial(name, type) {
  // Version inline pour onerror handler
  const cols = {stock:'rgba(59,130,246,0.15)',crypto:'rgba(245,158,11,0.15)',etf:'rgba(34,197,94,0.15)',savings:'rgba(139,92,246,0.15)',esop:'rgba(99,102,241,0.15)'};
  const txts = {stock:'#60a5fa',crypto:'#fbbf24',etf:'#22c55e',savings:'#a78bfa',esop:'#818cf8'};
  const bg  = cols[type]||cols.stock;
  const col = txts[type]||txts.stock;
  const ini = (name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('');
  return `<div style="width:32px;height:32px;border-radius:50%;flex-shrink:0;background:${bg};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${col};">${ini||'?'}</div>`;
}

// ── SORT STATE ────────────────────────────────────────────────
let currentSort = 'val_desc';

function setSortFilter(sortKey) {
  currentSort = sortKey;
  // Update button states
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`sort_${sortKey}`)?.classList.add('active');
  renderPortfolio();
}

// ── RENDER PORTFOLIO ──────────────────────────────────────────
function renderPortfolio() {
  const { totalValue } = computeTotals();
  const srcFilter  = document.getElementById('filterSource')?.value  || 'all';
  const typeFilter = document.getElementById('filterType')?.value    || 'all';

  let filtered = assets.filter(a => {
    if (srcFilter  !== 'all' && a.source !== srcFilter)  return false;
    if (typeFilter !== 'all' && a.type   !== typeFilter)  return false;
    return true;
  });

  if (!filtered.length) {
    document.getElementById('portfolioTbody').innerHTML =
      `<tr><td colspan="11"><div class="empty-state"><div class="icon">📭</div><p>Aucun actif trouvé.</p></div></td></tr>`;
    document.getElementById('perfPodium').innerHTML = '';
    return;
  }

  // Helper : vrai P&L % depuis buyPrice ou perf.total
  function realPct(a) {
    if (a.buyPrice > 0 && a.currentPrice > 0) return (a.currentPrice - a.buyPrice) / a.buyPrice * 100;
    return (a.perf?.total || 0) * 100;
  }

  // Trier selon currentSort
  const sortFns = {
    val_desc:         (a,b) => ((b.qty||1)*(b.currentPrice||0)) - ((a.qty||1)*(a.currentPrice||0)),
    perf_day_desc:    (a,b) => (b.perf?.d1||0) - (a.perf?.d1||0),
    perf_day_asc:     (a,b) => (a.perf?.d1||0) - (b.perf?.d1||0),
    perf_week_desc:   (a,b) => (b.perf?.w1||0) - (a.perf?.w1||0),
    perf_week_asc:    (a,b) => (a.perf?.w1||0) - (b.perf?.w1||0),
    perf_month_desc:  (a,b) => (b.perf?.m1||0) - (a.perf?.m1||0),
    perf_month_asc:   (a,b) => (a.perf?.m1||0) - (b.perf?.m1||0),
    perf_ytd_desc:    (a,b) => (b.perf?.ytd||0) - (a.perf?.ytd||0),
    perf_ytd_asc:     (a,b) => (a.perf?.ytd||0) - (b.perf?.ytd||0),
    perf_total_desc:  (a,b) => realPct(b) - realPct(a),
    perf_total_asc:   (a,b) => realPct(a) - realPct(b),
  };

  filtered = [...filtered].sort(sortFns[currentSort] || sortFns.val_desc);

  // Activer le bon bouton
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`sort_${currentSort}`)?.classList.add('active');

  // ── PODIUM top 3 / pire 3 selon le tri actif ──
  const podiumEl = document.getElementById('perfPodium');
  if (podiumEl && currentSort !== 'val_desc') {
    const perfKey = currentSort.replace('_desc','').replace('_asc','').replace('perf_','');
    const keyMap = { day:'d1', week:'w1', month:'m1', ytd:'ytd', total:'total' };
    const pk = keyMap[perfKey] || 'total';
    const isDesc = currentSort.endsWith('_desc');

    const withPerf = [...assets].filter(a => a.perf?.[pk] !== undefined || pk === 'total');
    withPerf.sort((a,b) => pk==='total' ? realPct(b)-realPct(a) : (b.perf?.[pk]||0)-(a.perf?.[pk]||0));

    const top3   = withPerf.slice(0,3);
    const worst3 = withPerf.slice(-3).reverse();
    const medals = ['🥇','🥈','🥉'];

    podiumEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%">
        <div>
          <div class="text-xs color-muted" style="margin-bottom:6px;letter-spacing:1px;">🏆 TOP PERFORMANCES</div>
          ${top3.map((a,i) => {
            const v = pk==='total' ? realPct(a) : (a.perf?.[pk]||0)*100;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.12);border-radius:8px;margin-bottom:5px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span>${medals[i]}</span>
                <div>
                  <div style="font-size:12px;font-weight:500;">${a.label||a.name}</div>
                  <div style="font-size:10px;color:var(--muted);">${a.name}</div>
                </div>
              </div>
              <div style="font-size:13px;font-weight:600;color:#22c55e;">${v>=0?'+':''}${v.toFixed(2)}%</div>
            </div>`;
          }).join('')}
        </div>
        <div>
          <div class="text-xs color-muted" style="margin-bottom:6px;letter-spacing:1px;">📉 PIRES PERFORMANCES</div>
          ${worst3.map((a,i) => {
            const v = pk==='total' ? realPct(a) : (a.perf?.[pk]||0)*100;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.12);border-radius:8px;margin-bottom:5px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span>${['💀','😢','😞'][i]}</span>
                <div>
                  <div style="font-size:12px;font-weight:500;">${a.label||a.name}</div>
                  <div style="font-size:10px;color:var(--muted);">${a.name}</div>
                </div>
              </div>
              <div style="font-size:13px;font-weight:600;color:#ef4444;">${v>=0?'+':''}${v.toFixed(2)}%</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  } else if (podiumEl) {
    podiumEl.innerHTML = '';
  }

  // Helper perf cell
  function perfCell(val, isDecimal = true) {
    const v = isDecimal ? val * 100 : val;
    if (v === 0 || val === undefined || val === null) return '<td class="perf-zero">–</td>';
    const cls = v > 0 ? 'perf-pos' : 'perf-neg';
    return `<td class="${cls}">${v>0?'+':''}${v.toFixed(2)}%</td>`;
  }

  // Tableau
  const tbody = document.getElementById('portfolioTbody');
  tbody.innerHTML = filtered.map(a => {
    const val    = (a.qty||1) * (a.currentPrice||0);
    const inv    = (a.qty||1) * (a.buyPrice||a.currentPrice||0);
    const pnlA   = val - inv;
    const pnlP   = inv > 0 ? (pnlA/inv)*100 : 0;
    const weight = totalValue > 0 ? (val/totalValue)*100 : 0;
    const rp     = realPct(a);

    return `<tr style="cursor:pointer;" onclick="selectAsset('${a.name}')">
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          ${getAssetLogo(a)}
          <div>
            <div style="font-weight:500;font-size:13px;">${a.label||a.name}</div>
            <div style="font-size:10px;color:var(--muted);">${a.name} <span class="asset-badge badge-${a.type}" style="font-size:9px;">${a.type}</span></div>
          </div>
        </div>
      </td>
      <td><span class="badge badge-neutral" style="font-size:10px">${a.source||'–'}</span></td>
      <td class="fw-bold">${fmt(val)}</td>
      <td class="${colorClass(pnlA)}">${pnlA >= 0 ? '+' : ''}${fmt(pnlA)}</td>
      <td class="${pnlP>=0?'perf-pos':'perf-neg'}">${pnlP>=0?'+':''}${pnlP.toFixed(2)}%</td>
      ${perfCell(a.perf?.d1)}
      ${perfCell(a.perf?.w1)}
      ${perfCell(a.perf?.m1)}
      ${perfCell(a.perf?.ytd)}
      <td class="${rp>=0?'perf-pos':'perf-neg'}">${rp>=0?'+':''}${rp.toFixed(2)}%</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="progress-bar" style="width:50px;height:4px;">
            <div class="progress-fill" style="background:var(--accent);width:${Math.min(weight,100)}%"></div>
          </div>
          <span style="font-size:11px;color:var(--muted);">${weight.toFixed(1)}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── ADD ASSET ─────────────────────────────────────────────────
function addAsset() {
  const name = document.getElementById('assetName').value.trim();
  if (!name) { toast('Nom requis', 'var(--danger)'); return; }

  const asset = {
    id: Date.now(),
    name,
    type: document.getElementById('assetType').value,
    source: document.getElementById('assetSource').value,
    qty: parseFloat(document.getElementById('assetQty').value) || 1,
    buyPrice: parseFloat(document.getElementById('assetBuyPrice').value) || 0,
    currentPrice: parseFloat(document.getElementById('assetCurrentPrice').value) || 0,
    geo: document.getElementById('assetGeo').value,
    sector: document.getElementById('assetSector').value,
    currency: document.getElementById('assetCurrency').value,
    fees: parseFloat(document.getElementById('assetFees').value) || 0,
  };

  // Deduplicate: if same name + source, merge (Google Sheets + broker same ticker)
  const existIdx = assets.findIndex(a => a.name.toLowerCase() === name.toLowerCase() && a.source === asset.source);
  if (existIdx >= 0) {
    assets[existIdx] = asset;
    toast(`${name} mis à jour`);
  } else {
    assets.push(asset);
    toast(`${name} ajouté ✓`);
  }

  setData('assets', assets);
  closeModal('addAsset');
  renderPage('overview');
  // Clear form
  ['assetName','assetQty','assetBuyPrice','assetCurrentPrice','assetFees'].forEach(id => document.getElementById(id).value = '');
}

// ── RENDER SAVINGS ────────────────────────────────────────────
function renderSavings() {
  const total = savings.reduce((s, x) => s + (x.balance||0), 0);
  const interests = savings.reduce((s, x) => s + (x.balance||0)*(x.rate||0)/100, 0);
  const avgRate = total > 0 ? savings.reduce((s,x) => s + (x.balance||0)*(x.rate||0), 0) / total : 0;

  document.getElementById('savingsTotal').textContent = fmt(total);
  document.getElementById('savingsInterests').textContent = fmt(interests);
  document.getElementById('savingsAvgRate').textContent = `${avgRate.toFixed(2)}%`;

  const list = document.getElementById('savingsList');
  list.innerHTML = savings.map((s, i) => `
    <div class="fee-item">
      <div>
        <div class="fw-bold text-sm">${s.name}</div>
        <div class="text-xs color-muted">Taux: ${s.rate}% · Intérêts: ${fmt((s.balance||0)*(s.rate||0)/100)}/an</div>
      </div>
      <div style="text-align:right">
        <div class="fw-bold color-blue">${fmt(s.balance)}</div>
        <button class="btn btn-danger" style="font-size:11px;padding:2px 8px;margin-top:4px;" onclick="removeSavings(${i})">Suppr.</button>
      </div>
    </div>
  `).join('') || '<div class="empty-state"><div class="icon">🏦</div><p>Aucun livret ajouté</p></div>';

  if (savings.length) {
    makeDonut('chartSavings', savings.map(s => s.name), savings.map(s => s.balance || 0));
  }
}

function addSavings() {
  const name = document.getElementById('savName').value.trim();
  if (!name) return;
  savings.push({
    name,
    balance: parseFloat(document.getElementById('savBalance').value) || 0,
    rate: parseFloat(document.getElementById('savRate').value) || 0,
  });
  setData('savings', savings);
  closeModal('addSavings');
  renderSavings();
  toast('Livret ajouté ✓');
}

function removeSavings(i) {
  savings.splice(i, 1);
  setData('savings', savings);
  renderSavings();
}

// ── RENDER SALARY ─────────────────────────────────────────────
function renderSalary() {
  const totalExp = expenses.reduce((s, e) => s + (e.amount||0), 0);
  const net = salary.net || 0;
  const saved = salary.saved || 0;
  const aides = (salary.apl||0) + (salary.caf||0) + (salary.transport||0) + (salary.tr||0) + (salary.other||0) + (salary.abond||0);
  const totalRevenu = net + aides;
  const savRate = totalRevenu > 0 ? (saved/totalRevenu)*100 : 0;
  const available = totalRevenu - saved - totalExp;

  document.getElementById('grossDisplay').textContent = fmt(salary.gross || 0);
  document.getElementById('netDisplay').textContent = fmt(net);
  document.getElementById('interDisplay').textContent = fmt(salary.inter || 0);
  document.getElementById('partDisplay').textContent = fmt(salary.part || 0);
  document.getElementById('rateValBig').textContent = `${savRate.toFixed(0)}%`;
  document.getElementById('savedMonthly').textContent = fmt(saved);
  document.getElementById('fixedExp').textContent = fmt(totalExp);
  document.getElementById('available').textContent = fmt(Math.max(0, available));

  if (totalRevenu > 0) {
    document.getElementById('savedBar').style.width = `${Math.min((saved/totalRevenu)*100, 100)}%`;
    document.getElementById('fixedBar').style.width = `${Math.min((totalExp/totalRevenu)*100, 100)}%`;
    document.getElementById('availBar').style.width = `${Math.min((Math.max(0,available)/totalRevenu)*100, 100)}%`;
    document.getElementById('netBar').style.width = `${Math.min((net/(salary.gross||net))*100, 100)}%`;
  }

  // Aides section
  const aidesEl = document.getElementById('aidesDisplay');
  if (aidesEl) {
    if (aides > 0) {
      aidesEl.innerHTML = `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
          <div class="text-xs color-muted fw-bold" style="margin-bottom:8px;">🏛️ Aides & compléments</div>
          ${salary.apl > 0 ? `<div class="flex-between text-sm"><span class="color-muted">APL / Logement</span><span class="color-accent2">+${fmt(salary.apl)}/m</span></div>` : ''}
          ${salary.caf > 0 ? `<div class="flex-between text-sm"><span class="color-muted">CAF</span><span class="color-accent2">+${fmt(salary.caf)}/m</span></div>` : ''}
          ${salary.transport > 0 ? `<div class="flex-between text-sm"><span class="color-muted">Prime transport</span><span class="color-accent2">+${fmt(salary.transport)}/m</span></div>` : ''}
          ${salary.tr > 0 ? `<div class="flex-between text-sm"><span class="color-muted">Tickets restaurant</span><span class="color-accent2">+${fmt(salary.tr)}/m</span></div>` : ''}
          ${salary.abond > 0 ? `<div class="flex-between text-sm"><span class="color-muted">Abondement Airbus</span><span class="color-accent2">+${fmt(salary.abond)}/m</span></div>` : ''}
          ${salary.other > 0 ? `<div class="flex-between text-sm"><span class="color-muted">Autre</span><span class="color-accent2">+${fmt(salary.other)}/m</span></div>` : ''}
          <div class="flex-between text-sm fw-bold" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
            <span>Revenu total</span><span class="color-accent">${fmt(totalRevenu)}/mois</span>
          </div>
        </div>`;
    } else {
      aidesEl.innerHTML = '<div class="text-xs color-muted mt-8" style="margin-top:8px;">Ajoutez vos aides (APL, CAF…) via le bouton Modifier</div>';
    }
  }

  const expList = document.getElementById('expensesList');
  const catColors = { logement:'#60a5fa', transport:'#fbbf24', assurance:'#5af2c8', abonnement:'#a78bfa', alimentation:'#34d399', autre:'#9ca3af' };
  expList.innerHTML = expenses.map((e, i) => `
    <div class="fee-item">
      <div class="flex gap-8">
        <div class="fee-score" style="background:${catColors[e.category]||'#9ca3af'}"></div>
        <div>
          <div class="fw-bold text-sm">${e.label}</div>
          <div class="text-xs color-muted">${e.category}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="fw-bold color-danger">${fmt(e.amount)}</div>
        <button class="btn btn-danger" style="font-size:11px;padding:2px 8px;margin-top:4px;" onclick="removeExpense(${i})">Suppr.</button>
      </div>
    </div>
  `).join('') || '<div class="empty-state"><div class="icon">📦</div><p>Aucune dépense fixe</p></div>';
}

function estimateNet() {
  const gross = parseFloat(document.getElementById('salGross')?.value) || 0;
  const el = document.getElementById('netEstimate');
  if (!el || !gross) return;
  const est = Math.round(gross * 0.77);
  el.textContent = `Estimation Airbus : ~${est}€/mois`;
}

function saveSalary() {
  salary = {
    gross:     parseFloat(document.getElementById('salGross').value) || 0,
    net:       parseFloat(document.getElementById('salNet').value) || 0,
    inter:     parseFloat(document.getElementById('salInter').value) || 0,
    part:      parseFloat(document.getElementById('salPart').value) || 0,
    saved:     parseFloat(document.getElementById('salSaved').value) || 0,
    abond:     parseFloat(document.getElementById('salAbond').value) || 0,
    apl:       parseFloat(document.getElementById('salApl').value) || 0,
    caf:       parseFloat(document.getElementById('salCaf').value) || 0,
    transport: parseFloat(document.getElementById('salTransport').value) || 0,
    tr:        parseFloat(document.getElementById('salTr').value) || 0,
    other:     parseFloat(document.getElementById('salOther').value) || 0,
  };
  setData('salary', salary);
  closeModal('editSalary');
  renderSalary();
  toast('Informations salariales enregistrées ✓');
}

function addExpense() {
  const label = document.getElementById('expLabel').value.trim();
  if (!label) return;
  expenses.push({
    label,
    amount: parseFloat(document.getElementById('expAmount').value) || 0,
    category: document.getElementById('expCategory').value,
  });
  setData('expenses', expenses);
  closeModal('addExpense');
  renderSalary();
  toast('Dépense ajoutée ✓');
}

function removeExpense(i) {
  expenses.splice(i, 1);
  setData('expenses', expenses);
  renderSalary();
}

// ── PROJECTION DCA ────────────────────────────────────────────
let projChart = null;

function updateProjection() {
  const start  = parseFloat(document.getElementById('projStartCapital')?.value) || 0;
  const monthly = parseFloat(document.getElementById('projMonthly')?.value) || 500;
  const rate   = parseFloat(document.getElementById('projRate')?.value) || 8;
  const years  = parseInt(document.getElementById('projYears')?.value) || 20;

  const monthRate = rate / 100 / 12;
  const months = years * 12;

  const labelsYear = [];
  const withDCA = [];
  const withoutDCA = [];
  const invested = [];

  let val = start;
  let valSimple = start;
  let totalInv = start;

  for (let m = 0; m <= months; m++) {
    if (m % 12 === 0 || m === months) {
      labelsYear.push(m === 0 ? 'Auj.' : `+${m/12}a`);
      withDCA.push(Math.round(val));
      withoutDCA.push(Math.round(valSimple));
      invested.push(Math.round(totalInv));
    }
    if (m < months) {
      val = (val + monthly) * (1 + monthRate);
      valSimple = valSimple * (1 + monthRate);
      totalInv += monthly;
    }
  }

  const finalVal = withDCA[withDCA.length - 1];
  const finalInv = invested[invested.length - 1];
  const gains = finalVal - finalInv;

  document.getElementById('projectedValue').textContent = fmt(finalVal);
  document.getElementById('projectedGains').textContent = `+${fmt(gains)} (×${(finalVal/Math.max(finalInv,1)).toFixed(2)})`;
  document.getElementById('projectionMeta').textContent = `DCA ${fmt(monthly)}/mois · ${rate}%/an · ${years} ans`;

  makeLine('chartProjection', labelsYear, [
    { label: 'Avec DCA', data: withDCA, borderColor: '#c8f25a', backgroundColor: 'rgba(200,242,90,0.08)', tension: 0.4, fill: true, pointRadius: 0, borderWidth: 2 },
    { label: 'Sans DCA', data: withoutDCA, borderColor: '#6b7280', backgroundColor: 'transparent', tension: 0.4, fill: false, pointRadius: 0, borderWidth: 1.5, borderDash: [4,4] },
    { label: 'Capital investi', data: invested, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.05)', tension: 0, fill: true, pointRadius: 0, borderWidth: 1.5 },
  ]);

  // Milestones
  const milestones = [10000, 50000, 100000, 250000, 500000, 1000000];
  const msEl = document.getElementById('milestones');
  msEl.innerHTML = milestones.map(ms => {
    let reached = null;
    let v = start, m = 0;
    while (v < ms && m <= 600) { v = (v + monthly) * (1 + monthRate); m++; }
    if (m <= months) reached = m;
    return `<div class="kpi-card" style="flex:1;min-width:140px;padding:16px;">
      <div class="kpi-label">${fmt(ms)}</div>
      <div class="kpi-value" style="font-size:20px; ${reached ? 'color:var(--accent)' : 'color:var(--muted)'}">${reached ? `${Math.floor(reached/12)}a ${reached%12}m` : '> horizon'}</div>
      <div class="text-xs color-muted">${reached ? 'pour atteindre ce seuil' : 'hors de portée'}</div>
    </div>`;
  }).join('');
}

// ── ANALYSIS ──────────────────────────────────────────────────
const GEO_LABELS = { us:'États-Unis', eu:'Europe', fr:'France', em:'Émergents', world:'Monde', other:'Autre' };
const SECTOR_LABELS = { tech:'Tech', finance:'Finance', health:'Santé', consumer:'Conso', energy:'Énergie', industry:'Industrie', real_estate:'Immobilier', crypto:'Crypto', mixed:'Mixte' };
const CURRENCY_LABELS = { EUR:'EUR', USD:'USD', GBP:'GBP' };

function renderAnalysis() {
  const total = assets.reduce((s, a) => s + (a.qty||1)*(a.currentPrice||0), 0);
  if (!total) {
    ['chartGeo','chartSector','chartCurrency'].forEach(id => {
      const c = document.getElementById(id);
      if (c) c.parentElement.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>Ajoutez des actifs</p></div>';
    });
    return;
  }

  const geo = {}, sector = {}, currency = {};
  assets.forEach(a => {
    const val = (a.qty||1)*(a.currentPrice||0);
    geo[a.geo||'other'] = (geo[a.geo||'other']||0) + val;
    sector[a.sector||'mixed'] = (sector[a.sector||'mixed']||0) + val;
    currency[a.currency||'EUR'] = (currency[a.currency||'EUR']||0) + val;
  });

  makeDonut('chartGeo', Object.keys(geo).map(k=>GEO_LABELS[k]||k), Object.values(geo));
  makeDonut('chartSector', Object.keys(sector).map(k=>SECTOR_LABELS[k]||k), Object.values(sector));
  makeDonut('chartCurrency', Object.keys(currency).map(k=>CURRENCY_LABELS[k]||k), Object.values(currency));

  // Concentration alerts
  const threshold = settings.exposureThreshold || 20;
  const alerts = [];
  Object.entries(geo).forEach(([k, v]) => {
    const pctV = (v/total)*100;
    if (pctV > threshold) alerts.push({ type: 'Géo', label: GEO_LABELS[k]||k, pct: pctV });
  });
  Object.entries(sector).forEach(([k, v]) => {
    const pctV = (v/total)*100;
    if (pctV > threshold) alerts.push({ type: 'Secteur', label: SECTOR_LABELS[k]||k, pct: pctV });
  });

  const alertEl = document.getElementById('concentrationAlerts');
  if (!alerts.length) {
    alertEl.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>Aucune surexposition détectée (seuil: ' + threshold + '%)</p></div>';
  } else {
    alertEl.innerHTML = alerts.map(al => `
      <div class="fee-item">
        <div class="flex gap-8">
          <div class="fee-score" style="background:var(--gold)"></div>
          <div>
            <div class="fw-bold text-sm">${al.type}: ${al.label}</div>
            <div class="text-xs color-muted">Surexposé (>${threshold}%)</div>
          </div>
        </div>
        <div class="badge" style="background:rgba(251,191,36,0.15);color:var(--gold);font-size:12px;">${al.pct.toFixed(1)}%</div>
      </div>
    `).join('');
  }
}

// ── FEES SCANNER ──────────────────────────────────────────────
const PLATFORM_FEES = {
  binance: { label: 'Binance', fee: 0.1, score: 9 },
  tr: { label: 'Trade Republic', fee: 0, score: 10 },
  crypto: { label: 'Crypto.com', fee: 0.4, score: 7 },
  sheets: { label: 'Google Sheets (Manuel)', fee: 0, score: 10 },
  manual: { label: 'Manuel', fee: 0, score: 10 },
};

function renderFees() {
  const total = assets.reduce((s, a) => s + (a.qty||1)*(a.currentPrice||0), 0);

  let totalFees = 0;
  const bySource = {};
  assets.forEach(a => {
    const val = (a.qty||1)*(a.currentPrice||0);
    const feeAmt = val * (a.fees||0) / 100;
    totalFees += feeAmt;
    bySource[a.source||'manual'] = (bySource[a.source||'manual']||0) + feeAmt;
  });

  // avg score
  const avgScore = assets.length ? assets.reduce((s,a) => s + ((PLATFORM_FEES[a.source]?.score)||8), 0) / assets.length : 0;
  const impact20 = totalFees * 20 * 1.5; // rough opportunity cost

  document.getElementById('feeTotal').textContent = `${fmt(totalFees)}/an`;
  document.getElementById('feeImpact').textContent = fmt(impact20);
  document.getElementById('feeScore').textContent = `${avgScore.toFixed(1)}/10`;

  const breakdown = document.getElementById('feesBreakdown');
  if (!Object.keys(bySource).length) {
    breakdown.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>Ajoutez des actifs pour analyser les frais</p></div>';
    return;
  }

  breakdown.innerHTML = Object.entries(bySource).map(([src, fees]) => {
    const pf = PLATFORM_FEES[src] || { label: src, score: 7 };
    const scoreColor = pf.score >= 9 ? 'var(--accent)' : pf.score >= 7 ? 'var(--gold)' : 'var(--danger)';
    return `<div class="fee-item">
      <div class="flex gap-8">
        <div class="fee-score" style="background:${scoreColor}"></div>
        <div>
          <div class="fw-bold text-sm">${pf.label}</div>
          <div class="text-xs color-muted">Score: ${pf.score}/10</div>
        </div>
      </div>
      <div class="text-sm" style="text-align:right;">
        <div class="color-danger fw-bold">${fmt(fees)}/an</div>
        <div class="text-xs color-muted">Impact 20a: ~${fmt(fees*20*1.5)}</div>
      </div>
    </div>`;
  }).join('');
}

// ── SOURCES PAGE ──────────────────────────────────────────────
function renderSourcesPage() {
  const srcs = getData('sources', {});

  // Compter les actifs par source
  const countBySrc = {};
  assets.forEach(a => { countBySrc[a.source] = (countBySrc[a.source]||0) + 1; });

  // Badges + boutons supprimer
  const srcConfig = {
    sheets:  { elId: 'sheetsStatus',  label: 'Google Sheets' },
    binance: { elId: 'binanceStatus', label: 'Binance' },
    crypto:  { elId: 'cryptoStatus',  label: 'Crypto.com' },
    tr:      { elId: 'trStatus',      label: 'Trade Republic' },
  };

  Object.entries(srcConfig).forEach(([src, cfg]) => {
    const el = document.getElementById(cfg.elId);
    if (!el) return;
    const connected = !!srcs[src];
    const count = countBySrc[src] || 0;
    el.className = connected ? 'badge badge-up' : 'badge badge-neutral';
    el.textContent = connected ? `Connecté (${count} actifs)` : 'Non connecté';
  });

  // Boutons "Supprimer import" — ajouter/mettre à jour dans chaque panel
  ['sheets','binance','crypto','tr'].forEach(src => {
    const btnId = `deleteImport_${src}`;
    let btn = document.getElementById(btnId);
    const container = document.getElementById(`deleteContainer_${src}`);
    if (!container) return;
    if (srcs[src] && countBySrc[src]) {
      container.innerHTML = `<button class="btn btn-danger" style="font-size:11px;padding:6px 14px;margin-top:8px;" onclick="deleteImport('${src}')">🗑️ Supprimer cet import (${countBySrc[src]} actifs)</button>`;
    } else {
      container.innerHTML = '';
    }
  });

  // Pré-remplir clé API et URL sauvegardées
  const savedKey = getData('sheets_api_key', '');
  const savedUrl = getData('sheets_url', '');
  const keyEl = document.getElementById('sheetsApiKey');
  const urlEl = document.getElementById('sheetsUrl');
  if (keyEl && savedKey) keyEl.value = savedKey;
  if (urlEl && savedUrl) urlEl.value = savedUrl;
  if (savedUrl) updateSheetDetection(savedUrl);

  // Pré-remplir soldes Binance
  const binanceManualEl = document.getElementById('binanceManual');
  const savedBinanceManual = getData('binance_manual', '');
  if (binanceManualEl && savedBinanceManual) binanceManualEl.value = savedBinanceManual;

  // Actifs manuels
  const manEl = document.getElementById('manualAssetsList');
  if (!manEl) return;
  const manual = assets.filter(a => a.source === 'manual');
  manEl.innerHTML = manual.map(a => `
    <div class="fee-item">
      <div class="asset-name">${a.name} <span class="asset-badge badge-${a.type}">${a.type}</span></div>
      <div style="text-align:right">
        <div class="fw-bold">${fmt((a.qty||1)*(a.currentPrice||0))}</div>
        <button class="btn btn-danger" style="font-size:11px;padding:2px 8px;margin-top:4px;" onclick="removeAsset(${a.id})">Suppr.</button>
      </div>
    </div>
  `).join('') || '<div class="empty-state"><div class="icon">✏️</div><p>Aucun actif manuel</p></div>';
}

// ── SUPPRIMER UN IMPORT ───────────────────────────────────────
function deleteImport(src) {
  const srcLabels = { sheets:'Google Sheets', binance:'Binance', crypto:'Crypto.com', tr:'Trade Republic' };
  const count = assets.filter(a => a.source === src).length;
  if (!confirm(`Supprimer les ${count} actifs importés depuis ${srcLabels[src]} ?`)) return;

  assets = assets.filter(a => a.source !== src);
  setData('assets', assets);

  const srcs = getData('sources', {});
  delete srcs[src];
  setData('sources', srcs);
  sources = srcs;

  // Supprimer aussi les clés sauvegardées si besoin
  if (src === 'sheets') { setData('sheets_api_key', ''); setData('sheets_url', ''); }
  if (src === 'binance') { setData('binance_key', ''); setData('binance_secret', ''); setData('binance_manual', ''); }

  toast(`Import ${srcLabels[src]} supprimé`, 'var(--gold)');
  renderSourcesPage();
  renderPage('overview');
}

function removeAsset(id) {
  assets = assets.filter(a => a.id !== id);
  setData('assets', assets);
  renderSourcesPage();
  toast('Actif supprimé');
}

// ── CONNECT SHEETS ────────────────────────────────────────────
async function connectSheets() {
  const apiKey = document.getElementById('sheetsApiKey').value.trim();
  const url    = document.getElementById('sheetsUrl').value.trim();

  if (!apiKey) { toast('Clé API Google requise (AIza...)', 'var(--danger)'); return; }
  if (!url)    { toast('URL du Google Sheet requise', 'var(--danger)'); return; }
  if (!apiKey.startsWith('AIza')) { toast('Clé API invalide — doit commencer par AIza', 'var(--danger)'); return; }

  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) { toast('URL du Sheet invalide', 'var(--danger)'); return; }

  // Sauvegarder la clé et l'URL par utilisateur (localStorage, jamais envoyé à un serveur)
  setData('sheets_api_key', apiKey);
  setData('sheets_url', url);

  const sheetId = match[1];
  toast('Import en cours…', 'var(--accent2)');

  // Détecter si c'est le DASHBOARD (structure connue) ou un sheet générique
  const isDashboard = url.includes('1_IRTIWy_g3qDLPQj2WY7AqgqRR6NCoRA8sh6IYXZxn8');
  if (isDashboard) {
    await importDashboard(sheetId, apiKey);
  } else {
    await importGenericSheet(sheetId, apiKey);
  }
}

// ── IMPORT DASHBOARD ──────────────────────────────────────────
async function importDashboard(sheetId, apiKey) {
  let count = 0;

  // Vider les actifs sheets existants avant réimport
  assets = assets.filter(a => a.source !== 'sheets');

  const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values`;
  const OPT  = `?key=${encodeURIComponent(apiKey)}&valueRenderOption=FORMATTED_VALUE`;

  function pn(v) {
    if (v === undefined || v === null || v === '') return 0;
    const s = v.toString().replace(/\s/g,'').replace(',','.').replace('%','').replace('€','');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function cl(v) { return v ? v.toString().trim() : ''; }

  const geoMap = { 'USA':'us', 'Europe':'eu', 'Emergent':'em', 'Monde':'world', 'France':'fr' };
  function sectorFromStr(s) {
    if (!s) return 'mixed';
    const sl = s.toLowerCase();
    if (sl.includes('tech') || sl.includes('ia')) return 'tech';
    if (sl.includes('energ')) return 'energy';
    if (sl.includes('aéro') || sl.includes('indu')) return 'industry';
    if (sl.includes('auto')) return 'consumer';
    return 'mixed';
  }

  try {
    const [ctoR, cryR, airR, divR] = await Promise.all([
      fetch(`${BASE}/${encodeURIComponent('CTO!A2:P30')}${OPT}`).then(r=>r.json()),
      fetch(`${BASE}/${encodeURIComponent('Crypto!A2:K20')}${OPT}`).then(r=>r.json()).catch(()=>({values:[]})),
      fetch(`${BASE}/${encodeURIComponent('AIRBUS!A2:M20')}${OPT}`).then(r=>r.json()).catch(()=>({values:[]})),
      fetch(`${BASE}/${encodeURIComponent('Suivi CTO 2026!I2:L30')}${OPT}`).then(r=>r.json()).catch(()=>({values:[]})),
    ]);

    if (ctoR.error) throw new Error('Erreur API: ' + (ctoR.error.message || JSON.stringify(ctoR.error)));

    // ── CTO ──
    (ctoR.values || []).forEach(row => {
      const ticker = cl(row[0]);
      const nom    = cl(row[1]);
      if (!ticker || !nom || nom === 'TOTAL') return;
      if (ticker === 'EPA:AIR') return; // doublon des PEG

      const qty      = pn(row[2]);
      const pru      = pn(row[3]);
      const prix     = pn(row[4]) > 0 ? pn(row[4]) : pru;
      const perf1j   = pn(row[7]);
      const perfHeb  = pn(row[8]);
      const perf1m   = pn(row[9]);
      const perfYtd  = pn(row[11]);
      const perfGlob = pn(row[12]);
      const cat      = cl(row[13]) || 'Actions';
      const sect     = cl(row[14]);
      const geo      = cl(row[15]) || 'Monde';
      const type = cat.toLowerCase().includes('etf') ? 'stock' : cat.toLowerCase() === 'or' ? 'savings' : 'stock';

      assets.push({ id: Date.now()+Math.random(), name: ticker, label: nom, qty,
        buyPrice: pru, currentPrice: prix,
        perf: { d1:perf1j, w1:perfHeb, m1:perf1m, ytd:perfYtd, total:perfGlob },
        source:'sheets', type, geo: geoMap[geo]||'world', sector: sectorFromStr(sect),
        currency:'EUR', fees: cat==='Or'?0.12:cat==='ETFs'?0.2:0 });
      count++;
    });

    // ── CRYPTO ──
    (cryR.values || []).forEach(row => {
      const ticker = cl(row[0]).toUpperCase();
      const nom    = cl(row[1]);
      if (!ticker || !nom || nom === 'TOTAL') return;
      const qty = pn(row[2]), pru = pn(row[3]);
      const prix = pn(row[4]) > 0 ? pn(row[4]) : pru;
      assets.push({ id: Date.now()+Math.random(), name: ticker, label: nom, qty,
        buyPrice: pru, currentPrice: prix, perf: { total: pn(row[7]) },
        source:'sheets', type:'crypto', geo:'other',
        sector: cl(row[9]).toLowerCase().includes('ia')?'tech':'crypto',
        currency:'EUR', fees:0.4 });
      count++;
    });

    // ── AIRBUS — PEG fusionné + PERCOL séparé ──
    let pegInv=0, pegVal=0, pegQty=0;
    const percolRows=[];
    (airR.values || []).forEach(row => {
      const env = cl(row[1]), nom = cl(row[2]);
      if (!env || !nom || nom.toLowerCase().includes('total')) return;
      const inv=pn(row[3]), qty=pn(row[7]), pru=pn(row[9]), cours=pn(row[10]), valTot=pn(row[11]), perf=pn(row[12]);
      if (valTot===0 && qty===0) return;
      if (env.toUpperCase()==='PEG') { pegInv+=inv; pegVal+=valTot; pegQty+=qty; }
      else if (env.toUpperCase()==='PERCOL') { percolRows.push({nom,qty,pru,cours,valTot,perf}); }
    });

    if (pegVal>0 || pegQty>0) {
      const avgPrice = pegQty>0 ? pegVal/pegQty : 0;
      const avgPru   = pegQty>0 ? pegInv/pegQty : 0;
      assets.push({ id: Date.now()+Math.random(), name:'EPA:AIR (PEG)', label:'Airbus ESOP + Intéressement',
        qty:pegQty, buyPrice:avgPru, currentPrice:avgPrice,
        perf:{ total: pegInv>0?(pegVal-pegInv)/pegInv:0 },
        source:'sheets', type:'esop', geo:'eu', sector:'industry', currency:'EUR', fees:0.5 });
      count++;
    }
    percolRows.forEach(r => {
      const price = r.cours>0 ? r.cours : (r.qty>0 ? r.valTot/r.qty : 0);
      assets.push({ id: Date.now()+Math.random(), name:`${r.nom} (PERCOL)`, label:r.nom,
        qty:r.qty, buyPrice:r.pru, currentPrice:price, perf:{total:r.perf},
        source:'sheets', type:'esop', geo:'eu', sector:'industry', currency:'EUR', fees:0.5 });
      count++;
    });

    // ── DIVIDENDES ──
    const dividends=[];
    (divR.values || []).forEach(row => {
      const societe = cl(row[1]);
      if (!societe || societe==='Société' || societe==='Total') return;
      dividends.push({ date:cl(row[0]), company:societe, amount:pn(row[2]), perShare:pn(row[3]) });
    });
    setData('dividends', dividends);

    // ── HISTORIQUE RÉEL depuis Suivi CTO 2026 + Suivi Crypto + Suivi Airbus ──
    const [histCTOR, histCryR, histAirR] = await Promise.all([
      fetch(`${BASE}/${encodeURIComponent('Suivi CTO 2026!A2:F13')}${OPT}`).then(r=>r.json()).catch(()=>({values:[]})),
      fetch(`${BASE}/${encodeURIComponent('Suivi Crypto!A2:F13')}${OPT}`).then(r=>r.json()).catch(()=>({values:[]})),
      fetch(`${BASE}/${encodeURIComponent('Suivi Airbus !A2:F5')}${OPT}`).then(r=>r.json()).catch(()=>({values:[]})),
    ]);

    // Construire l'historique global = CTO + Crypto + Airbus par date
    const histMap = {};

    const addToHist = (rows, category) => {
      (rows.values || []).forEach(row => {
        const dateRaw = cl(row[0]);
        const valeur  = pn(row[2]); // Valeur Totale colonne C
        if (!dateRaw || valeur <= 0) return;
        // Normaliser la date
        let dateStr = dateRaw;
        try {
          const d = new Date(dateRaw);
          if (!isNaN(d)) dateStr = d.toISOString().slice(0, 10);
        } catch(e) {}
        if (!histMap[dateStr]) histMap[dateStr] = { cto: 0, crypto: 0, airbus: 0 };
        histMap[dateStr][category] = valeur;
      });
    };

    addToHist(histCTOR, 'cto');
    addToHist(histCryR, 'crypto');
    addToHist(histAirR, 'airbus');

    // Créer l'historique global consolidé
    const existingHistory = getData('history', []);
    const newHistory = [];

    Object.entries(histMap).sort(([a],[b]) => a.localeCompare(b)).forEach(([date, vals]) => {
      const total = Math.round((vals.cto || 0) + (vals.crypto || 0) + (vals.airbus || 0));
      if (total <= 0) return;
      // Ne pas écraser un snapshot plus récent du même jour
      const existing = existingHistory.find(h => h.date === date);
      newHistory.push({ date, total, bySource: vals });
    });

    // Fusionner avec l'historique existant (conserver les snapshots automatiques)
    const mergedHistory = [...newHistory];
    existingHistory.forEach(h => {
      if (!mergedHistory.find(m => m.date === h.date)) {
        mergedHistory.push(h);
      }
    });
    mergedHistory.sort((a,b) => a.date.localeCompare(b.date));
    setData('history', mergedHistory);

    // ── SAVE ──
    setData('assets', assets);
    const srcs = getData('sources', {}); srcs.sheets = true; setData('sources', srcs); sources = srcs;
    document.getElementById('lastUpdate').textContent = `Mis à jour: ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`;
    toast(`✓ ${count} actifs + ${mergedHistory.length} points historique importés`, 'var(--accent)');
    renderSourcesPage();
    renderPage('overview');

  } catch(err) {
    toast('Erreur: ' + err.message, 'var(--danger)');
    console.error(err);
  }
}

// ── IMPORT GÉNÉRIQUE (autre Google Sheet) ─────────────────────
async function importGenericSheet(sheetId) {
  const range = document.getElementById('sheetsRange').value || 'Sheet1';
  const colName = document.getElementById('colName').value || 'A';
  const colQty  = document.getElementById('colQty').value || 'B';
  const colBuy  = document.getElementById('colBuy').value || 'C';
  const colVal  = document.getElementById('colVal').value || 'D';
  const colToIdx = c => c.toUpperCase().charCodeAt(0) - 65;

  const apiUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&range=${range}`;
  try {
    const resp = await fetch(apiUrl);
    const text = await resp.text();
    const json = JSON.parse(text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)[1]);
    const rows = json.table.rows;
    const ni = colToIdx(colName), qi = colToIdx(colQty), bi = colToIdx(colBuy), vi = colToIdx(colVal);
    let count = 0;
    rows.forEach(row => {
      const cells = row.c || [];
      const name = cells[ni]?.v?.toString()?.trim();
      if (!name || ['Nom','Name','Actif','Ticker'].includes(name)) return;
      const qty = parseFloat(cells[qi]?.v) || 1;
      const buy = parseFloat(cells[bi]?.v) || 0;
      const curV = parseFloat(cells[vi]?.v) || 0;
      const currentPrice = qty > 0 ? curV / qty : curV;
      const asset = { id: Date.now() + Math.random(), name, qty, buyPrice: buy, currentPrice, source: 'sheets', type: 'stock', geo: 'world', sector: 'mixed', currency: 'EUR', fees: 0 };
      const ei = assets.findIndex(a => a.name.toLowerCase() === name.toLowerCase() && a.source === 'sheets');
      if (ei >= 0) assets[ei] = asset; else assets.push(asset);
      count++;
    });
    setData('assets', assets);
    const srcs = getData('sources', {}); srcs.sheets = true; setData('sources', srcs);
    toast(`${count} actifs importés ✓`, 'var(--accent)');
    renderSourcesPage();
  } catch (e) {
    toast('Erreur: vérifiez que le Sheet est public', 'var(--danger)');
    console.error(e);
  }
}

// ── CONNECT BINANCE ─────────────────────────────────────────
// Binance API via clé API (lecture seule)
// Note: CORS bloque l'API Binance directe depuis un navigateur.
// On utilise un proxy public CoinGecko pour les prix + saisie manuelle des soldes
async function connectBinance() {
  const apiKey    = document.getElementById('binanceApiKey')?.value.trim();
  const apiSecret = document.getElementById('binanceApiSecret')?.value.trim();

  if (!apiKey) { toast('Clé API Binance requise', 'var(--danger)'); return; }

  // Sauvegarder les clés (chiffrées basiquement)
  const xor = s => btoa([...s].map((c,i) => String.fromCharCode(c.charCodeAt(0)^(72+i%8))).join(''));
  setData('binance_key', xor(apiKey));
  if (apiSecret) setData('binance_secret', xor(apiSecret));

  // Récupérer les soldes via saisie manuelle (CORS empêche l'API Binance directe)
  const manual = document.getElementById('binanceManual')?.value.trim();
  if (!manual) {
    toast('Clés sauvegardées. Renseignez vos soldes manuellement ci-dessous.', 'var(--gold)');
    renderSourcesPage();
    return;
  }

  // Parser "BTC:0.5, ETH:2.3" + récupérer les prix via CoinGecko (pas de CORS)
  const pairs = manual.split(',').map(s => s.trim()).filter(Boolean);
  const symbols = pairs.map(p => p.split(':')[0].trim().toUpperCase());

  toast('Récupération des prix en cours…', 'var(--accent2)');

  // Map CoinGecko IDs
  const cgMap = {
    BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', SOL:'solana',
    ADA:'cardano', DOT:'polkadot', LINK:'chainlink', NEAR:'near',
    TAO:'bittensor', CRO:'crypto-com-chain', USDT:'tether', USDC:'usd-coin',
    XRP:'ripple', DOGE:'dogecoin', AVAX:'avalanche-2', MATIC:'matic-network'
  };

  let prices = {};
  try {
    const ids = symbols.map(s => cgMap[s]).filter(Boolean).join(',');
    if (ids) {
      const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur`);
      const data = await resp.json();
      symbols.forEach(sym => {
        const cgId = cgMap[sym];
        if (cgId && data[cgId]) prices[sym] = data[cgId].eur;
      });
    }
  } catch(e) {
    console.warn('CoinGecko unavailable, using estimates');
  }

  // Prix de secours si CoinGecko indisponible
  const fallback = { BTC:60000, ETH:2200, BNB:380, SOL:130, ADA:0.4, DOT:5, LINK:7, NEAR:3, TAO:140, CRO:0.07 };

  let count = 0;
  pairs.forEach(p => {
    const [sym, qtyStr] = p.split(':').map(s => s.trim());
    if (!sym || !qtyStr) return;
    const symbol = sym.toUpperCase();
    const qty = parseFloat(qtyStr) || 0;
    if (qty === 0) return;

    const price = prices[symbol] || fallback[symbol] || 1;

    // Supprimer entrée Sheet pour ce crypto
    assets = assets.filter(a => !(a.name === symbol && a.source === 'sheets' && a.type === 'crypto'));
    assets = assets.filter(a => !(a.name === symbol && a.source === 'binance'));

    assets.push({
      id: Date.now() + Math.random(),
      name: symbol, label: symbol,
      qty, buyPrice: 0, currentPrice: price,
      source: 'binance', type: 'crypto',
      geo: 'other', sector: 'crypto',
      currency: 'EUR', fees: 0.1
    });
    count++;
  });

  setData('assets', assets);
  const srcs = getData('sources', {}); srcs.binance = true; setData('sources', srcs); sources = srcs;
  toast(`✓ ${count} cryptos Binance importés avec prix temps réel`, 'var(--accent)');
  renderSourcesPage();
  renderPage('overview');
}

// ── CONNECT CRYPTO.COM ────────────────────────────────────────
// Crypto.com = priorité sur le Sheet pour les cryptos présents ici
function connectCrypto() {
  function applyCryptoAsset(symbol, qty, price, source) {
    if (!symbol || qty === 0) return;
    // Supprimer l'entrée Sheet pour ce crypto (Binance/Crypto.com ont la priorité)
    assets = assets.filter(a => !(a.name === symbol && a.source === 'sheets' && a.type === 'crypto'));
    // Supprimer doublon même source
    assets = assets.filter(a => !(a.name === symbol && a.source === source));
    assets.push({
      id: Date.now() + Math.random(),
      name: symbol, label: symbol,
      qty, buyPrice: 0, currentPrice: price,
      source, type: 'crypto',
      geo: 'other', sector: 'crypto',
      currency: 'EUR', fees: 0.4
    });
  }

  // Saisie manuelle "BTC:0.5, ETH:2.3"
  const manual = document.getElementById('cryptoManual')?.value.trim();
  if (manual) {
    const priceEstimates = { BTC:64000, ETH:2300, CRO:0.07, BNB:400, SOL:140, ADA:0.4, DOT:5, LINK:7, NEAR:3, TAO:150 };
    manual.split(',').forEach(p => {
      const [sym, qty] = p.trim().split(':');
      if (!sym || !qty) return;
      const symbol = sym.trim().toUpperCase();
      applyCryptoAsset(symbol, parseFloat(qty)||0, priceEstimates[symbol]||1, 'crypto');
    });
    setData('assets', assets);
    const srcs = getData('sources', {}); srcs.crypto = true; setData('sources', srcs); sources = srcs;
    toast('Crypto.com importé manuellement ✓', 'var(--accent)');
    renderSourcesPage(); renderPage('overview');
  }

  // Import fichier CSV/JSON
  const fileInput = document.getElementById('cryptoFile');
  if (fileInput?.files.length) {
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = e => {
      try {
        let count = 0;
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(e.target.result);
          (Array.isArray(data) ? data : data.assets || []).forEach(item => {
            const symbol = (item.currency || item.symbol || '').toUpperCase();
            applyCryptoAsset(symbol, parseFloat(item.amount||item.balance||0), parseFloat(item.price||0), 'crypto');
            count++;
          });
        } else {
          // CSV
          const lines = e.target.result.split('\n').filter(l => l.trim());
          const sep = lines[0].includes(';') ? ';' : ',';
          lines.slice(1).forEach(line => {
            const cols = line.split(sep).map(c => c.trim().replace(/"/g,''));
            const symbol = (cols[0]||'').toUpperCase();
            const qty    = parseFloat(cols[1]||'0') || 0;
            const price  = parseFloat(cols[2]||'0') || 0;
            applyCryptoAsset(symbol, qty, price, 'crypto');
            count++;
          });
        }
        setData('assets', assets);
        const srcs = getData('sources', {}); srcs.crypto = true; setData('sources', srcs); sources = srcs;
        toast(`✓ ${count} cryptos Crypto.com importés`, 'var(--accent)');
        renderSourcesPage(); renderPage('overview');
      } catch(err) { toast('Erreur fichier: ' + err.message, 'var(--danger)'); }
    };
    reader.readAsText(file);
  }
}

// ── CONNECT TRADE REPUBLIC ────────────────────────────────────
// TR = import PDF du relevé de portefeuille
async function connectTR() {
  const fileInput = document.getElementById('trFile');
  if (!fileInput || !fileInput.files.length) {
    toast('Sélectionne un PDF Trade Republic', 'var(--danger)');
    return;
  }

  const file = fileInput.files[0];

  // Si c'est un CSV on garde la logique CSV
  if (file.name.endsWith('.csv')) {
    return connectTR_CSV(file);
  }

  // PDF → utiliser pdf.js pour extraire le texte
  toast('Lecture du PDF en cours…', 'var(--accent2)');

  try {
    // Charger pdf.js dynamiquement
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str).join(' ') + '\n';
    }

    // Parser le texte extrait du PDF Trade Republic
    const assets_found = parseTRPdfText(fullText);

    if (!assets_found.length) {
      toast('Aucun actif trouvé dans le PDF. Essayez le format CSV.', 'var(--gold)');
      return;
    }

    // Appliquer les actifs trouvés
    assets_found.forEach(a => {
      assets = assets.filter(x => !(x.source === 'tr' && x.name === a.name));
      assets = assets.filter(x => !(x.source === 'sheets' && x.type !== 'crypto' && x.type !== 'esop' &&
        x.name.toLowerCase() === a.name.toLowerCase()));
      assets.push(a);
    });

    setData('assets', assets);
    const srcs = getData('sources', {}); srcs.tr = true; setData('sources', srcs); sources = srcs;
    toast(`✓ ${assets_found.length} positions TR importées depuis le PDF`, 'var(--accent)');
    renderSourcesPage();
    renderPage('overview');

  } catch(err) {
    toast('Erreur PDF: ' + err.message + ' — Essayez le format CSV', 'var(--danger)');
    console.error(err);
  }
}

function parseTRPdfText(text) {
  const found = [];

  // Nettoyer le texte : remplacer les retours à la ligne multiples par un espace
  // Le PDF TR a le format : "QTY titre(s) NOM ISIN : XXXXXXXX PRIX DATE VALEUR"
  const cleaned = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ');

  // Noms courts pour affichage
  const nameShortMap = {
    'CNE100000296': 'BYD Co. Ltd.',
    'FR0000120073': 'Air Liquide',
    'FR0000120271': 'TotalEnergies',
    'IE000BI8OT95': 'Amundi MSCI World',
    'IE00B4K48X80': 'iShares MSCI Europe',
    'IE00B4ND3602': 'iShares Physical Gold',
    'IE00B53SZB19': 'iShares Nasdaq 100',
    'IE00BKM4GZ66': 'iShares MSCI EM IMI',
    'US02079K3059': 'Alphabet',
    'US0231351067': 'Amazon',
    'US09857L1089': 'Booking Holdings',
    'US11135F1012': 'Broadcom',
    'US30303M1027': 'Meta Platforms',
    'US5949181045': 'Microsoft',
    'US92826C8394': 'Visa',
    'FR0011053636': 'Capital B',
  };

  // Pattern principal : QTY titre(s) ... ISIN : XXXX ... PRIX DATE VALEUR
  // Gère les virgules comme séparateurs décimaux (format européen)
  const pattern = /([\d]+[,.][\d]+|[\d]+)\s+titre\(s\)\s+(.*?)\s+ISIN\s*:\s*([A-Z]{2}[A-Z0-9]{10})\s+([\d]+[,.][\d]+)\s+\d{2}\/\d{2}\/\d{4}\s+([\d]+[,.][\d]+)/g;

  let match;
  while ((match = pattern.exec(cleaned)) !== null) {
    const qty    = parseFloat(match[1].replace(',', '.'));
    const rawName = match[2].trim();
    const isin   = match[3];
    const price  = parseFloat(match[4].replace(',', '.'));
    const total  = parseFloat(match[5].replace(',', '.'));

    if (!isin || qty === 0 || price === 0) continue;

    // Nom propre : utiliser le raccourci ou nettoyer le nom brut
    const label = nameShortMap[isin] || rawName.split(/\s+/).slice(0,4).join(' ');

    found.push({
      id: Date.now() + Math.random(),
      name: isin,        // ISIN comme identifiant unique
      label,             // Nom lisible
      isin,
      qty,
      buyPrice: 0,       // Non disponible dans le relevé de positions
      currentPrice: price,
      perf: { total: 0 },
      source: 'tr',
      type: 'stock',
      geo: 'world',
      sector: 'mixed',
      currency: 'EUR',
      fees: 0
    });
  }

  // Si le pattern principal ne trouve rien, essayer ligne par ligne
  if (!found.length) {
    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      // Chercher une ligne avec ISIN
      const isinMatch = line.match(/ISIN\s*:\s*([A-Z]{2}[A-Z0-9]{10})/);
      if (isinMatch) {
        const isin = isinMatch[1];
        // Chercher la quantité dans les lignes précédentes
        let qty = 0, price = 0, label = '';
        for (let j = Math.max(0, i-3); j <= i; j++) {
          const l = lines[j];
          const qtyM = l.match(/^([\d,]+)\s+titre/);
          if (qtyM) qty = parseFloat(qtyM[1].replace(',','.'));
          const nameM = l.match(/titre\(s\)\s+(.+)/);
          if (nameM) label = nameM[1].trim().split(/\s+/).slice(0,4).join(' ');
        }
        // Chercher le prix dans les lignes suivantes
        for (let j = i+1; j <= Math.min(lines.length-1, i+5); j++) {
          const priceM = lines[j].match(/^([\d]+[,.][\d]+)$/);
          if (priceM) { price = parseFloat(priceM[1].replace(',','.')); break; }
        }
        if (qty > 0 && price > 0) {
          found.push({
            id: Date.now() + Math.random(),
            name: isin, label: nameShortMap[isin] || label, isin,
            qty, buyPrice: 0, currentPrice: price,
            perf: { total: 0 }, source: 'tr', type: 'stock',
            geo: 'world', sector: 'mixed', currency: 'EUR', fees: 0
          });
        }
      }
      i++;
    }
  }

  return found;
}

function connectTR_CSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      if (!lines.length) { toast('Fichier vide', 'var(--danger)'); return; }
      const sep = lines[0].includes(';') ? ';' : ',';
      const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g,'').toLowerCase());
      const nameIdx  = headers.findIndex(h => h.includes('name') || h.includes('nom') || h.includes('titel'));
      const isinIdx  = headers.findIndex(h => h.includes('isin'));
      const qtyIdx   = headers.findIndex(h => h.includes('qty') || h.includes('shares') || h.includes('quantit'));
      const pruIdx   = headers.findIndex(h => h.includes('buy') || h.includes('achat') || h.includes('avg'));
      const priceIdx = headers.findIndex(h => h.includes('price') || h.includes('prix') || h.includes('kurs'));
      let count = 0;
      lines.slice(1).forEach(line => {
        const cols = line.split(sep).map(c => c.trim().replace(/"/g,'').replace(',','.'));
        const name  = cols[nameIdx  >= 0 ? nameIdx  : 0] || '';
        const isin  = cols[isinIdx  >= 0 ? isinIdx  : -1] || '';
        const qty   = parseFloat(cols[qtyIdx   >= 0 ? qtyIdx   : 1] || '0') || 0;
        const pru   = parseFloat(cols[pruIdx   >= 0 ? pruIdx   : 2] || '0') || 0;
        const price = parseFloat(cols[priceIdx >= 0 ? priceIdx : 3] || '0') || 0;
        const label = name || isin;
        if (!label || label.length < 2 || qty === 0) return;
        assets = assets.filter(a => !(a.source === 'tr' && a.name.toLowerCase() === label.toLowerCase()));
        assets = assets.filter(a => !(a.source === 'sheets' && a.type !== 'crypto' && a.type !== 'esop' &&
          a.name.toLowerCase() === label.toLowerCase()));
        assets.push({ id: Date.now()+Math.random(), name: label, label: name, isin, qty,
          buyPrice: pru, currentPrice: price > 0 ? price : pru, perf: { total: 0 },
          source: 'tr', type: 'stock', geo: 'world', sector: 'mixed', currency: 'EUR', fees: 0 });
        count++;
      });
      setData('assets', assets);
      const srcs = getData('sources', {}); srcs.tr = true; setData('sources', srcs); sources = srcs;
      toast(`✓ ${count} positions TR importées depuis CSV`, 'var(--accent)');
      renderSourcesPage(); renderPage('overview');
    } catch(err) { toast('Erreur CSV: ' + err.message, 'var(--danger)'); }
  };
  reader.readAsText(file);
}
// ══════════════════════════════════════════════════════════════
//  SUPABASE — Base de données cloud persistante
// ══════════════════════════════════════════════════════════════

// Récupérer les config Supabase depuis localStorage (partagées entre tous les users)
function getSbConfig() {
  // Supprimé : la config Supabase est maintenant dans app.js (SUPABASE_URL / SUPABASE_ANON)
  return null;
}

function setSbConfig(url, key) {
  localStorage.setItem('patrimonia_supabase', JSON.stringify({ url: url.replace(/\/$/, ''), key }));
}

// ── Requête Supabase ──────────────────────────────────────────
async function sbRequest(method, path, body = null) {
  const cfg = getSbConfig();
  if (!cfg) throw new Error('Supabase non configuré');

  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': cfg.key,
      'Authorization': `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Sauvegarder toutes les données dans Supabase ──────────────
async function saveToCloud() {
  const cfg = getSbConfig();
  if (!cfg) return; // Pas configuré → silencieux

  const data = {
    assets, savings, salary, expenses, settings, sources,
    history: getData('history', []),
    taxProfile: getData('taxProfile', {}),
    dividends: getData('dividends', []),
    savedAt: new Date().toISOString()
  };

  try {
    await sbRequest('POST', 'patrimonia_data', {
      username: currentUser,
      data,
      updated_at: new Date().toISOString()
    });
    updateDbBadge(true);
  } catch(e) {
    console.warn('Cloud save failed:', e.message);
    updateDbBadge(false, e.message);
  }
}

// ── Charger depuis Supabase ───────────────────────────────────
async function loadFromCloud() {
  const cfg = getSbConfig();
  if (!cfg) return false;

  try {
    const rows = await sbRequest('GET', `patrimonia_data?username=eq.${encodeURIComponent(currentUser)}&select=data,updated_at`);
    if (!rows || !rows.length) return false;

    const remote = rows[0].data;
    const remoteDate = new Date(rows[0].updated_at);
    const localDate = new Date(getData('lastSync', 0));

    // Prendre les données les plus récentes
    if (remoteDate > localDate) {
      if (remote.assets)     { assets   = remote.assets;   setData('assets', assets); }
      if (remote.savings)    { savings  = remote.savings;  setData('savings', savings); }
      if (remote.salary)     { salary   = remote.salary;   setData('salary', salary); }
      if (remote.expenses)   { expenses = remote.expenses; setData('expenses', expenses); }
      if (remote.settings)   { settings = remote.settings; setData('settings', settings); }
      if (remote.sources)    { sources  = remote.sources;  setData('sources', sources); }
      if (remote.history)    setData('history', remote.history);
      if (remote.taxProfile) setData('taxProfile', remote.taxProfile);
      if (remote.dividends)  setData('dividends', remote.dividends);

      setData('lastSync', remoteDate.toISOString());
      updateDbBadge(true);
      return true;
    }
    updateDbBadge(true);
    return false;
  } catch(e) {
    console.warn('Cloud load failed:', e.message);
    updateDbBadge(false, e.message);
    return false;
  }
}

// ── Badge statut ──────────────────────────────────────────────
function updateDbBadge(ok, errMsg = '') {
  const badge = document.getElementById('dbStatusBadge');
  if (!badge) return;
  if (ok) {
    badge.className = 'badge badge-up';
    badge.textContent = '✓ Synchronisé';
  } else {
    badge.className = 'badge badge-down';
    badge.textContent = errMsg ? `Erreur: ${errMsg.slice(0,30)}` : 'Non connecté';
  }
}

// ── Connecter Supabase depuis l'UI ────────────────────────────
async function connectSupabase() {
  const url = document.getElementById('supabaseUrl')?.value.trim();
  const key = document.getElementById('supabaseKey')?.value.trim();
  const msg = document.getElementById('supabaseMsg');

  if (!url || !key) {
    if (msg) msg.innerHTML = '<span style="color:var(--red)">⚠️ URL et clé requis</span>';
    return;
  }
  if (!url.includes('supabase.co')) {
    if (msg) msg.innerHTML = '<span style="color:var(--red)">⚠️ L\'URL doit contenir supabase.co</span>';
    return;
  }

  setSbConfig(url, key);
  if (msg) msg.innerHTML = '<span style="color:var(--muted2)">Connexion en cours…</span>';

  try {
    await saveToCloud();
    if (msg) msg.innerHTML = '<span style="color:var(--green)">✓ Connecté ! Données sauvegardées dans le cloud.</span>';
    toast('✓ Cloud synchronisé — vos données sont maintenant persistantes !', 'var(--green)');
  } catch(e) {
    if (msg) msg.innerHTML = `<span style="color:var(--red)">✗ Erreur : ${e.message}</span>`;
  }
}

async function testSupabase() {
  const url = document.getElementById('supabaseUrl')?.value.trim();
  const key = document.getElementById('supabaseKey')?.value.trim();
  const msg = document.getElementById('supabaseMsg');
  if (!url || !key) { if (msg) msg.innerHTML = '<span style="color:var(--red)">Remplissez l\'URL et la clé</span>'; return; }
  setSbConfig(url, key);
  try {
    await sbRequest('GET', 'patrimonia_data?select=username&limit=1');
    if (msg) msg.innerHTML = '<span style="color:var(--green)">✓ Connexion réussie ! La table existe et est accessible.</span>';
  } catch(e) {
    if (msg) msg.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`;
  }
}

async function syncFromCloud() {
  const msg = document.getElementById('supabaseMsg');
  if (msg) msg.innerHTML = '<span style="color:var(--muted2)">Restauration en cours…</span>';
  try {
    const restored = await loadFromCloud();
    if (restored) {
      if (msg) msg.innerHTML = '<span style="color:var(--green)">✓ Données restaurées depuis le cloud !</span>';
      toast('✓ Données restaurées depuis Supabase', 'var(--green)');
      renderPage('overview');
    } else {
      if (msg) msg.innerHTML = '<span style="color:var(--muted2)">Aucune donnée cloud plus récente trouvée.</span>';
    }
  } catch(e) {
    if (msg) msg.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`;
  }
}

// ── Suppression de compte ─────────────────────────────────────
async function deleteAccount() {
  const input = document.getElementById('deleteConfirmInput')?.value;
  if (input !== 'SUPPRIMER') {
    toast('Tapez exactement SUPPRIMER pour confirmer', 'var(--red)');
    return;
  }

  try {
    // 1. Supprimer toutes les données utilisateur dans Supabase
    await sb.from('user_data').delete().eq('user_id', currentUser);

    // 2. Supprimer le compte auth Supabase
    // Note: nécessite un Edge Function ou la clé service_role côté serveur
    // Pour l'instant on déconnecte simplement
    await sb.auth.signOut();

    toast('Données supprimées. Compte déconnecté.', 'var(--muted2)');
    setTimeout(() => { window.location.href = 'index.html'; }, 1500);

  } catch(e) {
    toast('Erreur lors de la suppression : ' + e.message, 'var(--red)');
  }
}

// ── Auto-save : géré nativement par la nouvelle couche Supabase ──
// setData() envoie directement à Supabase, pas besoin de surcharge.

// ── Pré-remplir l'UI Supabase depuis config sauvegardée ───────
function initSupabaseUI() {
  const cfg = getSbConfig();
  if (!cfg) return;
  const urlEl = document.getElementById('supabaseUrl');
  const keyEl = document.getElementById('supabaseKey');
  if (urlEl) urlEl.value = cfg.url;
  if (keyEl) keyEl.value = cfg.key;
  updateDbBadge(true);
}

// ── Chargement initial depuis le cloud au démarrage ───────────
async function initCloudSync() {
  const cfg = getSbConfig();
  if (!cfg) return;
  try {
    const restored = await loadFromCloud();
    if (restored) {
      // Recharger les variables depuis localStorage mis à jour
      assets   = getData('assets', []);
      savings  = getData('savings', []);
      salary   = getData('salary', { gross: 0, net: 0, inter: 0, part: 0, saved: 0 });
      expenses = getData('expenses', []);
      settings = getData('settings', { currency: 'EUR', exposureThreshold: 20 });
      sources  = getData('sources', {});
      renderPage('overview');
      toast('✓ Données restaurées depuis le cloud', 'var(--green)');
    }
  } catch(e) {
    console.warn('Init cloud sync failed:', e);
  }
}
function saveSettings() {
  settings.currency = document.getElementById('currency').value;
  settings.exposureThreshold = parseFloat(document.getElementById('exposureThreshold').value) || 20;
  setData('settings', settings);
  // Le thème est déjà sauvegardé dans localStorage via setTheme()
  toast('✓ Paramètres sauvegardés', 'var(--green)');
}

function exportData() {
  const data = { assets, savings, salary, expenses, settings };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wealthview_${currentUser}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

function importData() { document.getElementById('importFile').click(); }

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.assets) { assets = data.assets; setData('assets', assets); }
      if (data.savings) { savings = data.savings; setData('savings', savings); }
      if (data.salary) { salary = data.salary; setData('salary', salary); }
      if (data.expenses) { expenses = data.expenses; setData('expenses', expenses); }
      if (data.settings) { settings = data.settings; setData('settings', settings); }
      toast('Données importées ✓');
      renderPage('overview');
    } catch { toast('Fichier JSON invalide', 'var(--danger)'); }
  };
  reader.readAsText(file);
}

function clearData() {
  if (!confirm('Réinitialiser toutes vos données ?')) return;
  assets = []; savings = []; salary = {}; expenses = [];
  setData('assets', assets); setData('savings', savings);
  setData('salary', salary); setData('expenses', expenses);
  toast('Données réinitialisées');
  renderPage('overview');
}

// ── REFRESH ───────────────────────────────────────────────────
function refreshData() {
  document.getElementById('lastUpdate').textContent = `Mis à jour: ${new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}`;
  const active = document.querySelector('.page-section.active')?.id?.replace('page-','') || 'overview';
  renderPage(active);
  toast('Données actualisées ✓');
}

// ── INIT ──────────────────────────────────────────────────────
function init() {
  // User display — récupérer l'email depuis la session Supabase
  sb.auth.getSession().then(({ data: { session } }) => {
    const email = session?.user?.email || '';
    const name  = email.split('@')[0];
    const el    = document.getElementById('userName');
    const av    = document.getElementById('userAvatar');
    const gr    = document.getElementById('greetName');
    if (el) el.textContent = email;
    if (av) av.textContent = name.charAt(0).toUpperCase();
    if (gr) gr.textContent = name.charAt(0).toUpperCase() + name.slice(1);
  });

  // Settings defaults
  document.getElementById('currency').value = settings.currency || 'EUR';
  document.getElementById('exposureThreshold').value = settings.exposureThreshold || 20;

  // Salary defaults in modal
  const sl = salary;
  if (sl.gross) document.getElementById('salGross').value = sl.gross;
  if (sl.net)   document.getElementById('salNet').value = sl.net;
  if (sl.inter) document.getElementById('salInter').value = sl.inter;
  if (sl.part)  document.getElementById('salPart').value = sl.part;
  if (sl.saved) document.getElementById('salSaved').value = sl.saved;

  // Appliquer thème sauvegardé
  const savedTheme = localStorage.getItem('patrimonia_theme') || 'dark';
  applyTheme(savedTheme);

  refreshData();
  renderPage('overview');
  updateProjection();

  // Detect URL change → show DASHBOARD badge or generic mapping
  setTimeout(() => {
    const urlEl = document.getElementById('sheetsUrl');
    if (urlEl) {
      urlEl.addEventListener('input', () => updateSheetDetection(urlEl.value));
    }
  }, 500);
}

function updateSheetDetection(url) {
  const isDash = url.includes('1_IRTIWy_g3qDLPQj2WY7AqgqRR6NCoRA8sh6IYXZxn8');
  const detected  = document.getElementById('dashboardDetected');
  const generic   = document.getElementById('genericMappingSection');
  const btn       = document.getElementById('importSheetsBtn');
  if (detected) detected.style.display = isDash ? 'block' : 'none';
  if (generic)  generic.style.display  = isDash ? 'none'  : 'block';
  if (btn)      btn.textContent = isDash ? '⬇ Importer mon DASHBOARD' : '⬇ Importer ce Google Sheet';
}

// ══════════════════════════════════════════════════════════════
//  FISCALITÉ — Barème IR 2024, PFU, optimisations
// ══════════════════════════════════════════════════════════════

// Tranches IR 2024 (revenus 2023)
const TRANCHES_IR = [
  { max: 11294,  taux: 0 },
  { max: 28797,  taux: 0.11 },
  { max: 82341,  taux: 0.30 },
  { max: 177106, taux: 0.41 },
  { max: Infinity, taux: 0.45 },
];

// Parts fiscales selon situation
const PARTS = {
  single: 1, married: 2,
  married_children1: 2.5, married_children2: 3, married_children3: 4,
  single_parent1: 2, single_parent2: 2.5,
  etudiant: 1, apprenti: 1
};

// ── Plafonds exonérations 2024 ──
// Étudiant : revenus du job étudiant exonérés jusqu'à 3x le SMIC mensuel = 5 763€/an (≈ 3 × 1921€)
const EXONERATION_ETUDIANT = 5763;
// Apprenti  : salaire exonéré jusqu'à 50% du SMIC annuel = 11 536€/an  (SMIC 2024 = 23 073€ brut)
const EXONERATION_APPRENTI = 11536;
// Stage     : gratification exonérée jusqu'à 50% du plafond horaire SS ≈ 4 102€/an
const EXONERATION_STAGE    = 4102;

function calcIR(revenuImposable, nbParts) {
  const quotient = revenuImposable / nbParts;
  let impot = 0;
  let prev = 0;
  for (const t of TRANCHES_IR) {
    const tranche = Math.min(quotient, t.max) - prev;
    if (tranche <= 0) break;
    impot += tranche * t.taux;
    prev = t.max;
  }
  return impot * nbParts;
}

function getTMI(revenuImposable, nbParts) {
  const quotient = revenuImposable / nbParts;
  for (const t of TRANCHES_IR) {
    if (quotient <= t.max) return t.taux;
  }
  return 0.45;
}

function calculateTax() {
  const gross     = parseFloat(document.getElementById('taxGross')?.value) || 0;
  const other     = parseFloat(document.getElementById('taxOther')?.value) || 0;
  const capGain   = parseFloat(document.getElementById('taxCapGain')?.value) || 0;
  const dividends = parseFloat(document.getElementById('taxDividends')?.value) || 0;
  const per       = parseFloat(document.getElementById('taxPer')?.value) || 0;
  const dons      = parseFloat(document.getElementById('taxDons')?.value) || 0;
  const situation = document.getElementById('taxSituation')?.value || 'single';
  const age       = parseInt(document.getElementById('taxAge')?.value) || 30;

  if (!gross && !other) {
    if (salary.gross) {
      const el = document.getElementById('taxGross');
      if (el && !el.value) el.value = salary.gross * 12;
    }
    return;
  }

  const nbParts = PARTS[situation] || 1;
  const fmtE = v => `${Math.round(v).toLocaleString('fr-FR')}€`;

  // ── EXONÉRATIONS ÉTUDIANT / APPRENTI ────────────────────────
  let exonerationLabel = '';
  let exonerationMontant = 0;
  let grossImposable = gross; // salaire brut pris en compte pour l'IR

  if (situation === 'etudiant') {
    // Exonération jusqu'à 3 SMIC mensuels (5 763€/an, 2024)
    exonerationMontant = Math.min(gross, EXONERATION_ETUDIANT);
    grossImposable = Math.max(0, gross - exonerationMontant);
    exonerationLabel = `Exonération job étudiant (≤ 3×SMIC mensuel = ${fmtE(EXONERATION_ETUDIANT)})`;
  } else if (situation === 'apprenti') {
    // Salaire exonéré jusqu'à 50% du SMIC annuel (11 536€/an, 2024)
    exonerationMontant = Math.min(gross, EXONERATION_APPRENTI);
    grossImposable = Math.max(0, gross - exonerationMontant);
    exonerationLabel = `Exonération contrat d'apprentissage (≤ 50% SMIC annuel = ${fmtE(EXONERATION_APPRENTI)})`;
  }

  // ── CALCUL NORMAL SUR LE REVENU APRÈS EXONÉRATION ───────────
  // Abattement 10% frais professionnels (sur la part imposable seulement)
  const abattement10 = Math.min(grossImposable * 0.1, 13522);
  const salaireImposable = Math.max(0, grossImposable - abattement10);

  // Déduction PER (plafond calculé sur le brut total, pas le brut imposable)
  const plafondPER = Math.min(per, gross * 0.1);

  // Revenu net imposable
  const revenuImposable = Math.max(0, salaireImposable + other - plafondPER);

  // IR sur salaire + autres revenus
  const irSalaire = calcIR(revenuImposable, nbParts);
  const tmi = getTMI(revenuImposable, nbParts);

  // PFU (Flat Tax) sur PV et dividendes : 12.8% IR + 17.2% PS = 30%
  const pfuIR = (capGain + dividends) * 0.128;
  const pfuPS = (capGain + dividends) * 0.172;

  // Option barème pour PV/dividendes (si TMI < 12.8%)
  const irPvBareme = tmi < 0.128
    ? calcIR(revenuImposable + capGain + dividends, nbParts) - irSalaire
    : null;

  // Réduction d'impôt pour dons (66% dans la limite de 20% du revenu imposable)
  const reductionDons = Math.min(dons * 0.66, revenuImposable * 0.20);

  // Décote
  const seuilDecote = nbParts === 1 ? 1929 : 3191;
  let decote = 0;
  const irBrut = irSalaire + pfuIR - reductionDons;
  if (irBrut < seuilDecote) {
    decote = nbParts === 1
      ? Math.max(0, 873 - irBrut * 0.4525)
      : Math.max(0, 1444 - irBrut * 0.4525);
  }

  const irNet = Math.max(0, irBrut - decote);
  const totalImpots = irNet + pfuPS;
  const revenuTotal = gross + other + capGain + dividends;
  const tauxEffectif = revenuTotal > 0 ? (totalImpots / revenuTotal) * 100 : 0;

  // ── BANNIÈRE EXONÉRATION (affichée si étudiant/apprenti) ────
  const bannerEl = document.getElementById('exonerationBanner');
  if (bannerEl) {
    if (exonerationMontant > 0) {
      bannerEl.style.display = 'block';
      bannerEl.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <span style="font-size:22px;flex-shrink:0;">${situation === 'apprenti' ? '🎓' : '📚'}</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--green);margin-bottom:4px;">
              ${situation === 'apprenti' ? 'Exonération apprenti appliquée ✓' : 'Exonération job étudiant appliquée ✓'}
            </div>
            <div style="font-size:12px;color:var(--text2);line-height:1.6;">${exonerationLabel}</div>
            <div style="font-size:12px;color:var(--green);margin-top:4px;font-weight:500;">
              → Revenu exonéré : <b>${fmtE(exonerationMontant)}</b> · Revenu imposable réduit à <b>${fmtE(grossImposable)}</b>
            </div>
            ${situation === 'apprenti' && gross > EXONERATION_APPRENTI ? `
            <div style="font-size:11px;color:var(--muted2);margin-top:4px;">
              ⚠️ La part au-delà de ${fmtE(EXONERATION_APPRENTI)} (soit ${fmtE(gross - EXONERATION_APPRENTI)}) reste imposable normalement.
            </div>` : ''}
            ${situation === 'etudiant' && gross > EXONERATION_ETUDIANT ? `
            <div style="font-size:11px;color:var(--muted2);margin-top:4px;">
              ⚠️ La part au-delà de ${fmtE(EXONERATION_ETUDIANT)} (soit ${fmtE(gross - EXONERATION_ETUDIANT)}) reste imposable.
            </div>` : ''}
          </div>
        </div>`;
    } else {
      bannerEl.style.display = 'none';
    }
  }

  // Résultats
  document.getElementById('taxResult').textContent = fmtE(irNet);
  document.getElementById('taxTMI').textContent = `Tranche marginale : ${(tmi*100).toFixed(0)}%`;
  document.getElementById('taxRate').textContent = `${tauxEffectif.toFixed(1)}%`;

  // Décomposition
  const bdEl = document.getElementById('taxBreakdown');
  bdEl.innerHTML = `
    ${exonerationMontant > 0 ? `
    <div class="fee-item" style="background:rgba(34,197,94,0.04);margin:0 -4px;padding:10px 4px;border-radius:6px;">
      <div class="text-sm" style="color:var(--green);">✓ ${exonerationLabel.split('(')[0].trim()}</div>
      <div class="fw-bold" style="color:var(--green);">-${fmtE(exonerationMontant)}</div>
    </div>` : ''}
    <div class="fee-item"><div class="text-sm">Abattement 10% frais pro</div><div class="fw-bold" style="color:var(--green);">-${fmtE(abattement10)}</div></div>
    <div class="fee-item"><div class="text-sm">Revenu net imposable</div><div class="fw-bold">${fmtE(revenuImposable)}</div></div>
    <div class="fee-item"><div class="text-sm">IR sur salaire/revenus</div><div class="fw-bold color-danger">${fmtE(irSalaire)}</div></div>
    ${capGain+dividends > 0 ? `<div class="fee-item"><div class="text-sm">IR Flat Tax (PV+Div)</div><div class="fw-bold color-danger">${fmtE(pfuIR)}</div></div>` : ''}
    ${pfuPS > 0 ? `<div class="fee-item"><div class="text-sm">Prélèvements sociaux (17.2%)</div><div class="fw-bold color-danger">${fmtE(pfuPS)}</div></div>` : ''}
    ${reductionDons > 0 ? `<div class="fee-item"><div class="text-sm">Réduction dons (66%)</div><div class="fw-bold" style="color:var(--green);">-${fmtE(reductionDons)}</div></div>` : ''}
    ${decote > 0 ? `<div class="fee-item"><div class="text-sm">Décote</div><div class="fw-bold" style="color:var(--green);">-${fmtE(decote)}</div></div>` : ''}
    ${plafondPER > 0 ? `<div class="fee-item"><div class="text-sm">Déduction PER</div><div class="fw-bold" style="color:var(--green);">-${fmtE(plafondPER)}</div></div>` : ''}
    <div class="fee-item" style="border-top:2px solid var(--border2);margin-top:4px;">
      <div class="text-sm fw-bold">Total impôts + PS</div>
      <div class="fw-bold color-danger" style="font-size:16px;">${fmtE(totalImpots)}</div>
    </div>`;

  // Flat Tax vs Barème
  const fbEl = document.getElementById('taxFlatvsBareme');
  if (capGain + dividends > 0 && irPvBareme !== null) {
    const pfuTotal = pfuIR + pfuPS;
    const baremeTotal = irPvBareme + pfuPS;
    const best = pfuTotal <= baremeTotal ? 'Flat Tax' : 'Barème';
    const saving = Math.abs(pfuTotal - baremeTotal);
    fbEl.innerHTML = `
      <div class="fee-item">
        <div class="text-sm">Flat Tax (PFU 30%)</div>
        <div class="fw-bold ${pfuTotal <= baremeTotal ? 'color-accent' : ''}">${fmtE(pfuTotal)} ${pfuTotal <= baremeTotal ? '✓ Optimal' : ''}</div>
      </div>
      <div class="fee-item">
        <div class="text-sm">Barème progressif</div>
        <div class="fw-bold ${baremeTotal < pfuTotal ? 'color-accent' : ''}">${fmtE(baremeTotal)} ${baremeTotal < pfuTotal ? '✓ Optimal' : ''}</div>
      </div>
      <div class="text-xs color-muted mt-8">→ <b style="color:var(--accent)">${best}</b> est plus avantageux — économie de <b>${fmtE(saving)}</b></div>`;
  } else {
    fbEl.innerHTML = `<div class="text-xs color-muted">Saisissez des plus-values ou dividendes pour voir la comparaison.</div>`;
  }

  // Optimisations
  renderOptimisations({ gross, grossImposable, exonerationMontant, situation, other, capGain, dividends, per, dons, age, tmi, revenuImposable, nbParts, irNet, plafondPER });

  // Enveloppes fiscales
  renderEnvelopes({ tmi, gross });

  // Panel régimes spéciaux (étudiant/apprenti)
  renderRegimesSpeciaux({ situation, gross, exonerationMontant });

  // Simulateur PER
  updatePerSim();

  // Sauvegarder profil fiscal
  setData('taxProfile', { gross: gross * 12, other, capGain, dividends, per, dons, situation, age });
}

function renderOptimisations({ gross, grossImposable = gross, exonerationMontant = 0, situation, other, capGain, dividends, per, dons, age, tmi, revenuImposable, nbParts, irNet, plafondPER }) {
  const opts = [];
  const fmtE = v => `${Math.round(v).toLocaleString('fr-FR')}€`;

  // ── EXONÉRATIONS SPÉCIFIQUES ÉTUDIANT / APPRENTI ────────────
  if (situation === 'etudiant') {
    opts.push({
      icon: '📚', titre: 'Exonération job étudiant — 5 763€/an',
      desc: `Vos revenus sont <b>exonérés d'IR jusqu'à 5 763€/an</b> (3× SMIC mensuel brut 2024). Au-delà, le surplus est imposé normalement. Exonération automatique, aucune démarche.`,
      gain: exonerationMontant > 0 ? `✓ Appliquée : <b style="color:var(--green)">${fmtE(Math.min(gross, EXONERATION_ETUDIANT))}</b> hors IR` : `Saisissez votre salaire pour voir l'économie`,
      priority: 'high'
    });
    opts.push({
      icon: '🏦', titre: "Livret A & LDDS — 0% d'impôt",
      desc: `Intérêts totalement exonérés d'IR et de PS. Livret A : 22 950€ · LDDS : 12 000€ · Taux 2024 : <b>2.40% net</b>.`,
      gain: `Idéal pour épargne de précaution · Disponible à tout moment`,
      priority: 'high'
    });
    opts.push({
      icon: '🎓', titre: 'Rattachement au foyer parental',
      desc: `Rattaché au foyer de vos parents = pas de déclaration séparée. Vos revenus s'ajoutent aux leurs. Comparez selon leur TMI.`,
      gain: `Peut être avantageux si vos parents ont une TMI élevée`,
      priority: 'medium'
    });
    opts.push({
      icon: '🏠', titre: 'Bourses & APL — Non imposables',
      desc: `Bourses CROUS sur critères sociaux, APL, ALS, ALF : toutes exonérées d'IR. <b>Ne pas les déclarer</b> comme revenus.`,
      gain: `Bourses CROUS, aides au logement : hors déclaration`,
      priority: 'medium'
    });
  }

  if (situation === 'apprenti') {
    opts.push({
      icon: '🎓', titre: 'Exonération apprenti — 11 536€/an',
      desc: `Salaire exonéré d'IR jusqu'à <b>50% du SMIC annuel brut</b> (11 536€ en 2024). Au-delà : imposable normalement. Exonération automatique à la déclaration.`,
      gain: exonerationMontant > 0 ? `✓ Appliquée : <b style="color:var(--green)">${fmtE(Math.min(gross, EXONERATION_APPRENTI))}</b> hors IR` : `Saisissez votre salaire pour voir l'économie`,
      priority: 'high'
    });
    opts.push({
      icon: '📋', titre: 'Cotisations sociales — Quasi nulles',
      desc: `Salaire apprenti exonéré de toutes cotisations salariales jusqu'au SMIC. <b>Salaire net ≈ salaire brut</b> sous le SMIC.`,
      gain: `Économie de cotisations : environ <b>22%</b> du brut sous SMIC`,
      priority: 'high'
    });
    opts.push({
      icon: '🏦', titre: 'Ouvrir un PEL maintenant',
      desc: `L'apprentissage est idéal pour ouvrir un PEL (taux 2.25% garanti). Délai minimum 4 ans → ouvrir tôt = droits à prêt plus tôt.`,
      gain: `Taux garanti + droits à prêt immobilier préférentiels`,
      priority: 'medium'
    });
    opts.push({
      icon: '🎁', titre: 'Primes apprentissage — Exonérées',
      desc: `Primes régionales, aide à l'embauche, aide au logement dans le cadre de l'apprentissage : généralement <b>exonérées d'IR</b>.`,
      gain: `À ne pas déclarer comme revenus salariaux`,
      priority: 'low'
    });
  }

  // PER
  const plafondPERMax = gross * 0.1;
  const restePER = plafondPERMax - per;
  if ((situation === 'etudiant' || situation === 'apprenti') && tmi === 0) {
    opts.push({
      icon: '📙', titre: 'PER : peu utile à TMI 0%',
      desc: `Le PER sert à réduire l'impôt via une déduction du revenu. À TMI 0%, vous ne payez pas d'IR donc la déduction ne vous apporte rien. <b>Attendez une TMI plus élevée</b> pour l'alimenter.`,
      gain: `Préférez le Livret A (liquide) plutôt qu'un PER (bloqué jusqu'à la retraite)`,
      priority: 'low'
    });
  } else if (restePER > 500 && tmi >= 0.11) {
    const economiePER = restePER * tmi;
    opts.push({
      icon: '📙', titre: 'Maximiser votre PER',
      desc: `Vous pouvez encore verser <b>${fmtE(restePER)}</b> sur un PER cette année.`,
      gain: `Économie fiscale estimée : <b style="color:var(--accent)">${fmtE(economiePER)}</b>`,
      priority: economiePER > 1000 ? 'high' : 'medium'
    });
  }

  // PEA — message adapté étudiant/apprenti
  opts.push({
    icon: '📗', titre: situation === 'etudiant' || situation === 'apprenti'
      ? 'Ouvrir un PEA dès maintenant — Le timing compte !'
      : 'Ouvrir/alimenter un PEA',
    desc: situation === 'etudiant' || situation === 'apprenti'
      ? `Le compteur des <b>5 ans</b> pour l'exonération IR démarre à l'ouverture, pas au premier versement. Ouvrez-le maintenant avec 100€ symboliques — dans 5 ans, vos plus-values seront exonérées d'IR.`
      : `Vos ETF et actions européennes en PEA seront exonérés d'IR après 5 ans (seulement 17.2% PS).`,
    gain: `Après 5 ans : PV et dividendes exonérés d'IR · Seulement 17.2% prélèvements sociaux`,
    priority: 'high'
  });

  // Abattement AV 8 ans
  if (age >= 30) {
    opts.push({
      icon: '📘', titre: 'Assurance-Vie après 8 ans',
      desc: `Abattement annuel de <b>4 600€</b> (9 200€ couple) sur les gains. Idéal pour les retraits progressifs.`,
      gain: `Économie : jusqu'à <b>${fmtE(4600 * tmi)}</b>/an selon TMI`,
      priority: 'medium'
    });
  }

  // Dons
  if (dons === 0) {
    opts.push({
      icon: '🤝', titre: 'Déductions pour dons',
      desc: 'Les dons à des associations reconnues d\'utilité publique ouvrent droit à une réduction de 66% du montant donné.',
      gain: `Ex: 300€ donnés = <b>${fmtE(198)}</b> d'économie d'impôt`,
      priority: 'low'
    });
  }

  // Défiscalisation immo (si TMI 30%+)
  if (tmi >= 0.30) {
    opts.push({
      icon: '🏠', titre: 'Investissement locatif LMNP',
      desc: 'Le statut LMNP (Loueur Meublé Non Professionnel) permet d\'amortir le bien et de réduire fortement la fiscalité des loyers.',
      gain: `Revenus locatifs potentiellement non imposés pendant 10-15 ans`,
      priority: 'medium'
    });
  }

  // Épargne salariale (Airbus)
  opts.push({
    icon: '✈️', titre: 'Épargne salariale Airbus',
    desc: 'L\'intéressement et la participation versés sur PER COL sont exonérés d\'IR (seulement 9.7% CSG/CRDS).',
    gain: `Maximisez vos versements PERCOL avant le plafond annuel`,
    priority: 'high'
  });

  const priorityColors = { high: 'var(--accent)', medium: 'var(--gold)', low: 'var(--blue)' };
  const priorityLabels = { high: 'Priorité haute', medium: 'À considérer', low: 'Bonus' };

  document.getElementById('taxOptimizations').innerHTML = opts.map(o => `
    <div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:24px;flex-shrink:0;">${o.icon}</div>
      <div style="flex:1;">
        <div class="flex-between" style="margin-bottom:4px;">
          <div class="fw-bold text-sm">${o.titre}</div>
          <span class="badge" style="background:rgba(255,255,255,0.05);color:${priorityColors[o.priority]};font-size:10px;">${priorityLabels[o.priority]}</span>
        </div>
        <div class="text-xs color-muted" style="margin-bottom:4px;line-height:1.5;">${o.desc}</div>
        <div class="text-xs" style="color:${priorityColors[o.priority]};">${o.gain}</div>
      </div>
    </div>
  `).join('');
}

function renderEnvelopes({ tmi, gross }) {
  const fmtE = v => `${Math.round(v).toLocaleString('fr-FR')}€`;

  // PEA status
  const peaAssets = assets.filter(a => a.type === 'stock' && a.source !== 'esop');
  const peaVal = peaAssets.reduce((s,a) => s + (a.qty||1)*(a.currentPrice||0), 0);
  document.getElementById('peaStatus').innerHTML = `
    <div class="progress-wrap">
      <div class="progress-header"><span>Utilisation estimée</span><span>${fmtE(peaVal)} / 150 000€</span></div>
      <div class="progress-bar"><div class="progress-fill" style="background:var(--accent);width:${Math.min(peaVal/1500, 100)}%"></div></div>
    </div>
    <div class="text-xs color-muted mt-8">💡 Économie potentielle vs CTO : <span class="color-accent">${fmtE(peaVal * 0.128)}</span> d'IR sur vos plus-values</div>`;

  // AV status
  document.getElementById('avStatus').innerHTML = `
    <div class="text-xs color-muted" style="line-height:1.6;">
      <span class="color-accent2">Après 8 ans :</span> Abattement ${fmtE(4600)}/an sur les gains<br>
      <span class="color-accent2">Votre TMI :</span> ${(tmi*100).toFixed(0)}% → taux AV : ${tmi > 0.075 ? '<span class="color-accent">7.5%</span> (avantageux ✓)' : '<span class="color-gold">identique TMI</span>'}<br>
    </div>`;

  // PER status
  const plafondPER = gross * 0.1;
  document.getElementById('perStatus').innerHTML = `
    <div class="progress-wrap">
      <div class="progress-header"><span>Plafond déductible</span><span>${fmtE(plafondPER)}/an</span></div>
      <div class="progress-bar"><div class="progress-fill" style="background:var(--gold);width:60%"></div></div>
    </div>
    <div class="text-xs color-muted mt-8">💡 À votre TMI de ${(tmi*100).toFixed(0)}%, chaque 1 000€ versés = <span class="color-gold">${fmtE(tmi*1000)}</span> d'économie</div>`;
}

function renderRegimesSpeciaux({ situation, gross, exonerationMontant }) {
  const panel = document.getElementById('regimesSpeciaux');
  const titleEl = document.getElementById('regimesTitle');
  const contentEl = document.getElementById('regimesContent');
  if (!panel) return;

  const fmtE = v => `${Math.round(v).toLocaleString('fr-FR')}€`;

  if (situation === 'etudiant') {
    panel.style.display = 'block';
    titleEl.textContent = '📚 Régime fiscal étudiant — Récapitulatif 2024';
    contentEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px;">
        <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Exonération IR</div>
          <div style="font-size:22px;font-weight:700;color:var(--green);">${fmtE(EXONERATION_ETUDIANT)}</div>
          <div style="font-size:11px;color:var(--muted2);margin-top:4px;">3 × SMIC mensuel brut · Auto à la déclaration</div>
        </div>
        <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Exonération stage</div>
          <div style="font-size:22px;font-weight:700;color:var(--green);">${fmtE(EXONERATION_STAGE)}</div>
          <div style="font-size:11px;color:var(--muted2);margin-top:4px;">Gratification de stage · 50% plafond horaire SS</div>
        </div>
        <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Livret A + LDDS</div>
          <div style="font-size:22px;font-weight:700;color:var(--accent2);">34 950€</div>
          <div style="font-size:11px;color:var(--muted2);margin-top:4px;">Plafond exonéré · Taux 2.40% net 2024</div>
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>Revenu / Aide</th><th>Plafond exonération</th><th>Condition</th><th>À déclarer ?</th></tr></thead>
        <tbody>
          <tr><td class="fw-bold">Job étudiant (salarié)</td><td style="color:var(--green);">${fmtE(EXONERATION_ETUDIANT)}/an</td><td>Étudiant de moins de 26 ans</td><td style="color:var(--green);">Oui, mais exonéré auto</td></tr>
          <tr><td class="fw-bold">Stage obligatoire</td><td style="color:var(--green);">${fmtE(EXONERATION_STAGE)}/an</td><td>Stage conventionné &gt; 2 mois</td><td style="color:var(--green);">Oui, mais exonéré auto</td></tr>
          <tr><td class="fw-bold">Bourse CROUS</td><td style="color:var(--green);">Totalité</td><td>Sur critères sociaux</td><td style="color:var(--green);">Non</td></tr>
          <tr><td class="fw-bold">APL / ALS / ALF</td><td style="color:var(--green);">Totalité</td><td>Logement étudiant</td><td style="color:var(--green);">Non</td></tr>
          <tr><td class="fw-bold">Livret A / LDDS</td><td style="color:var(--green);">Intérêts totaux</td><td>Plafonds 22 950€ + 12 000€</td><td style="color:var(--green);">Non</td></tr>
          <tr><td class="fw-bold">Pension alimentaire reçue</td><td style="color:var(--gold);">Partielle</td><td>Selon déclaration parents</td><td style="color:var(--gold);">Oui si parents déduisent</td></tr>
        </tbody>
      </table>
      <div style="margin-top:14px;padding:12px;background:var(--surface2);border-radius:8px;font-size:12px;color:var(--muted2);line-height:1.7;">
        💡 <b style="color:var(--text);">Conseil :</b> Si vous êtes rattaché au foyer fiscal de vos parents, ils bénéficient d'une demi-part supplémentaire (économie ~500–1 500€ selon leur TMI). Comparez avec une déclaration séparée si vous avez des revenus importants.
      </div>`;
  } else if (situation === 'apprenti') {
    panel.style.display = 'block';
    titleEl.textContent = '🎓 Régime fiscal apprenti — Récapitulatif 2024';
    contentEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px;">
        <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Exonération IR</div>
          <div style="font-size:22px;font-weight:700;color:var(--green);">${fmtE(EXONERATION_APPRENTI)}</div>
          <div style="font-size:11px;color:var(--muted2);margin-top:4px;">50% SMIC annuel brut · Automatique</div>
        </div>
        <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Cotisations sociales</div>
          <div style="font-size:22px;font-weight:700;color:var(--green);">~0%</div>
          <div style="font-size:11px;color:var(--muted2);margin-top:4px;">Sous le SMIC · Net ≈ Brut</div>
        </div>
        <div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">SMIC mensuel brut 2024</div>
          <div style="font-size:22px;font-weight:700;color:var(--gold);">1 921€</div>
          <div style="font-size:11px;color:var(--muted2);margin-top:4px;">SMIC annuel : 23 073€ brut</div>
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>Revenu / Avantage</th><th>Plafond / Taux</th><th>Condition</th><th>À déclarer ?</th></tr></thead>
        <tbody>
          <tr><td class="fw-bold">Salaire apprenti</td><td style="color:var(--green);">${fmtE(EXONERATION_APPRENTI)}/an exonérés</td><td>Contrat d'apprentissage</td><td style="color:var(--green);">Oui, mais exonéré auto</td></tr>
          <tr><td class="fw-bold">Cotisations salariales</td><td style="color:var(--green);">≈ 0% sous SMIC</td><td>Salaire ≤ SMIC mensuel</td><td>—</td></tr>
          <tr><td class="fw-bold">Prime d'embauche employeur</td><td style="color:var(--green);">Non imposable</td><td>Aide de l'État à l'employeur</td><td style="color:var(--green);">Non</td></tr>
          <tr><td class="fw-bold">Aide mobilité apprenti</td><td style="color:var(--green);">Non imposable</td><td>Région / OPCO selon dossier</td><td style="color:var(--green);">Non</td></tr>
          <tr><td class="fw-bold">Livret A / LDDS</td><td style="color:var(--green);">Intérêts totaux</td><td>Plafonds 22 950€ + 12 000€</td><td style="color:var(--green);">Non</td></tr>
          <tr><td class="fw-bold">Part au-delà de ${fmtE(EXONERATION_APPRENTI)}</td><td style="color:var(--gold);">Imposable normalement</td><td>Salaire &gt; 50% SMIC annuel</td><td style="color:var(--gold);">Oui</td></tr>
        </tbody>
      </table>
      <div style="margin-top:14px;padding:12px;background:var(--surface2);border-radius:8px;font-size:12px;color:var(--muted2);line-height:1.7;">
        💡 <b style="color:var(--text);">Conseil :</b> Profitez de l'alternance pour ouvrir dès maintenant un <b>PEA</b> et un <b>Livret A</b>. Le PEA déclenche son compteur de 5 ans dès l'ouverture — dans 5 ans vos plus-values seront exonérées d'IR. Le Livret A vous donnera un matelas de sécurité défiscalisé.
      </div>`;
  } else {
    panel.style.display = 'none';
  }
}

function renderFiscalite() {
  // Pré-remplir depuis les données salary si dispo
  const taxProfile = getData('taxProfile', {});
  if (taxProfile.gross && !document.getElementById('taxGross').value) {
    document.getElementById('taxGross').value = taxProfile.gross;
  }
  if (salary.gross && !document.getElementById('taxGross').value) {
    document.getElementById('taxGross').value = Math.round(salary.gross * 12);
  }
  // Dividendes depuis les données importées
  const divs = getData('dividends', []);
  const totalDiv = divs.reduce((s,d) => s + (d.amount||0), 0);
  if (totalDiv > 0 && !document.getElementById('taxDividends').value) {
    document.getElementById('taxDividends').value = Math.round(totalDiv);
  }
  calculateTax();
}

function updatePerSim() {
  const versement = parseFloat(document.getElementById('perSimSlider')?.value) || 2000;
  const tmi = parseFloat(document.getElementById('taxTMI')?.textContent?.match(/\d+/)?.[0] || 30) / 100;
  const years = 20;
  const rate = 0.07;

  const economieFiscale = versement * tmi;
  const capitalSansPER = versement * years; // sans intérêts pour simplifier
  const capitalAvecPER = Array.from({length:years}, (_,i) => versement * Math.pow(1+rate, years-i)).reduce((a,b)=>a+b,0);
  const gainNet = capitalAvecPER - capitalSansPER + economieFiscale * years;

  const fmtE = v => `${Math.round(v).toLocaleString('fr-FR')}€`;
  document.getElementById('perSimResult').innerHTML = `
    <div class="fee-item"><div class="text-sm">Économie fiscale / an</div><div class="fw-bold color-accent">${fmtE(economieFiscale)}</div></div>
    <div class="fee-item"><div class="text-sm">Capital PER dans ${years} ans (7%/an)</div><div class="fw-bold color-gold">${fmtE(capitalAvecPER)}</div></div>
    <div class="fee-item"><div class="text-sm">Gain total vs épargne classique</div><div class="fw-bold color-accent">${fmtE(gainNet)}</div></div>`;

  // Chart
  const labels = Array.from({length:years+1}, (_,i) => i===0?'Auj.':'+'+i+'a');
  const dataPER = Array.from({length:years+1}, (_,i) => Math.round(
    Array.from({length:i}, (_,j) => versement * Math.pow(1+rate, i-j-1)).reduce((a,b)=>a+b,0)
  ));
  const dataSans = Array.from({length:years+1}, (_,i) => versement * i);

  makeLine('chartPerSim', labels, [
    { label: 'Avec PER (7%/an)', data: dataPER, borderColor:'#fbbf24', backgroundColor:'rgba(251,191,36,0.08)', tension:0.4, fill:true, pointRadius:0, borderWidth:2 },
    { label: 'Épargne classique', data: dataSans, borderColor:'#6b7280', backgroundColor:'transparent', tension:0, fill:false, pointRadius:0, borderWidth:1.5, borderDash:[4,4] },
  ]);
}

// ── PWA INIT ──────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ── SPLASH SCREEN — disparaît toujours, même en cas d'erreur ──
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('hidden');
  setTimeout(() => splash.remove(), 400);
}

// Forcer la disparition après 1.5s max quoi qu'il arrive
setTimeout(hideSplash, 1500);
window.addEventListener('load', () => setTimeout(hideSplash, 300));

// Démarrage async : auth Supabase → chargement données → rendu
initApp().catch(e => {
  console.error('Init error:', e);
  hideSplash();
});

// ══════════════════════════════════════════════════════════════
//  DIVIDENDES — Analyse complète
// ══════════════════════════════════════════════════════════════

function renderDividendsPage() {
  const dividends = getData('dividends', []);
  const received  = dividends.filter(d => d.amount > 0);
  const { totalValue } = computeTotals();

  // ── KPIs ──
  const totalReceived = received.reduce((s, d) => s + (d.amount || 0), 0);
  document.getElementById('div-total-received').textContent = fmt(totalReceived, 2);
  document.getElementById('div-count').textContent = `${received.length} versement${received.length > 1 ? 's' : ''}`;

  // Rendement annualisé = total reçu / valeur totale
  const yieldPct = totalValue > 0 ? (totalReceived / totalValue) * 100 : 0;
  document.getElementById('div-yield').textContent = `${yieldPct.toFixed(2)}%`;

  // Mensuel moyen
  const monthly = totalReceived / 12;
  document.getElementById('div-monthly').textContent = fmt(monthly, 2);

  // Prochain dividende (depuis les dividendes futurs = amount 0 avec date future)
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = dividends.filter(d => d.amount === 0 && d.date > today).sort((a, b) => a.date.localeCompare(b.date));
  if (upcoming.length) {
    document.getElementById('div-next').textContent = upcoming[0].date;
    document.getElementById('div-next-company').textContent = upcoming[0].company;
  } else {
    document.getElementById('div-next').textContent = '–';
    document.getElementById('div-next-company').textContent = 'Aucun planifié';
  }

  // ── PAR SOCIÉTÉ ──
  const byCo = {};
  received.forEach(d => {
    if (!byCo[d.company]) byCo[d.company] = { total: 0, count: 0, amounts: [] };
    byCo[d.company].total  += d.amount;
    byCo[d.company].count  += 1;
    byCo[d.company].amounts.push(d.amount);
  });

  const byCoSorted = Object.entries(byCo).sort((a, b) => b[1].total - a[1].total);
  const maxDiv = byCoSorted[0]?.[1].total || 1;

  document.getElementById('div-total-label').textContent = `Total : ${fmt(totalReceived, 2)}`;

  document.getElementById('div-by-company').innerHTML = byCoSorted.map(([co, d]) => {
    const share = (d.total / totalReceived) * 100;
    const barW  = (d.total / maxDiv) * 100;
    // Croissance : comparer dernier vs premier versement
    let growthHtml = '';
    if (d.amounts.length > 1) {
      const growth = ((d.amounts[d.amounts.length - 1] - d.amounts[0]) / d.amounts[0]) * 100;
      const col = growth >= 0 ? 'var(--green)' : 'var(--red)';
      growthHtml = `<span style="font-size:11px;color:${col};margin-left:6px;">${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth).toFixed(1)}%</span>`;
    }
    return `
      <div style="margin-bottom:14px;">
        <div class="flex-between" style="margin-bottom:5px;">
          <div style="font-size:13px;font-weight:500;">${co} ${growthHtml}</div>
          <div style="text-align:right;">
            <span style="font-weight:600;color:var(--green);">${fmt(d.total, 2)}</span>
            <span style="font-size:11px;color:var(--muted2);margin-left:6px;">${share.toFixed(1)}%</span>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="background:var(--green);width:${barW}%;opacity:0.8;"></div>
        </div>
        <div style="font-size:11px;color:var(--muted2);margin-top:3px;">${d.count} versement${d.count > 1 ? 's' : ''}</div>
      </div>`;
  }).join('') || '<div class="empty-state"><div class="icon">💰</div><p>Importez votre DASHBOARD Google Sheets pour voir vos dividendes</p></div>';

  // ── GRAPHIQUE MENSUEL ──
  const monthlyMap = {};
  received.forEach(d => {
    if (!d.date) return;
    const m = d.date.slice(0, 7); // "2026-01"
    monthlyMap[m] = (monthlyMap[m] || 0) + d.amount;
  });
  const months = Object.keys(monthlyMap).sort();
  const monthLabels = months.map(m => {
    const [y, mo] = m.split('-');
    return new Date(+y, +mo - 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  });

  destroyChart('chartDividends');
  const ctx = document.getElementById('chartDividends')?.getContext('2d');
  if (ctx && months.length) {
    chartInstances['chartDividends'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: monthLabels,
        datasets: [{
          data: months.map(m => monthlyMap[m]),
          backgroundColor: 'rgba(34,197,94,0.25)',
          borderColor: '#22c55e',
          borderWidth: 1.5,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y, 2) } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#52525b', font: { size: 11 } }, border: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#52525b', font: { size: 11 }, callback: v => fmt(v) }, border: { display: false } }
        }
      }
    });
  }

  // ── RENDEMENT PAR POSITION ──
  const yieldRows = [];
  assets.forEach(a => {
    if (a.type !== 'stock' && a.type !== 'esop') return;
    const co = byCo[a.label || a.name] || byCo[Object.keys(byCo).find(k => k.toLowerCase().includes((a.label || a.name).toLowerCase().split(' ')[0]))];
    if (!co) return;
    const val = (a.qty || 1) * (a.currentPrice || 0);
    if (val === 0) return;
    const yld = (co.total / val) * 100;
    const perShare = co.total / (a.qty || 1);
    yieldRows.push({ name: a.label || a.name, val, yld, perShare, divTotal: co.total });
  });
  yieldRows.sort((a, b) => b.yld - a.yld);

  document.getElementById('div-yield-table').innerHTML = yieldRows.length
    ? `<table class="data-table">
        <thead><tr><th>Actif</th><th>Valeur position</th><th>Dividendes reçus</th><th>Par action</th><th>Rendement</th></tr></thead>
        <tbody>
          ${yieldRows.map(r => `<tr>
            <td style="font-weight:500;">${r.name}</td>
            <td>${fmt(r.val)}</td>
            <td style="color:var(--green);font-weight:500;">${fmt(r.divTotal, 2)}</td>
            <td>${fmt(r.perShare, 2)}</td>
            <td><span style="color:var(--green);font-weight:600;">${r.yld.toFixed(2)}%</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<div class="text-xs color-muted" style="padding:12px 0;">Importez vos actifs avec leurs données pour voir le rendement par position.</div>';

  // ── PROJECTION ──
  renderDivProjection();
}

function renderDivProjection() {
  const dividends = getData('dividends', []);
  const received  = dividends.filter(d => d.amount > 0);
  const base      = received.reduce((s, d) => s + (d.amount || 0), 0);
  const growth    = parseFloat(document.getElementById('divGrowthSlider')?.value || 5) / 100;
  const years     = 10;

  const projData = Array.from({ length: years + 1 }, (_, i) => ({
    year: new Date().getFullYear() + i,
    annual: base * Math.pow(1 + growth, i),
    monthly: (base * Math.pow(1 + growth, i)) / 12
  }));

  // Stats
  const end = projData[years];
  document.getElementById('divProjectionStats').innerHTML = `
    <div class="fee-item"><div class="text-sm">Dividendes annuels en ${end.year}</div><div class="fw-bold" style="color:var(--green);">${fmt(end.annual, 2)}</div></div>
    <div class="fee-item"><div class="text-sm">Revenu mensuel en ${end.year}</div><div class="fw-bold" style="color:var(--green);">${fmt(end.monthly, 2)}</div></div>
    <div class="fee-item"><div class="text-sm">Croissance totale</div><div class="fw-bold">${((Math.pow(1 + growth, years) - 1) * 100).toFixed(1)}%</div></div>`;

  destroyChart('chartDivProjection');
  const ctx = document.getElementById('chartDivProjection')?.getContext('2d');
  if (ctx) {
    chartInstances['chartDivProjection'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: projData.map(d => d.year),
        datasets: [{
          label: 'Dividendes annuels',
          data: projData.map(d => Math.round(d.annual)),
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.08)',
          tension: 0.4, fill: true, pointRadius: 4,
          pointBackgroundColor: '#22c55e', borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y, 2) + '/an' } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#52525b', font: { size: 11 } }, border: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#52525b', callback: v => fmt(v), font: { size: 11 } }, border: { display: false } }
        }
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════
//  ANALYSE IA — Powered by Claude
// ══════════════════════════════════════════════════════════════

function renderAIPage() {
  if (!assets.length) {
    document.getElementById('aiEmpty').style.display    = 'block';
    document.getElementById('aiResults').style.display  = 'none';
    document.getElementById('aiLoading').style.display  = 'none';
  } else {
    document.getElementById('aiEmpty').style.display    = 'none';
    document.getElementById('aiResults').style.display  = 'none';
  }
}

async function runAIAnalysis() {
  if (!assets.length) {
    toast('Importez d\'abord vos actifs pour analyser', 'var(--red)');
    return;
  }

  // Afficher loading
  document.getElementById('aiLoading').style.display  = 'block';
  document.getElementById('aiResults').style.display  = 'none';
  document.getElementById('aiEmpty').style.display    = 'none';
  document.getElementById('aiAnalyzeBtn').disabled    = true;

  try {
    const { totalValue, totalInvested, pnl, pnlPct, byType } = computeTotals();
    const dividends = getData('dividends', []);
    const totalDiv  = dividends.filter(d => d.amount > 0).reduce((s, d) => s + d.amount, 0);

    // Préparer le résumé du portefeuille pour l'IA
    const topAssets = [...assets]
      .sort((a, b) => ((b.qty||1)*(b.currentPrice||0)) - ((a.qty||1)*(a.currentPrice||0)))
      .slice(0, 15)
      .map(a => {
        const val  = (a.qty||1) * (a.currentPrice||0);
        const inv  = (a.qty||1) * (a.buyPrice||a.currentPrice||0);
        const pnlA = inv > 0 ? ((val - inv)/inv*100).toFixed(1) : 0;
        return `${a.label||a.name} (${a.type}) : ${fmt(val)} | P&L: ${pnlA}% | Poids: ${totalValue > 0 ? (val/totalValue*100).toFixed(1) : 0}%`;
      }).join('\n');

    const stockCount  = assets.filter(a => a.type === 'stock').length;
    const cryptoCount = assets.filter(a => a.type === 'crypto').length;
    const esopCount   = assets.filter(a => a.type === 'esop').length;

    const prompt = `Tu es un conseiller financier expert. Analyse ce portefeuille d'investissement et fournis une analyse détaillée en JSON.

DONNÉES DU PORTEFEUILLE :
- Valeur totale : ${fmt(totalValue)}
- Investi total : ${fmt(totalInvested)}
- P&L total : ${fmt(pnl)} (${(pnlPct).toFixed(2)}%)
- Actions/ETF : ${fmt(byType.stock||0)} (${stockCount} positions)
- Crypto : ${fmt(byType.crypto||0)} (${cryptoCount} actifs)
- Épargne salariale : ${fmt(byType.esop||0)} (${esopCount} positions)
- Épargne bancaire : ${fmt(byType.savings||0)}
- Dividendes reçus : ${fmt(totalDiv, 2)}
- Taux épargne mensuel : ${salary.saved > 0 ? ((salary.saved/(salary.net||1))*100).toFixed(1) : '?'}%

TOP POSITIONS :
${topAssets}

Réponds UNIQUEMENT en JSON valide (sans backticks ni markdown), avec cette structure exacte :
{
  "score": 7,
  "summary": "Résumé en 2-3 phrases du portefeuille",
  "strengths": ["Point fort 1", "Point fort 2", "Point fort 3"],
  "weaknesses": ["Point faible 1", "Point faible 2", "Point faible 3"],
  "recommendations": [
    {"title": "Titre court", "description": "Description actionnable", "priority": "haute|moyenne|faible"},
    {"title": "Titre court", "description": "Description actionnable", "priority": "haute|moyenne|faible"},
    {"title": "Titre court", "description": "Description actionnable", "priority": "haute|moyenne|faible"}
  ],
  "risks": [
    {"name": "Risque 1", "level": "élevé|moyen|faible", "description": "Explication"},
    {"name": "Risque 2", "level": "élevé|moyen|faible", "description": "Explication"}
  ],
  "opportunities": [
    {"title": "Opportunité 1", "description": "Explication concrète"},
    {"title": "Opportunité 2", "description": "Explication concrète"}
  ]
}`;

    // Appel API Claude
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const raw  = data.content?.[0]?.text || '';

    // Parser le JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse IA invalide');
    const analysis = JSON.parse(jsonMatch[0]);

    renderAIResults(analysis);

  } catch(e) {
    toast('Erreur analyse IA : ' + e.message, 'var(--red)');
    console.error(e);
  } finally {
    document.getElementById('aiLoading').style.display = 'none';
    document.getElementById('aiAnalyzeBtn').disabled   = false;
  }
}

function renderAIResults(a) {
  document.getElementById('aiResults').style.display = 'block';

  // Score
  const score = Math.max(0, Math.min(10, a.score || 5));
  const scoreColor = score >= 7 ? '#22c55e' : score >= 5 ? '#f59e0b' : '#ef4444';
  const scoreCircle = document.getElementById('aiScoreCircle');
  if (scoreCircle) {
    scoreCircle.style.background = `rgba(${score >= 7 ? '34,197,94' : score >= 5 ? '245,158,11' : '239,68,68'},0.1)`;
    scoreCircle.style.border     = `2px solid ${scoreColor}`;
  }
  const scoreEl = document.getElementById('aiScoreVal');
  if (scoreEl) { scoreEl.textContent = score; scoreEl.style.color = scoreColor; }
  const summaryEl = document.getElementById('aiScoreSummary');
  if (summaryEl) summaryEl.textContent = a.summary || '';

  // Points forts
  const strengthsEl = document.getElementById('aiStrengthsList');
  if (strengthsEl) {
    strengthsEl.innerHTML = (a.strengths || []).map(s => `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
        <span style="color:var(--green);flex-shrink:0;font-size:16px;">✓</span>
        <span style="font-size:13px;line-height:1.5;">${s}</span>
      </div>`).join('');
  }

  // Points faibles
  const weakEl = document.getElementById('aiWeaknessesList');
  if (weakEl) {
    weakEl.innerHTML = (a.weaknesses || []).map(w => `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
        <span style="color:var(--gold);flex-shrink:0;font-size:16px;">!</span>
        <span style="font-size:13px;line-height:1.5;">${w}</span>
      </div>`).join('');
  }

  // Recommandations
  const priorityColor = { haute: 'var(--red)', moyenne: 'var(--gold)', faible: 'var(--muted2)' };
  const recoEl = document.getElementById('aiRecommendations');
  if (recoEl) {
    recoEl.innerHTML = (a.recommendations || []).map((r, i) => `
      <div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;flex-shrink:0;">${i+1}</div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <span style="font-size:14px;font-weight:600;">${r.title}</span>
            <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(255,255,255,0.05);color:${priorityColor[r.priority]||'var(--muted2)'};font-weight:500;">${r.priority||'–'}</span>
          </div>
          <div style="font-size:13px;color:var(--muted2);line-height:1.6;">${r.description}</div>
        </div>
      </div>`).join('');
  }

  // Risques
  const riskColor = { 'élevé': 'var(--red)', 'moyen': 'var(--gold)', 'faible': 'var(--green)' };
  const risksEl = document.getElementById('aiRisks');
  if (risksEl) {
    risksEl.innerHTML = (a.risks || []).map(r => `
      <div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--border);">
        <div style="width:8px;height:8px;border-radius:50%;background:${riskColor[r.level]||'var(--muted2)'};margin-top:5px;flex-shrink:0;"></div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
            <span style="font-weight:600;font-size:13px;">${r.name}</span>
            <span style="font-size:11px;color:${riskColor[r.level]||'var(--muted2)'};">${r.level}</span>
          </div>
          <div style="font-size:12px;color:var(--muted2);line-height:1.5;">${r.description}</div>
        </div>
      </div>`).join('');
  }

  // Opportunités
  const oppsEl = document.getElementById('aiOpportunities');
  if (oppsEl) {
    oppsEl.innerHTML = (a.opportunities || []).map(o => `
      <div style="padding:14px;background:var(--surface2);border-radius:8px;margin-bottom:8px;">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px;color:var(--accent2);">🚀 ${o.title}</div>
        <div style="font-size:13px;color:var(--muted2);line-height:1.6;">${o.description}</div>
      </div>`).join('');
  }

  // Scroll vers les résultats
  document.getElementById('aiResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ══════════════════════════════════════════════════════════════
//  SIMULATION PRÊT BANCAIRE
// ══════════════════════════════════════════════════════════════

// État partagé entre les tabs
let pretData = {};

function switchPretTab(tab) {
  ['mensualite','capacite','comparatif'].forEach(t => {
    const content = document.getElementById(`tabContent-${t}`);
    const btn     = document.getElementById(`tab${t.charAt(0).toUpperCase()+t.slice(1).replace('mensualite','Mens').replace('capacite','Capa').replace('comparatif','Comp')}`);
    if (content) content.style.display = t === tab ? 'block' : 'none';
  });
  // Style boutons
  document.getElementById('tabMens').style.background  = tab==='mensualite' ? 'var(--accent)' : 'transparent';
  document.getElementById('tabMens').style.color        = tab==='mensualite' ? 'white' : 'var(--muted2)';
  document.getElementById('tabCapa').style.background  = tab==='capacite'   ? 'var(--accent)' : 'transparent';
  document.getElementById('tabCapa').style.color        = tab==='capacite'   ? 'white' : 'var(--muted2)';
  document.getElementById('tabComp').style.background  = tab==='comparatif' ? 'var(--accent)' : 'transparent';
  document.getElementById('tabComp').style.color        = tab==='comparatif' ? 'white' : 'var(--muted2)';

  if (tab === 'mensualite') calcMensualite();
  if (tab === 'capacite')   calcCapacite();
  if (tab === 'comparatif') calcComparatif();
}

function initPret() {
  // Pré-remplir salaire si dispo
  if (salary.net && !document.getElementById('revenusMensuels').value) {
    document.getElementById('revenusMensuels').value = Math.round(salary.net);
  }
  // Pré-remplir apport depuis patrimoine bancaire
  const { bankTotal } = computeTotals();
  if (bankTotal > 0 && !document.getElementById('apport').value) {
    document.getElementById('apport').value = Math.round(bankTotal * 0.8); // 80% de l'épargne comme apport
  }
  calcMensualite();
  calcCapacite();
  calcComparatif();
}

// ── Calcul mensualité ─────────────────────────────────────────
function calcMensualite() {
  const prix        = parseFloat(document.getElementById('prixBien')?.value)       || 0;
  const apport      = parseFloat(document.getElementById('apport')?.value)          || 0;
  const taux        = parseFloat(document.getElementById('tauxPret')?.value)        || 3.5;
  const duree       = parseFloat(document.getElementById('dureePret')?.value)       || 20;
  const assurance   = parseFloat(document.getElementById('assurancePret')?.value)   || 0.3;
  const fraisNotaire= parseFloat(document.getElementById('fraisNotaire')?.value)    || 0;

  const capital = Math.max(0, prix - apport);
  document.getElementById('capitalEmprunte').textContent = fmt(capital);

  if (capital <= 0 || taux <= 0 || duree <= 0) return;

  const n  = duree * 12;             // nombre de mensualités
  const tm = taux / 100 / 12;        // taux mensuel

  // Mensualité hors assurance (formule amortissement)
  const mensHors = tm === 0 ? capital / n : capital * (tm * Math.pow(1 + tm, n)) / (Math.pow(1 + tm, n) - 1);

  // Assurance mensuelle
  const mensAssur = capital * (assurance / 100) / 12;
  const mensTotale = mensHors + mensAssur;

  const totalPaye      = mensHors * n;
  const totalInterets  = totalPaye - capital;
  const totalCredit    = totalPaye + mensAssur * n;
  const tauxEffort     = salary.net > 0 ? (mensTotale / salary.net) * 100 : 0;

  // Afficher
  document.getElementById('mensualiteTotale').textContent  = fmt(mensTotale, 0) + ' €/mois';
  document.getElementById('partAssurance').textContent     = fmt(mensAssur, 0) + ' €/mois';
  document.getElementById('resCapital').textContent        = fmt(capital);
  document.getElementById('resTotalInterets').textContent  = fmt(totalInterets);
  document.getElementById('resTotalCredit').textContent    = fmt(totalCredit);
  document.getElementById('resTauxEffort').textContent     = tauxEffort > 0 ? `${tauxEffort.toFixed(1)}%` : '–';
  document.getElementById('resTauxEffort').style.color     = tauxEffort > 35 ? 'var(--red)' : tauxEffort > 25 ? 'var(--gold)' : 'var(--green)';

  // Conseil apport
  const pctApport = prix > 0 ? (apport / prix) * 100 : 0;
  const conseilEl = document.getElementById('conseilApport');
  if (pctApport >= 20) {
    conseilEl.style.background = 'rgba(34,197,94,0.08)';
    conseilEl.style.border     = '1px solid rgba(34,197,94,0.2)';
    conseilEl.innerHTML = `✅ <b style="color:var(--green)">Excellent apport (${pctApport.toFixed(1)}%)</b> — Vous bénéficierez des meilleurs taux. Les banques apprécient un apport ≥ 20%.`;
  } else if (pctApport >= 10) {
    conseilEl.style.background = 'rgba(245,158,11,0.08)';
    conseilEl.style.border     = '1px solid rgba(245,158,11,0.2)';
    conseilEl.innerHTML = `⚠️ <b style="color:var(--gold)">Apport correct (${pctApport.toFixed(1)}%)</b> — Un apport de 10-20% est accepté. Avec 20% (${fmt(prix * 0.20)}), vous économiseriez <b>${fmt((mensHors - (taux > 0 ? (prix*0.80) * ((taux/100/12) * Math.pow(1+taux/100/12,n)) / (Math.pow(1+taux/100/12,n)-1) : 0)) * n)}</b> d'intérêts.`;
  } else {
    conseilEl.style.background = 'rgba(239,68,68,0.08)';
    conseilEl.style.border     = '1px solid rgba(239,68,68,0.2)';
    conseilEl.innerHTML = `❌ <b style="color:var(--red)">Apport insuffisant (${pctApport.toFixed(1)}%)</b> — La plupart des banques exigent minimum 10% (${fmt(prix * 0.10)}). Sans apport, taux majoré et assurance obligatoire.`;
  }

  // Stocker pour tableau amortissement
  pretData = { capital, tm, n, mensHors, mensAssur, duree };
  buildAmortTable();
  updateAmortChart();

  // Ajuster slider max durée
  document.getElementById('amortYear').max = duree;
}

// ── Tableau d'amortissement ───────────────────────────────────
function buildAmortTable() {
  const { capital, tm, n, mensHors, duree } = pretData;
  if (!capital || !mensHors) return;

  let restant = capital;
  const tbody = document.getElementById('amortTbody');
  let rows = '';

  for (let annee = 1; annee <= duree; annee++) {
    let interetsAnnee = 0, capitalAnnee = 0;
    for (let m = 0; m < 12; m++) {
      const inter = restant * tm;
      const cap   = mensHors - inter;
      interetsAnnee += inter;
      capitalAnnee  += cap;
      restant       -= cap;
    }
    const totalAnnee = (mensHors * 12);
    const restantOk  = Math.max(0, restant);
    rows += `<tr>
      <td style="font-weight:500;">Année ${annee}</td>
      <td style="color:var(--accent2);">${fmt(restantOk)}</td>
      <td style="color:var(--red);">${fmt(interetsAnnee)}</td>
      <td style="color:var(--green);">${fmt(capitalAnnee)}</td>
      <td>${fmt(totalAnnee)}</td>
    </tr>`;
  }
  if (tbody) tbody.innerHTML = rows;
}

function updateAmortChart() {
  const { capital, tm, n, mensHors, duree } = pretData;
  if (!capital || !mensHors || !duree) return;

  const yearSel   = parseInt(document.getElementById('amortYear')?.value || 1);
  const labels    = [];
  const dataInter = [];
  const dataCap   = [];
  let restant     = capital;

  for (let annee = 1; annee <= duree; annee++) {
    let interAn = 0, capAn = 0;
    for (let m = 0; m < 12; m++) {
      const inter = restant * tm;
      const cap   = mensHors - inter;
      interAn  += inter;
      capAn    += cap;
      restant  -= cap;
    }
    labels.push(`A${annee}`);
    dataInter.push(Math.round(interAn));
    dataCap.push(Math.round(capAn));
  }

  destroyChart('chartAmort');
  const ctx = document.getElementById('chartAmort')?.getContext('2d');
  if (!ctx) return;

  chartInstances['chartAmort'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Capital remboursé', data: dataCap,   backgroundColor: 'rgba(139,92,246,0.5)', borderColor: '#8b5cf6', borderWidth: 1, borderRadius: 3 },
        { label: 'Intérêts',          data: dataInter, backgroundColor: 'rgba(239,68,68,0.35)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 3 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#71717a', font: { size: 11, family: 'Inter' }, boxWidth: 10 } },
        tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fmt(c.parsed.y)}` } }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: '#52525b', font: { size: 10 } }, border: { display: false } },
        y: { stacked: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#52525b', callback: v => fmt(v), font: { size: 10 } }, border: { display: false } }
      }
    }
  });
}

// ── Capacité d'emprunt ────────────────────────────────────────
function calcCapacite() {
  const revenus   = parseFloat(document.getElementById('revenusMensuels')?.value) || 0;
  const charges   = parseFloat(document.getElementById('chargesMensuelles')?.value) || 0;
  const apport    = parseFloat(document.getElementById('apportCapa')?.value)       || 0;
  const taux      = parseFloat(document.getElementById('tauxCapa')?.value)         || 3.5;
  const duree     = parseFloat(document.getElementById('dureeCapa')?.value)        || 20;
  const tauxEndet = parseFloat(document.getElementById('tauxEndetMax')?.value)     || 35;

  if (revenus <= 0) return;

  const mensMax = (revenus * tauxEndet / 100) - charges;
  const tm      = taux / 100 / 12;
  const n       = duree * 12;

  // Capital empruntable depuis mensualité max
  const capacite = mensMax > 0 && tm > 0
    ? mensMax * (Math.pow(1+tm,n) - 1) / (tm * Math.pow(1+tm,n))
    : mensMax * n;

  const budget         = capacite + apport;
  const resteVivre     = revenus - charges - mensMax;
  const tauxEndettReal = revenus > 0 ? ((mensMax + charges) / revenus) * 100 : 0;
  const apportReco     = budget * 0.10; // 10% minimum

  // Afficher
  document.getElementById('capaciteEmprunt').textContent  = fmt(Math.max(0, capacite));
  document.getElementById('budgetTotal').textContent       = fmt(Math.max(0, budget));
  document.getElementById('mensualiteMax').textContent     = fmt(Math.max(0, mensMax), 0) + ' €';
  document.getElementById('resteAVivre').textContent       = fmt(resteVivre);
  document.getElementById('resteAVivre').style.color       = resteVivre < 500 ? 'var(--red)' : resteVivre < 1000 ? 'var(--gold)' : 'var(--green)';
  document.getElementById('tauxEndettement').textContent   = `${tauxEndettReal.toFixed(1)}%`;
  document.getElementById('tauxEndettement').style.color   = tauxEndettReal > 35 ? 'var(--red)' : tauxEndettReal > 25 ? 'var(--gold)' : 'var(--green)';
  document.getElementById('apportReco').textContent        = fmt(apportReco);

  // Conseil
  const conseilEl = document.getElementById('conseilCapacite');
  if (conseilEl) {
    if (mensMax <= 0) {
      conseilEl.style.background = 'rgba(239,68,68,0.08)';
      conseilEl.style.border     = '1px solid rgba(239,68,68,0.2)';
      conseilEl.innerHTML = `❌ <b style="color:var(--red)">Capacité nulle</b> — Vos charges dépassent déjà le seuil d'endettement autorisé. Réduisez vos charges ou augmentez vos revenus.`;
    } else if (resteVivre < 500) {
      conseilEl.style.background = 'rgba(245,158,11,0.08)';
      conseilEl.style.border     = '1px solid rgba(245,158,11,0.2)';
      conseilEl.innerHTML = `⚠️ <b style="color:var(--gold)">Reste à vivre serré (${fmt(resteVivre)})</b> — Techniquement empruntable mais risqué. Les banques regardent le reste à vivre : minimum 700-800€/mois conseillé.`;
    } else {
      conseilEl.style.background = 'rgba(34,197,94,0.08)';
      conseilEl.style.border     = '1px solid rgba(34,197,94,0.2)';
      conseilEl.innerHTML = `✅ <b style="color:var(--green)">Profil solide</b> — Reste à vivre confortable (${fmt(resteVivre)}). Avec un apport de ${fmt(apportReco)} (10% minimum), votre budget immobilier atteint <b>${fmt(budget)}</b>.`;
    }
  }

  // Graphique capacité selon durée
  const durees    = [10, 15, 20, 25, 30];
  const capacites = durees.map(d => {
    const nd = d * 12;
    return mensMax > 0 && tm > 0
      ? Math.round(mensMax * (Math.pow(1+tm,nd)-1) / (tm * Math.pow(1+tm,nd)))
      : Math.round(mensMax * nd);
  });

  destroyChart('chartCapacite');
  const ctx = document.getElementById('chartCapacite')?.getContext('2d');
  if (ctx) {
    chartInstances['chartCapacite'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: durees.map(d => `${d} ans`),
        datasets: [{
          label: 'Capacité d\'emprunt',
          data: capacites,
          backgroundColor: durees.map(d => d === duree ? 'rgba(139,92,246,0.6)' : 'rgba(139,92,246,0.2)'),
          borderColor: '#8b5cf6',
          borderWidth: 1.5,
          borderRadius: 5,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y) } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#52525b', font: { size: 11 } }, border: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#52525b', callback: v => fmt(v), font: { size: 11 } }, border: { display: false } }
        }
      }
    });
  }
}

// ── Comparatif banques ────────────────────────────────────────
function calcComparatif() {
  const capital = parseFloat(document.getElementById('compCapital')?.value) || 270000;
  const duree   = parseFloat(document.getElementById('compDuree')?.value)   || 20;
  const n       = duree * 12;

  const taux    = [2.0, 2.5, 3.0, 3.5, 3.8, 4.0, 4.5, 5.0, 5.5, 6.0];
  const refTaux = 4.0;
  const refMens = capital * ((refTaux/100/12) * Math.pow(1+refTaux/100/12,n)) / (Math.pow(1+refTaux/100/12,n)-1);
  const refTotal = refMens * n;

  const rows = taux.map(t => {
    const tm    = t / 100 / 12;
    const mens  = capital * (tm * Math.pow(1+tm,n)) / (Math.pow(1+tm,n)-1);
    const total = mens * n;
    const inter = total - capital;
    const econ  = refTotal - total;
    const isCurrent = Math.abs(t - 3.5) < 0.1;

    return {
      taux: t, mens, total, inter, econ,
      html: `<tr style="${isCurrent ? 'background:rgba(139,92,246,0.08);' : ''}">
        <td style="font-weight:${isCurrent?'600':'400'};color:${t<=3?'var(--green)':t<=4?'var(--text)':'var(--red)'};">${t.toFixed(1)}%${isCurrent?' ← actuel':''}</td>
        <td style="font-weight:500;">${fmt(mens, 0)} €/mois</td>
        <td style="color:var(--red);">${fmt(inter)}</td>
        <td>${fmt(total)}</td>
        <td style="color:${econ>0?'var(--green)':'var(--red)'};font-weight:500;">${econ>0?'+':''} ${fmt(econ)}</td>
      </tr>`
    };
  });

  document.getElementById('compTbody').innerHTML = rows.map(r => r.html).join('');

  // Graphique coût total
  destroyChart('chartComp');
  const ctx = document.getElementById('chartComp')?.getContext('2d');
  if (ctx) {
    chartInstances['chartComp'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: taux.map(t => t.toFixed(1) + '%'),
        datasets: [
          {
            label: 'Coût total',
            data: rows.map(r => Math.round(r.total)),
            borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.07)',
            tension: 0.4, fill: true, pointRadius: 4, pointBackgroundColor: '#ef4444', borderWidth: 2
          },
          {
            label: 'Capital emprunté',
            data: rows.map(() => capital),
            borderColor: '#52525b', borderDash: [5,5],
            tension: 0, fill: false, pointRadius: 0, borderWidth: 1.5
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { color: '#71717a', font: { size: 11 }, boxWidth: 10 } },
          tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fmt(c.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#52525b', font: { size: 11 } }, border: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#52525b', callback: v => fmt(v), font: { size: 10 } }, border: { display: false } }
        }
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════
//  SIMULATEUR DE PRÊT BANCAIRE
// ══════════════════════════════════════════════════════════════

// ── Onglets ──────────────────────────────────────────────────
function switchLoanTab(tab) {
  ['mensualite','capacite','comparatif'].forEach(t => {
    document.getElementById(`loan-${t}`).style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`tab-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'comparatif') calcComparatif();
  if (tab === 'capacite')   calcCapacite();
}

function setEndettement(pct, btn) {
  document.getElementById('capEndettement').value = pct;
  document.querySelectorAll('#loan-capacite .loan-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  calcCapacite();
}

// ── Helpers mathématiques ─────────────────────────────────────
// Mensualité hors assurance : M = K × [t/(1-(1+t)^-n)]
function calcMensualite(capital, tauxAnnuel, dureeAns) {
  if (capital <= 0 || tauxAnnuel <= 0) return capital / (dureeAns * 12);
  const t = tauxAnnuel / 100 / 12;
  const n = dureeAns * 12;
  return capital * t / (1 - Math.pow(1 + t, -n));
}

// Capital empruntable à partir d'une mensualité max
function calcCapitalMax(mensualiteMax, tauxAnnuel, dureeAns) {
  if (tauxAnnuel <= 0) return mensualiteMax * dureeAns * 12;
  const t = tauxAnnuel / 100 / 12;
  const n = dureeAns * 12;
  return mensualiteMax * (1 - Math.pow(1 + t, -n)) / t;
}

// ── ONGLET 1 : MENSUALITÉS ────────────────────────────────────
function calcLoan() {
  const price      = parseFloat(document.getElementById('loanPrice')?.value) || 0;
  const apport     = parseFloat(document.getElementById('loanApport')?.value) || 0;
  const duree      = parseInt(document.getElementById('loanDuree')?.value) || 20;
  const rate       = parseFloat(document.getElementById('loanRate')?.value) || 3.5;
  const insurance  = parseFloat(document.getElementById('loanInsurance')?.value) || 0.25;
  const notairePct = parseFloat(document.getElementById('loanNotaire')?.value) || 7.5;
  const revenuNet  = salary.net || 0;

  if (!price) return;

  const capital      = Math.max(0, price - apport);
  const fraisNotaire = price * (notairePct / 100);
  const mensualite   = calcMensualite(capital, rate, duree);
  const assuranceMens = capital * (insurance / 100) / 12;
  const mensualiteTot = mensualite + assuranceMens;
  const totalInterets = (mensualite * duree * 12) - capital;
  const totalCredit   = mensualite * duree * 12 + assuranceMens * duree * 12;
  const totalProjet   = price + fraisNotaire + (assuranceMens * duree * 12) + totalInterets;

  // TAEG simplifié
  const taeg = rate + insurance + (notairePct / duree);

  // Taux endettement
  const endettement = revenuNet > 0 ? (mensualiteTot / revenuNet) * 100 : 0;

  // Affichage
  const fmtE = v => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  const fmtE2 = v => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  document.getElementById('loanMonthly').textContent          = fmtE2(mensualiteTot);
  document.getElementById('loanMonthlyInsurance').textContent  = fmtE2(assuranceMens);
  document.getElementById('loanCapital').textContent           = fmtE(capital);
  document.getElementById('loanTotalCost').textContent         = fmtE(totalInterets + assuranceMens * duree * 12);
  document.getElementById('loanInterets').textContent          = fmtE(totalInterets);
  document.getElementById('loanFraisNotaire').textContent      = fmtE(fraisNotaire);
  document.getElementById('loanTotalProjet').textContent       = fmtE(totalProjet);
  document.getElementById('loanTaeg').textContent              = `${taeg.toFixed(2)}%`;

  // Apport %
  const apportPct = price > 0 ? (apport / price) * 100 : 0;
  document.getElementById('loanApportPct').textContent         = `${apportPct.toFixed(1)}% du prix`;
  document.getElementById('loanMontantEmprunte').textContent   = `Emprunté : ${fmtE(capital)}`;

  // Taux endettement
  const endColor = endettement <= 25 ? 'var(--green)' : endettement <= 35 ? 'var(--gold)' : 'var(--red)';
  const endLabel = endettement <= 25 ? '✓ Excellent' : endettement <= 33 ? '✓ Acceptable' : endettement <= 35 ? '⚠ Limite' : '✗ Trop élevé';
  document.getElementById('loanEndettementPct').textContent   = revenuNet > 0 ? `${endettement.toFixed(1)}%` : '– (renseignez votre salaire)';
  document.getElementById('loanEndettementBadge').textContent = revenuNet > 0 ? endLabel : '–';
  document.getElementById('loanEndettementBadge').style.background = `${endColor}20`;
  document.getElementById('loanEndettementBadge').style.color      = endColor;
  document.getElementById('loanEndettementBar').style.width         = `${Math.min(endettement / 0.7, 100)}%`;
  document.getElementById('loanEndettementBar').style.background    = endColor;

  // Graphique + tableau amortissement
  renderAmortissement(capital, rate, duree, assuranceMens, fmtE);
}

function renderAmortissement(capital, tauxAnnuel, dureeAns, assuranceMens, fmtE) {
  const t = tauxAnnuel / 100 / 12;
  const n = dureeAns * 12;
  const mensualite = calcMensualite(capital, tauxAnnuel, dureeAns);

  // Données annuelles pour le graphique
  const years = [];
  const capitalData = [];
  const interetsData = [];
  let solde = capital;
  let totalCapRembourse = 0;
  let totalInterets = 0;
  const tableRows = [];

  for (let m = 1; m <= n; m++) {
    const interet = solde * t;
    const capRemb = mensualite - interet;
    solde -= capRemb;
    totalCapRembourse += capRemb;
    totalInterets += interet;

    if (m % 12 === 0) {
      const yr = m / 12;
      years.push(`Année ${yr}`);
      capitalData.push(Math.round(totalCapRembourse));
      interetsData.push(Math.round(totalInterets));
      tableRows.push({ year: yr, mensualite, interet: interet * 12, capRemb: capRemb * 12, solde: Math.max(0, solde) });
    }
  }

  // Graphique
  destroyChart('chartAmortissement');
  const ctx = document.getElementById('chartAmortissement')?.getContext('2d');
  if (ctx) {
    chartInstances['chartAmortissement'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          { label: 'Capital remboursé', data: capitalData, backgroundColor: 'rgba(139,92,246,0.5)', borderRadius: 2 },
          { label: 'Intérêts payés',    data: interetsData, backgroundColor: 'rgba(239,68,68,0.4)', borderRadius: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { color: '#71717a', font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fmtE(c.parsed.y)}` } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: '#52525b', font: { size: 10 }, maxTicksLimit: 10 } },
          y: { stacked: false, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#52525b', font: { size: 10 }, callback: v => fmtE(v) } }
        }
      }
    });
  }

  // Tableau
  const amortEl = document.getElementById('loanAmortTable');
  if (amortEl) {
    amortEl.innerHTML = `<table class="data-table" style="font-size:12px;">
      <thead><tr><th>Année</th><th>Mensualité</th><th>Intérêts</th><th>Capital</th><th>Capital restant</th></tr></thead>
      <tbody>${tableRows.map(r => `<tr>
        <td style="font-weight:500;">An ${r.year}</td>
        <td>${fmtE(r.mensualite)}/mois</td>
        <td style="color:var(--red);">${fmtE(r.interet)}</td>
        <td style="color:var(--accent2);">${fmtE(r.capRemb)}</td>
        <td style="color:var(--muted2);">${fmtE(r.solde)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
}

// ── ONGLET 2 : CAPACITÉ D'EMPRUNT ────────────────────────────
function calcCapacite() {
  const revenu    = parseFloat(document.getElementById('capRevenu')?.value) || salary.net || 0;
  const charges   = parseFloat(document.getElementById('capCharges')?.value) || 0;
  const apport    = parseFloat(document.getElementById('capApport')?.value) || 0;
  const duree     = parseInt(document.getElementById('capDuree')?.value) || 20;
  const rate      = parseFloat(document.getElementById('capRate')?.value) || 3.5;
  const endMax    = parseInt(document.getElementById('capEndettement')?.value) || 33;

  if (!revenu) return;

  const fmtE = v => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);

  // Mensualité max disponible
  const mensMax    = (revenu * endMax / 100) - charges;
  // Capital empruntable
  const capitalMax = calcCapitalMax(Math.max(0, mensMax), rate, duree);
  const capaciteMax = capitalMax + apport;
  // Budget avec frais notaire (on enlève 7.5% du budget total)
  const budgetSansNotaire = capaciteMax / 1.075;
  const rav = revenu - mensMax - charges;

  document.getElementById('capMax').textContent          = fmtE(capaciteMax);
  document.getElementById('capApportDisplay').textContent = fmtE(apport);
  document.getElementById('capMensualite').textContent   = fmtE(Math.max(0, mensMax));
  document.getElementById('capRav').textContent          = fmtE(Math.max(0, rav));
  document.getElementById('capBudgetTotal').textContent  = fmtE(budgetSansNotaire);
  document.getElementById('capRevenuDispo').textContent  = fmtE(revenu - charges);

  // Scénarios selon durées
  const scenarDurees = [10, 15, 20, 25, 30];
  document.getElementById('capScenarios').innerHTML = scenarDurees.map(d => {
    const cap = calcCapitalMax(Math.max(0, mensMax), rate, d) + apport;
    const isCurrent = d === duree;
    return `<div class="fee-item" style="${isCurrent ? 'background:rgba(139,92,246,0.06);margin:0 -12px;padding:12px;border-radius:6px;' : ''}">
      <div style="font-size:13px;${isCurrent ? 'font-weight:600;' : ''}">
        ${d} ans ${isCurrent ? '<span style="font-size:11px;color:var(--accent2);margin-left:6px;">← actuel</span>' : ''}
      </div>
      <div style="font-size:14px;font-weight:600;color:${isCurrent ? 'var(--accent2)' : 'var(--text)'};">${fmtE(cap)}</div>
    </div>`;
  }).join('');

  // Conseils
  const conseils = [];
  if (apportPct(apport, capaciteMax) < 10) conseils.push({ icon: '⚠️', text: 'Votre apport est inférieur à 10%. Les banques recommandent au minimum 10-20% du prix pour couvrir les frais de notaire.', color: 'var(--gold)' });
  else if (apportPct(apport, capaciteMax) >= 20) conseils.push({ icon: '✅', text: `Excellent apport (${apportPct(apport, capaciteMax).toFixed(0)}%). Vous obtiendrez de meilleures conditions de prêt.`, color: 'var(--green)' });
  if (charges > 0) conseils.push({ icon: '💡', text: `Vos charges actuelles (${fmtE(charges)}/mois) réduisent votre capacité. Rembourser vos crédits existants augmenterait votre budget de ${fmtE(calcCapitalMax(charges, rate, duree))}.`, color: 'var(--accent2)' });
  if (rav < 800) conseils.push({ icon: '⚠️', text: `Votre reste à vivre (${fmtE(rav)}/mois) est inférieur à 800€. Les banques pourraient refuser votre dossier.`, color: 'var(--red)' });
  conseils.push({ icon: '🏦', text: 'Faites jouer la concurrence : comparez au moins 3 banques et faites appel à un courtier pour économiser jusqu\'à 0.5% de taux.', color: 'var(--muted2)' });

  document.getElementById('capConseils').innerHTML = conseils.map(c => `
    <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:18px;flex-shrink:0;">${c.icon}</span>
      <span style="font-size:13px;color:${c.color};line-height:1.6;">${c.text}</span>
    </div>`).join('');
}

function apportPct(apport, total) { return total > 0 ? (apport / total) * 100 : 0; }

// ── ONGLET 3 : COMPARATIF BANQUES ────────────────────────────
const BANQUES = [
  { nom: 'Caisse d\'Épargne', taux20: 3.48, taux15: 3.22, taux25: 3.68, logo: '🐿️', type: 'Votre banque', highlight: true },
  { nom: 'Crédit Agricole',    taux20: 3.45, taux15: 3.20, taux25: 3.65, logo: '🌾', type: 'Banque régionale' },
  { nom: 'BNP Paribas',       taux20: 3.50, taux15: 3.25, taux25: 3.70, logo: '🦁', type: 'Banque nationale' },
  { nom: 'Société Générale',  taux20: 3.40, taux15: 3.15, taux25: 3.60, logo: '🔴', type: 'Banque nationale' },
  { nom: 'LCL',               taux20: 3.55, taux15: 3.30, taux25: 3.75, logo: '🔵', type: 'Banque nationale' },
  { nom: 'Banque Populaire',  taux20: 3.42, taux15: 3.18, taux25: 3.62, logo: '🤝', type: 'Banque mutualiste' },
  { nom: 'Hello bank!',       taux20: 3.35, taux15: 3.10, taux25: 3.55, logo: '💻', type: 'Banque en ligne' },
  { nom: 'Boursorama',        taux20: 3.30, taux15: 3.05, taux25: 3.50, logo: '🌐', type: 'Banque en ligne' },
  { nom: 'Fortuneo',          taux20: 3.28, taux15: 3.02, taux25: 3.48, logo: '⚡', type: 'Banque en ligne' },
];

// Produits Caisse d'Épargne
const CE_PRODUITS = [
  { nom: 'Livret A',        taux: 2.40, plafond: 22950, type: 'Épargne réglementée', icon: '📗', fiscalite: 'Exonéré IR & PS', disponibilite: 'Immédiate' },
  { nom: 'LDDS',            taux: 2.40, plafond: 12000, type: 'Épargne réglementée', icon: '🌱', fiscalite: 'Exonéré IR & PS', disponibilite: 'Immédiate' },
  { nom: 'LEP',             taux: 3.50, plafond: 10000, type: 'Épargne réglementée', icon: '💙', fiscalite: 'Exonéré IR & PS', disponibilite: 'Immédiate', condition: 'Sous conditions de revenus' },
  { nom: 'CEL',             taux: 2.00, plafond: 15300, type: 'Épargne logement',    icon: '🏠', fiscalite: 'IR + PS', disponibilite: 'Immédiate', condition: 'Droits prêt épargne logement' },
  { nom: 'PEL',             taux: 2.25, plafond: 61200, type: 'Épargne logement',    icon: '🏡', fiscalite: 'IR + PS', disponibilite: 'Après 4 ans', condition: '540€/an minimum' },
  { nom: 'Assurance-Vie',   taux: 2.80, plafond: null,  type: 'Placement long terme', icon: '📘', fiscalite: 'Avantage après 8 ans', disponibilite: 'Variable', condition: 'Fonds euros + UC' },
];

function calcComparatif() {
  const montant = parseFloat(document.getElementById('compMontant')?.value) || 270000;
  const duree   = parseInt(document.getElementById('compDuree')?.value) || 20;

  const fmtE  = v => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  const fmtE2 = v => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const tauxKey = duree <= 15 ? 'taux15' : duree <= 20 ? 'taux20' : 'taux25';

  const results = BANQUES.map(b => {
    const taux     = b[tauxKey];
    const mens     = calcMensualite(montant, taux, duree);
    const totalInt = (mens * duree * 12) - montant;
    return { ...b, taux, mens, totalInt };
  }).sort((a, b) => {
    // Caisse d'Épargne toujours en premier
    if (a.highlight) return -1;
    if (b.highlight) return 1;
    return a.mens - b.mens;
  });

  const minMens = Math.min(...results.map(r => r.mens));
  const maxMens = Math.max(...results.map(r => r.mens));

  document.getElementById('compTable').innerHTML = `

    <!-- Bloc Caisse d'Épargne mis en avant -->
    <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:16px;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
        <span style="font-size:22px;">🐿️</span>
        <div>
          <div style="font-size:15px;font-weight:600;">Caisse d'Épargne — Votre banque</div>
          <div style="font-size:12px;color:var(--muted2);">Taux immobilier sur ${duree} ans : <b style="color:var(--text);">${results.find(r=>r.highlight)?.taux.toFixed(2)}%</b> · Mensualité : <b style="color:var(--text);">${fmtE2(results.find(r=>r.highlight)?.mens)}</b></div>
        </div>
        <span class="badge" style="background:rgba(34,197,94,0.15);color:var(--green);margin-left:auto;">Votre banque</span>
      </div>

      <!-- Produits CE -->
      <div style="font-size:11px;font-weight:500;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Produits d'épargne disponibles</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">
        ${CE_PRODUITS.map(p => `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="font-size:16px;">${p.icon}</span>
              <span style="font-size:13px;font-weight:600;">${p.nom}</span>
            </div>
            <div style="font-size:20px;font-weight:700;color:var(--green);margin-bottom:4px;">${p.taux.toFixed(2)}%</div>
            <div style="font-size:11px;color:var(--muted2);line-height:1.6;">
              ${p.plafond ? `Plafond : <b style="color:var(--text);">${fmtE(p.plafond)}</b><br>` : ''}
              Dispo : ${p.disponibilite}<br>
              Fiscalité : ${p.fiscalite}
              ${p.condition ? `<br><span style="color:var(--gold);">⚠ ${p.condition}</span>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Tableau comparatif toutes banques -->
    <div style="font-size:12px;font-weight:500;color:var(--muted2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Comparatif toutes banques — ${duree} ans · ${fmtE(montant)}</div>
    <table class="data-table">
      <thead><tr>
        <th>Banque</th><th>Type</th><th>Taux</th><th>Mensualité</th><th>Total intérêts</th><th>Économie vs pire</th>
      </tr></thead>
      <tbody>
        ${results.map((b, i) => {
          const saving  = (maxMens - b.mens) * duree * 12;
          const isCE    = b.highlight;
          const isBest  = !isCE && b.mens === minMens;
          return `<tr style="${isCE ? 'background:rgba(34,197,94,0.04);border-left:2px solid var(--green);' : ''}">
            <td style="font-weight:600;">${b.logo} ${b.nom} ${isCE ? '<span style="font-size:10px;color:var(--green);"> ★ vous</span>' : ''}</td>
            <td style="font-size:12px;color:var(--muted2);">${b.type}</td>
            <td style="font-weight:600;color:${b.taux <= 3.35 ? 'var(--green)' : b.taux >= 3.55 ? 'var(--red)' : 'var(--gold)'};">${b.taux.toFixed(2)}%</td>
            <td style="font-weight:600;">${fmtE2(b.mens)}</td>
            <td style="color:var(--red);">${fmtE(b.totalInt)}</td>
            <td style="color:var(--green);font-weight:500;">${saving > 0 ? `+${fmtE(saving)}` : '–'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px;padding:12px;background:var(--surface2);border-radius:8px;font-size:12px;color:var(--muted2);line-height:1.6;">
      ⚠️ <b style="color:var(--text);">Taux indicatifs avril 2026</b> pour un profil standard (CDI, bon dossier, apport ≥10%). 
      Négociez avec votre conseiller Caisse d'Épargne — en tant que client existant vous pouvez obtenir de meilleures conditions.
    </div>`;
}

  const fmtE = v => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  const fmtE2 = v => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const tauxKey = duree <= 15 ? 'taux15' : duree <= 20 ? 'taux20' : 'taux25';

  const results = BANQUES.map(b => {
    const taux     = b[tauxKey];
    const mens     = calcMensualite(montant, taux, duree);
    const totalInt = (mens * duree * 12) - montant;
    return { ...b, taux, mens, totalInt };
  }).sort((a, b) => a.mens - b.mens);

  const minMens = results[0].mens;
  const maxMens = results[results.length - 1].mens;

  document.getElementById('compTable').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Banque</th><th>Type</th><th>Taux</th><th>Mensualité</th><th>Total intérêts</th><th>Économie vs pire</th><th>Recommandation</th>
      </tr></thead>
      <tbody>
        ${results.map((b, i) => {
          const saving = (maxMens - b.mens) * duree * 12;
          const isTop  = i === 0;
          const badge  = isTop ? `<span class="badge badge-up">⭐ Meilleur taux</span>` :
                         i === 1 ? `<span class="badge badge-neutral">2ème</span>` : '';
          return `<tr style="${isTop ? 'background:rgba(34,197,94,0.04);' : ''}">
            <td style="font-weight:600;">${b.logo} ${b.nom}</td>
            <td style="font-size:12px;color:var(--muted2);">${b.type}</td>
            <td style="font-weight:600;color:${b.taux <= 3.35 ? 'var(--green)' : b.taux >= 3.55 ? 'var(--red)' : 'var(--gold)'};">${b.taux.toFixed(2)}%</td>
            <td style="font-weight:600;">${fmtE2(b.mens)}</td>
            <td style="color:var(--red);">${fmtE(b.totalInt)}</td>
            <td style="color:var(--green);font-weight:500;">${saving > 0 ? `+${fmtE(saving)}` : '–'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px;padding:12px;background:var(--surface2);border-radius:8px;font-size:12px;color:var(--muted2);line-height:1.6;">
      ⚠️ <b style="color:var(--text);">Taux indicatifs avril 2026</b> pour un profil standard (CDI, bon dossier, apport ≥10%). 
      Négociez avec votre conseiller Caisse d'Épargne — en tant que client existant vous pouvez obtenir de meilleures conditions.
    </div>`;
