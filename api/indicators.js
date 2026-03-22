// Technical Indicators API — BUNKER V500
// v4.0 — Added closes_daily support for SMA200 (Momentum strategy)
module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (req.body.closes) {
      const closesStr = typeof req.body.closes === 'string' ? req.body.closes : req.body.closes.toString();
      const closes = closesStr.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      if (closes.length === 0) return res.status(400).json({ error: 'No valid close prices provided' });

      const currentClose = closes[closes.length - 1];

      // Core indicators from 1h closes
      const rsi6   = calculateRSI(closes, 6);
      const rsi14  = calculateRSI(closes, 14);
      const rsi21  = calculateRSI(closes, 21);
      const sma20  = calculateSMA(closes, 20);
      const sma50  = calculateSMA(closes, 50);
      const ema12  = calculateEMA(closes, 12);
      const ema26  = calculateEMA(closes, 26);
      const macd   = (ema12 && ema26) ? ema12 - ema26 : null;

      // ATR from closes (approximation: close-to-close * 1.25)
      const atr14 = calculateATRFromCloses(closes, 14);
      const atr21 = calculateATRFromCloses(closes, 21);
      const stopLossPrice = atr14 ? Math.round((currentClose - (2 * atr14)) * 100) / 100 : null;

      // --- Daily closes for SMA200 (optional — Momentum strategy) ---
      let sma200 = null;
      let aboveSma200 = null;
      let sma50AboveSma200 = null;
      let momentumAlignment = false;

      if (req.body.closes_daily) {
        const dailyStr = typeof req.body.closes_daily === 'string' ? req.body.closes_daily : req.body.closes_daily.toString();
        const dailyCloses = dailyStr.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
        if (dailyCloses.length >= 200) {
          sma200 = calculateSMA(dailyCloses, 200);
          const sma50Daily = calculateSMA(dailyCloses, 50);
          aboveSma200 = sma200 ? currentClose > sma200 : null;
          sma50AboveSma200 = (sma50Daily && sma200) ? sma50Daily > sma200 : null;
          // Minervini alignment: price > SMA50 > SMA200
          const aboveSma50Daily = sma50Daily ? currentClose > sma50Daily : null;
          momentumAlignment = (aboveSma50Daily && sma50AboveSma200) ? true : false;
        }
      }

      // Trend confirmations from 1h closes
      const aboveSma50 = sma50 ? currentClose > sma50 : null;

      // ATR filter for options (sufficient volatility for premium)
      const atrSufficient = atr14 ? atr14 > 0.5 : false;

      // Grid Trading levels
      const recentCloses = closes.slice(-20);
      const gridHigh = Math.max(...recentCloses);
      const gridLow  = Math.min(...recentCloses);
      const gridRange = gridHigh - gridLow;
      const gridLevels = gridRange > 0 ? {
        level1: Math.round((gridLow + gridRange * 0.25) * 100) / 100,
        level2: Math.round((gridLow + gridRange * 0.50) * 100) / 100,
        level3: Math.round((gridLow + gridRange * 0.75) * 100) / 100,
        high:   Math.round(gridHigh * 100) / 100,
        low:    Math.round(gridLow  * 100) / 100,
        range:  Math.round(gridRange * 100) / 100,
      } : null;

      return res.status(200).json({
        success:            true,
        // RSI
        rsi_6:              rsi6   ? Math.round(rsi6   * 100) / 100 : null,
        rsi_14:             rsi14  ? Math.round(rsi14  * 100) / 100 : null,
        rsi_21:             rsi21  ? Math.round(rsi21  * 100) / 100 : null,
        // Moving Averages (1h)
        sma_20:             sma20  ? Math.round(sma20  * 100) / 100 : null,
        sma_50:             sma50  ? Math.round(sma50  * 100) / 100 : null,
        // Moving Averages (daily — only if closes_daily provided)
        sma_200:            sma200 ? Math.round(sma200 * 100) / 100 : null,
        // EMA & MACD
        ema_12:             ema12  ? Math.round(ema12  * 100) / 100 : null,
        ema_26:             ema26  ? Math.round(ema26  * 100) / 100 : null,
        macd:               macd   ? Math.round(macd   * 10000) / 10000 : null,
        // ATR
        atr_14:             atr14  ? Math.round(atr14  * 10000) / 10000 : null,
        atr_21:             atr21  ? Math.round(atr21  * 10000) / 10000 : null,
        stop_loss_price:    stopLossPrice,
        // Trend signals
        above_sma50:        aboveSma50,
        above_sma200:       aboveSma200,
        sma50_above_sma200: sma50AboveSma200,
        momentum_alignment: momentumAlignment,
        // Options filter
        atr_sufficient:     atrSufficient,
        // Grid Trading levels (last 20 candles)
        grid_levels:        gridLevels,
        // Status
        oversold:           rsi14 ? rsi14 < 50 : false,
        candles_count:      closes.length,
        daily_candles_count: req.body.closes_daily ? (req.body.closes_daily.split(',').filter(v => v.trim()).length) : 0,
        timestamp:          new Date().toISOString()
      });
    }

    // FORMATO COMPLETO: { "Data": { "Data": [...] } }
    let candles;
    if (req.body.Data && req.body.Data.Data) {
      candles = req.body.Data.Data;
    } else if (Array.isArray(req.body)) {
      candles = req.body;
    } else {
      return res.status(400).json({
        error: 'Invalid format. Send {"closes":"48.57,48.69,..."}',
        received: JSON.stringify(req.body).substring(0, 200)
      });
    }

    if (!Array.isArray(candles) || candles.length === 0) {
      return res.status(400).json({ error: 'No candle data provided' });
    }

    candles = candles.map(c => ({
      ...c,
      volumefrom: c.volumefrom ?? c.volume ?? 0,
      time: c.time ?? c.date ?? 0,
      open:  parseFloat(c.open)  || 0,
      high:  parseFloat(c.high)  || 0,
      low:   parseFloat(c.low)   || 0,
      close: parseFloat(c.close) || 0,
    }));

    const indicators = calculateAllIndicators(candles);
    res.status(200).json({ success: true, indicators, candles_count: candles.length, timestamp: new Date().toISOString() });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

