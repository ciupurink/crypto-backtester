import * as fs from 'fs';
import * as path from 'path';
import { BacktestResult, Trade, BtcBacktestResult } from './types';

// ============================================================
// Constants
// ============================================================

const RESULTS_DIR = path.resolve(__dirname, '..', 'results');
const SUMMARY_FILE = path.join(RESULTS_DIR, 'backtest_results.json');
const FULL_FILE = path.join(RESULTS_DIR, 'backtest_full.json');

// ============================================================
// Helpers
// ============================================================

function ensureResultsDir(): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function pad(value: string, width: number, align: 'left' | 'right' | 'center' = 'right'): string {
  if (align === 'left') {
    return value.padEnd(width);
  }
  if (align === 'center') {
    const totalPad = width - value.length;
    const leftPad = Math.floor(totalPad / 2);
    return ' '.repeat(Math.max(0, leftPad)) + value + ' '.repeat(Math.max(0, totalPad - leftPad));
  }
  return value.padStart(width);
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }
  return `${minutes}m`;
}

function formatPnl(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${value.toFixed(2)}`;
}

function formatPnlPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

// ============================================================
// Generate single report
// ============================================================

export function generateReport(result: BacktestResult): string {
  const lines: string[] = [];
  const W = 47; // width of the report box

  const title = `${result.strategyName} (${result.leverage}x)`;

  lines.push('');
  lines.push('\u2550'.repeat(W));
  lines.push(`  BACKTEST REPORT: ${title}`);
  lines.push('\u2550'.repeat(W));
  lines.push('');
  lines.push(`  Capital: $${result.startingCapital.toFixed(2)} \u2192 $${result.finalEquity.toFixed(2)}`);
  lines.push('');

  // --- Performance ---
  lines.push('  PERFORMANCE');
  lines.push('  ' + '\u2500'.repeat(29));
  lines.push(`  Total Trades:     ${result.totalTrades}`);
  lines.push(`  Wins / Losses:    ${result.wins} / ${result.losses}`);
  lines.push(`  Win Rate:         ${result.winRate.toFixed(1)}%`);
  lines.push(`  Total P&L:        $${result.totalPnl.toFixed(2)} (${result.totalPnlPercent.toFixed(1)}%)`);
  lines.push(`  Profit Factor:    ${result.profitFactor === Infinity ? 'Inf' : result.profitFactor.toFixed(2)}`);
  lines.push(`  Sharpe Ratio:     ${result.sharpeRatio.toFixed(2)}`);
  lines.push('');

  // --- Risk ---
  lines.push('  RISK');
  lines.push('  ' + '\u2500'.repeat(29));
  lines.push(`  Max Drawdown:     $${result.maxDrawdown.toFixed(2)} (${result.maxDrawdownPercent.toFixed(1)}%)`);
  lines.push(`  Avg Win:          $${result.avgWin.toFixed(2)}`);
  lines.push(`  Avg Loss:         $${result.avgLoss.toFixed(2)}`);

  if (result.bestTrade) {
    lines.push(`  Best Trade:       $${result.bestTrade.pnl.toFixed(2)} (${result.bestTrade.symbol})`);
  } else {
    lines.push(`  Best Trade:       N/A`);
  }

  if (result.worstTrade) {
    lines.push(`  Worst Trade:      $${result.worstTrade.pnl.toFixed(2)} (${result.worstTrade.symbol})`);
  } else {
    lines.push(`  Worst Trade:      N/A`);
  }

  lines.push(`  Avg Duration:     ${formatDuration(result.avgTradeDuration)}`);
  lines.push('');

  // --- Monthly Returns ---
  if (result.monthlyReturns.length > 0) {
    lines.push('  MONTHLY RETURNS');
    lines.push('  ' + '\u2500'.repeat(29));
    for (const mr of result.monthlyReturns) {
      const pnlStr = formatPnl(mr.pnl);
      const pctStr = formatPnlPercent(mr.pnlPercent);
      lines.push(
        `  ${mr.month}: ${pnlStr} (${pctStr}) [${mr.trades} trades, ${mr.winRate.toFixed(0)}% WR]`,
      );
    }
    lines.push('');
  }

  // --- Symbol Breakdown ---
  if (result.symbolBreakdown.length > 0) {
    lines.push('  SYMBOL BREAKDOWN');
    lines.push('  ' + '\u2500'.repeat(29));
    for (const sb of result.symbolBreakdown) {
      const pfStr = sb.profitFactor === Infinity ? 'Inf' : sb.profitFactor.toFixed(2);
      lines.push(
        `  ${sb.symbol}:  ${sb.trades} trades, $${sb.pnl.toFixed(2)} P&L, ${sb.winRate.toFixed(0)}% WR, PF: ${pfStr}`,
      );
    }
    lines.push('');
  }

  lines.push('\u2550'.repeat(W));
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// Generate comparison report
// ============================================================

export function generateComparisonReport(results: BacktestResult[]): string {
  if (results.length === 0) return 'No results to compare.\n';

  // Column definitions: header, width
  const cols = [
    { header: 'Strategy', width: 24 },
    { header: 'Trades', width: 8 },
    { header: 'WR %', width: 7 },
    { header: 'P&L ($)', width: 10 },
    { header: 'P&L (%)', width: 9 },
    { header: 'PF', width: 9 },
    { header: 'Max DD (%)', width: 12 },
  ];

  // Build row data
  const rows = results.map((r) => [
    `${r.strategyName} (${r.leverage}x)`,
    r.totalTrades.toString(),
    r.winRate.toFixed(1),
    r.totalPnl.toFixed(2),
    r.totalPnlPercent.toFixed(1),
    r.profitFactor === Infinity ? 'Inf' : r.profitFactor.toFixed(2),
    r.maxDrawdownPercent.toFixed(1),
  ]);

  // Build the table
  const lines: string[] = [];

  // Top border
  const topBorder =
    '\u2554' +
    cols.map((c) => '\u2550'.repeat(c.width)).join('\u2566') +
    '\u2557';
  lines.push(topBorder);

  // Header row
  const headerRow =
    '\u2551' +
    cols.map((c) => pad(` ${c.header} `, c.width, 'center')).join('\u2551') +
    '\u2551';
  lines.push(headerRow);

  // Header separator
  const headerSep =
    '\u2560' +
    cols.map((c) => '\u2550'.repeat(c.width)).join('\u256C') +
    '\u2563';
  lines.push(headerSep);

  // Data rows
  for (const row of rows) {
    const cells = row.map((val, i) => {
      if (i === 0) {
        // Strategy name — left-aligned
        return ' ' + pad(val, cols[i].width - 2, 'left') + ' ';
      }
      // Numeric — center-aligned
      return pad(val, cols[i].width, 'center');
    });
    lines.push('\u2551' + cells.join('\u2551') + '\u2551');
  }

  // Bottom border
  const bottomBorder =
    '\u255A' +
    cols.map((c) => '\u2550'.repeat(c.width)).join('\u2569') +
    '\u255D';
  lines.push(bottomBorder);

  return '\n' + lines.join('\n') + '\n';
}

// ============================================================
// Save / Load results
// ============================================================

/**
 * Saves backtest results to disk.
 *
 * - Full results (with trades) go to results/backtest_full.json.
 * - Summary results (trades stripped, trade count preserved) go to
 *   results/backtest_results.json for dashboard use.
 */
export function saveResults(results: BacktestResult[]): void {
  ensureResultsDir();

  // Save full results
  fs.writeFileSync(FULL_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Full results saved to ${FULL_FILE}`);

  // Build summary: replace trades array with empty array, keep trade count
  const summaries = results.map((r) => {
    const { trades, bestTrade, worstTrade, ...rest } = r;

    // For best/worst trade, keep just the key fields
    const summariseTrade = (t: Trade | null) => {
      if (!t) return null;
      return {
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: t.pnl,
        duration: t.duration,
        reason: t.reason,
        exitReason: t.exitReason,
      };
    };

    return {
      ...rest,
      trades: [], // stripped for size
      tradeCount: trades.length,
      bestTrade: summariseTrade(bestTrade),
      worstTrade: summariseTrade(worstTrade),
    };
  });

  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summaries, null, 2), 'utf-8');
  console.log(`Summary results saved to ${SUMMARY_FILE}`);
}

