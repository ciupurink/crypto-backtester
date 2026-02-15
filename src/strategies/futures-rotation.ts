import { BtcStrategy, AltBtcCandle, BtcEntrySignal, BtcExitSignal, BtcPosition, NO_BTC_ENTRY, NO_BTC_EXIT } from '../types';

/**
 * Strategy I — Futures ALT/BTC Rotation (2x leverage)
 *
 * Similar confluence scoring system as Strategy H, but with higher
 * thresholds (score >= 55) since leverage amplifies both gains and losses.
 * Tighter stop loss and shorter hold times to manage leveraged risk.
 */
export const futuresRotationStrategy: BtcStrategy = {
  name: 'Futures ALT/BTC Rotation (2x)',
  leverage: 2,

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
      return NO_BTC_ENTRY; // Must have at least 10% drop
    }

    // --- Condition 2: RSI oversold (stricter for leverage) ---
    if (indicators.rsi <= 25) {
      score += 20; reasons.push(`RSI=${indicators.rsi.toFixed(1)}`);
    } else if (indicators.rsi <= 35) {
      score += 15; reasons.push(`RSI=${indicators.rsi.toFixed(1)}`);
    } else if (indicators.rsi <= 42) {
      score += 10; reasons.push(`RSI=${indicators.rsi.toFixed(1)}`);
    }

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
        if (ema21Change > 0.01) {
          score += 15; reasons.push(`EMA21↑${(ema21Change * 100).toFixed(2)}%`);
        } else if (ema21Change > -0.02) {
          score += 10; reasons.push(`EMA21~${(ema21Change * 100).toFixed(2)}%`);
        }
      }
    }

    // --- Condition 5: Volume confirmation ---
    if (indicators.volumeSma > 0) {
      const volRatio = current.volume / indicators.volumeSma;
      if (volRatio > 1.5) {
        score += 10; reasons.push(`vol=${volRatio.toFixed(1)}x`);
      } else if (volRatio > 1.0) {
        score += 5; reasons.push(`vol=${volRatio.toFixed(1)}x`);
      }
    }

    // --- Condition 6: ADX trend strength ---
    if (indicators.adx > 25) {
      score += 10; reasons.push(`ADX=${indicators.adx.toFixed(1)}`);
    } else if (indicators.adx > 15) {
      score += 5; reasons.push(`ADX=${indicators.adx.toFixed(1)}`);
    }

    // --- Condition 7: Funding rate neutral ---
    if (current.altFundingRate !== undefined) {
      if (Math.abs(current.altFundingRate) <= 0.0005) {
        score += 5; reasons.push(`FR=${(current.altFundingRate * 100).toFixed(3)}%`);
      }
    } else {
      score += 5;
    }

    // --- Condition 8: BTC dominance rising or stable ---
    if (avgRatioTrend <= -2) {
      score += 10; reasons.push(`dom↑${avgRatioTrend.toFixed(1)}`);
    } else if (avgRatioTrend <= 1) {
      score += 5; reasons.push(`dom=${avgRatioTrend.toFixed(1)}`);
    }

    // --- Threshold: need score >= 55 for leveraged entry ---
    if (score < 55) return NO_BTC_ENTRY;

    const reason = `[2x Score=${score}] ${reasons.join(' | ')}`;

    return {
      enter: true,
      stopLossRatio: currentClose * 0.90,
      tp1Ratio: currentClose * 1.15,
      tp2Ratio: currentClose * 1.30,
      btcAllocation: 0.20,
      reason,
    };
  },

  shouldExit(position: BtcPosition, altCandles: AltBtcCandle[], currentIndex: number, avgRatioTrend: number): BtcExitSignal {
    const current = altCandles[currentIndex];
    const currentClose = current.close;

    // --- Exit 1: BTC dominance dropping (alts pumping vs BTC) ---
    if (avgRatioTrend > 2.5) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `BTC dominance dropping (avgRatioTrend=${avgRatioTrend.toFixed(2)})`,
      };
    }

    // --- Exit 2: 14-day max hold (shorter due to leverage time risk) ---
    const holdDuration = current.timestamp - position.entryTime;
    if (holdDuration >= 14 * 86_400_000) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `Max hold time reached (${(holdDuration / 86_400_000).toFixed(1)} days)`,
      };
    }

    // --- Exit 3: Stop loss (10% below entry, tighter for 2x) ---
    if (currentClose <= position.entryRatio * 0.90) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `Stop loss hit (10% * 2x = 20% loss)`,
      };
    }

    // --- Exit 4: TP1 - partial exit at 15% gain (15% * 2x = 30% return) ---
    if (!position.tp1Hit && currentClose >= position.entryRatio * 1.15) {
      return {
        exit: true,
        sellFraction: 0.5,
        reason: `TP1 hit: +15% ratio (30% effective)`,
      };
    }

    // --- Exit 5: TP2 - full exit at 30% gain (30% * 2x = 60% return) ---
    if (position.tp1Hit && currentClose >= position.entryRatio * 1.30) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `TP2 hit: +30% ratio (60% effective)`,
      };
    }

    // --- Exit 6: RSI overbought while in profit ---
    if (current.indicators.rsi >= 75 && currentClose > position.entryRatio) {
      return {
        exit: true,
        sellFraction: 1.0,
        reason: `RSI overbought (${current.indicators.rsi.toFixed(1)}) while in profit`,
      };
    }

    return NO_BTC_EXIT;
  },
};
