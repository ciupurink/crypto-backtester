import {
  BtcStrategy,
  BtcPosition,
  BtcTrade,
  BtcBacktestResult,
  BtcEquityPoint,
  AltBreakdown,
  AltBtcCandle,
  ALT_SYMBOLS,
} from './types';
import { buildAllAltBtcCandles, calculateAvgRatioTrend } from './altbtc';

// ============================================================
// Constants
// ============================================================

const STARTING_BTC = 0.05;
const MAX_CONCURRENT_POSITIONS = 3;
const STOP_LOSS_PCT = 0.15;       // 15% drop in ratio from entry
const TP1_PCT = 0.30;             // +30% ratio gain
const TP2_PCT = 0.50;             // +50% ratio gain
const TP1_SELL_FRACTION = 0.50;   // sell 50% at TP1
const MAX_HOLD_MS = 14 * 86_400_000; // 14 days
const DOMINANCE_TREND_THRESHOLD = 2.0; // avg ratio trend > 2% triggers exit
const MIN_BTC_ALLOCATION = 0.0001;
const EQUITY_RECORD_INTERVAL = 10; // record equity every N candles

// Commission rates (per leg)
const SPOT_COMMISSION_RATE = 0.001;    // 0.1%
const FUTURES_COMMISSION_RATE = 0.0006; // 0.06%

// ============================================================
// Main backtest runner
// ============================================================

/**
 * Runs a BTC-denominated altcoin rotation backtest.
 *
 * The backtester iterates through a merged timeline of all ALT/BTC
 * candles, checking exits on open positions and entries for new ones
 * according to the provided strategy.
 *
 * Positions are sized in BTC. Profit/loss is measured in BTC to
 * determine whether the rotation strategy accumulates more BTC than
 * simply holding.
 */
