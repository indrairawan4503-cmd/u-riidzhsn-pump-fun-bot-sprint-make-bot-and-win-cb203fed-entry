// Dip-bounce mean reversion on pump.fun bonding curves (variant A).
//
// Idea: a mature, liquid curve that ran up, then dropped hard (45-65%) from its
// recent high, and has now started to bounce — price up off a fresh trough with
// buyers stepping back in — tends to recover part of the dip before fading
// again. We buy ONLY after the bounce confirms (never into a still-falling
// knife), in one fixed tranche per position, and exit fast: take profit, a
// trailing stop once a winner runs, a hard stop, a bounce-failure exit when
// price falls back through the trough, or a hold limit. Selectivity (deep dip,
// mature curve, strong real SOL, fresh trough) is what makes the edge; the
// single-tranche size and the trailing exit are what size it.
//
// Everything here is a pure function of the batches the harness sends: no clock,
// no randomness, no I/O, so the two graded executions produce byte-identical
// action logs. Iteration order is always deterministic (sorted mints for held
// positions, batch order for touched mints).

import type { Batch, BotState, Mark, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Lookback (slots) for the recent high the drawdown is measured from. */
  highWindow: number;
  /** Lookback (slots) for the trough the bounce is measured from. */
  troughWindow: number;
  /** Enter when price is at least this far below the recent high (fraction)... */
  ddMin: number;
  /** ...and not further than this (a collapse, not a dip). */
  ddMax: number;
  /** Price must have risen at least this far off the trough (fraction). */
  bounceMin: number;
  /** The trough must be no older than this many slots. */
  troughFresh: number;
  /** Minimum ticks seen on the curve before an entry is considered. */
  minTicks: number;
  /** The recent high must be no older than this many slots (0 = off). */
  highFresh: number;
  /** The drop from the high to the trough must have taken at most this many slots (0 = off). */
  dropSpeedMax: number;
  /** Minimum slots since the curve's CreateEvent before an entry is allowed (0 = off). */
  minAge: number;
  /** The curve must hold at least this much real SOL (lamports) at decision time. */
  minRealSol: bigint;
  /** Weak-tier entries need at least this much real SOL (lamports). */
  weakMinRealSol: bigint;
  /** The recent high must have come with at least this much real SOL (lamports). */
  minHighRealSol: bigint;
  /** Of the last `flowTrades` trades at least `minBuys` must be buys... */
  flowTrades: number;
  minBuys: number;
  /** ...and the most recent trade must be a buy (buyers stepping in). */
  lastMustBeBuy: boolean;
  /** Net SOL bought over the last `flowTrades` trades must be at least this (lamports). */
  minNetFlow: bigint;
  /** Lamports per tranche (capped by the reply size cap) and most lamports per position. */
  tranche: bigint;
  maxPosition: bigint;
  /** Smallest buy worth sending (tx fees are 105k lamports per order). */
  minBuy: bigint;
  /** Add a tranche only once price is this far above the last buy's price... */
  addStep: number;
  /** ...and only while the position is at least this far in profit. */
  addIfUp: number;
  /** Take profit when the position's liquidation value reaches cost * (1 + takeProfit). */
  takeProfit: number;
  /** Stop when liquidation value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** Trailing stop arms once the best gain reaches this; exit if gain falls this far below it. */
  trailArm: number;
  trailDrop: number;
  /** Or when the price recovers this share of the gap between entry and the recent high... */
  recoverShare: number;
  /** ...provided the gain is at least this. */
  recoverMinGain: number;
  /** Exit when the price falls back below the trough it bounced from times this (0 = off). */
  bounceFailMult: number;
  /** After an exit, ignore the coin for this many slots. */
  cooldownSlots: number;
  /** Slippage tolerance on buys and on sells (bps). */
  buySlippageBps: number;
  sellSlippageBps: number;
  /** Most new entries per reply. */
  maxEntriesPerBatch: number;
  /**
   * Curves holding at least this much real SOL at entry are "strong" and get full size; weaker ones
   * (down to minRealSol) get a small probe size, and at most maxWeakOpen of them are held at once.
   */
  strongRealSol: bigint;
  weakTranche: bigint;
  weakMaxPosition: bigint;
  maxWeakOpen: number;
  /** Hold limit / exits for weak-tier positions (slots). */
  weakMaxHoldSlots: number;
  /** Drawdown band and bounce confirmation for weak-tier entries. */
  weakDdMin: number;
  weakDdMax: number;
  weakBounceMin: number;
  weakTakeProfit: number;
  weakStopLoss: number;
  /** Exits are sent as this many equal sells in one reply. */
  sellSplits: number;
}

