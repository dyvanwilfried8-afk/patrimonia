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
  if (pageId === 'portfolio')  renderPortfolio();
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
    const av = document.getElementById('userAvatar');
    if (av) av.textContent = email.charAt(0).toUpperCase();
    loadLocalData();
    initOverview();
    updateProjection();
    autoFillFiscalFromSalary();
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

function saveLocalData() {
  localStorage.setItem('patrimonia_assets',   JSON.stringify(assets));
  localStorage.setItem('patrimonia_savings',  JSON.stringify(savings));
  localStorage.setItem('patrimonia_expenses', JSON.stringify(expenses));
  localStorage.setItem('patrimonia_salary',   JSON.stringify(salaryData));
  localStorage.setItem('patrimonia_settings', JSON.stringify(settings));
}

// ─── OVERVIEW ───────────────────────────────────────────────────────────

let chartHistoInstance = null, showSavingsInTotal = true;

function initOverview() {
  const totalAssets = assets.reduce((s, a) => s + (a.qty || 1) * (a.currentPrice || a.buyPrice || 0), 0);
  const totalSav    = savings.reduce((s, sv) => s + (sv.balance || 0), 0);
  const total       = showSavingsInTotal ? totalAssets + totalSav : totalAssets;
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
    { id:'stock',   label:'Actions / ETF',   icon:'📈', color:'#3b82f6' },
    { id:'crypto',  label:'Crypto',           icon:'₿',  color:'#f59e0b' },
    { id:'esop',    label:'ESOP / PER',       icon:'🏢', color:'#a78bfa' },
    { id:'savings', label:'Épargne bancaire', icon:'🏦', color:'#22c55e' },
  ];
  const rows = cats.map(cat => {
    const val = cat.id === 'savings' ? totalSav
      : assets.filter(a => (a.type || 'stock') === cat.id).reduce((s, a) => s + (a.qty || 1) * (a.currentPrice || a.buyPrice || 0), 0);
    if (val === 0) return '';
    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
    return `<div class="cat-card" onclick="navigate('${cat.id === 'savings' ? 'savings' : 'portfolio'}')">
      <div class="cat-icon" style="background:${cat.color}22;">${cat.icon}</div>
      <div class="cat-info"><div class="cat-name">${cat.label}</div><div class="cat-sub">${pct}% du patrimoine</div></div>
      <div class="cat-right"><div class="cat-val">${fmt.format(val)}</div></div>
    </div>`;
  }).filter(Boolean);
  el.innerHTML = rows.length ? rows.join('') : '<div class="empty-state"><div class="icon">📊</div><p>Ajoutez vos actifs via <b>Connexions</b></p></div>';
}

function renderPnlStats(totalAssets) {
  const invested = assets.reduce((s, a) => s + (a.qty || 1) * (a.buyPrice || 0), 0);
  const pnl = totalAssets - invested;
  const pnlPct = invested > 0 ? ((pnl / invested) * 100).toFixed(2) : 0;
  const color = pnl >= 0 ? '#22c55e' : '#ef4444';
  const el = document.getElementById('kpi-pnl');
  if (el) { el.textContent = fmt.format(pnl); el.style.color = color; }
  safeSet('kpi-pnl-pct', (pnl >= 0 ? '+' : '') + pnlPct + '%');
  safeSet('statPositions', assets.length);
  [['statD1', pnl * 0.003], ['statW1', pnl * 0.012], ['statM1', pnl * 0.04], ['statYtd', pnl * 0.11]].forEach(([id, v]) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.textContent = (v >= 0 ? '+' : '') + fmt.format(v);
    e.style.color = v >= 0 ? '#22c55e' : '#ef4444';
  });
}

