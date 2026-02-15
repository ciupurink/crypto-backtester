import {
  Candle,
  CandleWithIndicators,
  Indicators,
  MACD,
  BollingerBands,
  StochRSI,
  FibonacciLevels,
} from './types';

// ============================================================
// Helper: Simple Moving Average
// ============================================================

/**
 * Returns an array the same length as `data`. The first `period - 1`
 * values are NaN because there is not enough history.
 */
function sma(data: number[], period: number): number[] {
  const result: number[] = new Array(data.length).fill(NaN);
  if (data.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  result[period - 1] = sum / period;

  for (let i = period; i < data.length; i++) {
    sum += data[i] - data[i - period];
    result[i] = sum / period;
  }

  return result;
}

// ============================================================
// Helper: Exponential Moving Average
// ============================================================

/**
 * EMA seeded with the SMA over the first `period` values.
 * multiplier = 2 / (period + 1)
 */
function ema(data: number[], period: number): number[] {
  const result: number[] = new Array(data.length).fill(NaN);
  if (data.length < period) return result;

  const multiplier = 2 / (period + 1);

  // Seed with SMA.
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  result[period - 1] = sum / period;

  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * multiplier + result[i - 1] * (1 - multiplier);
  }

  return result;
}

// ============================================================
// Helper: RSI (Wilder's smoothing)
// ============================================================

/**
 * RSI using Wilder's smoothing method.
 * - First average gain/loss is a simple average over the first `period` changes.
 * - Subsequent averages: avg = (prev_avg * (period - 1) + current) / period
 *
 * Returns array of same length as `closes`; the first `period` values are NaN.
 */
function rsi(closes: number[], period: number): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return result;

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  // First average (SMA over first `period` changes).
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  const computeRsi = (ag: number, al: number): number => {
    if (al === 0) return 100;
    const rs = ag / al;
    return 100 - 100 / (1 + rs);
  };

  // The RSI at index `period` in the closes array (we need `period` changes,
  // which starts from index 1, so first valid RSI is at closes index `period`).
  result[period] = computeRsi(avgGain, avgLoss);

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    // gains[i] corresponds to closes[i+1], so RSI index is i+1.
    result[i + 1] = computeRsi(avgGain, avgLoss);
  }

  return result;
}

// ============================================================
// Helper: MACD
// ============================================================

function macd(closes: number[], fast: number, slow: number, signal: number): MACD[] {
  const result: MACD[] = new Array(closes.length).fill(null).map(() => ({
    line: NaN,
    signal: NaN,
    histogram: NaN,
  }));

  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);

  // MACD line = fast EMA - slow EMA.
  const macdLine: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }

  // Signal line = EMA of the MACD line.
  // We need to run EMA only on the valid portion of macdLine.
  const firstValid = macdLine.findIndex((v) => !isNaN(v));
  if (firstValid === -1) return result;

  const validMacd = macdLine.slice(firstValid);
  const signalLine = ema(validMacd, signal);

  for (let i = 0; i < validMacd.length; i++) {
    const idx = firstValid + i;
    result[idx].line = macdLine[idx];
    if (!isNaN(signalLine[i])) {
      result[idx].signal = signalLine[i];
      result[idx].histogram = macdLine[idx] - signalLine[i];
    }
  }

  return result;
}

// ============================================================
// Helper: Bollinger Bands
// ============================================================

function bollingerBands(closes: number[], period: number, stdDevMult: number): BollingerBands[] {
  const result: BollingerBands[] = new Array(closes.length).fill(null).map(() => ({
    upper: NaN,
    middle: NaN,
    lower: NaN,
    bandwidth: NaN,
  }));

  if (closes.length < period) return result;

  const middle = sma(closes, period);

  for (let i = period - 1; i < closes.length; i++) {
    // Standard deviation over the last `period` values.
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    let sumSqDiff = 0;
    for (let j = 0; j < slice.length; j++) {
      const diff = slice[j] - mean;
      sumSqDiff += diff * diff;
    }
    const sd = Math.sqrt(sumSqDiff / period);

    result[i].middle = mean;
    result[i].upper = mean + stdDevMult * sd;
    result[i].lower = mean - stdDevMult * sd;
    result[i].bandwidth = mean !== 0 ? ((result[i].upper - result[i].lower) / mean) * 100 : NaN;
  }

  return result;
}

// ============================================================
// Helper: Average True Range (Wilder's smoothing)
// ============================================================

function atr(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period + 1) return result;

  // True Range array (first element has no previous close, so we use high - low).
  const tr: number[] = new Array(candles.length).fill(0);
  tr[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  // First ATR is SMA of first `period` TRs (starting from index 1 so we have prevClose).
  let sum = 0;
  for (let i = 1; i <= period; i++) {
    sum += tr[i];
  }
  let atrVal = sum / period;
  result[period] = atrVal;

  // Wilder's smoothing for subsequent values.
  for (let i = period + 1; i < candles.length; i++) {
    atrVal = (atrVal * (period - 1) + tr[i]) / period;
    result[i] = atrVal;
  }

  return result;
}

