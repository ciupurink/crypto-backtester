import * as fs from 'fs';
import * as path from 'path';
import {
  Candle,
  FundingRate,
  TIMEFRAME_TO_BYBIT,
  TIMEFRAME_MS,
  SYMBOLS,
  TIMEFRAMES,
} from './types';

// ============================================================
// Constants
// ============================================================

const BASE_URL = 'https://api.bybit.com';
const KLINE_ENDPOINT = '/v5/market/kline';
const FUNDING_ENDPOINT = '/v5/market/funding/history';
const CANDLES_PER_REQUEST = 200;
const REQUEST_DELAY_MS = 100;
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DEFAULT_MONTHS = 6;

// How fresh the cached data needs to be before we skip re-downloading.
// If the file was modified less than 1 hour ago, we consider it recent.
const CACHE_FRESHNESS_MS = 3_600_000;

// ============================================================
// Helpers
// ============================================================

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function candlePath(symbol: string, timeframe: string): string {
  return path.join(DATA_DIR, `${symbol}_${timeframe}.json`);
}

function fundingPath(symbol: string): string {
  return path.join(DATA_DIR, `${symbol}_funding.json`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCacheFresh(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  return Date.now() - stat.mtimeMs < CACHE_FRESHNESS_MS;
}

// ============================================================
// Candle downloading
// ============================================================

/**
 * Downloads historical candle data from Bybit public API v5.
 *
 * Paginates backwards from `endMs` in chunks of 200 candles until we
 * have covered the requested number of months of history.
 *
 * Bybit returns candles in DESCENDING order (newest first), so each
 * batch is reversed before being prepended to the accumulated result.
 */
export async function downloadCandles(
  symbol: string,
  timeframe: string,
  months: number = DEFAULT_MONTHS
): Promise<Candle[]> {
  ensureDataDir();

  const bybitInterval = TIMEFRAME_TO_BYBIT[timeframe];
  if (!bybitInterval) {
    throw new Error(`Unknown timeframe "${timeframe}". Valid values: ${Object.keys(TIMEFRAME_TO_BYBIT).join(', ')}`);
  }

  const intervalMs = TIMEFRAME_MS[timeframe];
  if (!intervalMs) {
    throw new Error(`No millisecond mapping for timeframe "${timeframe}".`);
  }

  const filePath = candlePath(symbol, timeframe);

  // Check cache freshness
  if (isCacheFresh(filePath)) {
    console.log(`Cache hit for ${symbol} ${timeframe} — skipping download.`);
    const cached = loadCandles(symbol, timeframe);
    if (cached) return cached;
  }

  const now = Date.now();
  const startMs = now - months * 30 * 24 * 60 * 60 * 1000; // approximate months
  const totalExpected = Math.ceil((now - startMs) / intervalMs);

  const allCandles: Candle[] = [];
  let endMs = now;

  console.log(`Downloading ${symbol} ${timeframe}: 0/${totalExpected} candles...`);

  while (endMs > startMs) {
    // Build the request URL.
    // We request candles ending at `endMs`. Bybit returns up to 200 candles
    // whose open times are <= endMs, in descending order.
    const requestStart = Math.max(startMs, endMs - CANDLES_PER_REQUEST * intervalMs);
    const url =
      `${BASE_URL}${KLINE_ENDPOINT}` +
      `?category=linear` +
      `&symbol=${symbol}` +
      `&interval=${bybitInterval}` +
      `&start=${requestStart}` +
      `&end=${endMs}` +
      `&limit=${CANDLES_PER_REQUEST}`;

    let data: any;
    try {
      const res = await fetch(url);
      data = await res.json();
    } catch (err: any) {
      console.error(`Fetch error for ${symbol} ${timeframe}: ${err.message}. Retrying in 1 s...`);
      await sleep(1000);
      continue;
    }

    if (data.retCode !== 0) {
      console.error(`Bybit API error (retCode ${data.retCode}): ${data.retMsg}`);
      break;
    }

    const rawList: string[][] = data.result?.list;
    if (!rawList || rawList.length === 0) {
      break;
    }

    // Bybit returns newest first — reverse to chronological order.
    const batch: Candle[] = rawList.reverse().map((item) => ({
      timestamp: Number(item[0]),
      open: Number(item[1]),
      high: Number(item[2]),
      low: Number(item[3]),
      close: Number(item[4]),
      volume: Number(item[5]),
      turnover: Number(item[6]),
    }));

    // Prepend batch (it covers earlier times) — we build the array from
    // the end backwards, so we unshift entire batches.
    allCandles.unshift(...batch);

    // Move the window further into the past.
    // The oldest candle in this batch determines the new endMs.
    endMs = batch[0].timestamp - 1;

    console.log(`Downloading ${symbol} ${timeframe}: ${allCandles.length}/${totalExpected} candles...`);

    // Be nice to the API.
    await sleep(REQUEST_DELAY_MS);
  }

  // Deduplicate by timestamp (safety net for overlapping pagination windows).
  const seen = new Set<number>();
  const deduped = allCandles.filter((c) => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });

  // Sort chronologically just in case.
  deduped.sort((a, b) => a.timestamp - b.timestamp);

  // Persist to disk.
  fs.writeFileSync(filePath, JSON.stringify(deduped, null, 2), 'utf-8');
  console.log(`Saved ${deduped.length} candles to ${filePath}`);

  return deduped;
}

// ============================================================
// Load candles from disk
// ============================================================

/**
 * Loads previously downloaded candle data from disk.
 * Returns null if the file does not exist.
 */
export function loadCandles(symbol: string, timeframe: string): Candle[] | null {
  const filePath = candlePath(symbol, timeframe);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: Candle[] = JSON.parse(raw);
    return parsed;
  } catch (err: any) {
    console.error(`Failed to load candles from ${filePath}: ${err.message}`);
    return null;
  }
}

