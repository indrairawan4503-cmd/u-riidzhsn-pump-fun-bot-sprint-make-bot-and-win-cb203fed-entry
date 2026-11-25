// Dip-bounce mean reversion on pump.fun bonding curves (variant A).
// Strategy and parameters live in strategy.ts; the SDK shim is vendored
// byte for byte in vendor/ (see the kit's baselines for the same shim).

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const onBatch = createStrategy(DEFAULT_PARAMS);

await runBot({ onBatch });
