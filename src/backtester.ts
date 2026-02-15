import {
  BacktestConfig,
  BacktestResult,
  Trade,
  Position,
  CandleWithIndicators,
  EquityPoint,
  MonthlyReturn,
  SymbolBreakdown,
  PartialClose,
  MultiTimeframeData,
  Side,
  Strategy,
} from './types';
import { calculateIndicators } from './indicators';
import { loadCandles, loadFundingRates } from './downloader';

// ============================================================
// Helpers
// ============================================================

let positionCounter = 0;

function nextPositionId(symbol: string): string {
  return `${symbol}-${positionCounter++}`;
}

/**
 * Compute the remaining (unclosed) size of a position after partial closes.
 */
function remainingSize(position: Position): number {
  const closed = position.partialCloses.reduce((sum, pc) => sum + pc.size, 0);
  return position.size - closed;
}

/**
 * Compute total PnL already realised by partial closes.
 */
function partialPnl(position: Position): number {
  return position.partialCloses.reduce((sum, pc) => sum + pc.pnl, 0);
}

/**
 * Compute the unrealised PnL for an open position at a given price.
 */
function unrealisedPnl(position: Position, currentPrice: number): number {
  const remSize = remainingSize(position);
  let raw: number;
  if (position.side === 'long') {
    raw = ((currentPrice - position.entryPrice) / position.entryPrice) * remSize;
  } else {
    raw = ((position.entryPrice - currentPrice) / position.entryPrice) * remSize;
  }
  return raw - position.commission + partialPnl(position);
}

/**
 * Close a position (or remaining portion) at a given price/time, producing a Trade.
 */
function closePosition(
  position: Position,
  exitPrice: number,
  exitTime: number,
  exitReason: string,
  slippageRate: number,
  commissionRate: number,
): Trade {
  // Apply slippage on exit
  const slippedExit =
    position.side === 'long'
      ? exitPrice * (1 - slippageRate)
      : exitPrice * (1 + slippageRate);

  const remSize = remainingSize(position);
  const exitCommission = remSize * commissionRate;
  const totalCommission = position.commission + exitCommission;

  let pnl: number;
  if (position.side === 'long') {
    pnl =
      ((slippedExit - position.entryPrice) / position.entryPrice) * remSize -
      totalCommission;
  } else {
    pnl =
      ((position.entryPrice - slippedExit) / position.entryPrice) * remSize -
      totalCommission;
  }

  // Add realised PnL from partial closes
  pnl += partialPnl(position);

  const trade: Trade = {
    ...position,
    exitTime,
    exitPrice: slippedExit,
    pnl,
    status: 'closed',
    exitReason,
    duration: exitTime - position.entryTime,
    commission: totalCommission,
  };

  return trade;
}

/**
 * Execute a partial close on a position (e.g., close 50 % at TP1).
 */
function partialClosePosition(
  position: Position,
  price: number,
  fraction: number,
  timestamp: number,
  reason: string,
  slippageRate: number,
  commissionRate: number,
): PartialClose {
  const closeSize = remainingSize(position) * fraction;

  // Apply slippage
  const slippedPrice =
    position.side === 'long'
      ? price * (1 - slippageRate)
      : price * (1 + slippageRate);

  const commission = closeSize * commissionRate;

  let pnl: number;
  if (position.side === 'long') {
    pnl =
      ((slippedPrice - position.entryPrice) / position.entryPrice) * closeSize -
      commission;
  } else {
    pnl =
      ((position.entryPrice - slippedPrice) / position.entryPrice) * closeSize -
      commission;
  }

  const pc: PartialClose = {
    price: slippedPrice,
    size: closeSize,
    pnl,
    timestamp,
    reason,
  };

  position.partialCloses.push(pc);
  // Add the partial-close commission to the position total so it is not double-counted.
  position.commission += commission;

  return pc;
}

// ============================================================
// Main backtest engine
// ============================================================

