// ============================================================
// Core data types
// ============================================================

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export interface FundingRate {
  symbol: string;
  fundingRate: number;
  fundingRateTimestamp: number;
}

// ============================================================
// Indicator types
// ============================================================

export interface MACD {
  line: number;
  signal: number;
  histogram: number;
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
}

export interface StochRSI {
  k: number;
  d: number;
}

export interface FibonacciLevels {
  high: number;
  low: number;
  level236: number;
  level382: number;
  level500: number;
  level618: number;
  level786: number;
}

export interface Indicators {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  sma20: number;
  sma50: number;
  rsi: number;
  macd: MACD;
  bb: BollingerBands;
  atr: number;
  adx: number;
  stochRsi: StochRSI;
  volumeSma: number;
  vwap: number;
  fibonacci: FibonacciLevels;
}

export interface CandleWithIndicators extends Candle {
  indicators: Indicators;
}

// ============================================================
// Strategy types
// ============================================================

export type Side = 'long' | 'short';

export interface EntrySignal {
  enter: boolean;
  stopLoss: number;
  takeProfit: number;
  takeProfit2?: number;
  reason: string;
}

export interface ExitSignal {
  exit: boolean;
  reason: string;
}

export interface MultiTimeframeData {
  [timeframe: string]: CandleWithIndicators[];
}

export interface Strategy {
  name: string;
  requiredTimeframes?: string[];
  shouldEnterLong(candles: CandleWithIndicators[], currentIndex: number, multiTfData?: MultiTimeframeData): EntrySignal;
  shouldEnterShort(candles: CandleWithIndicators[], currentIndex: number, multiTfData?: MultiTimeframeData): EntrySignal;
  shouldExit(position: Position, candles: CandleWithIndicators[], currentIndex: number, multiTfData?: MultiTimeframeData): ExitSignal;
}

// ============================================================
// Position / Trade types
// ============================================================

export interface PartialClose {
  price: number;
  size: number;
  pnl: number;
  timestamp: number;
  reason: string;
}

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  entryPrice: number;
  size: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2?: number;
  entryTime: number;
  exitTime?: number;
  exitPrice?: number;
  pnl?: number;
  commission: number;
  status: 'open' | 'closed';
  reason: string;
  exitReason?: string;
  partialCloses: PartialClose[];
  trailingStop?: number;
  breakeven: boolean;
  tp1Hit: boolean;
}

export interface Trade extends Position {
  status: 'closed';
  exitTime: number;
  exitPrice: number;
  pnl: number;
  duration: number;
}

// ============================================================
// Backtest configuration & results
// ============================================================

export interface BacktestConfig {
  startingCapital: number;
  leverage: number;
  commissionRate: number;
  slippageRate: number;
  riskPerTrade: number;
  maxConcurrentPositions: number;
  symbols: string[];
  timeframe: string;
  strategy: Strategy;
}

export interface MonthlyReturn {
  month: string;
  pnl: number;
  pnlPercent: number;
  trades: number;
  winRate: number;
}

export interface SymbolBreakdown {
  symbol: string;
  trades: number;
  pnl: number;
  winRate: number;
  profitFactor: number;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
}

export interface BacktestResult {
  strategyName: string;
  leverage: number;
  trades: Trade[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  totalPnlPercent: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: Trade | null;
  worstTrade: Trade | null;
  avgTradeDuration: number;
  sharpeRatio: number;
  monthlyReturns: MonthlyReturn[];
  symbolBreakdown: SymbolBreakdown[];
  equityCurve: EquityPoint[];
  finalEquity: number;
  startingCapital: number;
}

// ============================================================
// Constants
// ============================================================

export type Timeframe = '1' | '5' | '15' | '60' | '240' | 'D';

export const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

export const TIMEFRAME_TO_BYBIT: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
};

export const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT',
];

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

export const NO_SIGNAL: EntrySignal = { enter: false, stopLoss: 0, takeProfit: 0, reason: '' };
export const NO_EXIT: ExitSignal = { exit: false, reason: '' };

// ============================================================
// ALT/BTC Rotation types (Strategies H & I)
// ============================================================

export const ALT_SYMBOLS = [
  'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT',
];

export interface AltBtcCandle {
  timestamp: number;
  altSymbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  altUsdtPrice: number;
  btcUsdtPrice: number;
  indicators: Indicators;
  altFundingRate?: number;
}

export interface BtcPosition {
  id: string;
  altSymbol: string;
  entryRatio: number;
  btcAllocated: number;
  entryTime: number;
  exitTime?: number;
  exitRatio?: number;
  btcPnl?: number;
  status: 'open' | 'closed';
  reason: string;
  exitReason?: string;
  tp1Hit: boolean;
  leverage: number;
}

export interface BtcTrade extends BtcPosition {
  status: 'closed';
  exitTime: number;
  exitRatio: number;
  btcPnl: number;
  duration: number;
}

export interface BtcEquityPoint {
  timestamp: number;
  btcEquity: number;
  usdtEquity: number;
}

export interface AltBreakdown {
  symbol: string;
  trades: number;
  btcPnl: number;
  winRate: number;
}

export interface BtcBacktestResult {
  strategyName: string;
  startingBtc: number;
  finalBtc: number;
  btcProfit: number;
  btcProfitPercent: number;
  startBtcPrice: number;
  endBtcPrice: number;
  usdtValueStart: number;
  usdtValueEnd: number;
  holdOnlyUsdtEnd: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgHoldTime: number;
  bestTrade: BtcTrade | null;
  worstTrade: BtcTrade | null;
  trades: BtcTrade[];
  equityCurve: BtcEquityPoint[];
  perAltBreakdown: AltBreakdown[];
}

export interface BtcEntrySignal {
  enter: boolean;
  stopLossRatio: number;
  tp1Ratio: number;
  tp2Ratio: number;
  btcAllocation: number;
  reason: string;
}

export interface BtcExitSignal {
  exit: boolean;
  sellFraction: number;
  reason: string;
}

export const NO_BTC_ENTRY: BtcEntrySignal = { enter: false, stopLossRatio: 0, tp1Ratio: 0, tp2Ratio: 0, btcAllocation: 0, reason: '' };
export const NO_BTC_EXIT: BtcExitSignal = { exit: false, sellFraction: 0, reason: '' };

export interface BtcStrategy {
  name: string;
  leverage: number;
  shouldEnter(altCandles: AltBtcCandle[], currentIndex: number, avgRatioTrend: number): BtcEntrySignal;
  shouldExit(position: BtcPosition, altCandles: AltBtcCandle[], currentIndex: number, avgRatioTrend: number): BtcExitSignal;
}
