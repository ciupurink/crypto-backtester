import express from 'express';
import path from 'path';
import fs from 'fs';
import { BacktestResult, BtcBacktestResult } from './types';

// ============================================================
// Paths
// ============================================================

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const RESULTS_DIR = path.resolve(__dirname, '..', 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'backtest_results.json');
const FULL_RESULTS_FILE = path.join(RESULTS_DIR, 'backtest_full.json');
const BTC_RESULTS_FILE = path.join(RESULTS_DIR, 'btc_results.json');

// ============================================================
// Helpers
// ============================================================

function loadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ============================================================
// Express server
// ============================================================

export function startDashboard(): void {
  const app = express();
  const PORT = 3737;

  // Serve static files (index.html, etc.)
  app.use(express.static(PUBLIC_DIR));

  // ----------------------------------------------------------
  // GET /api/results — summary results
  // ----------------------------------------------------------
  app.get('/api/results', (_req, res) => {
    const data = loadJson<BacktestResult[]>(RESULTS_FILE);
    if (!data) {
      return res.status(404).json({ error: 'No results found. Run backtest first.' });
    }
    // Return summary without heavy fields (trades, equityCurve)
    const summary = data.map((r) => ({
      strategyName: r.strategyName,
      leverage: r.leverage,
      totalTrades: r.totalTrades,
      wins: r.wins,
      losses: r.losses,
      winRate: r.winRate,
      totalPnl: r.totalPnl,
      totalPnlPercent: r.totalPnlPercent,
      profitFactor: r.profitFactor,
      maxDrawdown: r.maxDrawdown,
      maxDrawdownPercent: r.maxDrawdownPercent,
      avgWin: r.avgWin,
      avgLoss: r.avgLoss,
      avgTradeDuration: r.avgTradeDuration,
      sharpeRatio: r.sharpeRatio,
      finalEquity: r.finalEquity,
      startingCapital: r.startingCapital,
      monthlyReturns: r.monthlyReturns,
      symbolBreakdown: r.symbolBreakdown,
    }));
    res.json(summary);
  });

  // ----------------------------------------------------------
  // GET /api/results/full — full results including trades & equity
  // ----------------------------------------------------------
  app.get('/api/results/full', (_req, res) => {
    const data = loadJson<BacktestResult[]>(FULL_RESULTS_FILE);
    if (!data) {
      // Fall back to the summary file which may include trades
      const fallback = loadJson<BacktestResult[]>(RESULTS_FILE);
      if (!fallback) {
        return res.status(404).json({ error: 'No results found. Run backtest first.' });
      }
      return res.json(fallback);
    }
    res.json(data);
  });

  // ----------------------------------------------------------
  // GET /api/equity/:strategyName — equity curve for a strategy
  // ----------------------------------------------------------
  app.get('/api/equity/:strategyName', (req, res) => {
    const { strategyName } = req.params;
    const data = loadJson<BacktestResult[]>(FULL_RESULTS_FILE) ??
                 loadJson<BacktestResult[]>(RESULTS_FILE);

    if (!data) {
      return res.status(404).json({ error: 'No results found.' });
    }

    const result = data.find(
      (r) => r.strategyName === strategyName ||
             r.strategyName.toLowerCase().replace(/\s+/g, '-') === strategyName.toLowerCase()
    );

    if (!result) {
      return res.status(404).json({
        error: `Strategy "${strategyName}" not found.`,
        available: data.map((r) => r.strategyName),
      });
    }

    res.json({
      strategyName: result.strategyName,
      leverage: result.leverage,
      equityCurve: result.equityCurve,
    });
  });

  // ----------------------------------------------------------
  // GET /api/trades/:strategyName — trades for a strategy
  // ----------------------------------------------------------
  app.get('/api/trades/:strategyName', (req, res) => {
    const { strategyName } = req.params;
    const data = loadJson<BacktestResult[]>(FULL_RESULTS_FILE) ??
                 loadJson<BacktestResult[]>(RESULTS_FILE);

    if (!data) {
      return res.status(404).json({ error: 'No results found.' });
    }

    const result = data.find(
      (r) => r.strategyName === strategyName ||
             r.strategyName.toLowerCase().replace(/\s+/g, '-') === strategyName.toLowerCase()
    );

    if (!result) {
      return res.status(404).json({
        error: `Strategy "${strategyName}" not found.`,
        available: data.map((r) => r.strategyName),
      });
    }

    res.json({
      strategyName: result.strategyName,
      leverage: result.leverage,
      trades: result.trades,
      totalTrades: result.totalTrades,
    });
  });

  // ----------------------------------------------------------
  // GET /api/monthly/:strategyName — monthly returns
  // ----------------------------------------------------------
  app.get('/api/monthly/:strategyName', (req, res) => {
    const { strategyName } = req.params;
    const data = loadJson<BacktestResult[]>(FULL_RESULTS_FILE) ??
                 loadJson<BacktestResult[]>(RESULTS_FILE);

    if (!data) {
      return res.status(404).json({ error: 'No results found.' });
    }

    const result = data.find(
      (r) => r.strategyName === strategyName ||
             r.strategyName.toLowerCase().replace(/\s+/g, '-') === strategyName.toLowerCase()
    );

    if (!result) {
      return res.status(404).json({
        error: `Strategy "${strategyName}" not found.`,
        available: data.map((r) => r.strategyName),
      });
    }

    res.json({
      strategyName: result.strategyName,
      leverage: result.leverage,
      monthlyReturns: result.monthlyReturns,
    });
  });

  // ----------------------------------------------------------
  // GET /api/btc-results — BTC rotation strategy results
  // ----------------------------------------------------------
  app.get('/api/btc-results', (_req, res) => {
    const data = loadJson<BtcBacktestResult[]>(BTC_RESULTS_FILE);
    if (!data) {
      return res.status(404).json({ error: 'No BTC rotation results found.' });
    }
    res.json(data);
  });

  // ----------------------------------------------------------
  // Start
  // ----------------------------------------------------------
  app.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
  });
}

// Allow running directly: ts-node src/dashboard.ts
if (require.main === module) {
  startDashboard();
}