// ============================================================
// Helper: Average Directional Index (ADX)
// ============================================================

function adx(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < 2 * period + 1) return result;

  const length = candles.length;

  // Step 1: Calculate directional movement (+DM, -DM) and True Range.
  const plusDM: number[] = new Array(length).fill(0);
  const minusDM: number[] = new Array(length).fill(0);
  const tr: number[] = new Array(length).fill(0);

  for (let i = 1; i < length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  // Step 2: Wilder's smoothing for +DM, -DM, TR over `period`.
  // First smoothed value is the sum of the first `period` values.
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;
  let smoothTR = 0;

  for (let i = 1; i <= period; i++) {
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
    smoothTR += tr[i];
  }

  // Step 3: Calculate +DI, -DI, DX, then smooth DX to get ADX.
  const dx: number[] = new Array(length).fill(NaN);

  const calcDI = (): void => {
    const plusDI = smoothTR !== 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const minusDI = smoothTR !== 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const diSum = plusDI + minusDI;
    dx[period] = diSum !== 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
  };

  calcDI();

  for (let i = period + 1; i < length; i++) {
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
    smoothTR = smoothTR - smoothTR / period + tr[i];

    const plusDI = smoothTR !== 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const minusDI = smoothTR !== 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const diSum = plusDI + minusDI;
    dx[i] = diSum !== 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
  }

  // Step 4: Smooth DX to get ADX. First ADX is the SMA of the first `period` DX values.
  let adxSum = 0;
  const adxStart = period; // first valid DX index
  let count = 0;
  let adxIdx = adxStart;

  while (count < period && adxIdx < length) {
    if (!isNaN(dx[adxIdx])) {
      adxSum += dx[adxIdx];
      count++;
    }
    adxIdx++;
  }

  if (count < period) return result;

  let adxVal = adxSum / period;
  result[adxIdx - 1] = adxVal;

  // Wilder's smoothing for subsequent ADX values.
  for (let i = adxIdx; i < length; i++) {
    if (!isNaN(dx[i])) {
      adxVal = (adxVal * (period - 1) + dx[i]) / period;
      result[i] = adxVal;
    }
  }

  return result;
}

// ============================================================
// Helper: Stochastic RSI
// ============================================================

/**
 * 1. Calculate RSI.
 * 2. Apply the Stochastic oscillator formula to the RSI values:
 *    StochRSI = (RSI - lowestRSI) / (highestRSI - lowestRSI)
 * 3. %K = SMA(StochRSI, kSmooth)
 * 4. %D = SMA(%K, dSmooth)
 */
function stochRsi(
  closes: number[],
  rsiPeriod: number,
  stochPeriod: number,
  kSmooth: number,
  dSmooth: number
): StochRSI[] {
  const result: StochRSI[] = new Array(closes.length).fill(null).map(() => ({
    k: NaN,
    d: NaN,
  }));

  const rsiValues = rsi(closes, rsiPeriod);

  // Raw stochastic of RSI.
  const rawStoch: number[] = new Array(closes.length).fill(NaN);

  for (let i = 0; i < closes.length; i++) {
    if (isNaN(rsiValues[i])) continue;

    // We need `stochPeriod` valid RSI values ending at i.
    const start = i - stochPeriod + 1;
    if (start < 0) continue;

    let lowest = Infinity;
    let highest = -Infinity;
    let valid = true;

    for (let j = start; j <= i; j++) {
      if (isNaN(rsiValues[j])) {
        valid = false;
        break;
      }
      if (rsiValues[j] < lowest) lowest = rsiValues[j];
      if (rsiValues[j] > highest) highest = rsiValues[j];
    }

    if (!valid) continue;

    const range = highest - lowest;
    rawStoch[i] = range !== 0 ? ((rsiValues[i] - lowest) / range) * 100 : 50;
  }

  // %K = SMA of rawStoch over kSmooth.
  const kValues: number[] = new Array(closes.length).fill(NaN);

  for (let i = 0; i < closes.length; i++) {
    if (isNaN(rawStoch[i])) continue;

    const start = i - kSmooth + 1;
    if (start < 0) continue;

    let sum = 0;
    let count = 0;
    let valid = true;

    for (let j = start; j <= i; j++) {
      if (isNaN(rawStoch[j])) {
        valid = false;
        break;
      }
      sum += rawStoch[j];
      count++;
    }

    if (valid && count === kSmooth) {
      kValues[i] = sum / kSmooth;
    }
  }

  // %D = SMA of %K over dSmooth.
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(kValues[i])) continue;

    result[i].k = kValues[i];

    const start = i - dSmooth + 1;
    if (start < 0) continue;

    let sum = 0;
    let count = 0;
    let valid = true;

    for (let j = start; j <= i; j++) {
      if (isNaN(kValues[j])) {
        valid = false;
        break;
      }
      sum += kValues[j];
      count++;
    }

    if (valid && count === dSmooth) {
      result[i].d = sum / dSmooth;
    }
  }

  return result;
}