export function runBtcBacktest(strategy: BtcStrategy, timeframe: string): BtcBacktestResult {
  // ---- 1. Setup ----
  let availableBtc = STARTING_BTC;
  const openPositions: BtcPosition[] = [];
  const completedTrades: BtcTrade[] = [];
  const equityCurve: BtcEquityPoint[] = [];
  let positionCounter = 0;

  const commissionRate = strategy.leverage > 1 ? FUTURES_COMMISSION_RATE : SPOT_COMMISSION_RATE;

  // ---- 2. Load data ----
  const allAltCandles = buildAllAltBtcCandles(timeframe);

  if (allAltCandles.size === 0) {
    return emptyResult(strategy.name);
  }

  // Build per-alt index maps: altSymbol -> (timestamp -> candle index)
  const altIndexMaps = new Map<string, Map<number, number>>();
  for (const [sym, candles] of allAltCandles) {
    const indexMap = new Map<number, number>();
    for (let i = 0; i < candles.length; i++) {
      indexMap.set(candles[i].timestamp, i);
    }
    altIndexMaps.set(sym, indexMap);
  }

  // Build merged timeline of all unique timestamps, sorted
  const allTimestamps = new Set<number>();
  for (const [, candles] of allAltCandles) {
    for (const c of candles) {
      allTimestamps.add(c.timestamp);
    }
  }
  const timeline = Array.from(allTimestamps).sort((a, b) => a - b);

  if (timeline.length === 0) {
    return emptyResult(strategy.name);
  }

  // Track first and last BTC/USDT prices for final reporting
  let startBtcPrice = 0;
  let endBtcPrice = 0;
  let candelCounter = 0;

  // ---- 3. Main loop ----
  for (const timestamp of timeline) {
    candelCounter++;

    // Calculate average ratio trend with 7-day lookback for general use
    const avgRatioTrend7d = calculateAvgRatioTrend(allAltCandles, timestamp, 7);
    // Calculate 1-day lookback for BTC dominance fast-drop detection
    const avgRatioTrend1d = calculateAvgRatioTrend(allAltCandles, timestamp, 1);

    let currentBtcUsdtPrice = 0;

    for (const [altSymbol, altCandles] of allAltCandles) {
      const indexMap = altIndexMaps.get(altSymbol);
      if (!indexMap) continue;

      const candleIdx = indexMap.get(timestamp);
      if (candleIdx === undefined) continue;

      const currentCandle = altCandles[candleIdx];
      if (currentBtcUsdtPrice === 0) {
        currentBtcUsdtPrice = currentCandle.btcUsdtPrice;
      }

      // Record start/end BTC prices
      if (startBtcPrice === 0) {
        startBtcPrice = currentCandle.btcUsdtPrice;
      }
      endBtcPrice = currentCandle.btcUsdtPrice;

      // ---- 3a. Check exits for open positions on this alt ----
      const positionsForAlt = openPositions.filter((p) => p.altSymbol === altSymbol && p.status === 'open');

      for (const pos of positionsForAlt) {
        const currentRatio = currentCandle.close;

        // --- Stop loss: 15% drop from entry ---
        if (currentRatio <= pos.entryRatio * (1 - STOP_LOSS_PCT)) {
          closePosition(pos, currentRatio, timestamp, 'stop_loss', completedTrades, strategy.leverage, commissionRate);
          availableBtc += getCloseBtcReturn(pos, currentRatio, strategy.leverage, commissionRate);
          removeFromArray(openPositions, pos);
          continue;
        }

        // --- BTC dominance dropping fast (alts rising >2% in 1 day) ---
        // When alts pump vs BTC, sell alts to lock in BTC profit
        if (avgRatioTrend1d > DOMINANCE_TREND_THRESHOLD) {
          closePosition(pos, currentRatio, timestamp, 'btc_dominance_drop', completedTrades, strategy.leverage, commissionRate);
          availableBtc += getCloseBtcReturn(pos, currentRatio, strategy.leverage, commissionRate);
          removeFromArray(openPositions, pos);
          continue;
        }

        // --- TP1: +30% ratio gain, sell 50% ---
        if (!pos.tp1Hit && currentRatio >= pos.entryRatio * (1 + TP1_PCT)) {
          const originalAllocated = pos.btcAllocated;
          const halfAllocated = originalAllocated * TP1_SELL_FRACTION;

          // BTC returned from selling 50% at current ratio
          const btcReturned = calculateBtcReturn(halfAllocated, pos.entryRatio, currentRatio, strategy.leverage, commissionRate);
          availableBtc += btcReturned;

          // Update position: remaining 50%
          pos.btcAllocated = originalAllocated - halfAllocated;
          pos.tp1Hit = true;
          continue; // Don't check TP2 in the same candle
        }

        // --- TP2: +50% ratio gain (only after TP1 hit), sell remaining ---
        if (pos.tp1Hit && currentRatio >= pos.entryRatio * (1 + TP2_PCT)) {
          closePosition(pos, currentRatio, timestamp, 'tp2', completedTrades, strategy.leverage, commissionRate);
          availableBtc += getCloseBtcReturn(pos, currentRatio, strategy.leverage, commissionRate);
          removeFromArray(openPositions, pos);
          continue;
        }

        // --- 14-day max hold timeout ---
        if (timestamp - pos.entryTime >= MAX_HOLD_MS) {
          closePosition(pos, currentRatio, timestamp, 'max_hold_timeout', completedTrades, strategy.leverage, commissionRate);
          availableBtc += getCloseBtcReturn(pos, currentRatio, strategy.leverage, commissionRate);
          removeFromArray(openPositions, pos);
          continue;
        }

        // --- Strategy-defined exit ---
        const exitSignal = strategy.shouldExit(pos, altCandles, candleIdx, avgRatioTrend7d);
        if (exitSignal.exit) {
          const fraction = exitSignal.sellFraction > 0 && exitSignal.sellFraction <= 1
            ? exitSignal.sellFraction
            : 1;

          if (fraction >= 1) {
            // Full exit
            closePosition(pos, currentRatio, timestamp, exitSignal.reason, completedTrades, strategy.leverage, commissionRate);
            availableBtc += getCloseBtcReturn(pos, currentRatio, strategy.leverage, commissionRate);
            removeFromArray(openPositions, pos);
          } else {
            // Partial exit
            const partialAlloc = pos.btcAllocated * fraction;
            const btcReturned = calculateBtcReturn(partialAlloc, pos.entryRatio, currentRatio, strategy.leverage, commissionRate);
            availableBtc += btcReturned;
            pos.btcAllocated -= partialAlloc;
          }
          continue;
        }
      }

      // ---- 3b. Check entries (only if below max concurrent positions) ----
      const activeCount = openPositions.filter((p) => p.status === 'open').length;
      if (activeCount >= MAX_CONCURRENT_POSITIONS) continue;

      // Skip if we already have a position open on this alt
      if (openPositions.some((p) => p.altSymbol === altSymbol && p.status === 'open')) continue;

      const entrySignal = strategy.shouldEnter(altCandles, candleIdx, avgRatioTrend7d);

      if (entrySignal.enter) {
        // Calculate BTC to allocate
        const totalEquity = calculateTotalEquity(availableBtc, openPositions, allAltCandles, timestamp);
        let btcToAllocate = totalEquity * entrySignal.btcAllocation;

        // Cap at available BTC
        btcToAllocate = Math.min(btcToAllocate, availableBtc);

        if (btcToAllocate < MIN_BTC_ALLOCATION) continue;

        positionCounter++;
        const newPosition: BtcPosition = {
          id: `btc-pos-${positionCounter}`,
          altSymbol,
          entryRatio: currentCandle.close,
          btcAllocated: btcToAllocate,
          entryTime: timestamp,
          status: 'open',
          reason: entrySignal.reason,
          tp1Hit: false,
          leverage: strategy.leverage,
        };

        openPositions.push(newPosition);
        availableBtc -= btcToAllocate;
      }
    }

    // ---- 3c. Record equity periodically ----
    if (candelCounter % EQUITY_RECORD_INTERVAL === 0 && currentBtcUsdtPrice > 0) {
      const totalBtcEquity = calculateTotalEquity(availableBtc, openPositions, allAltCandles, timestamp);
      equityCurve.push({
        timestamp,
        btcEquity: totalBtcEquity,
        usdtEquity: totalBtcEquity * currentBtcUsdtPrice,
      });
    }
  }

  // ---- 4. Force close remaining positions at last candle ----
  const lastTimestamp = timeline[timeline.length - 1];

  for (const pos of [...openPositions]) {
    if (pos.status !== 'open') continue;

    const altCandles = allAltCandles.get(pos.altSymbol);
    if (!altCandles || altCandles.length === 0) continue;

    // Find the last available candle for this alt
    const lastCandle = altCandles[altCandles.length - 1];
    const exitRatio = lastCandle.close;

    closePosition(pos, exitRatio, lastTimestamp, 'backtest_end', completedTrades, strategy.leverage, commissionRate);
    availableBtc += getCloseBtcReturn(pos, exitRatio, strategy.leverage, commissionRate);
    removeFromArray(openPositions, pos);
  }

  // ---- 5. Calculate results ----
  const finalBtc = availableBtc;
  const btcProfit = finalBtc - STARTING_BTC;
  const btcProfitPercent = (btcProfit / STARTING_BTC) * 100;

  const usdtValueStart = STARTING_BTC * startBtcPrice;
  const usdtValueEnd = finalBtc * endBtcPrice;
  const holdOnlyUsdtEnd = STARTING_BTC * endBtcPrice;

  // Trade statistics
  const wins = completedTrades.filter((t) => t.btcPnl > 0).length;
  const losses = completedTrades.filter((t) => t.btcPnl <= 0).length;
  const totalTrades = completedTrades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  const avgHoldTime = totalTrades > 0
    ? completedTrades.reduce((sum, t) => sum + t.duration, 0) / totalTrades
    : 0;

  let bestTrade: BtcTrade | null = null;
  let worstTrade: BtcTrade | null = null;

  for (const t of completedTrades) {
    if (!bestTrade || t.btcPnl > bestTrade.btcPnl) bestTrade = t;
    if (!worstTrade || t.btcPnl < worstTrade.btcPnl) worstTrade = t;
  }

  // Per-alt breakdown
  const perAltBreakdown = buildAltBreakdown(completedTrades);

  return {
    strategyName: strategy.name,
    startingBtc: STARTING_BTC,
    finalBtc,
    btcProfit,
    btcProfitPercent,
    startBtcPrice,
    endBtcPrice,
    usdtValueStart,
    usdtValueEnd,
    holdOnlyUsdtEnd,
    totalTrades,
    wins,
    losses,
    winRate,
    avgHoldTime,
    bestTrade,
    worstTrade,
    trades: completedTrades,
    equityCurve,
    perAltBreakdown,
  };
}

