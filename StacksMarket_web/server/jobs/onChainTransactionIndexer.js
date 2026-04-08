const axios = require("axios");
const MarketConfig = require("../models/MarketConfig");
const Poll = require("../models/Poll");
const Trade = require("../models/Trade");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const LadderGroup = require("../models/LadderGroup");
const { syncPollOddsFromOnChainSnapshot, fetchParsedMarketSnapshot, deriveBinaryProbabilities } = require("../utils/onChainOddsSync");

const KNOWN_FUNCTIONS = {
  "buy-yes-auto": {
    kind: "buy",
    optionIndex: 0,
    amountArg: 1,
    totalArg: 3,
    totalKind: "max_cost_bound",
  },
  "buy-no-auto": {
    kind: "buy",
    optionIndex: 1,
    amountArg: 1,
    totalArg: 3,
    totalKind: "max_cost_bound",
  },
  "sell-yes-auto": {
    kind: "sell",
    optionIndex: 0,
    amountArg: 1,
    totalArg: 2,
    totalKind: "min_proceeds_bound",
  },
  "sell-no-auto": {
    kind: "sell",
    optionIndex: 1,
    amountArg: 1,
    totalArg: 2,
    totalKind: "min_proceeds_bound",
  },
  "buy-yes": { kind: "buy", optionIndex: 0, amountArg: 1, totalArg: null, totalKind: "missing" },
  "buy-no": { kind: "buy", optionIndex: 1, amountArg: 1, totalArg: null, totalKind: "missing" },
  "sell-yes": { kind: "sell", optionIndex: 0, amountArg: 1, totalArg: null, totalKind: "missing" },
  "sell-no": { kind: "sell", optionIndex: 1, amountArg: 1, totalArg: null, totalKind: "missing" },
  redeem: { kind: "redeem", amountArg: null, totalArg: null, totalKind: "n/a" },
  resolve: { kind: "resolve", amountArg: null, totalArg: null, totalKind: "n/a" },
  "set-max-trade": { kind: "admin", amountArg: null, totalArg: null, totalKind: "n/a" },
  "set-market-close-time": { kind: "admin", amountArg: null, totalArg: null, totalKind: "n/a" },
  pause: { kind: "admin", amountArg: null, totalArg: null, totalKind: "n/a" },
  unpause: { kind: "admin", amountArg: null, totalArg: null, totalKind: "n/a" },
  // Ladder / scalar market functions (v21)
  "create-ladder-group": { kind: "admin", amountArg: null, totalArg: null, totalKind: "n/a" },
  "add-rung": { kind: "add-rung", amountArg: null, totalArg: null, totalKind: "n/a" },
  "resolve-ladder-group": { kind: "resolve-ladder-group", amountArg: null, totalArg: null, totalKind: "n/a" },
  "resolve-rung": { kind: "resolve-rung", amountArg: null, totalArg: null, totalKind: "n/a" },
};

const FAILED_STATUSES = new Set([
  "abort_by_response",
  "abort_by_post_condition",
  "failed",
  "dropped_replace_by_fee",
  "dropped_replace_across_fork",
]);

function getNetwork() {
  const network = String(process.env.STACKS_NETWORK || "mainnet").toLowerCase();
  return network === "testnet" ? "testnet" : "mainnet";
}

function getHiroBaseUrl() {
  return getNetwork() === "testnet"
    ? "https://api.testnet.hiro.so"
    : "https://api.mainnet.hiro.so";
}

function getContractId() {
  const address =
    process.env.ONCHAIN_INDEXER_CONTRACT_ADDRESS ||
    process.env.CONTRACT_ADDRESS ||
    "ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP";
  const name =
    process.env.ONCHAIN_INDEXER_CONTRACT_NAME ||
    process.env.CONTRACT_NAME ||
    "market-factory-v21-testnet-bias";
  return `${address}.${name}`;
}