export function runBacktest(config: BacktestConfig): BacktestResult {
  // Reset the position counter for each run
  positionCounter = 0;

  const {
    startingCapital,
    leverage,
    commissionRate,
    slippageRate,
    riskPerTrade,
    maxConcurrentPositions,
    symbols,
    timeframe,
    strategy,
  } = config;

  // ----------------------------------------------------------
  // 1. Setup
  // ----------------------------------------------------------
  let equity = startingCapital;
  const openPositions: Position[] = [];
  const completedTrades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  // ----------------------------------------------------------
  // 2. Load & prepare data
  // ----------------------------------------------------------
  interface SymbolData {
    symbol: string;
    candles: CandleWithIndicators[];
  }

  const symbolDataMap = new Map<string, CandleWithIndicators[]>();

  // Multi-timeframe data keyed by symbol, then timeframe
  const multiTfBySymbol = new Map<string, MultiTimeframeData>();

  for (const symbol of symbols) {
    const rawCandles = loadCandles(symbol, timeframe);
    if (!rawCandles || rawCandles.length === 0) {
      console.warn(`No candle data for ${symbol} ${timeframe} — skipping.`);
      continue;
    }

    const withIndicators = calculateIndicators(rawCandles);
    symbolDataMap.set(symbol, withIndicators);

    // Load additional timeframes if strategy requires them
    if (strategy.requiredTimeframes && strategy.requiredTimeframes.length > 0) {
      const multiTf: MultiTimeframeData = {};
      multiTf[timeframe] = withIndicators;

      for (const tf of strategy.requiredTimeframes) {
        if (tf === timeframe) continue; // already loaded
        const tfCandles = loadCandles(symbol, tf);
        if (tfCandles && tfCandles.length > 0) {
          multiTf[tf] = calculateIndicators(tfCandles);
        }
      }

      multiTfBySymbol.set(symbol, multiTf);
    }
  }

  // ----------------------------------------------------------
  // 3. Build a merged chronological timeline
  // ----------------------------------------------------------
  // Collect all unique timestamps across all symbols
  const timestampSet = new Set<number>();
  for (const [, candles] of symbolDataMap) {
    for (const c of candles) {
      timestampSet.add(c.timestamp);
    }
  }

  const sortedTimestamps = Array.from(timestampSet).sort((a, b) => a - b);

  // Build index maps: symbol -> timestamp -> candle index, for O(1) lookups
  const indexMaps = new Map<string, Map<number, number>>();
  for (const [symbol, candles] of symbolDataMap) {
    const imap = new Map<number, number>();
    for (let i = 0; i < candles.length; i++) {
      imap.set(candles[i].timestamp, i);
    }
    indexMaps.set(symbol, imap);
  }

  let candleCount = 0;

  // ----------------------------------------------------------
  // 4. Main simulation loop
  // ----------------------------------------------------------
  for (const ts of sortedTimestamps) {
    for (const [symbol, candles] of symbolDataMap) {
      const indexMap = indexMaps.get(symbol)!;
      const candleIdx = indexMap.get(ts);
      if (candleIdx === undefined) continue; // no candle for this symbol at this timestamp

      const candle = candles[candleIdx];

      // Prepare multi-timeframe data if needed
      const multiTfData = multiTfBySymbol.get(symbol);

      // -------------------------------------------------------
      // a. Check exits for open positions on this symbol
      // -------------------------------------------------------
      for (let p = openPositions.length - 1; p >= 0; p--) {
        const position = openPositions[p];
        if (position.symbol !== symbol) continue;

        let closed = false;

        // --- Stop loss ---
        if (position.side === 'long' && candle.low <= position.stopLoss) {
          const trade = closePosition(
            position,
            position.stopLoss,
            candle.timestamp,
            'Stop loss hit',
            slippageRate,
            commissionRate,
          );
          completedTrades.push(trade);
          openPositions.splice(p, 1);
          closed = true;
        } else if (position.side === 'short' && candle.high >= position.stopLoss) {
          const trade = closePosition(
            position,
            position.stopLoss,
            candle.timestamp,
            'Stop loss hit',
            slippageRate,
            commissionRate,
          );
          completedTrades.push(trade);
          openPositions.splice(p, 1);
          closed = true;
        }

        if (closed) continue;

        // --- Take profit 1 (partial close) ---
        if (!position.tp1Hit) {
          const tp1Hit =
            (position.side === 'long' && candle.high >= position.takeProfit) ||
            (position.side === 'short' && candle.low <= position.takeProfit);

          if (tp1Hit) {
            // Partial close 50 %
            partialClosePosition(
              position,
              position.takeProfit,
              0.5,
              candle.timestamp,
              'TP1 hit — partial close 50%',
              slippageRate,
              commissionRate,
            );
            position.tp1Hit = true;

            // If TP2 exists, move stop to breakeven
            if (position.takeProfit2 !== undefined) {
              position.stopLoss = position.entryPrice;
              position.breakeven = true;
            } else {
              // No TP2 — close the rest at TP1
              const trade = closePosition(
                position,
                position.takeProfit,
                candle.timestamp,
                'TP1 hit — full close',
                slippageRate,
                commissionRate,
              );
              completedTrades.push(trade);
              openPositions.splice(p, 1);
              closed = true;
            }
          }
        }

        if (closed) continue;

        // --- Take profit 2 ---
        if (
          position.tp1Hit &&
          position.takeProfit2 !== undefined
        ) {
          const tp2Hit =
            (position.side === 'long' && candle.high >= position.takeProfit2) ||
            (position.side === 'short' && candle.low <= position.takeProfit2);

          if (tp2Hit) {
            const trade = closePosition(
              position,
              position.takeProfit2,
              candle.timestamp,
              'TP2 hit — full close',
              slippageRate,
              commissionRate,
            );
            completedTrades.push(trade);
            openPositions.splice(p, 1);
            closed = true;
          }
        }

        if (closed) continue;

        // --- Strategy exit signal ---
        const exitSignal = strategy.shouldExit(position, candles, candleIdx, multiTfData);
        if (exitSignal.exit) {
          const trade = closePosition(
            position,
            candle.close,
            candle.timestamp,
            exitSignal.reason,
            slippageRate,
            commissionRate,
          );
          completedTrades.push(trade);
          openPositions.splice(p, 1);
          closed = true;
        }

        if (closed) continue;

        // --- Trailing stop ---
        // Activate after position is 1x ATR in profit
        const atr = candle.indicators.atr;
        if (!isNaN(atr) && atr > 0) {
          if (position.side === 'long') {
            const profitDistance = candle.close - position.entryPrice;
            if (profitDistance >= atr) {
              const newTrail = position.entryPrice + 0.5 * atr;
              if (
                position.trailingStop === undefined ||
                newTrail > position.trailingStop
              ) {
                position.trailingStop = newTrail;
              }
              // Update the actual stop to whichever is higher: trailing or current stop
              if (position.trailingStop > position.stopLoss) {
                position.stopLoss = position.trailingStop;
              }
            }
          } else {
            const profitDistance = position.entryPrice - candle.close;
            if (profitDistance >= atr) {
              const newTrail = position.entryPrice - 0.5 * atr;
              if (
                position.trailingStop === undefined ||
                newTrail < position.trailingStop
              ) {
                position.trailingStop = newTrail;
              }
              // For shorts, lower trailing stop is tighter
              if (position.trailingStop < position.stopLoss) {
                position.stopLoss = position.trailingStop;
              }
            }
          }
        }
      }

      // -------------------------------------------------------
      // b. Check entries
      // -------------------------------------------------------
      if (openPositions.length < maxConcurrentPositions) {
        const signals: Array<{ signal: ReturnType<Strategy['shouldEnterLong']>; side: Side }> = [];

        const longSignal = strategy.shouldEnterLong(candles, candleIdx, multiTfData);
        if (longSignal.enter) {
          signals.push({ signal: longSignal, side: 'long' });
        }

        const shortSignal = strategy.shouldEnterShort(candles, candleIdx, multiTfData);
        if (shortSignal.enter) {
          signals.push({ signal: shortSignal, side: 'short' });
        }

        for (const { signal, side } of signals) {
          if (openPositions.length >= maxConcurrentPositions) break;

          // Calculate position size
          const riskAmount = equity * riskPerTrade;
          const entryPrice =
            side === 'long'
              ? candle.close * (1 + slippageRate)
              : candle.close * (1 - slippageRate);

          const distanceToSL = Math.abs(entryPrice - signal.stopLoss);
          if (distanceToSL === 0) continue; // avoid division by zero

          let positionSize = riskAmount / (distanceToSL / entryPrice);

          // Cap at max leveraged position
          const maxSize = equity * leverage;
          if (positionSize > maxSize) {
            positionSize = maxSize;
          }

          // Don't open a position if size is negligible
          if (positionSize <= 0) continue;

          const entryCommission = positionSize * commissionRate;

          const position: Position = {
            id: nextPositionId(symbol),
            symbol,
            side,
            entryPrice,
            size: positionSize,
            leverage,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            takeProfit2: signal.takeProfit2,
            entryTime: candle.timestamp,
            commission: entryCommission,
            status: 'open',
            reason: signal.reason,
            partialCloses: [],
            breakeven: false,
            tp1Hit: false,
          };

          openPositions.push(position);
        }
      }
    }

    // -------------------------------------------------------
    // c. Update equity at the end of each timestamp
    // -------------------------------------------------------
    candleCount++;

    // Record equity every 100 candles or at least once per day
    if (candleCount % 100 === 0 || candleCount === 1 || ts === sortedTimestamps[sortedTimestamps.length - 1]) {
      const realisedPnl = completedTrades.reduce((sum, t) => sum + t.pnl, 0);
      let unrealised = 0;

      for (const pos of openPositions) {
        // Find the latest price for this position's symbol at this timestamp
        const candles = symbolDataMap.get(pos.symbol);
        if (candles) {
          const idx = indexMaps.get(pos.symbol)?.get(ts);
          if (idx !== undefined) {
            unrealised += unrealisedPnl(pos, candles[idx].close);
          }
        }
      }

      equity = startingCapital + realisedPnl + unrealised;

      equityCurve.push({
        timestamp: ts,
        equity,
      });
    }
  }

  // ----------------------------------------------------------
  // 5. Close remaining open positions at last candle's close
  // ----------------------------------------------------------
  for (const position of openPositions) {
    const candles = symbolDataMap.get(position.symbol);
    if (!candles || candles.length === 0) continue;

    const lastCandle = candles[candles.length - 1];
    const trade = closePosition(
      position,
      lastCandle.close,
      lastCandle.timestamp,
      'End of backtest — forced close',
      slippageRate,
      commissionRate,
    );
    completedTrades.push(trade);
  }

  // Final equity
  const finalRealisedPnl = completedTrades.reduce((sum, t) => sum + t.pnl, 0);
  equity = startingCapital + finalRealisedPnl;

  // Ensure last equity point reflects the final state
  if (
    equityCurve.length === 0 ||
    equityCurve[equityCurve.length - 1].equity !== equity
  ) {
    const lastTs =
      sortedTimestamps.length > 0
        ? sortedTimestamps[sortedTimestamps.length - 1]
        : Date.now();
    equityCurve.push({ timestamp: lastTs, equity });
  }

  // ----------------------------------------------------------
  // 6. Calculate results
  // ----------------------------------------------------------
  return calculateResults(config, completedTrades, equityCurve);
}

