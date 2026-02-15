import { Candle, AltBtcCandle, Indicators, CandleWithIndicators, FundingRate, ALT_SYMBOLS } from './types';
import { calculateIndicators } from './indicators';
import { loadCandles, loadFundingRates } from './downloader';

// ============================================================
// Build synthetic ALT/BTC candles from ALTUSDT and BTCUSDT data
// ============================================================

/**
 * Constructs synthetic ALT/BTC ratio candles by dividing the ALTUSDT
 * price series by the BTCUSDT price series on a per-timestamp basis.
 *
 * Technical indicators are computed on the ratio series so that
 * strategies can use standard TA signals on the ALT/BTC pair.
 *
 * If funding rate data is available for the alt symbol, the closest
 * funding rate by timestamp is attached to each candle.
 */
export function buildAltBtcCandles(altSymbol: string, timeframe: string): AltBtcCandle[] | null {
  // ---- 1. Load raw USDT-denominated candles ----
  const btcCandles = loadCandles('BTCUSDT', timeframe);
  const altCandles = loadCandles(altSymbol, timeframe);

  if (!btcCandles || btcCandles.length === 0) return null;
  if (!altCandles || altCandles.length === 0) return null;

  // ---- 2. Build timestamp -> BTC candle lookup ----
  const btcMap = new Map<number, Candle>();
  for (const c of btcCandles) {
    btcMap.set(c.timestamp, c);
  }

  // ---- 3. Build ratio candles where both alt and btc exist ----
  interface RatioRow {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    turnover: number;
    altUsdtPrice: number;
    btcUsdtPrice: number;
  }

  const ratioRows: RatioRow[] = [];

  for (const alt of altCandles) {
    const btc = btcMap.get(alt.timestamp);
    if (!btc) continue;

    // Avoid division by zero
    if (btc.open === 0 || btc.close === 0 || btc.high === 0 || btc.low === 0) continue;

    ratioRows.push({
      timestamp: alt.timestamp,
      open: alt.open / btc.open,
      high: alt.high / btc.low,   // maximum possible ratio in the period
      low: alt.low / btc.high,    // minimum possible ratio in the period
      close: alt.close / btc.close,
      volume: alt.volume,
      turnover: alt.turnover,
      altUsdtPrice: alt.close,
      btcUsdtPrice: btc.close,
    });
  }

  if (ratioRows.length === 0) return null;

  // Sort by timestamp (should already be chronological, but be safe)
  ratioRows.sort((a, b) => a.timestamp - b.timestamp);

  // ---- 4. Create dummy Candle[] from ratios for indicator calculation ----
  const dummyCandles: Candle[] = ratioRows.map((r) => ({
    timestamp: r.timestamp,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    turnover: r.turnover,
  }));

  const candlesWithIndicators: CandleWithIndicators[] = calculateIndicators(dummyCandles);

  // ---- 5. Map indicators back onto AltBtcCandle objects ----
  const result: AltBtcCandle[] = ratioRows.map((r, i) => ({
    timestamp: r.timestamp,
    altSymbol,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    turnover: r.turnover,
    altUsdtPrice: r.altUsdtPrice,
    btcUsdtPrice: r.btcUsdtPrice,
    indicators: candlesWithIndicators[i].indicators,
  }));

  // ---- 6. Attach funding rates if available ----
  const fundingRates = loadFundingRates(altSymbol);

  if (fundingRates && fundingRates.length > 0) {
    // Funding rates are sorted chronologically.  For each candle we find
    // the closest funding rate by timestamp using binary search.
    const frTimestamps = fundingRates.map((fr) => fr.fundingRateTimestamp);

    for (const candle of result) {
      const idx = binarySearchClosest(frTimestamps, candle.timestamp);
      if (idx >= 0 && idx < fundingRates.length) {
        candle.altFundingRate = fundingRates[idx].fundingRate;
      }
    }
  }

  return result;
}

// ============================================================
// Build ALT/BTC candles for every alt in ALT_SYMBOLS
// ============================================================

/**
 * Calls `buildAltBtcCandles` for each symbol in ALT_SYMBOLS and
 * returns a map keyed by the alt symbol string.
 *
 * Symbols that fail to load (return null) are silently skipped.
 */
export function buildAllAltBtcCandles(timeframe: string): Map<string, AltBtcCandle[]> {
  const result = new Map<string, AltBtcCandle[]>();

  for (const sym of ALT_SYMBOLS) {
    const candles = buildAltBtcCandles(sym, timeframe);
    if (candles && candles.length > 0) {
      result.set(sym, candles);
    }
  }

  return result;
}

// ============================================================
// Average ratio trend across all alts
// ============================================================

/**
 * Calculates the average trend of ALT/BTC ratios across all alts
 * over a given lookback period ending at `timestamp`.
 *
 * For each alt, the function finds the candle closest to
 * `timestamp - lookbackDays * 86_400_000` and the candle closest to
 * `timestamp`, then computes the percentage change of the close ratio.
 * All percentage changes are averaged.
 *
 * Return value interpretation:
 *   - Positive: alts are outperforming BTC (BTC dominance falling)
 *   - Negative: BTC is outperforming alts (BTC dominance rising)
 */
export function calculateAvgRatioTrend(
  allAltCandles: Map<string, AltBtcCandle[]>,
  timestamp: number,
  lookbackDays: number,
): number {
  const lookbackMs = lookbackDays * 86_400_000;
  const startTimestamp = timestamp - lookbackMs;

  let totalPctChange = 0;
  let count = 0;

  for (const [, candles] of allAltCandles) {
    if (candles.length === 0) continue;

    // Find candle closest to startTimestamp
    const startIdx = findClosestCandleIndex(candles, startTimestamp);
    // Find candle closest to (current) timestamp
    const endIdx = findClosestCandleIndex(candles, timestamp);

    if (startIdx < 0 || endIdx < 0) continue;

    const startRatio = candles[startIdx].close;
    const endRatio = candles[endIdx].close;

    if (startRatio === 0 || !isFinite(startRatio) || !isFinite(endRatio)) continue;

    const pctChange = ((endRatio - startRatio) / startRatio) * 100;
    totalPctChange += pctChange;
    count++;
  }

  if (count === 0) return 0;
  return totalPctChange / count;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Binary search for the index of the element in `sortedArr` that is
 * closest to `target`.
 */
function binarySearchClosest(sortedArr: number[], target: number): number {
  if (sortedArr.length === 0) return -1;

  let lo = 0;
  let hi = sortedArr.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedArr[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is now the first index >= target.  Compare with lo-1 to see
  // which is actually closer.
  if (lo === 0) return 0;
  if (lo >= sortedArr.length) return sortedArr.length - 1;

  const diffLo = Math.abs(sortedArr[lo] - target);
  const diffPrev = Math.abs(sortedArr[lo - 1] - target);

  return diffPrev <= diffLo ? lo - 1 : lo;
}

/**
 * Finds the index of the candle whose timestamp is closest to `target`.
 * Assumes candles are sorted by timestamp ascending.
 */
function findClosestCandleIndex(candles: AltBtcCandle[], target: number): number {
  if (candles.length === 0) return -1;

  let lo = 0;
  let hi = candles.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].timestamp < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  if (lo === 0) return 0;
  if (lo >= candles.length) return candles.length - 1;

  const diffLo = Math.abs(candles[lo].timestamp - target);
  const diffPrev = Math.abs(candles[lo - 1].timestamp - target);

  return diffPrev <= diffLo ? lo - 1 : lo;
}
