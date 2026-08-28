// =====================================================================
// PATRIMONIA V2 - MOTEUR DE CALCUL DE PORTEFEUILLE (PORTFOLIO ENGINE)
// Basé sur les tables relationnelles Supabase : transactions, dividends, snapshots
// =====================================================================

const formatterEUR = new Intl.NumberFormat('fr-FR', { 
  style: 'currency', 
  currency: 'EUR', 
  maximumFractionDigits: 2 
});

/**
 * Calcule la valorisation totale actuelle du patrimoine en agrégeant la table assets
 */
async function calculatePortfolioValue(userId) {
  try {
    const { data, error } = await sb
      .from('assets')
      .select('value')
      .eq('user_id', userId);

    if (error) throw error;
    return data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  } catch (err) {
    console.error("Erreur dans calculatePortfolioValue:", err.message);
    return 0;
  }
}

/**
 * Calcule le capital injecté net (Achats - Ventes) en excluant les dividendes
 */
async function calculateInvestedCapital(userId) {
  try {
    const { data, error } = await sb
      .from('transactions')
      .select('amount, type')
      .eq('user_id', userId);

    if (error) throw error;

    let totalInjected = 0;
    data.forEach(tx => {
      if (tx.type === 'BUY') totalInjected += Number(tx.amount);
      else if (tx.type === 'SELL') totalInjected -= Number(tx.amount);
    });
    return totalInjected;
  } catch (err) {
    console.error("Erreur dans calculateInvestedCapital:", err.message);
    return 0;
  }
}

/**
 * Calcule la performance Year-To-Date depuis le 1er janvier
 */
async function calculateYTD(userId, currentPortfolioValue) {
  try {
    const currentYear = new Date().getFullYear();
    const firstDayOfYear = `${currentYear}-01-01`;

    const { data, error } = await sb
      .from('portfolio_snapshots')
      .select('total_value')
      .eq('user_id', userId)
      .gte('snapshot_date', firstDayOfYear)
      .order('snapshot_date', { ascending: true })
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0 || Number(data[0].total_value) === 0) return 0;

    const startOfYearValue = Number(data[0].total_value);
    return ((currentPortfolioValue - startOfYearValue) / startOfYearValue) * 100;
  } catch (err) {
    console.error("Erreur dans calculateYTD:", err.message);
    return 0;
  }
}

/**
 * Calcule le PRU d'un actif en ajustant à la baisse via les dividendes réinvestis
 */
async function calculateAssetPRU(userId, assetName) {
  try {
    const { data: txData, error: txError } = await sb
      .from('transactions')
      .select('amount, quantity, type')
      .eq('user_id', userId)
      .eq('asset_name', assetName);

    if (txError) throw txError;

    const { data: divData, error: divError } = await sb
      .from('dividends')
      .select('amount')
      .eq('user_id', userId)
      .eq('asset_name', assetName)
      .eq('is_reinvested', true);

    if (divError) throw divError;

    let totalCashSpent = 0;
    let totalQuantityOwned = 0;

    txData.forEach(tx => {
      if (tx.type === 'BUY') {
        totalCashSpent += Number(tx.amount);
        totalQuantityOwned += Number(tx.quantity || 0);
      } else if (tx.type === 'SELL') {
        totalQuantityOwned -= Number(tx.quantity || 0);
      }
    });

    let totalDividendsReinvested = divData.reduce((sum, div) => sum + Number(div.amount), 0);
    const netCashSpent = totalCashSpent - totalDividendsReinvested;

    if (totalQuantityOwned <= 0) return 0;
    return netCashSpent / totalQuantityOwned;
  } catch (err) {
    console.error(`Erreur PRU pour ${assetName}:`, err.message);
    return 0;
  }
}

/**
 * Synthèse complète pour l'affichage global
 */
async function getPortfolioSummary(userId) {
  const portfolioValue = await calculatePortfolioValue(userId);
  const investedCapital = await calculateInvestedCapital(userId);
  const pnlAbsolu = portfolioValue - investedCapital;
  const pnlRelatif = investedCapital > 0 ? (pnlAbsolu / investedCapital) * 100 : 0;
  const ytdPerf = await calculateYTD(userId, portfolioValue);

  return { portfolioValue, investedCapital, pnlAbsolu, pnlRelatif, ytdPerf };
}
