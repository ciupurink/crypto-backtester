import { SYMBOLS, TIMEFRAMES } from './types';
import { downloadAll, downloadCandles, downloadFundingRates, loadFundingRates } from './downloader';
import { strategies, strategyMap, btcStrategies, btcStrategyMap } from './strategies';
import { loadFundingData } from './strategies/funding-rate';
import { runBacktest, runAllBacktests } from './backtester';
import { runAllBtcBacktests } from './btc-backtester';
import { generateReport, generateComparisonReport, saveResults, generateBtcReport, saveBtcResults } from './report';
import { startDashboard } from './dashboard';

// ============================================================
// ANSI colour helpers
// ============================================================

const C = {
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  reset:  '\x1b[0m',
};

function green(text: string): string  { return `${C.green}${text}${C.reset}`; }
function red(text: string): string    { return `${C.red}${text}${C.reset}`; }
function yellow(text: string): string { return `${C.yellow}${text}${C.reset}`; }
function cyan(text: string): string   { return `${C.cyan}${text}${C.reset}`; }
function bold(text: string): string   { return `${C.bold}${text}${C.reset}`; }

// ============================================================
// Banner
// ============================================================

function printBanner(): void {
  console.log(cyan('\n╔═══════════════════════════════════════════╗'));
  console.log(cyan('║') + bold('   CRYPTO FUTURES BACKTESTER v1.0          ') + cyan('║'));
  console.log(cyan('║') + '   Bybit Historical Data Engine            ' + cyan('║'));
  console.log(cyan('╚═══════════════════════════════════════════╝'));
  console.log('');
}

// ============================================================
// Argument parsing
// ============================================================

