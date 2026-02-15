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

export const emaCrossoverStrategy: Strategy = {
  name: 'EMA Crossover Trend',

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

    // Check indicators are valid
    if (
      isNaN(ind.ema9) || isNaN(ind.ema21) || isNaN(ind.ema200) ||
      isNaN(ind.rsi) || isNaN(ind.adx) || isNaN(ind.atr) ||
      isNaN(prevInd.ema9) || isNaN(prevInd.ema21)
    ) {
      return NO_SIGNAL;
    }

    // EMA9 crosses above EMA21
    const crossAbove = ind.ema9 > ind.ema21 && prevInd.ema9 <= prevInd.ema21;
    // Price above EMA200
    const aboveEma200 = current.close > ind.ema200;
    // RSI between 40 and 60
    const rsiInRange = ind.rsi >= 40 && ind.rsi <= 60;
    // ADX > 25
    const strongTrend = ind.adx > 25;

    if (crossAbove && aboveEma200 && rsiInRange && strongTrend) {
      const stopLoss = current.close - 2 * ind.atr;
      const takeProfit = current.close + 4 * ind.atr;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `EMA9 crossed above EMA21 | Price above EMA200 | RSI=${ind.rsi.toFixed(1)} | ADX=${ind.adx.toFixed(1)}`,
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
      isNaN(ind.ema9) || isNaN(ind.ema21) || isNaN(ind.ema200) ||
      isNaN(ind.rsi) || isNaN(ind.adx) || isNaN(ind.atr) ||
      isNaN(prevInd.ema9) || isNaN(prevInd.ema21)
    ) {
      return NO_SIGNAL;
    }

    // EMA9 crosses below EMA21
    const crossBelow = ind.ema9 < ind.ema21 && prevInd.ema9 >= prevInd.ema21;
    // Price below EMA200
    const belowEma200 = current.close < ind.ema200;
    // RSI between 40 and 60
    const rsiInRange = ind.rsi >= 40 && ind.rsi <= 60;
    // ADX > 25
    const strongTrend = ind.adx > 25;

    if (crossBelow && belowEma200 && rsiInRange && strongTrend) {
      const stopLoss = current.close + 2 * ind.atr;
      const takeProfit = current.close - 4 * ind.atr;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `EMA9 crossed below EMA21 | Price below EMA200 | RSI=${ind.rsi.toFixed(1)} | ADX=${ind.adx.toFixed(1)}`,
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

    if (isNaN(ind.atr)) return NO_EXIT;

    const trailingDistance = 1.5 * ind.atr;

    if (position.side === 'long') {
      // Find highest price since entry
      let highestSinceEntry = current.high;
      for (let i = currentIndex; i >= 0; i--) {
        if (candles[i].timestamp < position.entryTime) break;
        if (candles[i].high > highestSinceEntry) {
          highestSinceEntry = candles[i].high;
        }
      }

      const trailingStopLevel = highestSinceEntry - trailingDistance;

      // Check if price has dropped below trailing stop
      if (current.close <= trailingStopLevel) {
        return {
          exit: true,
          reason: `Trailing stop hit | High=${highestSinceEntry.toFixed(2)} | Trail=${trailingStopLevel.toFixed(2)}`,
        };
      }

      // Check hard stop loss
      if (current.close <= position.stopLoss) {
        return {
          exit: true,
          reason: `Stop loss hit at ${position.stopLoss.toFixed(2)}`,
        };
      }
    } else {
      // Short position — find lowest price since entry
      let lowestSinceEntry = current.low;
      for (let i = currentIndex; i >= 0; i--) {
        if (candles[i].timestamp < position.entryTime) break;
        if (candles[i].low < lowestSinceEntry) {
          lowestSinceEntry = candles[i].low;
        }
      }

      const trailingStopLevel = lowestSinceEntry + trailingDistance;

      // Check if price has risen above trailing stop
      if (current.close >= trailingStopLevel) {
        return {
          exit: true,
          reason: `Trailing stop hit | Low=${lowestSinceEntry.toFixed(2)} | Trail=${trailingStopLevel.toFixed(2)}`,
        };
      }

      // Check hard stop loss
      if (current.close >= position.stopLoss) {
        return {
          exit: true,
          reason: `Stop loss hit at ${position.stopLoss.toFixed(2)}`,
        };
      }
    }

    return NO_EXIT;
  },
};
