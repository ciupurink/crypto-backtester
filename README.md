# Crypto Futures Backtester

A comprehensive cryptocurrency futures backtesting engine built in TypeScript. Downloads historical data from Bybit's public API, runs multiple trading strategies, and displays results via an interactive web dashboard.

## Features

- **Data Downloader** — Fetches candle data (15m, 1h, 4h, 1d) and funding rates for 10 symbols from Bybit v5 API (no auth required)
- **Indicator Engine** — EMA, SMA, RSI, MACD, Bollinger Bands, ATR, ADX, Stochastic RSI, VWAP, Fibonacci retracement — all computed from scratch
- **8 Trading Strategies** — 6 USDT-denominated + 2 BTC rotation strategies
- **Realistic Backtesting** — Commission (0.06%), slippage (0.05%), partial closes, trailing stops, breakeven mechanics
- **Web Dashboard** — Dark-themed Chart.js dashboard with equity curves, drawdown, monthly heatmap, symbol breakdown, and filterable trade lists

## Strategies

### USDT Strategies ($500 starting capital, 3x/5x leverage)

| ID | Strategy | Description |
|----|----------|-------------|
| A | EMA Crossover | EMA 9/21 crossover with EMA 50/200 trend filter |
| B | RSI Reversal | RSI oversold/overbought with Stochastic RSI confirmation |
| C | MACD + Volume | MACD histogram reversal with volume spike filter |
| D | Bollinger Squeeze | Bandwidth squeeze breakout with ADX confirmation |
| E | Multi-Timeframe | 4h trend + 15m pullback entry with Fibonacci targets |
| F | Funding Rate | Extreme funding rate mean-reversion with trend alignment |

### BTC Rotation Strategies (0.05 BTC starting capital)

| ID | Strategy | Description |
|----|----------|-------------|
| H | BTC Accumulation (Spot) | Buy oversold ALT/BTC ratios to accumulate more BTC |
| I | Futures Rotation (2x) | Same concept with 2x leverage on synthetic ALT/BTC pairs |

Both BTC strategies use a confluence scoring system (RSI, drop from high, fibonacci support, EMA trend, volume, funding rate, BTC dominance) and measure P&L in BTC rather than USD.

## Quick Start

```bash
# Install dependencies
npm install

# Download 6 months of historical data from Bybit
npm run download

# Run all strategies
npm run backtest

# Start the web dashboard
npm run dashboard
# Open http://localhost:3737
```

## Commands

```bash
npm run download                              # Download all data
npm run backtest                              # Run all strategies
npm run backtest -- --strategy ema-crossover  # Run specific strategy
npm run backtest -- --symbol BTCUSDT          # Run on specific symbol
npm run backtest -- --timeframe 4h            # Use specific timeframe
npm run backtest -- --leverage 10             # Use specific leverage
npm run dashboard                             # Start dashboard on port 3737
```

### Per-strategy shortcuts

```bash
npm run backtest:strategy-a    # EMA Crossover
npm run backtest:strategy-b    # RSI Reversal
npm run backtest:strategy-c    # MACD + Volume
npm run backtest:strategy-d    # Bollinger Squeeze
npm run backtest:strategy-e    # Multi-Timeframe
npm run backtest:strategy-f    # Funding Rate
npm run backtest:strategy-h    # BTC Accumulation (Spot)
npm run backtest:strategy-i    # Futures Rotation (2x)
```

## Supported Symbols

BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, AVAXUSDT, LINKUSDT, SUIUSDT

## Project Structure

```
src/
  cli.ts              # CLI entry point
  downloader.ts       # Bybit API data fetcher with caching
  indicators.ts       # Technical indicator calculations
  backtester.ts       # USDT-denominated backtest engine
  btc-backtester.ts   # BTC-denominated backtest engine
  altbtc.ts           # Synthetic ALT/BTC ratio candle builder
  report.ts           # Console reports and JSON export
  dashboard.ts        # Express server for web dashboard
  types.ts            # All TypeScript interfaces and constants
  strategies/
    ema-crossover.ts
    rsi-reversal.ts
    macd-volume.ts
    bollinger-squeeze.ts
    multi-timeframe.ts
    funding-rate.ts
    btc-accumulation.ts
    futures-rotation.ts
    index.ts
public/
  index.html          # Dashboard frontend (Chart.js)
data/                 # Downloaded candle/funding data (gitignored)
results/              # Backtest output JSON files (gitignored)
```

## Dashboard

The web dashboard at `localhost:3737` includes:

- **Strategy Comparison Table** — Sortable by any metric, best values highlighted
- **Equity Curves** — Line chart tracking portfolio value over time
- **Drawdown Chart** — Visualizes peak-to-trough drawdowns
- **Monthly Returns Heatmap** — Color-coded monthly P&L per strategy
- **Symbol Performance** — Grouped bar chart of per-symbol P&L
- **Trade List** — Filterable, sortable, paginated trade log
- **BTC Rotation Section** — Separate section for BTC strategies with equity curve, per-alt breakdown, and trade list

## Tech Stack

- TypeScript, ts-node
- Express.js (dashboard server)
- Chart.js (frontend charts)
- Bybit v5 public API (no authentication needed)
