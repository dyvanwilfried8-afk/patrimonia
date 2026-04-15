// =====================================================================
// PATRIMONIA - DATA LAYER & LOGIC ENGINE (v3.0)
// =====================================================================

// 1. CONFIGURATION SUPABASE (Ta configuration originale préservée)
const SUPABASE_URL  = 'https://grvxurgvxwmheiollrmp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_7XITRulkeLGYMis4S02PiA_JaDeUQQE';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
let currentUser = null;

// 2. INITIALISATION & AUTHENTIFICATION
async function initApp() {
  // Sécurité : masque le splash après 5s max quoi qu'il arrive
  const splashTimeout = setTimeout(hideSplash, 5000);

  try {
    const { data: { session } } = await sb.auth.getSession();
    
    // Si pas de session, on retourne à l'accueil
    if (!session) {
      clearTimeout(splashTimeout);
      hideSplash();
      window.location.href = 'index.html'; 
      return; 
    }
    
    currentUser = session.user.id;
    console.log("Connecté avec succès:", currentUser);

    // Charger les données initiales fictives pour la démo
    updateDashboard(142500, 82000);
    
    // Initialiser les graphiques
    initCharts();
    
    // Lancer la première simulation de DCA par défaut
    calculators.projection();

  } catch (err) {
    console.error("Erreur d'initialisation:", err);
  } finally {
    clearTimeout(splashTimeout);
    hideSplash();
  }
}

// Utilitaire : masque le splash screen
function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(() => { splash.style.display = 'none'; }, 450);
  }
}

// Lancer l'application quand le document est prêt
document.addEventListener('DOMContentLoaded', initApp);

// 3. FONCTIONS DE MISE À JOUR DE L'INTERFACE
function updateDashboard(brut, passif) {
  const net = brut - passif;
  const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  
  document.getElementById('val-brut').textContent = fmt.format(brut);
  document.getElementById('val-passif').textContent = fmt.format(passif);
  document.getElementById('val-net').textContent = fmt.format(net);
}

// 4. ROUTER INTERNE (Gère le changement de pages sans recharger)
const router = {
  go: function(viewId, element) {
    // UI Menu
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    // UI Views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
  }
};

// 5. MOTEURS DE CALCUL (Simulateurs)
let chartProjInstance = null;

const calculators = {
  // A. SIMULATEUR DCA / INTÉRÊTS COMPOSÉS
  projection: function() {
    const initVal = parseFloat(document.getElementById('sim_init').value) || 0;
    const dca = parseFloat(document.getElementById('sim_dca').value) || 0;
    const years = parseInt(document.getElementById('sim_years').value) || 20;
    const rate = (parseFloat(document.getElementById('sim_rate').value) || 0) / 100;
    const taxRate = (parseFloat(document.getElementById('sim_tax').value) || 0) / 100;

    let capital = initVal;
    let invested = initVal;
    let labels = [], dataCap = [], dataInv = [];

    for (let i = 0; i <= years; i++) {
      labels.push(`Année ${i}`);
      dataCap.push(capital);
      dataInv.push(invested);
      if (i < years) {
        capital = (capital + (dca * 12)) * (1 + rate);
        invested += (dca * 12);
      }
    }

    const pv = capital - invested;
    const tax = pv > 0 ? pv * taxRate : 0;
    const net = capital - tax;

    const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    document.getElementById('res_brut').textContent = fmt.format(capital);
    document.getElementById('res_net').textContent = fmt.format(net);

    // Dessiner le graphique de projection
    const ctx = document.getElementById('chartProjection').getContext('2d');
    if (chartProjInstance) chartProjInstance.destroy();
    
    chartProjInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Capital généré', data: dataCap, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 },
          { label: 'Total investi', data: dataInv, borderColor: '#94a3b8', borderDash: [5,5], fill: false }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } } } }
    });
  },

  // B. SIMULATEUR DE CRÉDIT IMMOBILIER
  credit: function() {
    const amount = parseFloat(document.getElementById('cred_amount').value) || 0;
    const rate = parseFloat(document.getElementById('cred_rate').value) || 0;
    const years = parseInt(document.getElementById('cred_years').value) || 20;

    const monthlyRate = (rate / 100) / 12;
    const months = years * 12;
    
    let mens = 0;
    if (monthlyRate > 0) {
      mens = (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
    } else {
      mens = amount / months;
    }

    const totalCost = (mens * months) - amount;

    const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
    document.getElementById('res_mensualite').textContent = fmt.format(mens) + " / mois";
    document.getElementById('res_interets').textContent = fmt.format(totalCost);
  }
};

// 6. INITIALISATION DES GRAPHIQUES GLOBAUX
function initCharts() {
  // Historique global (Dashboard)
  const ctxHist = document.getElementById('chartHistory').getContext('2d');
  new Chart(ctxHist, {
    type: 'line',
    data: { labels: ['T1', 'T2', 'T3', 'T4'], datasets: [{ data: [45000, 48000, 52000, 60500], borderColor: '#3b82f6', tension: 0.4 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { display: false }, x: { grid: { display: false } } } }
  });

  // Répartition des actifs (Analyse)
  const ctxAsset = document.getElementById('chartAssets').getContext('2d');
  new Chart(ctxAsset, {
    type: 'doughnut',
    data: { labels: ['Actions', 'Immobilier', 'Liquidités', 'Crypto'], datasets: [{ data: [45, 30, 15, 10], backgroundColor: ['#3b82f6', '#22c55e', '#64748b', '#f59e0b'], borderWidth: 0 }] },
    options: { cutout: '70%', plugins: { legend: { position: 'right', labels: { color: '#fff' } } } }
  });
}
