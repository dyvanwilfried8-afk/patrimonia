// =====================================================================
// PATRIMONIA - MOTEUR DE DONNÉES RÉELLES (Option 2)
// =====================================================================

// 1. CONFIGURATION SUPABASE
const SUPABASE_URL  = 'https://grvxurgvxwmheiollrmp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_7XITRulkeLGYMis4S02PiA_JaDeUQQE';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
let currentUser = null;

// 2. FONCTION D'INITIALISATION PRINCIPALE
async function initApp() {
  console.log("Démarrage de l'initialisation...");
  
  try {
    const { data: { session } } = await sb.auth.getSession();
    
    // Vérification de l'utilisateur
    if (!session) { 
      console.log("Pas de session, redirection...");
      window.location.href = 'index.html'; 
      return; 
    }
    
    currentUser = session.user.id;
    console.log("Utilisateur identifié :", currentUser);

    // --- CHARGEMENT DES DONNÉES ---
    // On appelle les fonctions de chargement réelles
    await loadAllData(); 
    initUI(); // On initialise les composants de l'interface

    // --- MASQUAGE DU CHARGEMENT ---
    hideLoader();

  } catch (error) {
    console.error("Erreur critique lors de l'init :", error);
    // Même en cas d'erreur, on essaie de retirer le loader pour voir l'interface
    hideLoader();
  }
}

// 3. CHARGEMENT DES DONNÉES DEPUIS SUPABASE
async function loadAllData() {
  console.log("Chargement des données Supabase...");
  
  // Ici, tu peux ajouter tes requêtes réelles, exemple :
  // const { data, error } = await sb.from('patrimoine').select('*').eq('user_id', currentUser);
  
  // Pour l'instant, on met des valeurs par défaut pour que l'app s'affiche
  updateDashboard(150000, 75000); 
  initCharts();
}

// 4. INITIALISATION DE L'UI
function initUI() {
  console.log("Initialisation des composants...");
  // Lancer la première simulation par défaut
  if (typeof calculators !== 'undefined') {
    calculators.projection();
  }
}

// 5. FONCTION POUR CACHER LE LOADER (Résout ton problème de blocage)
function hideLoader() {
  const loader = document.getElementById('loader') || document.querySelector('.loading-screen');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => {
      loader.style.display = 'none';
    }, 500);
  }
}

// 6. MISE À JOUR DU DASHBOARD
function updateDashboard(brut, passif) {
  const net = brut - passif;
  const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  
  if(document.getElementById('val-brut')) document.getElementById('val-brut').textContent = fmt.format(brut);
  if(document.getElementById('val-passif')) document.getElementById('val-passif').textContent = fmt.format(passif);
  if(document.getElementById('val-net')) document.getElementById('val-net').textContent = fmt.format(net);
}

// 7. ROUTER
const router = {
  go: function(viewId, element) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
  }
};

// 8. SIMULATEURS
let chartProjInstance = null;
const calculators = {
  projection: function() {
    const initVal = parseFloat(document.getElementById('sim_init')?.value) || 10000;
    const dca = parseFloat(document.getElementById('sim_dca')?.value) || 500;
    const years = parseInt(document.getElementById('sim_years')?.value) || 20;
    const rate = (parseFloat(document.getElementById('sim_rate')?.value) || 7) / 100;
    const taxRate = (parseFloat(document.getElementById('sim_tax')?.value) || 30) / 100;

    let capital = initVal;
    let invested = initVal;
    let labels = [], dataCap = [], dataInv = [];

    for (let i = 0; i <= years; i++) {
      labels.push(`An ${i}`);
      dataCap.push(capital);
      dataInv.push(invested);
      if (i < years) {
        capital = (capital + (dca * 12)) * (1 + rate);
        invested += (dca * 12);
      }
    }

    const pv = capital - invested;
    const net = capital - (pv > 0 ? pv * taxRate : 0);
    const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

    if(document.getElementById('res_brut')) document.getElementById('res_brut').textContent = fmt.format(capital);
    if(document.getElementById('res_net')) document.getElementById('res_net').textContent = fmt.format(net);

    const ctx = document.getElementById('chartProjection');
    if (ctx) {
      if (chartProjInstance) chartProjInstance.destroy();
      chartProjInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Capital', data: dataCap, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 },
            { label: 'Investi', data: dataInv, borderColor: '#94a3b8', borderDash: [5,5], fill: false }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  },
  credit: function() {
    const amount = parseFloat(document.getElementById('cred_amount')?.value) || 200000;
    const rate = parseFloat(document.getElementById('cred_rate')?.value) || 3.5;
    const years = parseInt(document.getElementById('cred_years')?.value) || 20;
    const mRate = (rate / 100) / 12;
    const months = years * 12;
    const mens = mRate > 0 ? (amount * mRate) / (1 - Math.pow(1 + mRate, -months)) : amount / months;
    const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
    if(document.getElementById('res_mensualite')) document.getElementById('res_mensualite').textContent = fmt.format(mens) + " / mois";
    if(document.getElementById('res_interets')) document.getElementById('res_interets').textContent = fmt.format((mens * months) - amount);
  }
};

// 9. CHARTS
function initCharts() {
  const ctxHist = document.getElementById('chartHistory');
  if (ctxHist) {
    new Chart(ctxHist.getContext('2d'), {
      type: 'line',
      data: { labels: ['Jan', 'Fev', 'Mar', 'Avr'], datasets: [{ data: [120000, 135000, 142000, 150000], borderColor: '#3b82f6' }] }
    });
  }
}

// LANCEMENT
document.addEventListener('DOMContentLoaded', initApp);
