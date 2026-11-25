# Dip-Bounce Mean Reversion — Pump.fun Bot Sprint

[![make.fun](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/indrairawan4503-cmd/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/indrairawan4503-cmd/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed-entry/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A paper trading bot for the [Pump.fun Bot Sprint](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed) on make.fun.

## Strategy

Dip-bounce mean reversion on pump.fun bonding curves. A curve that ran up,
then dropped hard from its recent high, and has now started to bounce — price
up off its trough with buyers stepping back in — tends to recover part of the
dip before fading again.

- **Entry (only after the bounce confirms):** price 45–65% below its recent
  high, up ≥6% off a trough no older than 150 slots, last trade a buy, recent
  tape mostly buys with non-negative net flow, curve at least 500 slots old
  and still holding ≥25 SOL real at the high.
- **Sizing:** one fixed 0.60 SOL tranche per strong position (0.02 SOL probes
  on weaker 8–25 SOL curves, at most 2 open). No averaging down; adds only
  into strength and capped by the single-tranche max.
- **Exits:** 30% take profit, a trailing stop that arms at +15% and exits on
  an 8-point pullback from the best gain, 7% hard stop, a bounce-failure exit
  when price falls back through the trough, or a 450-slot hold limit.

Deterministic: a pure function of the batches the harness sends — no clock,
no randomness, no network, no I/O.

## Layout

- `main.ts` — entrypoint (Node 22 runs it as-is).
- `strategy.ts` — the dip-bounce strategy.
- `vendor/agentfun-bot.ts` — the kit's bot shim, vendored byte for byte.

Built for the make.fun bounty
[u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed).
Referral code: `8dxq9bq0`.
