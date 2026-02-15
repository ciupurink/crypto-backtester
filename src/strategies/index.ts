import { emaCrossoverStrategy } from './ema-crossover';
import { rsiReversalStrategy } from './rsi-reversal';
import { macdVolumeStrategy } from './macd-volume';
import { bollingerSqueezeStrategy } from './bollinger-squeeze';
import { multiTimeframeStrategy } from './multi-timeframe';
import { fundingRateStrategy } from './funding-rate';
import { btcAccumulationStrategy } from './btc-accumulation';
import { futuresRotationStrategy } from './futures-rotation';
import { Strategy, BtcStrategy } from '../types';

export const strategies: Strategy[] = [
  emaCrossoverStrategy,
  rsiReversalStrategy,
  macdVolumeStrategy,
  bollingerSqueezeStrategy,
  multiTimeframeStrategy,
  fundingRateStrategy,
];

export const strategyMap: Record<string, Strategy> = {
  'ema-crossover': emaCrossoverStrategy,
  'rsi-reversal': rsiReversalStrategy,
  'macd-volume': macdVolumeStrategy,
  'bollinger-squeeze': bollingerSqueezeStrategy,
  'multi-timeframe': multiTimeframeStrategy,
  'funding-rate': fundingRateStrategy,
};

export const btcStrategies: BtcStrategy[] = [
  btcAccumulationStrategy,
  futuresRotationStrategy,
];

export const btcStrategyMap: Record<string, BtcStrategy> = {
  'btc-accumulation': btcAccumulationStrategy,
  'futures-rotation': futuresRotationStrategy,
};

export {
  emaCrossoverStrategy,
  rsiReversalStrategy,
  macdVolumeStrategy,
  bollingerSqueezeStrategy,
  multiTimeframeStrategy,
  fundingRateStrategy,
  btcAccumulationStrategy,
  futuresRotationStrategy,
};