/**
 * Loads previously saved backtest results from disk.
 * Tries the full file first, then falls back to the summary file.
 * Returns null if neither exists.
 */
export function loadResults(): BacktestResult[] | null {
  // Try full results first
  if (fs.existsSync(FULL_FILE)) {
    try {
      const raw = fs.readFileSync(FULL_FILE, 'utf-8');
      return JSON.parse(raw) as BacktestResult[];
    } catch (err: any) {
      console.error(`Failed to load full results: ${err.message}`);
    }
  }

  // Fall back to summary
  if (fs.existsSync(SUMMARY_FILE)) {
    try {
      const raw = fs.readFileSync(SUMMARY_FILE, 'utf-8');
      return JSON.parse(raw) as BacktestResult[];
    } catch (err: any) {
      console.error(`Failed to load summary results: ${err.message}`);
    }
  }

  return null;
}

// ============================================================
// BTC-denominated reports
// ============================================================

const BTC_RESULTS_FILE = path.join(RESULTS_DIR, 'btc_results.json');

export function generateBtcReport(result: BtcBacktestResult): string {
  const lines: string[] = [];
  const W = 55;

  lines.push('');
  lines.push('\u2550'.repeat(W));
  lines.push(`  BTC ROTATION REPORT: ${result.strategyName}`);
  lines.push('\u2550'.repeat(W));
  lines.push('');
  lines.push(`  Starting BTC:   ${result.startingBtc.toFixed(5)} BTC ($${result.usdtValueStart.toFixed(2)})`);
  lines.push(`  Final BTC:      ${result.finalBtc.toFixed(5)} BTC ($${result.usdtValueEnd.toFixed(2)})`);
  lines.push(`  Just Holding:   ${result.startingBtc.toFixed(5)} BTC ($${result.holdOnlyUsdtEnd.toFixed(2)})`);
  lines.push('');

  const btcSign = result.btcProfit >= 0 ? '+' : '';
  lines.push('  BTC PERFORMANCE');
  lines.push('  ' + '\u2500'.repeat(40));
  lines.push(`  BTC Accumulated: ${btcSign}${result.btcProfit.toFixed(6)} BTC (${btcSign}${result.btcProfitPercent.toFixed(2)}%)`);
  lines.push(`  BTC Price:       $${result.startBtcPrice.toFixed(0)} \u2192 $${result.endBtcPrice.toFixed(0)}`);
  lines.push('');

  const stratUsdtReturn = ((result.usdtValueEnd - result.usdtValueStart) / result.usdtValueStart * 100);
  const holdUsdtReturn = ((result.holdOnlyUsdtEnd - result.usdtValueStart) / result.usdtValueStart * 100);
  lines.push('  USD COMPARISON');
  lines.push('  ' + '\u2500'.repeat(40));
  lines.push(`  Strategy USD:    $${result.usdtValueStart.toFixed(2)} \u2192 $${result.usdtValueEnd.toFixed(2)} (${stratUsdtReturn >= 0 ? '+' : ''}${stratUsdtReturn.toFixed(1)}%)`);
  lines.push(`  Hold BTC only:   $${result.usdtValueStart.toFixed(2)} \u2192 $${result.holdOnlyUsdtEnd.toFixed(2)} (${holdUsdtReturn >= 0 ? '+' : ''}${holdUsdtReturn.toFixed(1)}%)`);
  lines.push(`  Alpha vs Hold:   ${result.btcProfitPercent >= 0 ? '+' : ''}${result.btcProfitPercent.toFixed(2)}% more BTC`);
  lines.push('');

  lines.push('  TRADES');
  lines.push('  ' + '\u2500'.repeat(40));
  lines.push(`  Total Trades:    ${result.totalTrades}`);
  lines.push(`  Wins / Losses:   ${result.wins} / ${result.losses}`);
  lines.push(`  Win Rate:        ${result.winRate.toFixed(1)}%`);
  lines.push(`  Avg Hold Time:   ${formatDuration(result.avgHoldTime)}`);

  if (result.bestTrade) {
    lines.push(`  Best Trade:      ${result.bestTrade.btcPnl >= 0 ? '+' : ''}${result.bestTrade.btcPnl.toFixed(6)} BTC (${result.bestTrade.altSymbol})`);
  }
  if (result.worstTrade) {
    lines.push(`  Worst Trade:     ${result.worstTrade.btcPnl >= 0 ? '+' : ''}${result.worstTrade.btcPnl.toFixed(6)} BTC (${result.worstTrade.altSymbol})`);
  }
  lines.push('');

  if (result.perAltBreakdown.length > 0) {
    lines.push('  PER-ALTCOIN BREAKDOWN');
    lines.push('  ' + '\u2500'.repeat(40));
    for (const ab of result.perAltBreakdown) {
      const pnlStr = (ab.btcPnl >= 0 ? '+' : '') + ab.btcPnl.toFixed(6);
      lines.push(`  ${ab.symbol.padEnd(12)} ${ab.trades} trades, ${pnlStr} BTC, ${ab.winRate.toFixed(0)}% WR`);
    }
    lines.push('');
  }

  lines.push('\u2550'.repeat(W));
  lines.push('');
  return lines.join('\n');
}

export function saveBtcResults(results: BtcBacktestResult[]): void {
  ensureResultsDir();
  fs.writeFileSync(BTC_RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`BTC rotation results saved to ${BTC_RESULTS_FILE}`);
}

export function loadBtcResults(): BtcBacktestResult[] | null {
  if (!fs.existsSync(BTC_RESULTS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BTC_RESULTS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}
