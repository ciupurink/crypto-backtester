import {
  Strategy,
  CandleWithIndicators,
  EntrySignal,
  ExitSignal,
  Position,
  MultiTimeframeData,
  NO_SIGNAL,
  NO_EXIT,
} from '../types';

// ---- Funding rate data store ----

interface FundingRateEntry {
  fundingRate: number;
  fundingRateTimestamp: number;
}

let fundingRates: FundingRateEntry[] = [];

/**
 * Load funding rate data so the strategy can reference it.
 * Rates should be sorted ascending by fundingRateTimestamp.
 */
export function loadFundingData(
  rates: Array<{ fundingRate: number; fundingRateTimestamp: number }>,
): void {
  fundingRates = [...rates].sort(
    (a, b) => a.fundingRateTimestamp - b.fundingRateTimestamp,
  );
}

/** Alias kept for compatibility */
export const setFundingRates = loadFundingData;

/**
 * Find the most recent funding rate entry whose timestamp <= the given candle timestamp.
 */
function findFundingRate(timestamp: number): FundingRateEntry | null {
  let result: FundingRateEntry | null = null;
  for (let i = fundingRates.length - 1; i >= 0; i--) {
    if (fundingRates[i].fundingRateTimestamp <= timestamp) {
      result = fundingRates[i];
      break;
    }
  }
  return result;
}

export const fundingRateStrategy: Strategy = {
  name: 'Funding Rate + Trend',
  requiredTimeframes: ['4h'],

  shouldEnterLong(
    candles: CandleWithIndicators[],
    currentIndex: number,
    multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    if (currentIndex < 1) return NO_SIGNAL;
    if (fundingRates.length === 0) return NO_SIGNAL;
    if (!multiTfData || !multiTfData['4h']) return NO_SIGNAL;

    const current = candles[currentIndex];
    const ind = current.indicators;

    if (
      isNaN(ind.rsi) || isNaN(ind.macd.histogram) || isNaN(ind.atr)
    ) {
      return NO_SIGNAL;
    }

    // Find corresponding funding rate
    const fr = findFundingRate(current.timestamp);
    if (!fr) return NO_SIGNAL;

    // Extreme negative funding: crowd is shorting, look for longs
    if (fr.fundingRate >= -0.0001) return NO_SIGNAL;

    // --- 4h timeframe checks ---
    const htf4hCandles = multiTfData['4h'];
    let htf4h: CandleWithIndicators | null = null;
    for (let i = htf4hCandles.length - 1; i >= 0; i--) {
      if (htf4hCandles[i].timestamp <= current.timestamp) {
        htf4h = htf4hCandles[i];
        break;
      }
    }
    if (!htf4h) return NO_SIGNAL;
    const ind4h = htf4h.indicators;
    if (isNaN(ind4h.ema50) || isNaN(ind4h.adx)) return NO_SIGNAL;

    // Price above EMA50 on 4h (uptrend despite negative funding)
    const aboveEma50_4h = htf4h.close > ind4h.ema50;
    // ADX > 20 on 4h
    const strongTrend4h = ind4h.adx > 20;
    // RSI between 35-55 (not overbought)
    const rsiInRange = ind.rsi >= 35 && ind.rsi <= 55;
    // MACD histogram positive on primary
    const macdPositive = ind.macd.histogram > 0;

    if (aboveEma50_4h && strongTrend4h && rsiInRange && macdPositive) {
      const stopLoss = current.close - 2 * ind.atr;
      const takeProfit = current.close + 3 * ind.atr;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `Funding rate extreme negative (${(fr.fundingRate * 100).toFixed(4)}%) | 4h uptrend | RSI=${ind.rsi.toFixed(1)}`,
      };
    }

    return NO_SIGNAL;
  },

  shouldEnterShort(
    candles: CandleWithIndicators[],
    currentIndex: number,
    multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    if (currentIndex < 1) return NO_SIGNAL;
    if (fundingRates.length === 0) return NO_SIGNAL;
    if (!multiTfData || !multiTfData['4h']) return NO_SIGNAL;

    const current = candles[currentIndex];
    const ind = current.indicators;

    if (
      isNaN(ind.rsi) || isNaN(ind.macd.histogram) || isNaN(ind.atr)
    ) {
      return NO_SIGNAL;
    }

    // Find corresponding funding rate
    const fr = findFundingRate(current.timestamp);
    if (!fr) return NO_SIGNAL;

    // Extreme positive funding: crowd is longing, look for shorts
    if (fr.fundingRate <= 0.0001) return NO_SIGNAL;

    // --- 4h timeframe checks ---
    const htf4hCandles = multiTfData['4h'];
    let htf4h: CandleWithIndicators | null = null;
    for (let i = htf4hCandles.length - 1; i >= 0; i--) {
      if (htf4hCandles[i].timestamp <= current.timestamp) {
        htf4h = htf4hCandles[i];
        break;
      }
    }
    if (!htf4h) return NO_SIGNAL;
    const ind4h = htf4h.indicators;
    if (isNaN(ind4h.ema50) || isNaN(ind4h.adx)) return NO_SIGNAL;

    // Price below EMA50 on 4h
    const belowEma50_4h = htf4h.close < ind4h.ema50;
    // ADX > 20 on 4h
    const strongTrend4h = ind4h.adx > 20;
    // RSI between 45-65
    const rsiInRange = ind.rsi >= 45 && ind.rsi <= 65;
    // MACD histogram negative on primary
    const macdNegative = ind.macd.histogram < 0;

    if (belowEma50_4h && strongTrend4h && rsiInRange && macdNegative) {
      const stopLoss = current.close + 2 * ind.atr;
      const takeProfit = current.close - 3 * ind.atr;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `Funding rate extreme positive (${(fr.fundingRate * 100).toFixed(4)}%) | 4h downtrend | RSI=${ind.rsi.toFixed(1)}`,
      };
    }

    return NO_SIGNAL;
  },

  shouldExit(
    position: Position,
    candles: CandleWithIndicators[],
    currentIndex: number,
    _multiTfData?: MultiTimeframeData,
  ): ExitSignal {
    if (currentIndex < 0) return NO_EXIT;
    if (fundingRates.length === 0) return NO_EXIT;

    const current = candles[currentIndex];

    // Check if funding rate has flipped (the crowd positioning that justified our entry is gone)
    const fr = findFundingRate(current.timestamp);
    if (!fr) return NO_EXIT;

    if (position.side === 'long') {
      // We entered long because funding was very negative.
      // If funding flips to very positive, the setup is invalidated.
      if (fr.fundingRate > 0.0001) {
        return {
          exit: true,
          reason: `Funding rate flipped positive (${(fr.fundingRate * 100).toFixed(4)}%) — setup invalidated`,
        };
      }
    } else {
      // We entered short because funding was very positive.
      // If funding flips to very negative, exit.
      if (fr.fundingRate < -0.0001) {
        return {
          exit: true,
          reason: `Funding rate flipped negative (${(fr.fundingRate * 100).toFixed(4)}%) — setup invalidated`,
        };
      }
    }

    return NO_EXIT;
  },
};