// ============================================================
// Results calculation
// ============================================================

function calculateResults(
  config: BacktestConfig,
  trades: Trade[],
  equityCurve: EquityPoint[],
): BacktestResult {
  const { startingCapital, strategy, leverage } = config;

  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const totalPnlPercent = (totalPnl / startingCapital) * 100;

  const winningPnls = trades.filter((t) => t.pnl > 0).map((t) => t.pnl);
  const losingPnls = trades.filter((t) => t.pnl <= 0).map((t) => t.pnl);

  const sumWins = winningPnls.reduce((s, p) => s + p, 0);
  const sumLosses = Math.abs(losingPnls.reduce((s, p) => s + p, 0));
  const profitFactor = sumLosses === 0 ? Infinity : sumWins / sumLosses;

  const avgWin = winningPnls.length > 0 ? sumWins / winningPnls.length : 0;
  const avgLoss = losingPnls.length > 0 ? losingPnls.reduce((s, p) => s + p, 0) / losingPnls.length : 0;

  const bestTrade =
    trades.length > 0
      ? trades.reduce((best, t) => (t.pnl > best.pnl ? t : best))
      : null;
  const worstTrade =
    trades.length > 0
      ? trades.reduce((worst, t) => (t.pnl < worst.pnl ? t : worst))
      : null;

  const avgTradeDuration =
    trades.length > 0
      ? trades.reduce((sum, t) => sum + t.duration, 0) / trades.length
      : 0;

  // ----------------------------------------------------------
  // Max drawdown
  // ----------------------------------------------------------
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let peak = equityCurve.length > 0 ? equityCurve[0].equity : startingCapital;

  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const drawdown = peak - point.equity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = (drawdown / peak) * 100;
    }
  }

  // ----------------------------------------------------------
  // Sharpe ratio (annualised, from daily returns)
  // ----------------------------------------------------------
  let sharpeRatio = 0;
  if (equityCurve.length > 1) {
    // Group equity points by day (using start of day)
    const DAY_MS = 86_400_000;
    const dailyEquity = new Map<number, { first: number; last: number }>();

    for (const point of equityCurve) {
      const dayKey = Math.floor(point.timestamp / DAY_MS) * DAY_MS;
      const existing = dailyEquity.get(dayKey);
      if (!existing) {
        dailyEquity.set(dayKey, { first: point.equity, last: point.equity });
      } else {
        existing.last = point.equity;
      }
    }

    const dayKeys = Array.from(dailyEquity.keys()).sort((a, b) => a - b);
    const dailyReturns: number[] = [];

    for (let i = 1; i < dayKeys.length; i++) {
      const prevEquity = dailyEquity.get(dayKeys[i - 1])!.last;
      const currEquity = dailyEquity.get(dayKeys[i])!.last;
      if (prevEquity !== 0) {
        dailyReturns.push((currEquity - prevEquity) / prevEquity);
      }
    }

    if (dailyReturns.length > 1) {
      const meanReturn =
        dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
      const variance =
        dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) /
        (dailyReturns.length - 1);
      const stdDev = Math.sqrt(variance);

      if (stdDev > 0) {
        sharpeRatio = (meanReturn / stdDev) * Math.sqrt(365);
      }
    }
  }

  // ----------------------------------------------------------
  // Monthly returns
  // ----------------------------------------------------------
  const monthlyMap = new Map<
    string,
    { pnl: number; trades: number; wins: number }
  >();

  for (const trade of trades) {
    const date = new Date(trade.exitTime);
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const entry = monthlyMap.get(monthKey) || { pnl: 0, trades: 0, wins: 0 };
    entry.pnl += trade.pnl;
    entry.trades++;
    if (trade.pnl > 0) entry.wins++;
    monthlyMap.set(monthKey, entry);
  }

  const monthlyReturns: MonthlyReturn[] = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      pnl: data.pnl,
      pnlPercent: (data.pnl / startingCapital) * 100,
      trades: data.trades,
      winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
    }));

  // ----------------------------------------------------------
  // Symbol breakdown
  // ----------------------------------------------------------
  const symbolMap = new Map<
    string,
    { trades: number; pnl: number; wins: number; winPnl: number; lossPnl: number }
  >();

  for (const trade of trades) {
    const entry = symbolMap.get(trade.symbol) || {
      trades: 0,
      pnl: 0,
      wins: 0,
      winPnl: 0,
      lossPnl: 0,
    };
    entry.trades++;
    entry.pnl += trade.pnl;
    if (trade.pnl > 0) {
      entry.wins++;
      entry.winPnl += trade.pnl;
    } else {
      entry.lossPnl += Math.abs(trade.pnl);
    }
    symbolMap.set(trade.symbol, entry);
  }

  const symbolBreakdown: SymbolBreakdown[] = Array.from(symbolMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([symbol, data]) => ({
      symbol,
      trades: data.trades,
      pnl: data.pnl,
      winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
      profitFactor: data.lossPnl === 0 ? Infinity : data.winPnl / data.lossPnl,
    }));

  // ----------------------------------------------------------
  // Final result
  // ----------------------------------------------------------
  const finalEquity = startingCapital + totalPnl;

  return {
    strategyName: strategy.name,
    leverage,
    trades,
    totalTrades,
    wins,
    losses,
    winRate,
    totalPnl,
    totalPnlPercent,
    profitFactor,
    maxDrawdown,
    maxDrawdownPercent,
    avgWin,
    avgLoss,
    bestTrade,
    worstTrade,
    avgTradeDuration,
    sharpeRatio,
    monthlyReturns,
    symbolBreakdown,
    equityCurve,
    finalEquity,
    startingCapital,
  };
}