function normalizeTxId(txId) {
  const raw = String(txId || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function toIntOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseUIntRepr(repr) {
  const raw = String(repr || "").trim();
  const m = raw.match(/^u(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseAsciiRepr(repr) {
  const raw = String(repr || "").trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return "";
}

function parseOkUIntFromTxResult(repr) {
  const raw = String(repr || "").trim();
  const m = raw.match(/^\(ok u(\d+)\)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function getCursorPair(cfg) {
  const block = toIntOrNull(cfg?.lastProcessedBlock) ?? 0;
  const txIndex = toIntOrNull(cfg?.lastProcessedTxIndex) ?? -1;
  return { block, txIndex };
}

function isAfterCursor(tx, cursor) {
  const blockHeight = toIntOrNull(tx?.block_height) ?? -1;
  const txIndex = toIntOrNull(tx?.tx_index) ?? -1;
  if (blockHeight > cursor.block) return true;
  if (blockHeight < cursor.block) return false;
  return txIndex > cursor.txIndex;
}

function compareByChainOrderAsc(a, b) {
  const ba = toIntOrNull(a?.block_height) ?? 0;
  const bb = toIntOrNull(b?.block_height) ?? 0;
  if (ba !== bb) return ba - bb;
  const ia = toIntOrNull(a?.tx_index) ?? 0;
  const ib = toIntOrNull(b?.tx_index) ?? 0;
  return ia - ib;
}

function derivePriceProbability(totalValue, amountShares) {
  const total = Number(totalValue);
  const amount = Number(amountShares);
  if (!Number.isFinite(total) || !Number.isFinite(amount) || total <= 0 || amount <= 0) {
    return 0.5;
  }
  const p = total / (amount * 1_000_000);
  if (!Number.isFinite(p)) return 0.5;
  return Math.max(0, Math.min(1, p));
}

function classifyIndexedPrice(functionMeta, { hasExplicitTotal }) {
  const totalKind = String(functionMeta?.totalKind || "unknown");

  if (!hasExplicitTotal) {
    if (totalKind === "missing") {
      return { priceReliable: false, priceSource: "indexed_missing_total" };
    }
    return { priceReliable: false, priceSource: "indexed_fallback_amount" };
  }

  if (totalKind === "max_cost_bound") {
    return { priceReliable: false, priceSource: "indexed_max_cost_bound" };
  }

  if (totalKind === "min_proceeds_bound") {
    return { priceReliable: false, priceSource: "indexed_min_proceeds_bound" };
  }

  if (totalKind === "exact") {
    return { priceReliable: true, priceSource: "indexed_exact_total" };
  }

  return { priceReliable: false, priceSource: "indexed_unknown" };
}

async function fetchAddressTransactions(contractId, { limit, offset, timeoutMs, hiroApiKey }) {
  const hiroUrl = `${getHiroBaseUrl()}/extended/v1/address/${contractId}/transactions?limit=${limit}&offset=${offset}`;
  const res = await axios.get(hiroUrl, {
    timeout: timeoutMs,
    headers: hiroApiKey ? { "x-api-key": hiroApiKey } : undefined,
  });
  return res.data;
}

async function fetchTransactionById(txid, { timeoutMs, hiroApiKey }) {
  const hiroUrl = `${getHiroBaseUrl()}/extended/v1/tx/${normalizeTxId(txid)}`;
  const res = await axios.get(hiroUrl, {
    timeout: timeoutMs,
    headers: hiroApiKey ? { "x-api-key": hiroApiKey } : undefined,
  });
  return res.data;
}

async function emitTradeRealtime(io, trade) {
  if (!io || !trade) return;
  io.to(`poll-${trade.poll}`).emit("trade-updated", {
    pollId: trade.poll,
    trade,
    orderBook: await Trade.getOrderBook(trade.poll, trade.optionIndex),
  });
}

// Returns { synced, yesPct, noPct } on success, null on failure.
// Also returns the raw snapshot so callers can reuse it without a second Hiro call.
async function trySyncOnChainOdds(pollId, logger = console) {
  try {
    const poll = await Poll.findById(pollId).select("_id marketId options isResolved");
    if (!poll?.marketId) return null;

    // Fetch snapshot once; reuse for both odds sync and price repair
    const snapshot = await fetchParsedMarketSnapshot(poll.marketId);
    if (!snapshot) return null;

    const odds = deriveBinaryProbabilities(snapshot);
    if (!odds) return null;

    poll.options[0].percentage = odds.yesPct;
    poll.options[1].percentage = odds.noPct;
    poll.options[0].impliedProbability = odds.yesPct;
    poll.options[1].impliedProbability = odds.noPct;
    await poll.updatePercentages();

    logger.log?.(
      `[onchain-odds-sync] poll=${pollId} yes=${odds.yesPct}% no=${odds.noPct}%`
    );

    return { synced: true, yesPct: odds.yesPct, noPct: odds.noPct, snapshot };
  } catch (error) {
    logger.warn?.(
      `[onchain-odds-sync] failed poll=${pollId}: ${error?.message || error}`
    );
    return null;
  }
}

// Compute the pre-trade probability for every indexed trade by rolling back
// from the current on-chain state (most recent → oldest).
// Accepts a pre-fetched snapshot to avoid a redundant Hiro API call.
// Uses bulkWrite to update all prices in one DB round-trip.
async function repairTradePricesForPoll(pollId, snapshotOrNull, logger = console) {
  try {
    let snapshot = snapshotOrNull;
    if (!snapshot) {
      const poll = await Poll.findById(pollId).select("_id marketId");
      if (!poll?.marketId) return;
      // Skip polls with non-numeric marketIds (legacy UUID-format IDs)
      if (!/^\d+$/.test(String(poll.marketId).trim())) return;
      snapshot = await fetchParsedMarketSnapshot(poll.marketId);
    }
    if (!snapshot) return;

    const { b, rYes, rNo } = snapshot;

    // Only repair indexed trades; leave frontend_quote / offchain_orderbook untouched.
    // Using $in (not a regex) so Mongoose can hit the {poll,priceSource} compound index.
    const INDEXED_PRICE_SOURCES = [
      "indexed_exact_total",
      "indexed_exact_from_events",
      "indexed_onchain_snapshot",
      "indexed_max_cost_bound",
      "indexed_min_proceeds_bound",
      "indexed_missing_total",
      "indexed_fallback_amount",
      "indexed_unknown",
    ];
    const trades = await Trade.find({
      poll: pollId,
      status: "completed",
      type: { $in: ["buy", "sell"] },
      priceSource: { $in: INDEXED_PRICE_SOURCES },
    })
      .sort({ txConfirmedAt: -1, createdAt: -1 })
      .limit(500)
      .select("_id type optionIndex amount");

    if (!trades.length) return;

    let rqYes = snapshot.qYes;
    let rqNo  = snapshot.qNo;
    const ops = [];

    for (const trade of trades) {
      const amt = BigInt(Math.trunc(Number(trade.amount) || 0));

      // Undo this trade to get the state BEFORE it was executed
      if (trade.type === "buy") {
        if (trade.optionIndex === 0) rqYes = rqYes >= amt ? rqYes - amt : 0n;
        else                         rqNo  = rqNo  >= amt ? rqNo  - amt : 0n;
      } else {
        if (trade.optionIndex === 0) rqYes += amt;
        else                         rqNo  += amt;
      }

      const odds = deriveBinaryProbabilities({ b, qYes: rqYes, qNo: rqNo, rYes, rNo });
      if (!odds) continue;

      const price = trade.optionIndex === 0 ? odds.pYes : odds.pNo;
      ops.push({
        updateOne: {
          filter: { _id: trade._id },
          update: { $set: { price, priceReliable: true, priceSource: "indexed_onchain_snapshot" } },
        },
      });
    }

    if (ops.length) await Trade.bulkWrite(ops, { ordered: false });
  } catch (err) {
    logger.warn?.(`[trade-price-repair] poll=${pollId}: ${err?.message || err}`);
  }
}

// Atomic volume increment for on-chain indexed trades.
// Percentages are overwritten by trySyncOnChainOdds at end-of-tick, so we
// don't touch them here — that avoids a read-modify-write cycle per trade.
async function updateOptionVolume(pollId, optionIndex, amount) {
  const optIdxNum = Number(optionIndex);
  await Poll.findByIdAndUpdate(pollId, {
    $inc: {
      [`options.${optIdxNum}.totalVolume`]: Number(amount) || 0,
      [`options.${optIdxNum}.totalTrades`]: 1,
    },
  });
}

// Atomic statistics increment — avoids full collection scan per trade.
// uniqueTraders is incremented only when the user has no prior completed
// trades for this poll (i.e., this is their first).
async function updatePollStatistics(pollId, { userId, tradeTotal }) {
  const isFirstTrade = userId
    ? (await Trade.countDocuments({ poll: pollId, user: userId, status: "completed" })) <= 1
    : false;

  await Poll.findByIdAndUpdate(pollId, {
    $inc: {
      totalVolume: Number(tradeTotal) || 0,
      totalTrades: 1,
      ...(isFirstTrade ? { uniqueTraders: 1 } : {}),
    },
  });
}

async function upsertTradeFromIndexedTransaction({
  txid,
  tradeType,
  optionIndex,
  amount,
  totalValue,
  exactFromEvents = false,
  functionMeta,
  walletAddress,
  poll,
  txStatus,
  blockTime,
  io,
}) {
  if (!poll || !walletAddress) return;
  if (tradeType !== "buy" && tradeType !== "sell") return;
  if (txStatus !== "success") return;

  const user = await User.findOne({ walletAddress }).select("_id");
  if (!user) return;

  const safeAmount = Number.isFinite(Number(amount)) && Number(amount) > 0 ? Number(amount) : 0;
  if (safeAmount <= 0) return;

  const hasExplicitTotal =
    Number.isFinite(Number(totalValue)) && Number(totalValue) > 0;
  const safeTotal = hasExplicitTotal ? Number(totalValue) : safeAmount * 1_000_000;
  const inferredPrice = hasExplicitTotal
    ? derivePriceProbability(safeTotal, safeAmount)
    : 0.5;

  // If we extracted the exact STX amount from tx events, override classification
  const { priceReliable, priceSource } = exactFromEvents
    ? { priceReliable: true, priceSource: "indexed_exact_from_events" }
    : classifyIndexedPrice(functionMeta, { hasExplicitTotal });

  const existingByTx = await Trade.findOne({ transactionHash: txid }).select("_id");
  if (existingByTx) return;

  const pendingIntent = await Trade.findOne({
    isOnChain: true,
    status: "pending",
    user: user._id,
    poll: poll._id,
    type: tradeType,
    optionIndex,
    amount: safeAmount,
    $or: [{ transactionHash: "" }, { transactionHash: null }],
  }).sort({ createdAt: -1 });

  if (pendingIntent) {
    pendingIntent.transactionHash = txid;
    pendingIntent.status = "completed";
    pendingIntent.chainSyncStatus = "confirmed";
    pendingIntent.chainSyncError = "";
    pendingIntent.totalValue = safeTotal;
    pendingIntent.price = inferredPrice;
    pendingIntent.priceSource = priceSource;
    pendingIntent.priceReliable = priceReliable;
    pendingIntent.notes = `indexed-from-onchain:${priceSource}`;
    pendingIntent.filledAmount = safeAmount;
    pendingIntent.remainingAmount = 0;
    pendingIntent.txAttachedAt = pendingIntent.txAttachedAt || blockTime || new Date();
    pendingIntent.txConfirmedAt = pendingIntent.txConfirmedAt || blockTime || new Date();
    await pendingIntent.save();

    await updateOptionVolume(pendingIntent.poll, pendingIntent.optionIndex, pendingIntent.amount);
    await updatePollStatistics(pendingIntent.poll, { userId: pendingIntent.user, tradeTotal: pendingIntent.totalValue });
    await User.findByIdAndUpdate(pendingIntent.user, { $inc: { totalTrades: 1 } });
    await emitTradeRealtime(io, pendingIntent);
    return;
  }

  const trade = new Trade({
    poll: poll._id,
    user: user._id,
    type: tradeType,
    optionIndex,
    amount: safeAmount,
    price: inferredPrice,
    priceSource,
    priceReliable,
    totalValue: safeTotal,
    satsTotal: safeTotal,
    orderType: "market",
    status: "completed",
    filledAmount: safeAmount,
    remainingAmount: 0,
    isOnChain: true,
    transactionHash: txid,
    chainSyncStatus: "confirmed",
    txAttachedAt: blockTime || new Date(),
    txConfirmedAt: blockTime || new Date(),
    notes: `indexed-from-onchain:${priceSource}`,
  });

  await trade.save();
  await updateOptionVolume(trade.poll, trade.optionIndex, trade.amount);
  await updatePollStatistics(trade.poll, { userId: trade.user, tradeTotal: trade.totalValue });
  await User.findByIdAndUpdate(trade.user, { $inc: { totalTrades: 1 } });
  await emitTradeRealtime(io, trade);
}

async function applyRedeemSideEffect({ poll, walletAddress, payoutAmount, txStatus }) {
  if (txStatus !== "success") return;
  if (!poll || !walletAddress) return;

  const user = await User.findOne({ walletAddress }).select("_id");
  if (!user) return;

  const result = await Trade.updateMany(
    {
      poll: poll._id,
      user: user._id,
      status: "completed",
      claimed: { $ne: true },
    },
    {
      $set: {
        claimed: true,
        ...(Number.isFinite(payoutAmount) && payoutAmount > 0 ? { payoutAmount } : {}),
      },
    }
  );

  if (result.modifiedCount > 0) {
    console.log(
      `[onchain-indexer] redeem: marked ${result.modifiedCount} trade(s) claimed` +
      ` user=${walletAddress} poll=${poll._id}`
    );
  }
}

async function applyPollSideEffects({ poll, functionName, txStatus, args }) {
  if (!poll || txStatus !== "success") return;

  if (functionName === "resolve") {
    const outcome = parseAsciiRepr(args?.[1]) || "";
    if (outcome === "YES" || outcome === "NO") {
      poll.isResolved = true;
      poll.winningOption = outcome === "YES" ? 0 : 1;
      await poll.save();
    }
    return;
  }

  if (functionName === "set-max-trade") {
    const maxTrade = parseUIntRepr(args?.[1]);
    if (Number.isFinite(maxTrade)) {
      poll.maxTradeLimit = maxTrade;
      await poll.save();
    }
    return;
  }

  if (functionName === "set-market-close-time") {
    const closeTs = parseUIntRepr(args?.[1]);
    if (Number.isFinite(closeTs) && closeTs > 0) {
      poll.endDate = new Date(closeTs * 1000);
      await poll.save();
    }
    return;
  }

  if (functionName === "pause") {
    poll.isPaused = true;
    await poll.save();
    return;
  }

  if (functionName === "unpause") {
    poll.isPaused = false;
    await poll.save();
  }
}

/**
 * Handle ladder-group-level side effects that don't map to a single Poll.
 * Called from upsertFromContractTx for resolve-ladder-group, resolve-rung, add-rung.
 */
async function applyLadderSideEffects({ functionName, txStatus, rawArgs }) {
  if (txStatus !== "success") return;

  if (functionName === "resolve-ladder-group") {
    // args: (g: uint) (final-value: uint)
    // rawArgs[0] = group id repr, rawArgs[1] = final value repr
    const groupId = parseUIntRepr(rawArgs[0]);
    const finalValue = parseUIntRepr(rawArgs[1]);
    if (!Number.isFinite(groupId)) return;

    const update = { status: "resolving" };
    if (Number.isFinite(finalValue)) {
      update.finalValue = finalValue;
    }

    await LadderGroup.findOneAndUpdate({ groupId }, { $set: update });
    return;
  }

  if (functionName === "resolve-rung") {
    // args: (m: uint)
    // rawArgs[0] = market id repr
    const marketId = parseUIntRepr(rawArgs[0]);
    if (!Number.isFinite(marketId)) return;

    // The actual resolution outcome is determined by resolve-rung on-chain using
    // the stored final-value. We just mark the rung's group as "resolving" if not
    // already resolved — the full resolution is handled by resolve-ladder-group.
    const poll = await Poll.findOne({ marketId: String(marketId) }).select(
      "_id ladderGroupId"
    );
    if (!poll?.ladderGroupId) return;

    await LadderGroup.findOneAndUpdate(
      { groupId: poll.ladderGroupId, status: "active" },
      { $set: { status: "resolving" } }
    );
    return;
  }

  if (functionName === "add-rung") {
    // args: (g: uint) (m: uint) (threshold: uint) (operator: string) (label: string) (initial-liquidity: uint)
    // rawArgs[0] = group id, rawArgs[1] = market id
    // No automatic DB side-effect here beyond what the admin REST route already handles.
    // Log for audit purposes only.
    const groupId = parseUIntRepr(rawArgs[0]);
    const marketId = parseUIntRepr(rawArgs[1]);
    if (Number.isFinite(groupId) && Number.isFinite(marketId)) {
      console.log(
        `[onchain-indexer] add-rung detected: groupId=${groupId} marketId=${marketId}`
      );
    }
  }
}

// Extract actual STX amount from tx events (exact, not a slippage bound)
// For buys:  find stx_transfer sender=walletAddress → recipient=contractId
// For sells: find stx_transfer sender=contractId    → recipient=walletAddress
function extractActualTotalFromEvents(tx, tradeType, walletAddress, contractId) {
  const events = Array.isArray(tx?.events) ? tx.events : [];
  const selfLower = String(walletAddress || "").toLowerCase();
  const contractLower = String(contractId || "").toLowerCase();

  for (const event of events) {
    if (String(event?.event_type || "") !== "stx_asset") continue;
    // Hiro API uses either event.stx or event.asset depending on version
    const stx = event?.stx || event?.asset;
    if (String(stx?.asset_event_type || stx?.type || "transfer") !== "transfer") continue;
    const sender = String(stx?.sender || "").toLowerCase();
    const recipient = String(stx?.recipient || "").toLowerCase();
    const amount = Number(stx?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    if (tradeType === "buy" && sender === selfLower && recipient === contractLower) return amount;
    if (tradeType === "sell" && sender === contractLower && recipient === selfLower) return amount;
  }
  return null;
}

async function upsertFromContractTx({ tx, contractId, io }) {
  const txid = normalizeTxId(tx?.tx_id);
  if (!txid) return { processed: false };

  const contractCall = tx?.contract_call || {};
  if (contractCall?.contract_id !== contractId) return { processed: false };

  const functionName = String(contractCall?.function_name || "");
  const functionMeta = KNOWN_FUNCTIONS[functionName] || { kind: "unknown" };
  const rawArgs = Array.isArray(contractCall?.function_args)
    ? contractCall.function_args.map((a) => String(a?.repr || ""))
    : [];

  const txStatus = String(tx?.tx_status || "").toLowerCase();
  const blockHeight = toIntOrNull(tx?.block_height);
  const txIndex = toIntOrNull(tx?.tx_index) ?? 0;
  const marketIdNum = parseUIntRepr(rawArgs[0]);
  const marketId = Number.isFinite(marketIdNum) ? String(marketIdNum) : "";
  const walletAddress = String(tx?.sender_address || "").trim();
  const amountFromArg =
    functionMeta.amountArg != null ? parseUIntRepr(rawArgs[functionMeta.amountArg]) : null;
  const amountFromResult = parseOkUIntFromTxResult(tx?.tx_result?.repr);
  const amount = Number.isFinite(amountFromArg) ? amountFromArg : amountFromResult;

  let totalValue =
    functionMeta.totalArg != null ? parseUIntRepr(rawArgs[functionMeta.totalArg]) : null;
  if (!Number.isFinite(totalValue) && functionMeta.kind === "redeem") {
    totalValue = parseOkUIntFromTxResult(tx?.tx_result?.repr);
  }

  // For buy/sell: replace arg-based total (which is a slippage bound, not exact)
  // with the actual STX transferred, extracted from tx events.
  let exactTotalFromEvents = null;
  if (functionMeta.kind === "buy" || functionMeta.kind === "sell") {
    exactTotalFromEvents = extractActualTotalFromEvents(
      tx,
      functionMeta.kind,
      walletAddress,
      contractId
    );
  }
  const effectiveTotalValue = exactTotalFromEvents ?? totalValue;

  const poll = marketId ? await Poll.findOne({ marketId }) : null;
  const user = walletAddress ? await User.findOne({ walletAddress }).select("_id") : null;

  const blockTime = tx?.block_time_iso
    ? new Date(tx.block_time_iso)
    : Number.isFinite(Number(tx?.block_time))
      ? new Date(Number(tx.block_time) * 1000)
      : null;

  await Transaction.findOneAndUpdate(
    { txid },
    {
      $set: {
        txid,
        network: getNetwork(),
        status: txStatus || "pending",
        blockHeight,
        txIndex,
        blockTime,
        contractId,
        functionName,
        kind: functionMeta.kind || "unknown",
        marketId,
        poll: poll?._id || null,
        walletAddress,
        user: user?._id || null,
        optionIndex: functionMeta.optionIndex ?? null,
        amount: Number.isFinite(amount) ? amount : null,
        totalValue: Number.isFinite(totalValue) ? totalValue : null,
        txResultRepr: String(tx?.tx_result?.repr || ""),
        rawArgs,
        syncedAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  if (functionMeta.kind === "buy" || functionMeta.kind === "sell") {
    await upsertTradeFromIndexedTransaction({
      txid,
      tradeType: functionMeta.kind,
      optionIndex: functionMeta.optionIndex,
      amount,
      totalValue: effectiveTotalValue,
      exactFromEvents: exactTotalFromEvents != null,
      functionMeta,
      walletAddress,
      poll,
      txStatus,
      blockTime,
      io,
    });
  }

  if (functionMeta.kind === "redeem") {
    await applyRedeemSideEffect({
      poll,
      walletAddress,
      payoutAmount: totalValue, // parsed from tx result (ok uXXX)
      txStatus,
    });
  }

  await applyPollSideEffects({ poll, functionName, txStatus, args: rawArgs });

  // Handle ladder-specific side effects (resolve-ladder-group, resolve-rung, add-rung)
  if (
    functionName === "resolve-ladder-group" ||
    functionName === "resolve-rung" ||
    functionName === "add-rung"
  ) {
    await applyLadderSideEffects({ functionName, txStatus, rawArgs });
  }

  return {
    processed: true,
    failed: FAILED_STATUSES.has(txStatus),
    blockHeight,
    txIndex,
    txid,
    pollId: poll?._id ?? null,
    isTrade: (functionMeta.kind === "buy" || functionMeta.kind === "sell") && txStatus === "success",
  };
}

function createOnChainTransactionIndexer({ io, logger = console } = {}) {
  const intervalRaw = Number(process.env.ONCHAIN_INDEXER_INTERVAL_MS);
  const pageSizeRaw = Number(process.env.ONCHAIN_INDEXER_PAGE_SIZE);
  const maxPagesRaw = Number(process.env.ONCHAIN_INDEXER_MAX_PAGES);
  const timeoutRaw = Number(process.env.ONCHAIN_INDEXER_HIRO_TIMEOUT_MS);

  const intervalMs = Math.max(5000, Number.isFinite(intervalRaw) ? intervalRaw : 15000);
  const pageSize = Math.max(1, Math.min(50, Number.isFinite(pageSizeRaw) ? pageSizeRaw : 25));
  const maxPages = Math.max(1, Math.min(40, Number.isFinite(maxPagesRaw) ? maxPagesRaw : 8));
  const hiroTimeoutMs = Math.max(2000, Number.isFinite(timeoutRaw) ? timeoutRaw : 10000);

  const hiroApiKey = process.env.HIRO_API_KEY;
  const contractId = getContractId();

  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;

    try {
      let cfg = await MarketConfig.findOne();
      if (!cfg) cfg = await MarketConfig.create({});

      const cursor = getCursorPair(cfg);

      let offset = 0;
      let page = 0;
      let shouldStop = false;
      const toProcess = [];

      while (!shouldStop && page < maxPages) {
        const payload = await fetchAddressTransactions(contractId, {
          limit: pageSize,
          offset,
          timeoutMs: hiroTimeoutMs,
          hiroApiKey,
        });

        const results = Array.isArray(payload?.results) ? payload.results : [];
        if (!results.length) break;

        const contractCalls = results.filter(
          (tx) => tx?.tx_type === "contract_call" && tx?.contract_call?.contract_id === contractId
        );

        for (const tx of contractCalls) {
          if (isAfterCursor(tx, cursor)) toProcess.push(tx);
        }

        const oldest = contractCalls[contractCalls.length - 1] || results[results.length - 1];
        if (!oldest || !isAfterCursor(oldest, cursor)) {
          shouldStop = true;
        }

        offset += results.length;
        page += 1;
      }

      if (!toProcess.length) {
        cfg.lastIndexedAt = new Date();
        await cfg.save();
        return;
      }

      toProcess.sort(compareByChainOrderAsc);

      let latestBlock = cursor.block;
      let latestTxIndex = cursor.txIndex;
      let latestTxId = cfg.lastProcessedTxId || null;
      let processed = 0;
      const touchedPollIds = new Set(); // polls with new buy/sell trades this tick

      for (const summary of toProcess) {
        const txid = normalizeTxId(summary?.tx_id);
        if (!txid) continue;

        let detail;
        try {
          detail = await fetchTransactionById(txid, {
            timeoutMs: hiroTimeoutMs,
            hiroApiKey,
          });
        } catch (err) {
          const status = err?.response?.status;
          if (status === 404) continue;
          throw err;
        }

        const out = await upsertFromContractTx({ tx: detail, contractId, io });
        if (!out?.processed) continue;

        processed += 1;
        if (out.pollId && out.isTrade) touchedPollIds.add(String(out.pollId));

        if (
          Number.isFinite(out.blockHeight) &&
          (out.blockHeight > latestBlock ||
            (out.blockHeight === latestBlock && Number(out.txIndex) > latestTxIndex))
        ) {
          latestBlock = out.blockHeight;
          latestTxIndex = Number(out.txIndex) || 0;
          latestTxId = out.txid;
        }
      }

      // Sync odds + repair trade prices once per touched poll (not once per trade)
      for (const pollId of touchedPollIds) {
        const syncResult = await trySyncOnChainOdds(pollId, logger);
        await repairTradePricesForPoll(pollId, syncResult?.snapshot ?? null, logger);
      }

      if (processed > 0) {
        cfg.lastProcessedBlock = latestBlock;
        cfg.lastProcessedTxIndex = latestTxIndex;
        cfg.lastProcessedTxId = latestTxId;
      }
      cfg.lastIndexedAt = new Date();
      await cfg.save();

      if (processed > 0) {
        logger.log?.(
          `[onchain-indexer] processed=${processed} cursor=${cfg.lastProcessedBlock}:${cfg.lastProcessedTxIndex}`
        );
      }
    } catch (err) {
      logger.error?.("[onchain-indexer] Tick error:", err?.message || err);
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    logger.log?.(
      `[onchain-indexer] enabled contract=${contractId} interval=${intervalMs}ms pageSize=${pageSize} maxPages=${maxPages}`
    );
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    void tick();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = { createOnChainTransactionIndexer, repairTradePricesForPoll };
