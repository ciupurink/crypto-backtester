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

/**
 * Finds the latest higher-timeframe candle whose timestamp <= the given timestamp.
 */
function findHtfCandle(
  htfCandles: CandleWithIndicators[],
  timestamp: number,
): CandleWithIndicators | null {
  let result: CandleWithIndicators | null = null;
  for (let i = htfCandles.length - 1; i >= 0; i--) {
    if (htfCandles[i].timestamp <= timestamp) {
      result = htfCandles[i];
      break;
    }
  }
  return result;
}

export const multiTimeframeStrategy: Strategy = {
  name: 'Multi-Timeframe Trend Pullback',
  requiredTimeframes: ['15m', '1h', '4h'],

  shouldEnterLong(
    candles: CandleWithIndicators[],
    currentIndex: number,
    multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    if (currentIndex < 10) return NO_SIGNAL;
    if (!multiTfData || !multiTfData['1h'] || !multiTfData['4h']) return NO_SIGNAL;

    const current = candles[currentIndex];
    const ind = current.indicators;
    const timestamp = current.timestamp;

    // Validate primary timeframe indicators
    if (
      isNaN(ind.rsi) || isNaN(ind.macd.histogram) || isNaN(ind.atr)
    ) {
      return NO_SIGNAL;
    }

    // --- 4h timeframe check ---
    const htf4h = findHtfCandle(multiTfData['4h'], timestamp);
    if (!htf4h) return NO_SIGNAL;
    const ind4h = htf4h.indicators;
    if (isNaN(ind4h.ema21) || isNaN(ind4h.ema50) || isNaN(ind4h.adx)) return NO_SIGNAL;

    // 4h: EMA21 > EMA50 AND ADX > 25 (confirmed uptrend)
    const uptrend4h = ind4h.ema21 > ind4h.ema50 && ind4h.adx > 25;
    if (!uptrend4h) return NO_SIGNAL;

    // --- 1h timeframe check ---
    const htf1h = findHtfCandle(multiTfData['1h'], timestamp);
    if (!htf1h) return NO_SIGNAL;
    const ind1h = htf1h.indicators;
    if (isNaN(ind1h.ema21)) return NO_SIGNAL;

    // 1h: price pulled back to EMA21 zone (within 0.5%)
    const pullbackToEma21 = Math.abs(htf1h.close - ind1h.ema21) / ind1h.ema21 <= 0.005;
    if (!pullbackToEma21) return NO_SIGNAL;

    // --- 15m (primary) check ---
    // RSI was below 40 recently and now above 40
    let wasBelow40 = false;
    for (let i = 1; i <= 5; i++) {
      const lookbackIdx = currentIndex - i;
      if (lookbackIdx < 0) break;
      const prevRsi = candles[lookbackIdx].indicators.rsi;
      if (!isNaN(prevRsi) && prevRsi < 40) {
        wasBelow40 = true;
        break;
      }
    }
    const rsiBounce = wasBelow40 && ind.rsi > 40;

    // MACD histogram turning positive
    const macdPositive = ind.macd.histogram > 0;

    if (rsiBounce && macdPositive) {
      // SL: 2.5x ATR or below recent swing low (min low of last 10 candles), whichever is lower
      const atrStop = current.close - 2.5 * ind.atr;
      let swingLow = current.low;
      for (let i = 1; i <= 10; i++) {
        const lookbackIdx = currentIndex - i;
        if (lookbackIdx < 0) break;
        if (candles[lookbackIdx].low < swingLow) {
          swingLow = candles[lookbackIdx].low;
        }
      }
      const stopLoss = Math.min(atrStop, swingLow);

      const takeProfit = current.close + 2 * ind.atr;   // TP1
      const takeProfit2 = current.close + 4 * ind.atr;   // TP2

      return {
        enter: true,
        stopLoss,
        takeProfit,
        takeProfit2,
        reason: `MTF Long | 4h uptrend (ADX=${ind4h.adx.toFixed(1)}) | 1h pullback to EMA21 | 15m RSI bounce + MACD positive`,
      };
    }

    return NO_SIGNAL;
  },

  shouldEnterShort(
    candles: CandleWithIndicators[],
    currentIndex: number,
    multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    if (currentIndex < 10) return NO_SIGNAL;
    if (!multiTfData || !multiTfData['1h'] || !multiTfData['4h']) return NO_SIGNAL;

    const current = candles[currentIndex];
    const ind = current.indicators;
    const timestamp = current.timestamp;

    if (
      isNaN(ind.rsi) || isNaN(ind.macd.histogram) || isNaN(ind.atr)
    ) {
      return NO_SIGNAL;
    }

    // --- 4h timeframe check ---
    const htf4h = findHtfCandle(multiTfData['4h'], timestamp);
    if (!htf4h) return NO_SIGNAL;
    const ind4h = htf4h.indicators;
    if (isNaN(ind4h.ema21) || isNaN(ind4h.ema50) || isNaN(ind4h.adx)) return NO_SIGNAL;

    // 4h: EMA21 < EMA50 AND ADX > 25 (confirmed downtrend)
    const downtrend4h = ind4h.ema21 < ind4h.ema50 && ind4h.adx > 25;
    if (!downtrend4h) return NO_SIGNAL;

    // --- 1h timeframe check ---
    const htf1h = findHtfCandle(multiTfData['1h'], timestamp);
    if (!htf1h) return NO_SIGNAL;
    const ind1h = htf1h.indicators;
    if (isNaN(ind1h.ema21)) return NO_SIGNAL;

    // 1h: price pulled back up to EMA21 zone (within 0.5%)
    const pullbackToEma21 = Math.abs(htf1h.close - ind1h.ema21) / ind1h.ema21 <= 0.005;
    if (!pullbackToEma21) return NO_SIGNAL;

    // --- 15m (primary) check ---
    // RSI was above 60 recently and now below 60
    let wasAbove60 = false;
    for (let i = 1; i <= 5; i++) {
      const lookbackIdx = currentIndex - i;
      if (lookbackIdx < 0) break;
      const prevRsi = candles[lookbackIdx].indicators.rsi;
      if (!isNaN(prevRsi) && prevRsi > 60) {
        wasAbove60 = true;
        break;
      }
    }
    const rsiDrop = wasAbove60 && ind.rsi < 60;

    // MACD histogram turning negative
    const macdNegative = ind.macd.histogram < 0;

    if (rsiDrop && macdNegative) {
      // SL: 2.5x ATR or above recent swing high (max high of last 10 candles), whichever is higher
      const atrStop = current.close + 2.5 * ind.atr;
      let swingHigh = current.high;
      for (let i = 1; i <= 10; i++) {
        const lookbackIdx = currentIndex - i;
        if (lookbackIdx < 0) break;
        if (candles[lookbackIdx].high > swingHigh) {
          swingHigh = candles[lookbackIdx].high;
        }
      }
      const stopLoss = Math.max(atrStop, swingHigh);

      const takeProfit = current.close - 2 * ind.atr;   // TP1
      const takeProfit2 = current.close - 4 * ind.atr;   // TP2

      return {
        enter: true,
        stopLoss,
        takeProfit,
        takeProfit2,
        reason: `MTF Short | 4h downtrend (ADX=${ind4h.adx.toFixed(1)}) | 1h pullback to EMA21 | 15m RSI drop + MACD negative`,
      };
    }

    return NO_SIGNAL;
  },

  shouldExit(
    position: Position,
    candles: CandleWithIndicators[],
    currentIndex: number,
    multiTfData?: MultiTimeframeData,
  ): ExitSignal {
    if (currentIndex < 0) return NO_EXIT;
    if (!multiTfData || !multiTfData['4h']) return NO_EXIT;

    const current = candles[currentIndex];
    const timestamp = current.timestamp;

    // Check if 4h trend has reversed
    const htf4h = findHtfCandle(multiTfData['4h'], timestamp);
    if (!htf4h) return NO_EXIT;
    const ind4h = htf4h.indicators;
    if (isNaN(ind4h.ema21) || isNaN(ind4h.ema50)) return NO_EXIT;

    if (position.side === 'long') {
      // Exit if 4h trend turns bearish
      if (ind4h.ema21 < ind4h.ema50) {
        return {
          exit: true,
          reason: `4h trend reversed to bearish (EMA21 < EMA50)`,
        };
      }
    } else {
      // Exit if 4h trend turns bullish
      if (ind4h.ema21 > ind4h.ema50) {
        return {
          exit: true,
          reason: `4h trend reversed to bullish (EMA21 > EMA50)`,
        };
      }
    }

    return NO_EXIT;
  },
};