function calculateATRFromCloses(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const ranges = [];
  for (let i = 1; i < closes.length; i++) {
    ranges.push(Math.abs(closes[i] - closes[i - 1]) * 1.25);
  }
  return calculateSMA(ranges, period);
}

function calculateAllIndicators(candles) {
  const latest  = candles[candles.length - 1];
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const closes  = candles.map(c => c.close);
  const currentClose = latest.close;

  const atr14 = calculateATR(highs, lows, closes, 14);
  const stopLossPrice = atr14 ? Math.round((currentClose - (2 * atr14)) * 100) / 100 : null;

  const sma50  = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, 200);
  const aboveSma50        = sma50  ? currentClose > sma50  : null;
  const aboveSma200       = sma200 ? currentClose > sma200 : null;
  const sma50AboveSma200  = (sma50 && sma200) ? sma50 > sma200 : null;
  const momentumAlignment = (aboveSma50 && sma50AboveSma200) ? true : false;
  const atrSufficient     = atr14 ? atr14 > 0.5 : false;

  const recentCloses = closes.slice(-20);
  const gridHigh = Math.max(...recentCloses);
  const gridLow  = Math.min(...recentCloses);
  const gridRange = gridHigh - gridLow;

  return {
    current_open: latest.open, current_high: latest.high,
    current_low: latest.low,   current_close: latest.close,
    current_volume: latest.volumefrom || 0,
    sma_5:   calculateSMA(closes, 5),
    sma_10:  calculateSMA(closes, 10),
    sma_20:  calculateSMA(closes, 20),
    sma_50:  sma50,
    sma_200: sma200,
    ema_12:  calculateEMA(closes, 12),
    ema_26:  calculateEMA(closes, 26),
    macd_12_26: calculateMACD(closes, 12, 26, 9),
    rsi_6:   calculateRSI(closes, 6),
    rsi_14:  calculateRSI(closes, 14),
    rsi_21:  calculateRSI(closes, 21),
    bb_20_2: calculateBollingerBands(closes, 20, 2),
    stoch_14_3: calculateStochastic(highs, lows, closes, 14, 3),
    atr_14:  atr14,
    atr_21:  calculateATR(highs, lows, closes, 21),
    stop_loss_price: stopLossPrice,
    above_sma50, above_sma200, sma50_above_sma200: sma50AboveSma200,
    momentum_alignment: momentumAlignment,
    atr_sufficient: atrSufficient,
    grid_levels: gridRange > 0 ? {
      level1: Math.round((gridLow + gridRange * 0.25) * 100) / 100,
      level2: Math.round((gridLow + gridRange * 0.50) * 100) / 100,
      level3: Math.round((gridLow + gridRange * 0.75) * 100) / 100,
      high: Math.round(gridHigh * 100) / 100,
      low:  Math.round(gridLow  * 100) / 100,
      range: Math.round(gridRange * 100) / 100,
    } : null,
    support_10:    Math.min(...lows.slice(-10)),
    resistance_10: Math.max(...highs.slice(-10)),
    price_change_1: closes.length > 1 ? ((latest.close - closes[closes.length-2]) / closes[closes.length-2]) * 100 : 0,
    volatility_20: calculateVolatility(closes, 20),
    oversold: calculateRSI(closes, 14) < 50
  };
}

function calculateSMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    ag = ((ag * (period - 1)) + (d > 0 ? d : 0)) / period;
    al = ((al * (period - 1)) + (d < 0 ? -d : 0)) / period;
  }
  return al === 0 ? 100 : 100 - (100 / (1 + ag / al));
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  const sma = calculateSMA(prices, period);
  if (!sma) return null;
  const slice = prices.slice(-period);
  const variance = slice.reduce((s, p) => s + Math.pow(p - sma, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: sma + sd * stdDev, middle: sma, lower: sma - sd * stdDev };
}

function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
  const f = calculateEMA(prices, fast);
  const s = calculateEMA(prices, slow);
  if (!f || !s) return null;
  const macd = f - s;
  return { macd, signal: macd * 0.9, histogram: macd * 0.1 };
}

function calculateStochastic(highs, lows, closes, k = 14, d = 3) {
  if (highs.length < k) return null;
  const hh = Math.max(...highs.slice(-k));
  const ll = Math.min(...lows.slice(-k));
  const kv = ((closes[closes.length - 1] - ll) / (hh - ll)) * 100;
  return { k: kv, d: kv * (d / (d + 1)) };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return calculateSMA(trs, period);
}

function calculateVolatility(prices, period = 20) {
  if (!prices || prices.length < period) return null;
  const returns = [];
  for (let i = 1; i < prices.length; i++) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  const r = returns.slice(-period);
  const avg = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / r.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}