// Defaults — tuned on the dev window over ~60 sweep configs (see sim-a sweep
// history): a deep 45-65% dip on a mature, liquid curve, a >=6% bounce off a
// fresh trough, 0.60 SOL single-tranche entries, 30% take profit with a
// trailing stop that arms at +15% and exits on an 8-point pullback, 7% stop,
// 450-slot hold limit. 32 coins, win rate ~37%, DD ~2% on dev.
export const DEFAULT_PARAMS: Params = {
  highWindow: 2000,
  troughWindow: 600,
  ddMin: 0.45,
  ddMax: 0.65,
  bounceMin: 0.06,
  troughFresh: 150,
  minTicks: 10,
  highFresh: 0,
  dropSpeedMax: 0,
  minAge: 500,
  minRealSol: 3_000_000_000n,
  weakMinRealSol: 8_000_000_000n,
  minHighRealSol: 25_000_000_000n,
  flowTrades: 6,
  minBuys: 4,
  lastMustBeBuy: true,
  minNetFlow: 0n,
  tranche: 600_000_000n,
  maxPosition: 600_000_000n,
  minBuy: 8_000_000n,
  addStep: 0.03,
  addIfUp: 0.0,
  takeProfit: 0.3,
  stopLoss: 0.07,
  trailArm: 0.15,
  trailDrop: 0.08,
  recoverShare: 0.5,
  recoverMinGain: 0.03,
  bounceFailMult: 0.99,
  maxHoldSlots: 450,
  cooldownSlots: 120,
  buySlippageBps: 500,
  sellSlippageBps: 3000,
  maxEntriesPerBatch: 3,
  strongRealSol: 25_000_000_000n,
  weakTranche: 20_000_000n,
  weakMaxPosition: 40_000_000n,
  maxWeakOpen: 2,
  weakMaxHoldSlots: 150,
  weakDdMin: 0.45,
  weakDdMax: 0.65,
  weakBounceMin: 0.06,
  weakTakeProfit: 0.15,
  weakStopLoss: 0.08,
  sellSplits: 2,
};

interface Tick {
  slot: number;
  /** virtual SOL / virtual tokens: the marginal price. */
  price: number;
  realSol: bigint;
  isBuy: boolean;
  sol: bigint;
}

interface Book {
  ticks: Tick[];
  /** Price and slot of the first fill decision, the recent high, and the trough we bounced from. */
  entryPrice: number;
  entrySlot: number;
  entryHigh: number;
  entryTrough: number;
  /** Price of the last buy into this position (for pyramid-into-strength adds). */
  lastBuyPrice: number;
  /** Best liquidation-value gain seen since entry (for the trailing stop). */
  bestGain: number;
  /** Lamports committed to buys on this position (sent, filled or not). */
  committed: bigint;
  /** Slot until which the coin is ignored after an exit. */
  coolUntil: number;
  /** A sell is in flight: do not send another. */
  exiting: boolean;
  /** Entered as a strong-tier position. */
  strong: boolean;
}

const FEE_BPS = 125n;
const BPS = 10_000n;

/**
 * The per-reply buy cap, with a margin: the harness checks it against the reserves shifted by our
 * own earlier flow on the coin, which can sit a little below the recorded ones the SDK keeps.
 */
function buyCap(state: BotState, mint: Pubkey): bigint {
  return (state.maxBuyLamports(mint) * 97n) / 100n;
}

/**
 * What selling `tokens` would pay, curve fees deducted, against the reserves the harness marks for
 * the mint (the recorded reserves shifted by our own net flow into the curve).
 */
