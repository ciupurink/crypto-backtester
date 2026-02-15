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

export const rsiReversalStrategy: Strategy = {
  name: 'RSI Reversal',

  shouldEnterLong(
    candles: CandleWithIndicators[],
    currentIndex: number,
    _multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    // Need at least 5 candles of lookback
    if (currentIndex < 5) return NO_SIGNAL;

    const current = candles[currentIndex];
    const ind = current.indicators;

    if (
      isNaN(ind.rsi) || isNaN(ind.atr) ||
      isNaN(ind.bb.lower) || isNaN(ind.bb.upper) || isNaN(ind.bb.middle)
    ) {
      return NO_SIGNAL;
    }

    // RSI was below 30 in recent candles (look back 3-5 candles) AND current RSI > 30
    let wasOversold = false;
    for (let i = 1; i <= 5; i++) {
      const lookbackIndex = currentIndex - i;
      if (lookbackIndex < 0) break;
      const prevRsi = candles[lookbackIndex].indicators.rsi;
      if (!isNaN(prevRsi) && prevRsi < 30) {
        wasOversold = true;
        break;
      }
    }

    const rsiCrossedAbove = ind.rsi > 30;

    // Price near lower Bollinger Band (within 0.5%)
    const nearLowerBB = Math.abs(current.close - ind.bb.lower) / ind.bb.lower <= 0.005;

    if (wasOversold && rsiCrossedAbove && nearLowerBB) {
      const stopLoss = current.close - 1.5 * ind.atr;
      const takeProfit = current.close + 3 * ind.atr;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `RSI reversal from oversold | RSI=${ind.rsi.toFixed(1)} | Near lower BB=${ind.bb.lower.toFixed(2)}`,
      };
    }

    return NO_SIGNAL;
  },

  shouldEnterShort(
    candles: CandleWithIndicators[],
    currentIndex: number,
    _multiTfData?: MultiTimeframeData,
  ): EntrySignal {
    if (currentIndex < 5) return NO_SIGNAL;

    const current = candles[currentIndex];
    const ind = current.indicators;

    if (
      isNaN(ind.rsi) || isNaN(ind.atr) ||
      isNaN(ind.bb.lower) || isNaN(ind.bb.upper) || isNaN(ind.bb.middle)
    ) {
      return NO_SIGNAL;
    }

    // RSI was above 70 in recent candles AND current RSI < 70
    let wasOverbought = false;
    for (let i = 1; i <= 5; i++) {
      const lookbackIndex = currentIndex - i;
      if (lookbackIndex < 0) break;
      const prevRsi = candles[lookbackIndex].indicators.rsi;
      if (!isNaN(prevRsi) && prevRsi > 70) {
        wasOverbought = true;
        break;
      }
    }

    const rsiCrossedBelow = ind.rsi < 70;

    // Price near upper Bollinger Band (within 0.5%)
    const nearUpperBB = Math.abs(current.close - ind.bb.upper) / ind.bb.upper <= 0.005;

    if (wasOverbought && rsiCrossedBelow && nearUpperBB) {
      const stopLoss = current.close + 1.5 * ind.atr;
      const takeProfit = current.close - 3 * ind.atr;
      return {
        enter: true,
        stopLoss,
        takeProfit,
        reason: `RSI reversal from overbought | RSI=${ind.rsi.toFixed(1)} | Near upper BB=${ind.bb.upper.toFixed(2)}`,
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

    if (isNaN(ind.rsi)) return NO_EXIT;

    if (position.side === 'long') {
      // Exit if RSI worsens further (drops below 25)
      if (ind.rsi < 25) {
        return {
          exit: true,
          reason: `RSI worsening for long | RSI=${ind.rsi.toFixed(1)} dropped below 25`,
        };
      }
    } else {
      // Exit if RSI worsens further (rises above 75)
      if (ind.rsi > 75) {
        return {
          exit: true,
          reason: `RSI worsening for short | RSI=${ind.rsi.toFixed(1)} rose above 75`,
        };
      }
    }

    return NO_EXIT;
  },
};