function renderBestWorst() {
  if (!assets.length) return;
  const withPerf = assets.map(a => ({
    name: a.name || '?',
    perf: a.buyPrice > 0 ? ((a.currentPrice - a.buyPrice) / a.buyPrice * 100) : 0
  })).sort((a, b) => b.perf - a.perf);
  if (withPerf.length) {
    safeSet('statBestName',  withPerf[0].name);
    safeSet('statBestPct',   '+' + withPerf[0].perf.toFixed(1) + '%');
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
  showSavingsInTotal = !showSavingsInTotal;
  const btn = document.getElementById('btnToggleSavings');
  if (btn) btn.style.opacity = showSavingsInTotal ? '1' : '0.5';
  initOverview();
}

function renderHistoChart(total) {
  const ctx = document.getElementById('chartHistorique');
  if (!ctx) return;
  if (chartHistoInstance) chartHistoInstance.destroy();
  const pts = 12, labels = [], data = [], now = new Date();
  for (let i = pts; i >= 0; i--) {
    const d = new Date(now); d.setMonth(d.getMonth() - i);
    labels.push(d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }));
    data.push(Math.round(total * (1 - (i / pts) * 0.25)));
  }
  data[data.length - 1] = total;
  chartHistoInstance = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { display: false }, x: { grid: { display: false }, ticks: { color: '#52525b', font: { size: 10 }, maxTicksLimit: 6 } } } }
  });
}

function setHistoPeriod(period, btn) {
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active', 'active-default'));
  btn.classList.add('active');
  initOverview();
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
  let filtered = assets.filter(a => (srcF === 'all' || a.source === srcF) && (typF === 'all' || a.type === typF));
  filtered.sort((a, b) => {
    const va = (a.qty||1)*(a.currentPrice||0), vb = (b.qty||1)*(b.currentPrice||0);
    const pa = a.buyPrice > 0 ? (a.currentPrice-a.buyPrice)/a.buyPrice*100 : 0;
    const pb = b.buyPrice > 0 ? (b.currentPrice-b.buyPrice)/b.buyPrice*100 : 0;
    if (currentSort==='val_desc') return vb-va;
    if (currentSort==='perf_total_desc') return pb-pa;
    if (currentSort==='perf_total_asc')  return pa-pb;
    return vb-va;
  });
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:24px;">Aucun actif — ajoutez-en via Connexions</td></tr>'; return; }
  const totalVal = filtered.reduce((s, a) => s + (a.qty||1)*(a.currentPrice||0), 0);
  const typeLabels = { stock:'ETF', crypto:'Crypto', savings:'Épargne', esop:'ESOP' };
  tbody.innerHTML = filtered.map(a => {
    const val=(a.qty||1)*(a.currentPrice||a.buyPrice||0), cost=(a.qty||1)*(a.buyPrice||0);
    const pnl=val-cost, pnlP=cost>0?((pnl/cost)*100).toFixed(1):'–';
    const poids=totalVal>0?((val/totalVal)*100).toFixed(1):'–';
    const pc=pnl>=0?'perf-pos':'perf-neg';
    // Affiche nom complet + ticker si différents
    const displayName = a.name || a.ticker || '–';
    const tickerBadge = a.ticker && a.ticker !== a.name ? `<span style="font-size:10px;color:var(--muted2);margin-left:4px;">${a.ticker}</span>` : '';
    return `<tr><td><div class="asset-name">${displayName}${tickerBadge} <span class="asset-badge">${typeLabels[a.type]||''}</span></div></td>
      <td style="color:var(--muted2);font-size:12px;">${a.source||'manuel'}</td>
      <td>${fmt.format(val)}</td>
      <td class="${pc}">${pnl>=0?'+':''}${fmt.format(pnl)}</td>
      <td class="${pc}">${pnl>=0?'+':''}${pnlP}%</td>
      <td class="perf-zero">–</td><td class="perf-zero">–</td><td class="perf-zero">–</td><td class="perf-zero">–</td>
      <td class="${pc}">${pnl>=0?'+':''}${pnlP}%</td>
      <td style="color:var(--muted2);">${poids}%</td></tr>`;
  }).join('');
}

function setAssetPeriod(p, btn) {
  document.querySelectorAll('#page-portfolio .period-btn').forEach(b => b.classList.remove('active', 'active-default'));
  btn.classList.add('active');
}
function renderAssetChart() {}

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
      options:{cutout:'65%',plugins:{legend:{position:'right',labels:{color:'#fff',font:{size:11}}}}}
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

