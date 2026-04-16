// =====================================================================
// PATRIMONIA - DATA LAYER & LOGIC ENGINE (v4.0)
// Aligné avec dashboard.html
// =====================================================================

// 1. CONFIGURATION SUPABASE
const SUPABASE_URL  = 'https://grvxurgvxwmheiollrmp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_7XITRulkeLGYMis4S02PiA_JaDeUQQE';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
let currentUser = null;

const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

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
  fees:'Scanner de frais', fiscalite:'Fiscalité', sources:'Connexions', settings:'Paramètres'
};

function navigate(pageId) {
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
  if (pageId === 'analysis')   computeDiversityScore();
  if (pageId === 'fees')       renderFees();
  if (pageId === 'savings')    renderSavings();
  if (pageId === 'salary')     renderSalary();
  if (pageId === 'portfolio')  renderPortfolio();
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
  const divEl = document.getElementById('dividendsOverview');
  if (divEl) divEl.innerHTML = '<div style="font-size:13px;color:var(--muted2);padding:8px 0;">Aucun dividende enregistré.</div>';
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
  const net = salaryData.net || 0, saved = salaryData.saved || 0;
  const fixed = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const rate = net > 0 ? Math.round((saved / net) * 100) : 0;
  safeSet('rateVal', rate + '%');
  safeSet('salaryDisplay',  net   ? fmt.format(net)   : '–');
  safeSet('savingsDisplay', saved ? fmt.format(saved) : '–');
  safeSet('expensesDisplay',fixed ? fmt.format(fixed) : '–');
  const sb2 = document.getElementById('savingsBar'), eb = document.getElementById('expensesBar');
  if (sb2) sb2.style.width = Math.min(rate, 100) + '%';
  if (eb && net > 0) eb.style.width = Math.min((fixed / net) * 100, 100) + '%';
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
    return `<tr><td><div class="asset-name">${a.name||'–'} <span class="asset-badge">${typeLabels[a.type]||''}</span></div></td>
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
  const fixed=expenses.reduce((s,e)=>s+(e.amount||0),0);
  const avail=net-saved-fixed, rate=net>0?Math.round((saved/net)*100):0;
  safeSet('grossDisplay', salaryData.gross?fmt.format(salaryData.gross):'–');
  safeSet('netDisplay',   net?fmt.format(net):'–');
  safeSet('interDisplay', salaryData.inter?fmt.format(salaryData.inter):'–');
  safeSet('partDisplay',  salaryData.part?fmt.format(salaryData.part):'–');
  safeSet('rateValBig',   rate+'%');
  safeSet('savedMonthly', saved?fmt.format(saved):'–');
  safeSet('fixedExp',     fixed?fmt.format(fixed):'–');
  safeSet('available',    fmt.format(Math.max(avail,0)));
  const pct=v=>net>0?Math.min((v/net)*100,100):0;
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
  saveLocalData(); closeModal('editSalary'); renderSalary(); initOverview(); showToast('Salaire enregistré ✓','#22c55e');
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

/**
 * Parse un nombre au format français ou anglais.
 * "1 166,57 €" → 1166.57 | "1,166.57" → 1166.57 | "42.5%" → 42.5
 */
function parseFR(val) {
  if (val === undefined || val === null || val === '') return 0;
  let s = String(val).replace(/\s/g, '').replace('€', '').replace('%', '');
  // Format français : 1.166,57
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  // Format FR simple : 1166,57
  else s = s.replace(',', '.');
  return parseFloat(s) || 0;
}

/**
 * Détecte automatiquement l'index d'une colonne à partir des mots-clés.
 * Retourne -1 si non trouvée.
 */
function detectCol(headers, keywords) {
  const norm = h => String(h).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (keywords.some(kw => h.includes(kw))) return i;
  }
  return -1;
}

/**
 * Analyse la ligne d'en-tête et retourne un objet col → index.
 * Fonctionne quelle que soit la structure du sheet.
 */
function parseHeaders(headerRow) {
  const cols = {};
  const maps = [
    { key: 'ticker',    kw: ['ticker','actif','symbole','symbol','isin','code'] },
    { key: 'nom',       kw: ['nom','name','libelle','title','designation','description'] },
    { key: 'qty',       kw: ['quantite','qty','qte','nombre','nb','units','shares'] },
    { key: 'pru',       kw: ['pru','prix de revient','prix achat','pa ','cost','buy price','achat'] },
    { key: 'prix',      kw: ['prix','cours','price','valeur unitaire','last','close','current'] },
    { key: 'investi',   kw: ['investi','invested','montant','capital','cost basis'] },
    { key: 'valTotale', kw: ['val. totale','valeur totale','total','valeur','portfolio','position'] },
    { key: 'perf1d',    kw: ['1jour','1j','jour','1day','day','daily'] },
    { key: 'perf1w',    kw: ['hebdo','1w','week','semaine','7j','7d'] },
    { key: 'perf1m',    kw: ['1mois','1m','mois','month','30j','30d'] },
    { key: 'perf6m',    kw: ['6mois','6m','6month','180j'] },
    { key: 'perfYTD',   kw: ['ytd','depuis jan','year to date','depuis debut'] },
    { key: 'perfTotal', kw: ['perf %','perf%','performance','total %','rendement','return'] },
    { key: 'categorie', kw: ['categorie','category','type','classe','asset class'] },
    { key: 'secteur',   kw: ['secteur','sector','industrie','industry'] },
    { key: 'geo',       kw: ['zone geo','geo','region','geographie','country','pays','localisation'] },
  ];
  maps.forEach(({ key, kw }) => {
    const idx = detectCol(headerRow, kw);
    if (idx >= 0) cols[key] = idx;
  });
  return cols;
}

async function connectSheets() {
  const apiKey = document.getElementById('sheetsApiKey')?.value?.trim();
  const url    = document.getElementById('sheetsUrl')?.value?.trim();
  if (!apiKey || !url) return showToast('Clé API et URL requis', '#ef4444');
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return showToast('URL invalide', '#ef4444');
  const sheetId = match[1];
  const btn = document.getElementById('importSheetsBtn');

  // Onglets à importer — type par défaut si non détecté dans les données
  const tabs = [
    { name: 'CTO',    defaultType: 'stock',  source: 'sheets-cto'    },
    { name: 'Crypto', defaultType: 'crypto', source: 'sheets-crypto'  },
    { name: 'AIRBUS', defaultType: 'esop',   source: 'sheets-airbus'  },
  ];

  // Correspondance catégorie textuelle → type interne
  const typeMap = {
    'etf': 'stock', 'action': 'stock', 'actions': 'stock', 'stock': 'stock',
    'crypto': 'crypto', 'cryptomonnaie': 'crypto',
    'esop': 'esop', 'per': 'esop', 'pea': 'stock', 'epargne': 'savings',
  };

  try {
    if (btn) btn.textContent = '⏳ Import en cours...';
    let imported = 0;
    let warnings = [];

    for (const tab of tabs) {
      const encodedTab = encodeURIComponent(tab.name);
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodedTab}?key=${apiKey}`
      );
      const data = await res.json();
      if (data.error) {
        console.warn(`Onglet "${tab.name}" ignoré :`, data.error.message);
        warnings.push(tab.name);
        continue;
      }

      const rows = data.values || [];
      if (rows.length < 2) continue;

      // Détection automatique des colonnes via l'en-tête
      const cols = parseHeaders(rows[0]);
      console.log(`[${tab.name}] Colonnes détectées :`, cols);

      // Si pas de colonne ticker/nom détectée → on essaye col 0 par défaut
      const tickerIdx = cols.ticker ?? cols.nom ?? 0;

      rows.slice(1).forEach((row, ri) => {
        const raw = row[tickerIdx] || '';
        const ticker = raw.trim();
        if (!ticker) return; // ligne vide

        const qty        = cols.qty       !== undefined ? parseFR(row[cols.qty])       : 1;
        const buyPrice   = cols.pru       !== undefined ? parseFR(row[cols.pru])       : 0;
        const currPrice  = cols.prix      !== undefined ? parseFR(row[cols.prix])      : buyPrice;
        const invested   = cols.investi   !== undefined ? parseFR(row[cols.investi])   : qty * buyPrice;
        const totalVal   = cols.valTotale !== undefined ? parseFR(row[cols.valTotale]) : qty * currPrice;
        const perf1d     = cols.perf1d    !== undefined ? parseFR(row[cols.perf1d])    : 0;
        const perf1w     = cols.perf1w    !== undefined ? parseFR(row[cols.perf1w])    : 0;
        const perf1m     = cols.perf1m    !== undefined ? parseFR(row[cols.perf1m])    : 0;
        const perf6m     = cols.perf6m    !== undefined ? parseFR(row[cols.perf6m])    : 0;
        const perfYTD    = cols.perfYTD   !== undefined ? parseFR(row[cols.perfYTD])   : 0;
        const perfTotal  = cols.perfTotal !== undefined ? parseFR(row[cols.perfTotal]) : 0;
        const catRaw     = cols.categorie !== undefined ? (row[cols.categorie]||'').toLowerCase().trim() : '';
        const secteur    = cols.secteur   !== undefined ? (row[cols.secteur]  ||'').trim() : '';
        const geoRaw     = cols.geo       !== undefined ? (row[cols.geo]      ||'').trim() : 'Monde';
        const nomLabel   = cols.nom       !== undefined ? (row[cols.nom]      ||ticker).trim() : ticker;

        // Ligne TOTAL ou séparateur → on ignore
        if (ticker.toUpperCase() === 'TOTAL' || (qty === 0 && buyPrice === 0 && currPrice === 0)) return;

        // Déduction du type selon la catégorie ou le tab par défaut
        const detectedType = typeMap[catRaw] || tab.defaultType;

        // Géo normalisée
        const geoNorm = geoRaw.toLowerCase().includes('usa') || geoRaw.toLowerCase().includes('etats') ? 'usa'
          : geoRaw.toLowerCase().includes('europ') ? 'europe'
          : geoRaw.toLowerCase().includes('emerg') ? 'emerging'
          : geoRaw.toLowerCase() === 'monde' || geoRaw.toLowerCase() === 'world' ? 'world'
          : 'other';

        const asset = {
          name:        ticker,
          label:       nomLabel,
          source:      tab.source,
          type:        detectedType,
          qty,
          buyPrice,
          currentPrice: currPrice,
          invested,
          totalValue:  totalVal,
          perf1d,  perf1w,  perf1m,  perf6m,  perfYTD,  perfTotal,
          category:    catRaw,
          sector:      secteur,
          geo:         geoNorm,
          currency:    'EUR',
          fees:        0,
        };

        const idx = assets.findIndex(a => a.name === asset.name && a.source === tab.source);
        if (idx >= 0) assets[idx] = asset; else assets.push(asset);
        imported++;
      });
    }

    saveLocalData();
    initOverview();
    document.getElementById('sheetsStatus').textContent = 'Connecté';
    document.getElementById('sheetsStatus').className = 'badge badge-up';
    document.getElementById('dashboardDetected').style.display = 'block';

    const warnMsg = warnings.length ? ` (onglets manquants : ${warnings.join(', ')})` : '';
    showToast(imported + ' actifs importés ✓' + warnMsg, '#22c55e');

  } catch (err) {
    showToast('Erreur : ' + err.message, '#ef4444');
    console.error(err);
  } finally {
    if (btn) btn.textContent = '⬇ Importer mon Google Sheet';
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