// ============================================================
// Run multiple strategies
// ============================================================

/**
 * Runs each strategy against the same timeframe and returns an array
 * of results, one per strategy.
 */
export function runAllBtcBacktests(strategies: BtcStrategy[], timeframe: string): BtcBacktestResult[] {
  return strategies.map((s) => runBtcBacktest(s, timeframe));
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Calculates how much BTC is returned when closing (or partially closing)
 * a position.
 *
 * For spot (leverage = 1):
 *   You hold altAmount = btcAllocated / entryRatio units of the alt.
 *   Selling at exitRatio returns altAmount * exitRatio BTC.
 *   grossReturn = btcAllocated * (exitRatio / entryRatio)
 *
 * For futures (leverage > 1):
 *   grossReturn = btcAllocated * (1 + leverage * (exitRatio / entryRatio - 1))
 *   Capped so that loss never exceeds btcAllocated (no liquidation with
 *   2x leverage and 15% SL).
 *
 * Commission is deducted from the gross return.
 */
function calculateBtcReturn(
  btcAllocated: number,
  entryRatio: number,
  exitRatio: number,
  leverage: number,
  commissionRate: number,
): number {
  if (entryRatio === 0) return 0;

  let grossReturn: number;
  const ratioChange = exitRatio / entryRatio;

  if (leverage <= 1) {
    // Spot
    grossReturn = btcAllocated * ratioChange;
  } else {
    // Futures with leverage
    grossReturn = btcAllocated * (1 + leverage * (ratioChange - 1));
    // Cap loss: cannot lose more than allocated margin
    if (grossReturn < 0) grossReturn = 0;
  }

  // Commission: applied on entry notional and exit notional
  // For spot: commissionRate per leg on btcAllocated
  // For futures: commissionRate per leg on btcAllocated * leverage
  const notional = leverage <= 1 ? btcAllocated : btcAllocated * leverage;
  const totalCommission = notional * commissionRate * 2; // entry + exit

  const netReturn = grossReturn - totalCommission;

  // Floor at zero: you can't lose more than your allocated BTC
  return Math.max(netReturn, 0);
}

/**
 * Returns the net BTC received when fully closing a position (using
 * its current btcAllocated, which may already be halved after TP1).
 */
function getCloseBtcReturn(
  pos: BtcPosition,
  exitRatio: number,
  leverage: number,
  commissionRate: number,
): number {
  return calculateBtcReturn(pos.btcAllocated, pos.entryRatio, exitRatio, leverage, commissionRate);
}

/**
 * Closes a position: marks it as closed, calculates pnl, and adds it
 * to the completedTrades array as a BtcTrade.
 */
function closePosition(
  pos: BtcPosition,
  exitRatio: number,
  exitTime: number,
  exitReason: string,
  completedTrades: BtcTrade[],
  leverage: number,
  commissionRate: number,
): void {
  const btcReturned = calculateBtcReturn(pos.btcAllocated, pos.entryRatio, exitRatio, leverage, commissionRate);
  const btcPnl = btcReturned - pos.btcAllocated;

  pos.status = 'closed';
  pos.exitRatio = exitRatio;
  pos.exitTime = exitTime;
  pos.exitReason = exitReason;
  pos.btcPnl = btcPnl;

  const trade: BtcTrade = {
    ...pos,
    status: 'closed' as const,
    exitTime,
    exitRatio,
    btcPnl,
    duration: exitTime - pos.entryTime,
  };

  completedTrades.push(trade);
}

/**
 * Calculates total BTC equity (available + mark-to-market of open positions).
 */
function calculateTotalEquity(
  availableBtc: number,
  openPositions: BtcPosition[],
  allAltCandles: Map<string, AltBtcCandle[]>,
  timestamp: number,
): number {
  let total = availableBtc;

  for (const pos of openPositions) {
    if (pos.status !== 'open') continue;

    const altCandles = allAltCandles.get(pos.altSymbol);
    if (!altCandles || altCandles.length === 0) {
      total += pos.btcAllocated; // fallback: assume no change
      continue;
    }

    // Find the candle at or closest before this timestamp
    const currentRatio = findRatioAtTimestamp(altCandles, timestamp);

    if (currentRatio <= 0 || pos.entryRatio <= 0) {
      total += pos.btcAllocated;
      continue;
    }

    const ratioChange = currentRatio / pos.entryRatio;

    if (pos.leverage <= 1) {
      // Spot: mark-to-market
      total += pos.btcAllocated * ratioChange;
    } else {
      // Futures: leveraged mark-to-market
      const mtm = pos.btcAllocated * (1 + pos.leverage * (ratioChange - 1));
      total += Math.max(mtm, 0);
    }
  }

  return total;
}

/**
 * Finds the close ratio for an alt at a given timestamp.
 * Uses binary search to find the closest candle at or before the timestamp.
 */
function findRatioAtTimestamp(candles: AltBtcCandle[], timestamp: number): number {
  if (candles.length === 0) return 0;

  // Binary search for the last candle with timestamp <= target
  let lo = 0;
  let hi = candles.length - 1;
  let bestIdx = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].timestamp <= timestamp) {
      bestIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (bestIdx < 0) return candles[0].close;
  return candles[bestIdx].close;
}