function addExpense() {
  const label=document.getElementById('expLabel')?.value?.trim();
  if (!label) return showToast('Entrez un libellé','#ef4444');
  expenses.push({ label, amount:parseFloat(document.getElementById('expAmount')?.value)||0, category:document.getElementById('expCategory')?.value||'autre' });
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
      plugins:{legend:{labels:{color:'#94a3b8',font:{size:11}}}},
      scales:{y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#52525b',callback:v=>fmt.format(v)}},
              x:{grid:{display:false},ticks:{color:'#52525b',maxTicksLimit:8}}}}
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
  const apiKey=document.getElementById('sheetsApiKey')?.value?.trim();
  const url   =document.getElementById('sheetsUrl')?.value?.trim();
  if(!apiKey||!url) return showToast('Clé API et URL requis','#ef4444');
  const match=url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if(!match) return showToast('URL invalide','#ef4444');
  const sheetId=match[1];
  const btn=document.getElementById('importSheetsBtn');

  // Onglets à importer avec leur type d'actif associé
  const tabs = [
    { name: 'CTO',    type: 'stock',  source: 'sheets-cto'    },
    { name: 'Crypto', type: 'crypto', source: 'sheets-crypto'  },
    { name: 'AIRBUS', type: 'esop',   source: 'sheets-airbus', isAirbus: true },
  ];

  try {
    if(btn) btn.textContent='⏳ Import en cours...';
    let imported=0;

    for (const tab of tabs) {
      const encodedTab = encodeURIComponent(tab.name);
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodedTab}?key=${apiKey}`
      );
      const data = await res.json();
      if (data.error) {
        console.warn(`Onglet "${tab.name}" ignoré :`, data.error.message);
        continue;
      }

      if (tab.isAirbus) {
        // Onglet AIRBUS : ESOP 2025 et 2026 séparés, + intéressement additionné
        // Cherche lignes contenant ticker, qty, prix achat, prix actuel, dividende
        let percolInter = 0; // intéressement/participation annuel à accumuler
        (data.values||[]).slice(1).forEach(row => {
          if (!row[0]) return;
          const rawName = (row[0]||'').toString().trim();
          // Les lignes d'intéressement/participation sont additionnées
          const lowerName = rawName.toLowerCase();
          if (lowerName.includes('interessement') || lowerName.includes('intéressement') || lowerName.includes('participation') || lowerName.includes('percol') || lowerName.includes('per ')) {
            percolInter += parseFloat(row[2]||row[1]||0) || 0;
            return;
          }
          const ticker = (row[1]||row[0]||'').toString().trim() || rawName;
          const displayName = rawName !== ticker ? `${rawName} (${ticker})` : rawName;
          const asset = {
            name:         displayName,
            ticker:       ticker,
            source:       tab.source,
            type:         tab.type,
            qty:          parseFloat(row[2]) || 1,
            buyPrice:     parseFloat(row[3]) || 0,
            currentPrice: parseFloat(row[4]) || parseFloat(row[3]) || 0,
            dividend:     parseFloat(row[5]) || 0,
            geo:          'eu',
            sector:       'industry',
            currency:     'EUR',
            fees:         parseFloat(row[6]) || 0,
          };
          const idx = assets.findIndex(a => a.name === asset.name && a.source === tab.source);
          if (idx >= 0) assets[idx] = asset; else assets.push(asset);
          imported++;
        });
        // Ajoute l'intéressement/participation dans salaryData si présent
        if (percolInter > 0) {
          if (!salaryData.inter) salaryData.inter = 0;
          salaryData.inter = percolInter;
          saveLocalData();
        }
      } else {
        (data.values||[]).slice(1).forEach(row => {
          if (!row[0]) return;
          const rawName = (row[0]||'').toString().trim();
          const ticker = (row[1]||rawName).toString().trim();
          const displayName = (rawName && ticker && rawName !== ticker) ? `${rawName} (${ticker})` : rawName;
          const asset = {
            name:         displayName,
            ticker:       ticker,
            source:       tab.source,
            type:         tab.type,
            qty:          parseFloat(row[2]) || 1,
            buyPrice:     parseFloat(row[3]) || 0,
            currentPrice: parseFloat(row[4]) || parseFloat(row[3]) || 0,
            dividend:     parseFloat(row[5]) || 0,
            geo:          tab.type === 'crypto' ? 'other' : (row[6]||'world'),
            sector:       tab.type === 'crypto' ? 'crypto' : (row[7]||'mixed'),
            currency:     row[8]||'EUR',
            fees:         parseFloat(row[9]) || 0,
          };
          const idx = assets.findIndex(a => a.name === asset.name && a.source === tab.source);
          if (idx >= 0) assets[idx] = asset; else assets.push(asset);
          imported++;
        });
      }
    }

    // Onglet Dividendes (optionnel)
    try {
      const divRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Dividendes?key=${apiKey}`);
      const divData = await divRes.json();
      if (!divData.error) {
        let divs = JSON.parse(localStorage.getItem('patrimonia_dividends')||'[]');
        (divData.values||[]).slice(1).forEach(row => {
          if (!row[0]) return;
          divs.push({ date: row[0], ticker: row[1]||'', amount: parseFloat(row[2])||0, source: 'sheets' });
        });
        localStorage.setItem('patrimonia_dividends', JSON.stringify(divs));
      }
    } catch(e) { /* onglet optionnel */ }

    saveLocalData(); initOverview();
    document.getElementById('sheetsStatus').textContent='Connecté';
    document.getElementById('sheetsStatus').className='badge badge-up';
    document.getElementById('dashboardDetected').style.display='block';
    showToast(imported+' actifs importés ✓','#22c55e');
    autoFillFiscalFromSalary();
  } catch(err){ showToast('Erreur : '+err.message,'#ef4444'); }
  finally{ if(btn) btn.textContent='⬇ Importer mon Google Sheet'; }
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
}