// ============================================================
// Funding rate downloading
// ============================================================

/**
 * Downloads the full funding rate history for a perpetual symbol from
 * Bybit. Paginates using the `endCursor` approach — each batch returns
 * the oldest timestamp, and we use that to page backwards.
 *
 * Saves to data/{symbol}_funding.json.
 */
export async function downloadFundingRates(symbol: string): Promise<FundingRate[]> {
  ensureDataDir();

  const filePath = fundingPath(symbol);

  if (isCacheFresh(filePath)) {
    console.log(`Cache hit for ${symbol} funding rates — skipping download.`);
    const cached = loadFundingRates(symbol);
    if (cached) return cached;
  }

  const allRates: FundingRate[] = [];
  const sixMonthsAgo = Date.now() - DEFAULT_MONTHS * 30 * 24 * 60 * 60 * 1000;
  let endTime: number | undefined;

  console.log(`Downloading ${symbol} funding rates...`);

  while (true) {
    let url =
      `${BASE_URL}${FUNDING_ENDPOINT}` +
      `?category=linear` +
      `&symbol=${symbol}` +
      `&limit=${CANDLES_PER_REQUEST}`;

    if (endTime !== undefined) {
      url += `&endTime=${endTime}`;
    }

    let data: any;
    try {
      const res = await fetch(url);
      data = await res.json();
    } catch (err: any) {
      console.error(`Fetch error for ${symbol} funding rates: ${err.message}. Retrying in 1 s...`);
      await sleep(1000);
      continue;
    }

    if (data.retCode !== 0) {
      console.error(`Bybit API error (retCode ${data.retCode}): ${data.retMsg}`);
      break;
    }

    const rawList: any[] = data.result?.list;
    if (!rawList || rawList.length === 0) {
      break;
    }

    const batch: FundingRate[] = rawList.map((item) => ({
      symbol: item.symbol,
      fundingRate: Number(item.fundingRate),
      fundingRateTimestamp: Number(item.fundingRateTimestamp),
    }));

    allRates.push(...batch);

    // The list comes newest-first. The last element is the oldest in
    // this batch. Page backwards from there.
    const oldestTimestamp = batch[batch.length - 1].fundingRateTimestamp;

    if (oldestTimestamp <= sixMonthsAgo) {
      break;
    }

    // Move the window further into the past.
    endTime = oldestTimestamp - 1;

    console.log(`Downloading ${symbol} funding rates: ${allRates.length} records...`);
    await sleep(REQUEST_DELAY_MS);
  }

  // Deduplicate by timestamp.
  const seen = new Set<number>();
  const deduped = allRates.filter((r) => {
    if (seen.has(r.fundingRateTimestamp)) return false;
    seen.add(r.fundingRateTimestamp);
    return true;
  });

  // Sort chronologically (oldest first).
  deduped.sort((a, b) => a.fundingRateTimestamp - b.fundingRateTimestamp);

  fs.writeFileSync(filePath, JSON.stringify(deduped, null, 2), 'utf-8');
  console.log(`Saved ${deduped.length} funding rate records to ${filePath}`);

  return deduped;
}

// ============================================================
// Load funding rates from disk
// ============================================================

/**
 * Loads previously downloaded funding rate data from disk.
 * Returns null if the file does not exist.
 */
export function loadFundingRates(symbol: string): FundingRate[] | null {
  const filePath = fundingPath(symbol);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: FundingRate[] = JSON.parse(raw);
    return parsed;
  } catch (err: any) {
    console.error(`Failed to load funding rates from ${filePath}: ${err.message}`);
    return null;
  }
}

// ============================================================
// Download everything
// ============================================================

/**
 * Downloads candle data for every symbol/timeframe combination, plus
 * funding rates for every symbol. Defaults to the full SYMBOLS and
 * TIMEFRAMES lists from the types module.
 */
export async function downloadAll(
  symbols: string[] = SYMBOLS,
  timeframes: string[] = TIMEFRAMES
): Promise<void> {
  const totalCombinations = symbols.length * timeframes.length + symbols.length;
  let completed = 0;

  console.log(`\n========================================`);
  console.log(`Starting bulk download`);
  console.log(`  Symbols:    ${symbols.join(', ')}`);
  console.log(`  Timeframes: ${timeframes.join(', ')}`);
  console.log(`  Total jobs: ${totalCombinations}`);
  console.log(`========================================\n`);

  for (const symbol of symbols) {
    for (const tf of timeframes) {
      try {
        await downloadCandles(symbol, tf);
      } catch (err: any) {
        console.error(`Error downloading ${symbol} ${tf}: ${err.message}`);
      }
      completed++;
      console.log(`Progress: ${completed}/${totalCombinations}\n`);
    }

    // Funding rates for this symbol.
    try {
      await downloadFundingRates(symbol);
    } catch (err: any) {
      console.error(`Error downloading ${symbol} funding rates: ${err.message}`);
    }
    completed++;
    console.log(`Progress: ${completed}/${totalCombinations}\n`);
  }

  console.log(`\nBulk download complete.`);
}