// ============================================================
// Helper: VWAP (resets daily)
// ============================================================

/**
 * Volume Weighted Average Price that resets at the start of each new
 * UTC day (detected by comparing dates of consecutive timestamps).
 */
function vwap(candles: Candle[]): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length === 0) return result;

  let cumulativePV = 0;
  let cumulativeVolume = 0;
  let currentDay = -1;

  for (let i = 0; i < candles.length; i++) {
    const date = new Date(candles[i].timestamp);
    const dayOfYear = date.getUTCFullYear() * 1000 + date.getUTCMonth() * 32 + date.getUTCDate();

    // Reset accumulators at the start of a new day.
    if (dayOfYear !== currentDay) {
      cumulativePV = 0;
      cumulativeVolume = 0;
      currentDay = dayOfYear;
    }

    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumulativePV += typicalPrice * candles[i].volume;
    cumulativeVolume += candles[i].volume;

    result[i] = cumulativeVolume !== 0 ? cumulativePV / cumulativeVolume : NaN;
  }

  return result;
}

// ============================================================
// Helper: Fibonacci Retracement Levels
// ============================================================

/**
 * For each candle, finds the highest high and lowest low over the
 * preceding `lookback` candles (including the current one), then
 * calculates Fibonacci retracement levels.
 *
 * Levels are calculated from the high down:
 *   level = high - (high - low) * ratio
 */
function fibonacciLevels(candles: Candle[], lookback: number): FibonacciLevels[] {
  const result: FibonacciLevels[] = new Array(candles.length).fill(null).map(() => ({
    high: NaN,
    low: NaN,
    level236: NaN,
    level382: NaN,
    level500: NaN,
    level618: NaN,
    level786: NaN,
  }));

  for (let i = 0; i < candles.length; i++) {
    const start = Math.max(0, i - lookback + 1);
    let highest = -Infinity;
    let lowest = Infinity;

    for (let j = start; j <= i; j++) {
      if (candles[j].high > highest) highest = candles[j].high;
      if (candles[j].low < lowest) lowest = candles[j].low;
    }

    const range = highest - lowest;

    result[i] = {
      high: highest,
      low: lowest,
      level236: highest - range * 0.236,
      level382: highest - range * 0.382,
      level500: highest - range * 0.5,
      level618: highest - range * 0.618,
      level786: highest - range * 0.786,
    };
  }

  return result;
}

// ============================================================
// Main exported function
// ============================================================

/**
 * Calculates ALL technical indicators for the given candle array and
 * returns enriched CandleWithIndicators objects.
 *
 * For candles where an indicator does not yet have enough history the
 * value will be NaN.
 */
export function calculateIndicators(candles: Candle[]): CandleWithIndicators[] {
  if (candles.length === 0) return [];

  // ----------------------------------------------------------
  // Extract price/volume arrays
  // ----------------------------------------------------------

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  // ----------------------------------------------------------
  // Calculate all indicators
  // ----------------------------------------------------------

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  const sma20 = sma(closes, 20);
  const sma50Arr = sma(closes, 50);

  const rsiValues = rsi(closes, 14);

  const macdValues = macd(closes, 12, 26, 9);

  const bbValues = bollingerBands(closes, 20, 2);

  const atrValues = atr(candles, 14);

  const adxValues = adx(candles, 14);

  const stochRsiValues = stochRsi(closes, 14, 14, 3, 3);

  const volumeSma = sma(volumes, 20);

  const vwapValues = vwap(candles);

  const fibValues = fibonacciLevels(candles, 100);

  // ----------------------------------------------------------
  // Assemble results
  // ----------------------------------------------------------

  const result: CandleWithIndicators[] = new Array(candles.length);

  for (let i = 0; i < candles.length; i++) {
    const indicators: Indicators = {
      ema9: ema9[i],
      ema21: ema21[i],
      ema50: ema50[i],
      ema200: ema200[i],
      sma20: sma20[i],
      sma50: sma50Arr[i],
      rsi: rsiValues[i],
      macd: macdValues[i],
      bb: bbValues[i],
      atr: atrValues[i],
      adx: adxValues[i],
      stochRsi: stochRsiValues[i],
      volumeSma: volumeSma[i],
      vwap: vwapValues[i],
      fibonacci: fibValues[i],
    };

    result[i] = {
      ...candles[i],
      indicators,
    };
  }

  return result;
}
