// Technical Indicators API for ML Prediction Models
module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let candles;

    // ✅ FORMATO SIMPLES: { "closes": "48.57,48.69,..." }
    if (req.body.closes) {
      const closesStr = typeof req.body.closes === 'string'
        ? req.body.closes : req.body.closes.toString();
      const closes = closesStr.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      if (closes.length === 0) return res.status(400).json({ error: 'No valid close prices provided' });

      const rsi14 = calculateRSI(closes, 14);
      const rsi6  = calculateRSI(closes, 6);
      const rsi21 = calculateRSI(closes, 21);
      const sma20 = calculateSMA(closes, 20);
      const ema12 = calculateEMA(closes, 12);
      const ema26 = calculateEMA(closes, 26);
      const macd  = (ema12 && ema26) ? ema12 - ema26 : null;
      const atr14 = calculateATRFromCloses(closes, 14);
      const atr21 = calculateATRFromCloses(closes, 21);
      const currentClose = closes[closes.length - 1];
      const stopLossPrice = atr14 ? Math.round((currentClose - (2 * atr14)) * 100) / 100 : null;

      return res.status(200).json({
        success: true,
        rsi_6:           rsi6  ? Math.round(rsi6  * 100) / 100 : null,
        rsi_14:          rsi14 ? Math.round(rsi14 * 100) / 100 : null,
        rsi_21:          rsi21 ? Math.round(rsi21 * 100) / 100 : null,
        sma_20:          sma20 ? Math.round(sma20 * 100) / 100 : null,
        ema_12:          ema12 ? Math.round(ema12 * 100) / 100 : null,
        ema_26:          ema26 ? Math.round(ema26 * 100) / 100 : null,
        macd:            macd  ? Math.round(macd  * 10000) / 10000 : null,
        atr_14:          atr14 ? Math.round(atr14 * 10000) / 10000 : null,
        atr_21:          atr21 ? Math.round(atr21 * 10000) / 10000 : null,
        stop_loss_price: stopLossPrice,
        oversold:        rsi14 ? rsi14 < 40 : false,
        candles_count:   closes.length,
        timestamp:       new Date().toISOString()
      });
    }

    // FORMATO COMPLETO: { "Data": { "Data": [...] } }
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
      open: parseFloat(c.open) || 0,
      high: parseFloat(c.high) || 0,
      low:  parseFloat(c.low)  || 0,
      close: parseFloat(c.close) || 0,
    }));

    const indicators = calculateAllIndicators(candles);

    res.status(200).json({
      success: true,
      indicators: indicators,
      candles_count: candles.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

// ATR approximation from closes only (close-to-close × 1.25 scaling factor)
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
  const volumes = candles.map(c => c.volumefrom || 0);

  const atr14 = calculateATR(highs, lows, closes, 14);
  const currentClose = latest.close;
  const stopLossPrice = atr14 ? Math.round((currentClose - (2 * atr14)) * 100) / 100 : null;

  return {
    current_open: latest.open, current_high: latest.high,
    current_low: latest.low,   current_close: latest.close,
    current_volume: latest.volumefrom || 0,
    sma_5: calculateSMA(closes,5),   sma_10: calculateSMA(closes,10),
    sma_20: calculateSMA(closes,20), sma_50: calculateSMA(closes,50),
    ema_12: calculateEMA(closes,12), ema_26: calculateEMA(closes,26),
    macd_12_26: calculateMACD(closes,12,26,9),
    rsi_6: calculateRSI(closes,6),   rsi_14: calculateRSI(closes,14),   rsi_21: calculateRSI(closes,21),
    bb_20_2: calculateBollingerBands(closes,20,2),
    stoch_14_3: calculateStochastic(highs,lows,closes,14,3),
    atr_14: atr14,
    atr_21: calculateATR(highs,lows,closes,21),
    stop_loss_price: stopLossPrice,
    support_10: Math.min(...lows.slice(-10)),
    resistance_10: Math.max(...highs.slice(-10)),
    price_change_1: closes.length > 1 ? ((latest.close - closes[closes.length-2]) / closes[closes.length-2]) * 100 : 0,
    volatility_20: calculateVolatility(closes,20),
    oversold: calculateRSI(closes,14) < 40
  };
}

function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a,b) => a+b, 0) / period;
}

function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i-1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i-1];
    ag = ((ag * (period-1)) + (d > 0 ? d : 0)) / period;
    al = ((al * (period-1)) + (d < 0 ? -d : 0)) / period;
  }
  return al === 0 ? 100 : 100 - (100 / (1 + ag / al));
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  const sma = calculateSMA(prices, period);
  if (!sma) return null;
  const slice = prices.slice(-period);
  const variance = slice.reduce((s,p) => s + Math.pow(p - sma, 2), 0) / period;
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
  const kv = ((closes[closes.length-1] - ll) / (hh - ll)) * 100;
  return { k: kv, d: kv * (d / (d + 1)) };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
  }
  return calculateSMA(trs, period);
}

function calculateVolatility(prices, period = 20) {
  if (prices.length < period) return null;
  const returns = [];
  for (let i = 1; i < prices.length; i++) returns.push((prices[i]-prices[i-1])/prices[i-1]);
  const r = returns.slice(-period);
  const avg = r.reduce((a,b) => a+b, 0) / r.length;
  const variance = r.reduce((s,v) => s + Math.pow(v-avg, 2), 0) / r.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}