function connectTR() { showToast('Import PDF Trade Republic — en développement','#f59e0b'); }

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
  // Dividendes enregistrés manuellement ou depuis Sheets
  let divs = [];
  try { divs = JSON.parse(localStorage.getItem('patrimonia_dividends')||'[]'); } catch(e){}
  // Calcul dividendes annuels estimés depuis les actifs
  const annualDivs = assets.filter(a => (a.dividend||0) > 0).map(a => ({
    name: a.name||a.ticker||'?',
    annual: (a.qty||1) * (a.dividend||0),
    yield: a.currentPrice > 0 ? ((a.dividend||0)/a.currentPrice*100).toFixed(2) : '–'
  }));
  const totalAnnual = annualDivs.reduce((s,d)=>s+d.annual,0);
  if (!divs.length && !annualDivs.length) {
    divEl.innerHTML = '<div style="font-size:13px;color:var(--muted2);padding:8px 0;">Aucun dividende enregistré. Renseignez le montant de dividende/action dans votre Google Sheet (col. F).</div>';
    return;
  }
  let html = '';
  if (totalAnnual > 0) {
    html += `<div style="margin-bottom:12px;padding:12px;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.15);border-radius:8px;">
      <div style="font-size:11px;color:var(--muted2);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Dividendes estimés / an</div>
      <div style="font-size:22px;font-weight:600;color:var(--green);">${fmt.format(totalAnnual)}</div>
      <div style="font-size:11px;color:var(--muted2);">soit ${fmt.format(totalAnnual/12)}/mois</div>
    </div>`;
    html += annualDivs.map(d=>`<div class="fee-item"><div style="flex:1"><div style="font-size:13px;font-weight:500;">${d.name}</div><div style="font-size:11px;color:var(--muted2);">Rendement ${d.yield}%</div></div><div style="font-weight:600;color:var(--green);">${fmt.format(d.annual)}/an</div></div>`).join('');
  }
  if (divs.length) {
    html += `<div style="font-size:12px;font-weight:600;color:var(--muted2);margin:12px 0 6px;text-transform:uppercase;letter-spacing:0.5px;">Historique reçu</div>`;
    html += divs.slice(-5).reverse().map(d=>`<div class="fee-item"><div><div style="font-size:13px;font-weight:500;">${d.ticker||'?'}</div><div style="font-size:11px;color:var(--muted2);">${d.date||''}</div></div><div style="font-weight:600;color:var(--green);">${fmt.format(d.amount)}</div></div>`).join('');
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
  if(!confirm('Réinitialiser ? Action irréversible.')) return;
  ['patrimonia_assets','patrimonia_savings','patrimonia_expenses','patrimonia_salary','patrimonia_settings'].forEach(k=>localStorage.removeItem(k));
  loadLocalData(); initOverview(); showToast('Données réinitialisées','#f59e0b');
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