function getArg(flag: string): string | undefined {
  const args = process.argv;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ============================================================
// Commands
// ============================================================

async function commandDownload(): Promise<void> {
  console.log(yellow(bold('\n--- Download Mode ---\n')));
  console.log(cyan('Symbols: ') + SYMBOLS.join(', '));

  // Skip 1m and 5m as they produce too much data.
  // Download 15m, 1h, 4h, 1d.
  const downloadTimeframes = TIMEFRAMES.filter(
    (tf) => tf !== '1m' && tf !== '5m'
  );
  console.log(cyan('Timeframes: ') + downloadTimeframes.join(', '));
  console.log(cyan('Also downloading: ') + 'funding rates for all symbols');
  console.log('');

  const totalSymbols = SYMBOLS.length;
  const totalTf = downloadTimeframes.length;
  const totalJobs = totalSymbols * totalTf + totalSymbols; // +symbols for funding rates
  let completed = 0;

  for (const symbol of SYMBOLS) {
    for (const tf of downloadTimeframes) {
      try {
        console.log(
          yellow(`[${completed + 1}/${totalJobs}] `) +
          `Downloading ${bold(symbol)} ${tf}...`
        );
        await downloadCandles(symbol, tf);
        completed++;
        console.log(green(`  Done. Progress: ${completed}/${totalJobs}`));
      } catch (err: any) {
        console.error(red(`  Error downloading ${symbol} ${tf}: ${err.message}`));
        completed++;
      }
    }

    // Funding rates for this symbol
    try {
      console.log(
        yellow(`[${completed + 1}/${totalJobs}] `) +
        `Downloading ${bold(symbol)} funding rates...`
      );
      await downloadFundingRates(symbol);
      completed++;
      console.log(green(`  Done. Progress: ${completed}/${totalJobs}`));
    } catch (err: any) {
      console.error(red(`  Error downloading ${symbol} funding rates: ${err.message}`));
      completed++;
    }
  }

  console.log(green(bold('\nDownload complete!')));
  console.log(cyan(`Total jobs: ${totalJobs}`));
}

async function commandBacktest(): Promise<void> {
  console.log(yellow(bold('\n--- Backtest Mode ---\n')));

  // Parse optional flags
  const strategyArg = getArg('--strategy');
  const symbolArg = getArg('--symbol');
  const timeframeArg = getArg('--timeframe') || '1h';
  const leverageArg = getArg('--leverage');

  // Check if this is a BTC-only strategy
  const isBtcOnlyStrategy = strategyArg && btcStrategyMap[strategyArg] && !strategyMap[strategyArg];

  // Determine which strategies to run
  let selectedStrategies = strategies;
  if (strategyArg && !isBtcOnlyStrategy) {
    const found = strategyMap[strategyArg];
    if (!found && !btcStrategyMap[strategyArg]) {
      console.error(
        red(`Unknown strategy: "${strategyArg}".`) +
        '\nAvailable USDT strategies: ' + Object.keys(strategyMap).join(', ') +
        '\nAvailable BTC strategies: ' + Object.keys(btcStrategyMap).join(', ')
      );
      process.exit(1);
    }
    if (found) {
      selectedStrategies = [found];
      console.log(cyan('Strategy: ') + bold(found.name));
    } else {
      selectedStrategies = [];
    }
  } else if (isBtcOnlyStrategy) {
    selectedStrategies = [];
    console.log(cyan('BTC Strategy: ') + bold(btcStrategyMap[strategyArg!].name));
  } else {
    console.log(cyan('Strategies: ') + selectedStrategies.map((s) => s.name).join(', '));
  }

  // Determine which symbols
  let selectedSymbols = SYMBOLS;
  if (symbolArg) {
    if (!SYMBOLS.includes(symbolArg)) {
      console.error(
        red(`Unknown symbol: "${symbolArg}".`) +
        '\nAvailable symbols: ' + SYMBOLS.join(', ')
      );
      process.exit(1);
    }
    selectedSymbols = [symbolArg];
    console.log(cyan('Symbol: ') + bold(symbolArg));
  } else {
    console.log(cyan('Symbols: ') + selectedSymbols.join(', '));
  }

  // Determine leverages
  let leverages = [3, 5];
  if (leverageArg) {
    const lev = parseInt(leverageArg, 10);
    if (isNaN(lev) || lev <= 0) {
      console.error(red(`Invalid leverage: "${leverageArg}". Must be a positive integer.`));
      process.exit(1);
    }
    leverages = [lev];
    console.log(cyan('Leverage: ') + bold(`${lev}x`));
  } else {
    console.log(cyan('Leverages: ') + leverages.map((l) => `${l}x`).join(', '));
  }

  console.log(cyan('Timeframe: ') + bold(timeframeArg));
  console.log('');

  // Load funding rate data for the funding rate strategy
  const allFundingRates: Array<{fundingRate: number; fundingRateTimestamp: number}> = [];
  for (const symbol of selectedSymbols) {
    const rates = loadFundingRates(symbol);
    if (rates) allFundingRates.push(...rates);
  }
  if (allFundingRates.length > 0) {
    loadFundingData(allFundingRates);
    console.log(cyan(`Loaded ${allFundingRates.length} funding rate records for Funding Rate strategy`));
    console.log('');
  }

  // Run all backtests
  try {
    const allResults = selectedStrategies.length > 0 ? await runAllBacktests(
      selectedSymbols,
      selectedStrategies,
      timeframeArg,
      leverages
    ) : [];

    if (allResults.length > 0) {
      // Print individual reports
      console.log(yellow(bold('\n==========================================')));
      console.log(yellow(bold('  INDIVIDUAL STRATEGY REPORTS')));
      console.log(yellow(bold('==========================================\n')));

      for (const result of allResults) {
        const report = generateReport(result);
        console.log(report);
        console.log('');
      }

      // Print comparison report
      if (allResults.length > 1) {
        console.log(yellow(bold('\n==========================================')));
        console.log(yellow(bold('  STRATEGY COMPARISON')));
        console.log(yellow(bold('==========================================\n')));

        const comparison = generateComparisonReport(allResults);
        console.log(comparison);
      }

      // Save results to disk
      saveResults(allResults);
    } else if (!isBtcOnlyStrategy) {
      console.log(
        yellow('No backtest results produced.') +
        '\nMake sure data files exist. Run ' + bold('npm run download') + ' first.'
      );
      return;
    }

    // -------------------------------------------------------
    // BTC Rotation Strategies (H & I)
    // -------------------------------------------------------
    if (!strategyArg || strategyArg === 'btc-accumulation' || strategyArg === 'futures-rotation') {
      console.log(yellow(bold('\n==========================================')));
      console.log(yellow(bold('  BTC ROTATION STRATEGIES (H & I)')));
      console.log(yellow(bold('==========================================\n')));

      const selectedBtcStrategies = strategyArg
        ? [btcStrategyMap[strategyArg]].filter(Boolean)
        : btcStrategies;

      if (selectedBtcStrategies.length > 0) {
        const btcResults = runAllBtcBacktests(selectedBtcStrategies, '1d');

        for (const btcResult of btcResults) {
          console.log(generateBtcReport(btcResult));
        }

        saveBtcResults(btcResults);
      }
    }

    console.log(green(bold('\nAll results saved to results/ directory.')));
    console.log(cyan('Run ') + bold('npm run dashboard') + cyan(' to view the web dashboard.'));

  } catch (err: any) {
    if (err.code === 'ENOENT' || err.message?.includes('ENOENT') || err.message?.includes('no data')) {
      console.error(
        red('\nError: Data files not found!') +
        '\n' + yellow('Please run ') + bold('npm run download') + yellow(' first to download historical data.')
      );
    } else {
      console.error(red(`\nBacktest error: ${err.message}`));
    }
    process.exit(1);
  }
}

function commandDashboard(): void {
  console.log(yellow(bold('\n--- Dashboard Mode ---\n')));
  startDashboard();
}

// ============================================================
// Usage / help
// ============================================================

function printUsage(): void {
  console.log(bold('Usage:'));
  console.log('');
  console.log(cyan('  npm run download') + '                           Download historical data from Bybit');
  console.log(cyan('  npm run backtest') + '                           Run all strategies on all symbols');
  console.log(cyan('  npm run backtest') + ' --strategy <name>         Run a specific strategy');
  console.log(cyan('  npm run backtest') + ' --symbol <SYMBOL>         Run on a specific symbol');
  console.log(cyan('  npm run backtest') + ' --timeframe <tf>          Use a specific timeframe (default: 1h)');
  console.log(cyan('  npm run backtest') + ' --leverage <n>            Use a specific leverage (default: 3 and 5)');
  console.log(cyan('  npm run dashboard') + '                          Start the web dashboard on port 3000');
  console.log('');
  console.log(bold('Available strategies (USDT):'));
  const keys = Object.keys(strategyMap);
  for (const key of keys) {
    const strat = strategyMap[key];
    console.log(`  ${cyan(key.padEnd(24))} ${strat.name}`);
  }
  console.log('');
  console.log(bold('Available strategies (BTC rotation):'));
  const btcKeys = Object.keys(btcStrategyMap);
  for (const key of btcKeys) {
    const strat = btcStrategyMap[key];
    console.log(`  ${cyan(key.padEnd(24))} ${strat.name}`);
  }
  console.log('');
  console.log(bold('Available symbols:'));
  console.log(`  ${SYMBOLS.join(', ')}`);
  console.log('');
  console.log(bold('Available timeframes:'));
  console.log(`  ${['15m', '1h', '4h', '1d'].join(', ')}`);
  console.log('');
}

// ============================================================
// Main
// ============================================================

(async () => {
  printBanner();

  const action = process.argv[2];

  switch (action) {
    case 'download':
      await commandDownload();
      break;

    case 'backtest':
      await commandBacktest();
      break;

    case 'dashboard':
      commandDashboard();
      break;

    case '--help':
    case '-h':
    case 'help':
      printUsage();
      break;

    default:
      if (action) {
        console.error(red(`Unknown command: "${action}"\n`));
      }
      printUsage();
      break;
  }
})().catch((err) => {
  console.error(red(`\nFatal error: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