// ============================================================
// Run all backtest combinations
// ============================================================

export function runAllBacktests(
  symbols: string[],
  strategies: Strategy[],
  timeframe: string,
  leverages: number[] = [3, 5],
): BacktestResult[] {
  const results: BacktestResult[] = [];

  for (const strategy of strategies) {
    for (const leverage of leverages) {
      // For multi-timeframe strategies, override the primary timeframe to 15m
      const primaryTimeframe =
        strategy.requiredTimeframes && strategy.requiredTimeframes.length > 0
          ? '15m'
          : timeframe;

      const config: BacktestConfig = {
        startingCapital: 500,
        leverage,
        commissionRate: 0.0006,
        slippageRate: 0.0003,
        riskPerTrade: 0.04,
        maxConcurrentPositions: 3,
        symbols,
        timeframe: primaryTimeframe,
        strategy,
      };

      console.log(
        `\nRunning backtest: ${strategy.name} | ${primaryTimeframe} | ${leverage}x leverage`,
      );

      const result = runBacktest(config);

      console.log(
        `  => ${result.totalTrades} trades | ` +
          `WR: ${result.winRate.toFixed(1)}% | ` +
          `PnL: $${result.totalPnl.toFixed(2)} (${result.totalPnlPercent.toFixed(1)}%) | ` +
          `Max DD: ${result.maxDrawdownPercent.toFixed(1)}%`,
      );

      results.push(result);
    }
  }

  return results;
}
