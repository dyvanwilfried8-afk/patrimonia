// =====================================================================
// PATRIMONIA V2 - MOTEUR DE CALCUL DE PORTEFEUILLE (PORTFOLIO ENGINE)
// Basé sur les tables relationnelles Supabase : transactions, dividends, snapshots
// =====================================================================

/**
 * UTILS : Formateur de devise hérité de app.js
 */
const formatterEUR = new Intl.NumberFormat('fr-FR', { 
  style: 'currency', 
  currency: 'EUR', 
  maximumFractionDigits: 2 
});

/**
 * 1. FONCTION : calculatePortfolioValue
 * Calcule la valorisation totale actuelle du portefeuille à l'instant T.
 * (Dans la V2, elle agrège la dernière valeur connue de chaque actif)
 */
async function calculatePortfolioValue(userId) {
  try {
    // On récupère la dernière snapshot ou la somme des valeurs actuelles des actifs
    const { data, error } = await sb
      .from('assets')
      .select('value')
      .eq('user_id', userId);

    if (error) throw error;

    const totalValue = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
    return totalValue;
  } catch (err) {
    console.error("Erreur dans calculatePortfolioValue:", err.message);
    return 0;
  }
}

/**
 * 2. FONCTION : calculateInvestedCapital
 * Calcule le capital NET réellement injecté par l'utilisateur (provenant de sa poche).
 * EXCLUSION DES DIVIDENDES : Les dividendes réinvestis ne sont pas comptés ici !
 */
async function calculateInvestedCapital(userId) {
  try {
    // Somme de tous les achats (BUY) effectués par l'utilisateur
    const { data: txData, error: txError } = await sb
      .from('transactions')
      .select('amount, type')
      .eq('user_id', userId);

    if (txError) throw txError;

    let totalInjected = 0;
    txData.forEach(tx => {
      if (tx.type === 'BUY') {
        totalInjected += Number(tx.amount);
      } else if (tx.type === 'SELL') {
        totalInjected -= Number(tx.amount); // Les ventes diminuent le capital exposé
      }
    });

    return totalInjected;
  } catch (err) {
    console.error("Erreur dans calculateInvestedCapital:", err.message);
    return 0;
  }
}

/**
 * 3. FONCTION : calculatePnL
 * Calcule la Plus-Value brute (P&L Absolu) : Valeur Actuelle - Capital Injecté
 */
async function calculatePnL(portfolioValue, investedCapital) {
  return portfolioValue - investedCapital;
}

/**
 * 4. FONCTION : calculateReturn
 * Calcule le rendement global en pourcentage (ROI / P&L Relatif)
 * Sécurité : Évite la division par zéro si aucun capital n'est investi.
 */
function calculateReturn(portfolioValue, investedCapital) {
  if (!investedCapital || investedCapital === 0) return 0;
  return ((portfolioValue - investedCapital) / investedCapital) * 100;
}

/**
 * 5. FONCTION : calculateYTD (Year-To-Date)
 * Calcule la performance du portefeuille depuis le 1er janvier de l'année en cours
 */
async function calculateYTD(userId, currentPortfolioValue) {
  try {
    const currentYear = new Date().getFullYear();
    const firstDayOfYear = `${currentYear}-01-01`;

    // On cherche la snapshot du portefeuille la plus proche du 1er Janvier
    const { data, error } = await sb
      .from('portfolio_snapshots')
      .select('total_value')
      .eq('user_id', userId)
      .gte('snapshot_date', firstDayOfYear)
      .order('snapshot_date', { ascending: true })
      .limit(1);

    if (error) throw error;

    if (!data || data.length === 0) return 0; // Pas de données pour cette année

    const startOfYearValue = Number(data[0].total_value);
    if (startOfYearValue === 0) return 0;

    // Performance YTD = ((Valeur Actuelle - Valeur Début Année) / Valeur Début Année) * 100
    return ((currentPortfolioValue - startOfYearValue) / startOfYearValue) * 100;
  } catch (err) {
    console.error("Erreur dans calculateYTD:", err.message);
    return 0;
  }
}

/**
 * 6. FONCTION : calculateAssetPRU
 * Calcule le Prix de Revient Unitaire (PRU) d'un actif spécifique (ex: AIRBUS, BTC...)
 * PREND EN COMPTE LES DIVIDENDES : Si un dividende est réinvesti, il augmente la quantité 
 * de parts SANS augmenter le montant injecté par l'utilisateur, ce qui fait baisser le PRU.
 */
async function calculateAssetPRU(userId, assetName) {
  try {
    // 1. Récupérer les transactions d'achat de cet actif
    const { data: txData, error: txError } = await sb
      .from('transactions')
      .select('amount, quantity, type')
      .eq('user_id', userId)
      .eq('asset_name', assetName);

    if (txError) throw txError;

    // 2. Récupérer les dividendes réinvestis de cet actif
    const { data: divData, error: divError } = await sb
      .from('dividends')
      .select('amount')
      .eq('user_id', userId)
      .eq('asset_name', assetName)
      .eq('is_reinvested', true);

    if (divError) throw divError;

    let totalCashSpent = 0;
    let totalQuantityOwned = 0;

    // Calcul via les transactions standards
    txData.forEach(tx => {
      if (tx.type === 'BUY') {
        totalCashSpent += Number(tx.amount);
        totalQuantityOwned += Number(tx.quantity || 0);
      } else if (tx.type === 'SELL') {
        // En cas de vente partielle, on ajuste la quantité au prorata
        totalQuantityOwned -= Number(tx.quantity || 0);
      }
    });

    // Impact des dividendes réinvestis :
    // Hypothèse : Le dividende a servi à acheter des fractions d'actions à la date de distribution.
    // Pour simplifier le calcul du PRU global : le dividende perçu réduit le "coût de revient net" de ta poche.
    let totalDividendsReinvested = divData.reduce((sum, div) => sum + Number(div.amount), 0);
    
    // Ton coût réel baisse puisque l'actif s'est auto-financé à hauteur des dividendes
    const netCashSpent = totalCashSpent - totalDividendsReinvested;

    if (totalQuantityOwned <= 0) return 0;

    // PRU = Argent net sorti de ta poche / Quantité totale de titres possédés
    return netCashSpent / totalQuantityOwned;
  } catch (err) {
    console.error(`Erreur PRU pour l'actif ${assetName}:`, err.message);
    return 0;
  }
}

/**
 * 🚀 FONCTION PRINCIPALE : Ggénérer le bilan financier complet pour le Dashboard
 */
async function getPortfolioSummary(userId) {
  const portfolioValue = await calculatePortfolioValue(userId);
  const investedCapital = await calculateInvestedCapital(userId);
  const pnlAbsolu = await calculatePnL(portfolioValue, investedCapital);
  const pnlRelatif = calculateReturn(portfolioValue, investedCapital);
  const ytdPerf = await calculateYTD(userId, portfolioValue);

  return {
    portfolioValue,
    investedCapital,
    pnlAbsolu,
    pnlRelatif,
    ytdPerf
  };
}