/**
 * Removes an element from an array in-place (by reference).
 */
function removeFromArray<T>(arr: T[], item: T): void {
  const idx = arr.indexOf(item);
  if (idx >= 0) {
    arr.splice(idx, 1);
  }
}

/**
 * Groups completed trades by alt symbol and computes per-alt statistics.
 */
function buildAltBreakdown(trades: BtcTrade[]): AltBreakdown[] {
  const grouped = new Map<string, BtcTrade[]>();

  for (const t of trades) {
    const existing = grouped.get(t.altSymbol);
    if (existing) {
      existing.push(t);
    } else {
      grouped.set(t.altSymbol, [t]);
    }
  }

  const breakdown: AltBreakdown[] = [];

  for (const [symbol, altTrades] of grouped) {
    const wins = altTrades.filter((t) => t.btcPnl > 0).length;
    const totalPnl = altTrades.reduce((sum, t) => sum + t.btcPnl, 0);

    breakdown.push({
      symbol,
      trades: altTrades.length,
      btcPnl: totalPnl,
      winRate: altTrades.length > 0 ? (wins / altTrades.length) * 100 : 0,
    });
  }

  // Sort by btcPnl descending
  breakdown.sort((a, b) => b.btcPnl - a.btcPnl);

  return breakdown;
}

/**
 * Returns an empty BtcBacktestResult for when no data is available.
 */
function emptyResult(strategyName: string): BtcBacktestResult {
  return {
    strategyName,
    startingBtc: STARTING_BTC,
    finalBtc: STARTING_BTC,
    btcProfit: 0,
    btcProfitPercent: 0,
    startBtcPrice: 0,
    endBtcPrice: 0,
    usdtValueStart: 0,
    usdtValueEnd: 0,
    holdOnlyUsdtEnd: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    avgHoldTime: 0,
    bestTrade: null,
    worstTrade: null,
    trades: [],
    equityCurve: [],
    perAltBreakdown: [],
  };
}
