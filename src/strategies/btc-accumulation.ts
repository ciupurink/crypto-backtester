import { BtcStrategy, AltBtcCandle, BtcEntrySignal, BtcExitSignal, BtcPosition, NO_BTC_ENTRY, NO_BTC_EXIT } from '../types';

/**
 * Strategy H — BTC Accumulation via Altcoin Rotation (Spot)
 *
 * Uses a confluence scoring system: each condition contributes points,
 * and a trade is entered when enough conditions align (score >= 50).
 * This avoids requiring ALL conditions simultaneously, which is
 * unrealistic on daily timeframe data.
 */
export const btcAccumulationStrategy: BtcStrategy = {
  name: 'BTC Accumulation (Spot)',
  leverage: 1,

  shouldEnter(altCandles: AltBtcCandle[], currentIndex: number, avgRatioTrend: number): BtcEntrySignal {
    if (currentIndex < 30) return NO_BTC_ENTRY;

    const current = altCandles[currentIndex];
    const currentClose = current.close;
    const indicators = current.indicators;

    let score = 0;
    const reasons: string[] = [];

    // --- Condition 1: ALT/BTC dropped from 30-day high ---
    let highestClose = 0;
    for (let i = currentIndex - 30; i < currentIndex; i++) {
      if (altCandles[i].close > highestClose) {
        highestClose = altCandles[i].close;
      }
    }
    const dropPct = (highestClose - currentClose) / highestClose;
    if (dropPct >= 0.25) {
      score += 20; reasons.push(`drop=${(dropPct * 100).toFixed(1)}%`);
    } else if (dropPct >= 0.15) {
      score += 15; reasons.push(`drop=${(dropPct * 100).toFixed(1)}%`);
    } else if (dropPct >= 0.10) {
      score += 10; reasons.push(`drop=${(dropPct * 100).toFixed(1)}%`);
    } else {
      return NO_BTC_ENTRY; // Minimum: must have at least 10% drop
    }

    // --- Condition 2: RSI oversold ---
    if (indicators.rsi <= 30) {
      score += 20; reasons.push(`RSI=${indicators.rsi.toFixed(1)}`);
    } else if (indicators.rsi <= 40) {
      score += 15; reasons.push(`RSI=${indicators.rsi.toFixed(1)}`);
    } else if (indicators.rsi <= 45) {
      score += 10; reasons.push(`RSI=${indicators.rsi.toFixed(1)}`);
    }
    // RSI > 45: no points, but not a hard filter

    // --- Condition 3: Near fibonacci support ---
    const fib = indicators.fibonacci;
    if (fib.level618 > 0 && fib.level786 > 0) {
      const dist618 = Math.abs(currentClose - fib.level618) / fib.level618;
      const dist786 = Math.abs(currentClose - fib.level786) / fib.level786;
      const minDist = Math.min(dist618, dist786);
      if (minDist < 0.05) {
        score += 10; reasons.push(`fib=${(minDist * 100).toFixed(1)}%`);
      } else if (minDist < 0.10) {
        score += 5; reasons.push(`fib=${(minDist * 100).toFixed(1)}%`);
      }
    }

    // --- Condition 4: EMA21 flattening or turning up ---
    if (currentIndex >= 5) {
      const ema21Current = indicators.ema21;
      const ema21Prev = altCandles[currentIndex - 5].indicators.ema21;
      if (ema21Prev > 0) {
        const ema21Change = (ema21Current - ema21Prev) / ema21Prev;
        if (ema21Change > 0) {
          score += 15; reasons.push(`EMA21↑${(ema21Change * 100).toFixed(2)}%`);
        } else if (ema21Change > -0.03) {
          score += 10; reasons.push(`EMA21~${(ema21Change * 100).toFixed(2)}%`);
        }
      }
    }

    // --- Condition 5: Volume above average ---
    if (indicators.volumeSma > 0) {
      const volRatio = current.volume / indicators.volumeSma;
      if (volRatio > 1.5) {
        score += 10; reasons.push(`vol=${volRatio.toFixed(1)}x`);
      } else if (volRatio > 0.8) {
        score += 5; reasons.push(`vol=${volRatio.toFixed(1)}x`);
      }
    }

    // --- Condition 6: Funding rate neutral ---
    if (current.altFundingRate !== undefined) {
      if (Math.abs(current.altFundingRate) <= 0.0005) {
        score += 5; reasons.push(`FR=${(current.altFundingRate * 100).toFixed(3)}%`);
      }
    } else {
      score += 5; // no data = neutral assumption
    }

    // --- Condition 7: BTC dominance rising or stable ---
    if (avgRatioTrend <= -2) {
      score += 10; reasons.push(`dom↑${avgRatioTrend.toFixed(1)}`);
    } else if (avgRatioTrend <= 1) {
      score += 5; reasons.push(`dom=${avgRatioTrend.toFixed(1)}`);
    }

    // --- Threshold: need score >= 50 to enter ---
    if (score < 50) return NO_BTC_ENTRY;

    const reason = `[Score=${score}] ${reasons.join(' | ')}`;

    return {
      enter: true,
      stopLossRatio: currentClose * 0.85,
      tp1Ratio: currentClose * 1.20,
      tp2Ratio: currentClose * 1.40,
      btcAllocation: 0.25,
      reason,
    };
  },

  shouldExit(position: BtcPosition, altCandles: AltBtcCandle[], currentIndex: number, avgRatioTrend: number): BtcExitSignal {
    const current = altCandles[currentIndex];
    const currentClose = current.close;

    // --- Exit 1: BTC dominance dropping fast (alts pumping vs BTC) ---
    if (avgRatioTrend > 3.0) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `BTC dominance dropping fast (avgRatioTrend=${avgRatioTrend.toFixed(2)})`,
      };
    }

    // --- Exit 2: 21-day max hold ---
    const holdDuration = current.timestamp - position.entryTime;
    if (holdDuration >= 21 * 86_400_000) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `Max hold time reached (${(holdDuration / 86_400_000).toFixed(1)} days)`,
      };
    }

    // --- Exit 3: Stop loss (15% below entry) ---
    if (currentClose <= position.entryRatio * 0.85) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `Stop loss hit`,
      };
    }

    // --- Exit 4: TP1 - partial exit at 20% gain ---
    if (!position.tp1Hit && currentClose >= position.entryRatio * 1.20) {
      return {
        exit: true,
        sellFraction: 0.5,
        reason: `TP1 hit: +20%`,
      };
    }

    // --- Exit 5: TP2 - full exit at 40% gain ---
    if (position.tp1Hit && currentClose >= position.entryRatio * 1.40) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `TP2 hit: +40%`,
      };
    }

    // --- Exit 6: RSI overbought while in profit ---
    if (current.indicators.rsi >= 70 && currentClose > position.entryRatio) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `RSI overbought (${current.indicators.rsi.toFixed(1)}) while in profit`,
      };
    }

    return NO_BTC_EXIT;
  },
};