function liquidationValue(mark: Mark | undefined, tokens: bigint): bigint {
  if (mark === undefined) return 0n;
  const vq = BigInt(mark.virtual_quote_reserves);
  const vt = BigInt(mark.virtual_token_reserves);
  const rq = BigInt(mark.real_quote_reserves);
  if (vt + tokens === 0n) return 0n;
  let q = (tokens * vq) / (vt + tokens);
  if (q > rq) q = rq;
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(p: Params = DEFAULT_PARAMS) {
  const books = new Map<Pubkey, Book>();
  const book = (mint: Pubkey): Book => {
    let b = books.get(mint);
    if (b === undefined) {
      b = {
        ticks: [], entryPrice: 0, entrySlot: -1, entryHigh: 0, entryTrough: 0,
        lastBuyPrice: 0, bestGain: 0, committed: 0n, coolUntil: -1, exiting: false, strong: false,
      };
      books.set(mint, b);
    }
    return b;
  };

  /** Recent high and trough of a tick tape, within their windows, plus the trough's slot. */
  function highAndTrough(ticks: Tick[], slot: number): { hi: number; hiReal: bigint; hiSlot: number; lo: number; loSlot: number } {
    let hi = 0;
    let hiReal = 0n;
    let hiSlot = -1;
    let lo = Number.POSITIVE_INFINITY;
    let loSlot = -1;
    for (let i = ticks.length - 1; i >= 0; i--) {
      const t = ticks[i]!;
      if (slot - t.slot > p.highWindow) break;
      if (t.price > hi) {
        hi = t.price;
        hiReal = t.realSol;
        hiSlot = t.slot;
      }
      if (slot - t.slot <= p.troughWindow && t.price < lo) {
        lo = t.price;
        loSlot = t.slot;
      }
    }
    if (lo === Number.POSITIVE_INFINITY) lo = 0;
    return { hi, hiReal, hiSlot, lo, loSlot };
  }

  return function onBatch(state: BotState, batch: Batch): OrderInput[] {
    const slot = batch.slot;
    const touched: Pubkey[] = [];
    for (const e of batch.events) {
      if (e.event === 'TradeEvent') {
        const b = book(e.mint);
        const vt = BigInt(e.virtual_token_reserves);
        const price = vt === 0n ? 0 : Number(BigInt(e.virtual_quote_reserves)) / Number(vt);
        b.ticks.push({ slot, price, realSol: BigInt(e.real_quote_reserves), isBuy: e.is_buy, sol: BigInt(e.sol_amount) });
        if (b.ticks.length > 500) b.ticks.splice(0, b.ticks.length - 500);
        if (touched[touched.length - 1] !== e.mint && !touched.includes(e.mint)) touched.push(e.mint);
      } else if (e.event === 'CompleteEvent') {
        // The curve is done; forget any entry bookkeeping so a later mint reuse cannot inherit it.
        const b = books.get(e.mint);
        if (b !== undefined) {
          b.committed = 0n;
          b.entrySlot = -1;
          b.exiting = false;
        }
      }
    }
    // A position whose sell resolved (or failed) may need another exit attempt.
    for (const f of batch.fills) {
      const b = books.get(f.mint);
      if (b === undefined) continue;
      if (f.side === 'sell') {
        b.exiting = false;
        if (!state.positions.has(f.mint)) {
          b.committed = 0n;
          b.entrySlot = -1;
          b.bestGain = 0;
          b.coolUntil = slot + p.cooldownSlots;
        }
      } else if (f.status !== 'filled' && !state.positions.has(f.mint)) {
        // The opening buy never filled: forget the entry.
        let stillPending = false;
        for (const o of state.pending.values()) if (o.order.mint === f.mint) stillPending = true;
        if (!stillPending) {
          b.committed = 0n;
          b.entrySlot = -1;
          b.bestGain = 0;
        }
      }
    }

    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = state.txFeeLamports();
    const marks = new Map<Pubkey, Mark>();
    for (const m of batch.marks) marks.set(m.mint, m);
    const pendingMints = new Set<Pubkey>();
    for (const o of state.pending.values()) pendingMints.add(o.order.mint);

    // 1. Exits and adds on held positions, in mint order (deterministic).
    const held = [...state.positions.keys()].sort();
    for (const mint of held) {
      if (orders.length >= cap) break;
      const h = state.positions.get(mint)!;
      const b = book(mint);
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      if (b.exiting) continue;
      const value = liquidationValue(marks.get(mint), h.token_amount);
      const ticks = b.ticks;
      const price = ticks.length > 0 ? ticks[ticks.length - 1]!.price : 0;
      const entrySlot = b.entrySlot < 0 ? slot : b.entrySlot;
      const gain = h.cost_lamports > 0n ? Number(value - h.cost_lamports) / Number(h.cost_lamports) : 0;
      if (gain > b.bestGain) b.bestGain = gain;
      const tp = gain >= (b.strong ? p.takeProfit : p.weakTakeProfit);
      const trail = b.bestGain >= p.trailArm && gain <= b.bestGain - p.trailDrop;
      const target = b.entryPrice + p.recoverShare * (b.entryHigh - b.entryPrice);
      const recover = p.recoverShare > 0 && price >= target && gain >= p.recoverMinGain;
      const sl = gain <= -(b.strong ? p.stopLoss : p.weakStopLoss);
      // The bounce failed: price fell back through the trough it bounced from.
      const bounceFail = p.bounceFailMult > 0 && b.entryTrough > 0 && price < b.entryTrough * p.bounceFailMult;
      const stale = slot - entrySlot >= (b.strong ? p.maxHoldSlots : p.weakMaxHoldSlots);
      if (tp || trail || recover || sl || bounceFail || stale) {
        if (pendingMints.has(mint)) continue;
        const n = BigInt(Math.max(1, Math.min(p.sellSplits, cap - orders.length)));
        const piece = h.token_amount / n;
        for (let i = 1n; i <= n; i++) {
          const amount = i === n ? h.token_amount - piece * (n - 1n) : piece;
          orders.push({ side: 'sell', mint, token_amount: amount, max_slippage_bps: p.sellSlippageBps });
        }
        b.exiting = true;
        continue;
      }
      // Add a tranche only into strength: price above the last buy, position not underwater.
      const maxPos = b.strong ? p.maxPosition : p.weakMaxPosition;
      if (pendingMints.has(mint) || b.committed >= maxPos) continue;
      if (b.lastBuyPrice <= 0 || price < b.lastBuyPrice * (1 + p.addStep)) continue;
      if (gain < p.addIfUp) continue;
      // Still a dip buy, not a chase: price must still sit below the recent high.
      if (b.entryHigh > 0 && price > b.entryHigh * 0.9) continue;
      let amount = maxPos - b.committed;
      const tranche = b.strong ? p.tranche : p.weakTranche;
      if (amount > tranche) amount = tranche;
      const sizeCap = buyCap(state, mint);
      if (amount > sizeCap) amount = sizeCap;
      if (amount < p.minBuy) continue;
      if (state.freeCashLamports() - amount - tx < 0n) continue;
      orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
      b.committed += amount;
      b.lastBuyPrice = price;
      pendingMints.add(mint);
    }

    // 2. New entries on coins that traded this slot.
    let entries = 0;
    let open = state.committedPositionCount();
    let weakOpen = 0;
    for (const m of state.positions.keys()) if (!book(m).strong) weakOpen++;
    for (const o of state.pending.values()) if (o.order.side === 'buy' && !state.positions.has(o.order.mint) && !book(o.order.mint).strong) weakOpen++;
    for (const mint of touched) {
      if (orders.length >= cap || entries >= p.maxEntriesPerBatch) break;
      if (open >= state.hello.caps.max_open_positions) break;
      if (state.positions.has(mint) || pendingMints.has(mint)) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      if (p.minAge > 0 && (curve.created_slot === null || slot - curve.created_slot < p.minAge)) continue;
      const b = book(mint);
      if (slot < b.coolUntil) continue;
      const ticks = b.ticks;
      if (ticks.length < Math.max(p.minTicks, p.flowTrades)) continue;
      const last = ticks[ticks.length - 1]!;
      if (last.realSol < p.minRealSol) continue;
      const { hi, hiReal, hiSlot, lo, loSlot } = highAndTrough(ticks, slot);
      if (hi <= 0 || lo <= 0 || hiReal < p.minHighRealSol) continue;
      if (p.highFresh > 0 && (hiSlot < 0 || slot - hiSlot > p.highFresh)) continue;
      if (p.dropSpeedMax > 0 && (hiSlot < 0 || loSlot < hiSlot || loSlot - hiSlot > p.dropSpeedMax)) continue;
      if (loSlot < 0 || slot - loSlot > p.troughFresh) continue;
      const dd = 1 - last.price / hi;
      const bounce = last.price / lo - 1;
      const strong = last.realSol >= p.strongRealSol;
      if (!strong && last.realSol < p.weakMinRealSol) continue;
      const ddMin = strong ? p.ddMin : p.weakDdMin;
      const ddMax = strong ? p.ddMax : p.weakDdMax;
      const bounceMin = strong ? p.bounceMin : p.weakBounceMin;
      if (dd < ddMin || dd > ddMax) continue;
      if (bounce < bounceMin) continue;
      // Buyers still stepping in: recent tape mostly buys, net flow non-negative, last trade a buy.
      let buys = 0;
      let net = 0n;
      for (let i = ticks.length - p.flowTrades; i < ticks.length; i++) {
        const t = ticks[i]!;
        if (t.isBuy) {
          buys++;
          net += t.sol;
        } else net -= t.sol;
      }
      if (buys < p.minBuys || net < p.minNetFlow) continue;
      if (p.lastMustBeBuy && !last.isBuy) continue;
      if (!strong && weakOpen >= p.maxWeakOpen) continue;
      let amount = strong ? p.tranche : p.weakTranche;
      const maxPos = strong ? p.maxPosition : p.weakMaxPosition;
      if (amount > maxPos) amount = maxPos;
      const sizeCap = buyCap(state, mint);
      if (amount > sizeCap) amount = sizeCap;
      if (amount < p.minBuy) continue;
      if (state.freeCashLamports() - amount - tx < 0n) continue;
      orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
      b.entryPrice = last.price;
      b.entrySlot = slot;
      b.entryHigh = hi;
      b.entryTrough = lo;
      b.lastBuyPrice = last.price;
      b.bestGain = 0;
      b.committed = amount;
      b.exiting = false;
      b.strong = strong;
      pendingMints.add(mint);
      entries++;
      open++;
      if (!strong) weakOpen++;
    }
    return orders;
  };
}
