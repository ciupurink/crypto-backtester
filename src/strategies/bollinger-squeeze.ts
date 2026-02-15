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
 * Checks whether a Bollinger Band squeeze occurred within the last `lookback` candles.
 * A squeeze is when the current bandwidth is the lowest in the last 20 periods.
 */
function squeezeDetectedRecently(
  candles: CandleWithIndicators[],
  currentIndex: number,
  lookback: number,
): boolean {
  for (let offset = 0; offset < lookback; offset++) {
    const idx = currentIndex - offset;
    if (idx < 20) continue;

    const bw = candles[idx].indicators.bb.bandwidth;
    if (isNaN(bw)) continue;

    // Check if this bandwidth is the lowest in the preceding 20 periods
    let isLowest = true;
    for (let j = 1; j < 20; j++) {
      const prevBw = candles[idx - j].indicators.bb.bandwidth;
      if (isNaN(prevBw)) {
        isLowest = false;
        break;
      }
      if (prevBw <= bw) {
        isLowest = false;
        break;
      }
    }

    if (isLowest) return true;
  }
  return false;
}

export const bollingerSqueezeStrategy: Strategy = {
  name: 'Bollinger Squeeze Breakout',

  shouldEnterLong(
    candles: CandleWithIndicators[],
    currentIndex: number,
    _multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    if (currentIndex < 25) return NO_SIGNAL;

    const current = candles[currentIndex];
    const ind = current.indicators;

    if (
      isNaN(ind.bb.upper) || isNaN(ind.bb.lower) || isNaN(ind.bb.middle) ||
      isNaN(ind.bb.bandwidth) || isNaN(ind.volumeSma) || isNaN(ind.atr) ||
      isNaN(ind.ema21) || isNaN(ind.ema50) || isNaN(current.volume)
    ) {
      return NO_SIGNAL;
    }

    // Squeeze detected in last 5 candles
    const squeezed = squeezeDetectedRecently(candles, currentIndex, 5);
    // Price breaks above upper BB
    const breakAbove = current.close > ind.bb.upper;
    // Volume spike
    const volumeSpike = current.volume > 1.5 * ind.volumeSma;
    // Bullish trend: EMA21 > EMA50
    const bullishTrend = ind.ema21 > ind.ema50;

    if (squeezed && breakAbove && volumeSpike && bullishTrend) {
      const stopLoss = ind.bb.middle;
      const distance = Math.abs(current.close - ind.bb.middle);
      const takeProfit = current.close + 2 * distance;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `BB squeeze breakout UP | Close=${current.close.toFixed(2)} > Upper=${ind.bb.upper.toFixed(2)} | Volume spike`,
      };
    }

    return NO_SIGNAL;
  },

  shouldEnterShort(
    candles: CandleWithIndicators[],
    currentIndex: number,
    _multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    if (currentIndex < 25) return NO_SIGNAL;

    const current = candles[currentIndex];
    const ind = current.indicators;

    if (
      isNaN(ind.bb.upper) || isNaN(ind.bb.lower) || isNaN(ind.bb.middle) ||
      isNaN(ind.bb.bandwidth) || isNaN(ind.volumeSma) || isNaN(ind.atr) ||
      isNaN(ind.ema21) || isNaN(ind.ema50) || isNaN(current.volume)
    ) {
      return NO_SIGNAL;
    }

    // Squeeze detected in last 5 candles
    const squeezed = squeezeDetectedRecently(candles, currentIndex, 5);
    // Price breaks below lower BB
    const breakBelow = current.close < ind.bb.lower;
    // Volume spike
    const volumeSpike = current.volume > 1.5 * ind.volumeSma;
    // Bearish trend: EMA21 < EMA50
    const bearishTrend = ind.ema21 < ind.ema50;

    if (squeezed && breakBelow && volumeSpike && bearishTrend) {
      const stopLoss = ind.bb.middle;
      const distance = Math.abs(current.close - ind.bb.middle);
      const takeProfit = current.close - 2 * distance;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `BB squeeze breakout DOWN | Close=${current.close.toFixed(2)} < Lower=${ind.bb.lower.toFixed(2)} | Volume spike`,
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

    const current = candles[currentIndex];
    const ind = current.indicators;

    if (isNaN(ind.bb.upper) || isNaN(ind.bb.lower)) return NO_EXIT;

    if (position.side === 'long') {
      // Only exit if the trade is profitable and price returns inside BB
      const isProfitable = current.close > position.entryPrice;
      if (isProfitable && current.close < ind.bb.upper) {
        return {
          exit: true,
          reason: `Price returned inside BB (close=${current.close.toFixed(2)} < upper=${ind.bb.upper.toFixed(2)}) after profit`,
        };
      }
    } else {
      const isProfitable = current.close < position.entryPrice;
      if (isProfitable && current.close > ind.bb.lower) {
        return {
          exit: true,
          reason: `Price returned inside BB (close=${current.close.toFixed(2)} > lower=${ind.bb.lower.toFixed(2)}) after profit`,
        };
      }
    }

    return NO_EXIT;
  },
};
