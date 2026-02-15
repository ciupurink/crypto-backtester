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

export const macdVolumeStrategy: Strategy = {
  name: 'MACD + Volume',

  shouldEnterLong(
    candles: CandleWithIndicators[],
    currentIndex: number,
    _multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    if (currentIndex < 1) return NO_SIGNAL;

    const current = candles[currentIndex];
    const prev = candles[currentIndex - 1];
    const ind = current.indicators;
    const prevInd = prev.indicators;

    if (
      isNaN(ind.macd.histogram) || isNaN(prevInd.macd.histogram) ||
      isNaN(ind.ema50) || isNaN(ind.adx) || isNaN(ind.atr) ||
      isNaN(ind.volumeSma) || isNaN(current.volume)
    ) {
      return NO_SIGNAL;
    }

    // MACD bullish crossover: histogram goes from negative to positive
    const macdBullishCross = ind.macd.histogram > 0 && prevInd.macd.histogram <= 0;
    // Volume spike: > 1.5x volume SMA
    const volumeSpike = current.volume > 1.5 * ind.volumeSma;
    // Price above EMA50
    const aboveEma50 = current.close > ind.ema50;
    // ADX > 20
    const trendStrength = ind.adx > 20;

    if (macdBullishCross && volumeSpike && aboveEma50 && trendStrength) {
      const stopLoss = current.close - 2 * ind.atr;
      const takeProfit = current.close + 3 * ind.atr;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `MACD bullish crossover | Volume spike ${(current.volume / ind.volumeSma).toFixed(1)}x | ADX=${ind.adx.toFixed(1)}`,
      };
    }

    return NO_SIGNAL;
  },

  shouldEnterShort(
    candles: CandleWithIndicators[],
    currentIndex: number,
    _multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    if (currentIndex < 1) return NO_SIGNAL;

    const current = candles[currentIndex];
    const prev = candles[currentIndex - 1];
    const ind = current.indicators;
    const prevInd = prev.indicators;

    if (
      isNaN(ind.macd.histogram) || isNaN(prevInd.macd.histogram) ||
      isNaN(ind.ema50) || isNaN(ind.adx) || isNaN(ind.atr) ||
      isNaN(ind.volumeSma) || isNaN(current.volume)
    ) {
      return NO_SIGNAL;
    }

    // MACD bearish crossover: histogram goes from positive to negative
    const macdBearishCross = ind.macd.histogram < 0 && prevInd.macd.histogram >= 0;
    // Volume spike
    const volumeSpike = current.volume > 1.5 * ind.volumeSma;
    // Price below EMA50
    const belowEma50 = current.close < ind.ema50;
    // ADX > 20
    const trendStrength = ind.adx > 20;

    if (macdBearishCross && volumeSpike && belowEma50 && trendStrength) {
      const stopLoss = current.close + 2 * ind.atr;
      const takeProfit = current.close - 3 * ind.atr;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `MACD bearish crossover | Volume spike ${(current.volume / ind.volumeSma).toFixed(1)}x | ADX=${ind.adx.toFixed(1)}`,
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
    if (currentIndex < 1) return NO_EXIT;

    const current = candles[currentIndex];
    const ind = current.indicators;

    if (isNaN(ind.macd.histogram)) return NO_EXIT;

    if (position.side === 'long') {
      // MACD histogram crosses zero against position (turns negative)
      if (ind.macd.histogram < 0) {
        return {
          exit: true,
          reason: `MACD histogram turned negative (${ind.macd.histogram.toFixed(4)}) — bearish reversal`,
        };
      }
    } else {
      // MACD histogram crosses zero against position (turns positive)
      if (ind.macd.histogram > 0) {
        return {
          exit: true,
          reason: `MACD histogram turned positive (${ind.macd.histogram.toFixed(4)}) — bullish reversal`,
        };
      }
    }

    return NO_EXIT;
  },
};
